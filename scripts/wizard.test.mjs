import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServerEnv, hashAdminPassword, setupPayloadSchema, toDeploymentConfig, verifyAdminPassword } from "../wizard/config.mjs";
import { buildDeploymentArtifacts } from "../utils/deployment-config.mjs";
import { renderSetupPage } from "../wizard/ui.mjs";
import {
  buildPublicFrontendConfig,
  createSetupServer,
  createStaticAppServer,
  parseDotEnvFile,
  resolveAppStartInvocation,
  sameOrigin,
  writePublicFrontendArtifacts,
} from "../wizard/server.mjs";
import { parseArgs } from "../bin/setup.mjs";
import {
  createSetupWizardCore,
  mountSetupGuard,
  parseEnvFile,
  readSetupRuntimeConfig,
  verifyAdminCredentials,
} from "../wizard/core.mjs";

const VALID_PAYLOAD = {
  deployment: {
    mode: "localhost",
    publicUrl: "http://localhost:5000/",
    basePath: "/",
    allowedOrigins: ["http://localhost:5000", "http://127.0.0.1:5000"],
    trustProxyHops: 0,
    retention: {
      enabled: true,
      actionLogDays: 180,
      readNotificationDays: 90,
      emailLogDays: 60,
      passwordResetDays: 30,
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5000,
  },
  admin: {
    name: "Sistem Yöneticisi",
    email: "admin@kurum.gov.tr",
    password: "Guclu_Parola_2026!",
  },
  email: {
    enabled: false,
  },
  buildClient: false,
  overwriteExistingEnv: false,
};

test("wizard/config: retention ayarları ve app.db varsayılanı .env çıktısına eksiksiz yazılır", () => {
  const parsed = setupPayloadSchema.parse(VALID_PAYLOAD);
  const envText = buildServerEnv(parsed, "fixed_secret_123");
  assert.match(envText, /DATABASE_URL="file:\.\.\/data\/app\.db"/);
  assert.match(envText, /RETENTION_ENABLED=true/);
  assert.match(envText, /RETENTION_ACTION_LOG_DAYS=180/);
  assert.match(envText, /RETENTION_READ_NOTIFICATION_DAYS=90/);
  assert.match(envText, /RETENTION_EMAIL_LOG_DAYS=60/);
  assert.match(envText, /RETENTION_PASSWORD_RESET_DAYS=30/);
  assert.match(envText, /FRONTEND_URL="http:\/\/localhost:5000"/);
});

test("wizard/config: zayıf parola ve Gmail dışı SMTP adresi reddedilir", () => {
  assert.throws(
    () =>
      setupPayloadSchema.parse({
        ...VALID_PAYLOAD,
        admin: { ...VALID_PAYLOAD.admin, password: "Password123456" },
      }),
    /Girilen bilgiler doğrulanamadı/,
  );

  assert.throws(
    () =>
      setupPayloadSchema.parse({
        ...VALID_PAYLOAD,
        email: {
          enabled: true,
          user: "test@yahoo.com",
          fromEmail: "test@yahoo.com",
          fromName: "Test",
          password: "abcd efgh ijkl mnop",
        },
      }),
    /Girilen bilgiler doğrulanamadı/,
  );
});

test("wizard/ui: XSS kaçışı, running CSS sınıfı ve e-posta doğrulaması içerir", () => {
  const html = renderSetupPage("csrf_123", { title: 'Test <script>alert(1)</script>' });
  assert.equal(html.includes("<script>alert(1)</script>"), false);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /\.pwd-rules \.running\{color:var\(--run\)/);
  assert.match(html, /s\.status==='running'\?'running':''/);
  assert.match(html, /escapeHtml\(JSON\.stringify\(s\.detected,null,2\)\)/);
  assert.match(html, /function validateEmailFields\(\)/);
});

test("wizard/server: Host başlığı sahteciliğine (Host Header Spoofing) karşı korumalıdır", () => {
  assert.equal(
    sameOrigin({ headers: { origin: "http://evil.com:5050", host: "evil.com:5050" } }, 5050),
    false,
  );
  assert.equal(
    sameOrigin({ headers: { origin: "http://localhost:5050", host: "localhost:5050" } }, 5050),
    true,
  );
  assert.equal(
    sameOrigin({ headers: { origin: "http://127.0.0.1:5050", host: "127.0.0.1:5050" } }, 5050),
    true,
  );
});

test("wizard/server E2E: token oturumu (setup.wizard), rate limit, /api/apply ve .env + lock üretimi", async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "setup-wizard-e2e-"));
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

  const token = "wizard_secret_token_1234567890_abcdef";
  const server = createSetupServer(token, { projectRoot: tmpRoot, forceServerSubdir: true });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  // 1. Token ile oturum açma
  const loginRes = await fetch(`${baseUrl}/setup?token=${token}`, { redirect: "manual" });
  assert.equal(loginRes.status, 303);
  const cookiePair = loginRes.headers.get("set-cookie").split(";")[0];
  assert.match(cookiePair, /^setup\.wizard=/);

  // 2. Sayfadan CSRF okuma
  const pageRes = await fetch(`${baseUrl}/setup`, { headers: { Cookie: cookiePair } });
  const html = await pageRes.text();
  const csrf = JSON.parse(html.match(/window\.__SETUP__=(\{[^;]+\});/)[1]).csrfToken;

  // 3. Kurulum öncesi /api/start-app çağrısı engellenmeli (409)
  const earlyStart = await fetch(`${baseUrl}/api/start-app`, {
    method: "POST",
    headers: {
      Cookie: cookiePair,
      "X-Setup-CSRF": csrf,
      Origin: `http://localhost:${port}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(earlyStart.status, 409);

  // 4. localhost Origin ile /api/apply çağrısı başarılı olmalı (202)
  const applyRes = await fetch(`${baseUrl}/api/apply`, {
    method: "POST",
    headers: {
      Cookie: cookiePair,
      "X-Setup-CSRF": csrf,
      Origin: `http://localhost:${port}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(VALID_PAYLOAD),
  });
  assert.equal(applyRes.status, 202);

  // 5. Kurulum tamamlanana kadar /api/status izleme
  let statusData;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 50));
    const sRes = await fetch(`${baseUrl}/api/status`, { headers: { Cookie: cookiePair } });
    statusData = await sRes.json();
    if (statusData.apply.status === "success" || statusData.apply.status === "error") break;
  }
  assert.equal(statusData.apply.status, "success");

  // 6. Üretilen dosyaların kontrolü (.env, installation.lock, nginx.conf.example, deployment-config.json)
  const envFile = fs.readFileSync(path.join(tmpRoot, "server", ".env"), "utf8");
  assert.match(envFile, /RETENTION_ENABLED=true/);
  assert.match(envFile, /DATABASE_URL="file:\.\.\/data\/app\.db"/);
  assert.equal(fs.existsSync(path.join(tmpRoot, "server", "data", "installation.lock")), true);
  assert.equal(fs.existsSync(path.join(tmpRoot, "server", "data", "deployment-config.json")), true);
  assert.equal(fs.existsSync(path.join(tmpRoot, "server", "data", "setup-artifacts", "nginx.conf.example")), true);

  // 7. Rate-limit testi: /setup?token=yanlis adresine 16 istek atıldığında 429 dönmeli
  let lastStatus = 200;
  for (let i = 0; i < 16; i++) {
    const r = await fetch(`${baseUrl}/setup?token=wrong_token_${i}`);
    lastStatus = r.status;
  }
  assert.equal(lastStatus, 429);
});

test("wizard/server E2E: tek dizinli projede (server/ yokken) .env ve data/* doğrudan proje köküne yazılır", async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "setup-wizard-singledir-"));
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(tmpRoot, "package.json"), JSON.stringify({ name: "single-dir-app" }), "utf8");

  const token = "wizard_secret_token_singledir_123456";
  const server = createSetupServer(token, { projectRoot: tmpRoot });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const loginRes = await fetch(`${baseUrl}/setup?token=${token}`, { redirect: "manual" });
  const cookiePair = loginRes.headers.get("set-cookie").split(";")[0];
  const pageRes = await fetch(`${baseUrl}/setup`, { headers: { Cookie: cookiePair } });
  const html = await pageRes.text();
  const csrf = JSON.parse(html.match(/window\.__SETUP__=(\{[^;]+\});/)[1]).csrfToken;

  const applyRes = await fetch(`${baseUrl}/api/apply`, {
    method: "POST",
    headers: {
      Cookie: cookiePair,
      "X-Setup-CSRF": csrf,
      Origin: `http://localhost:${port}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(VALID_PAYLOAD),
  });
  assert.equal(applyRes.status, 202);

  let statusData;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 50));
    const sRes = await fetch(`${baseUrl}/api/status`, { headers: { Cookie: cookiePair } });
    statusData = await sRes.json();
    if (statusData.apply.status === "success" || statusData.apply.status === "error") break;
  }
  assert.equal(statusData.apply.status, "success");

  assert.equal(fs.existsSync(path.join(tmpRoot, "server")), false, "server/ dizini zorla oluşturulmamalı");
  const envFile = fs.readFileSync(path.join(tmpRoot, ".env"), "utf8");
  assert.match(envFile, /DATABASE_URL="file:\.\/data\/app\.db"/);
  assert.equal(fs.existsSync(path.join(tmpRoot, "data", "installation.lock")), true);
  assert.equal(fs.existsSync(path.join(tmpRoot, "data", "deployment-config.json")), true);
  assert.equal(fs.existsSync(path.join(tmpRoot, "data", "setup-artifacts", "nginx.conf.example")), true);
});

test("wizard/server E2E: setup.config.json içindeki özel paths ve wizard.title ayarlarına uyulur", async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "setup-wizard-customcfg-"));
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(tmpRoot, "setup.config.json"),
    JSON.stringify({
      name: "custom-paths-app",
      wizard: { title: "Özel Kurulum Başlığı" },
      paths: {
        env: "config/.env.local",
        dataDir: "storage/data",
        lockFile: "storage/data/custom.lock",
      },
    }),
    "utf8",
  );
  fs.mkdirSync(path.join(tmpRoot, "config"), { recursive: true });

  const token = "wizard_secret_token_customcfg_123456";
  const server = createSetupServer(token, { projectRoot: tmpRoot });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const loginRes = await fetch(`${baseUrl}/setup?token=${token}`, { redirect: "manual" });
  const cookiePair = loginRes.headers.get("set-cookie").split(";")[0];
  const pageRes = await fetch(`${baseUrl}/setup`, { headers: { Cookie: cookiePair } });
  const html = await pageRes.text();
  assert.match(html, /Özel Kurulum Başlığı/);
  const csrf = JSON.parse(html.match(/window\.__SETUP__=(\{[^;]+\});/)[1]).csrfToken;

  const applyRes = await fetch(`${baseUrl}/api/apply`, {
    method: "POST",
    headers: {
      Cookie: cookiePair,
      "X-Setup-CSRF": csrf,
      Origin: `http://localhost:${port}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(VALID_PAYLOAD),
  });
  assert.equal(applyRes.status, 202);

  let statusData;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 50));
    const sRes = await fetch(`${baseUrl}/api/status`, { headers: { Cookie: cookiePair } });
    statusData = await sRes.json();
    if (statusData.apply.status === "success" || statusData.apply.status === "error") break;
  }
  assert.equal(statusData.apply.status, "success");

  assert.equal(fs.existsSync(path.join(tmpRoot, "config", ".env.local")), true);
  assert.equal(fs.existsSync(path.join(tmpRoot, "storage", "data", "custom.lock")), true);
  assert.equal(fs.existsSync(path.join(tmpRoot, "storage", "data", "deployment-config.json")), true);

  // Dizin dışına çıkma (path traversal) girişimi engellenmeli
  const unsafeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "setup-wizard-unsafe-"));
  t.after(() => fs.rmSync(unsafeRoot, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(unsafeRoot, "setup.config.json"),
    JSON.stringify({ paths: { env: "../outside.env" } }),
    "utf8",
  );
  assert.throws(
    () => createSetupServer(token, { projectRoot: unsafeRoot }),
    /Güvenli dizin sınırı ihlali/,
  );
});

test("wizard/config: hashAdminPassword ve verifyAdminPassword scrypt formatında çalışır", () => {
  const hash = hashAdminPassword("Guclu_Parola_2026!");
  assert.match(hash, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
  assert.equal(verifyAdminPassword("Guclu_Parola_2026!", hash), true);
  assert.equal(verifyAdminPassword("Yanlis_Parola_2026!", hash), false);
  assert.equal(verifyAdminPassword("Guclu_Parola_2026!", "invalid$hash"), false);
});

test("wizard/config ve deployment-config: extraEnvVars çekirdek anahtarları ezmeden birleştirilir ve özel port Nginx çıktısına yansır", () => {
  const parsed = setupPayloadSchema.parse(VALID_PAYLOAD);
  const envText = buildServerEnv(
    parsed,
    "fixed_secret_123",
    "file:./data/app.db",
    [
      { key: "PORT", defaultValue: "9999", description: "Should not override" },
      { key: "DATABASE_URL", defaultValue: "postgres://override", description: "Should not override" },
      { key: "STRIPE_SECRET_KEY", defaultValue: "sk_test_123", description: "Stripe API anahtarı" },
      { key: "INVALID-KEY!", defaultValue: "bad", description: "Invalid identifier" },
    ],
  );
  assert.match(envText, /^PORT=5000$/m);
  assert.equal(envText.includes("PORT=9999"), false);
  assert.match(envText, /^DATABASE_URL="file:\.\/data\/app\.db"$/m);
  assert.match(envText, /^ADMIN_NAME="Sistem Yöneticisi"$/m);
  assert.match(envText, /^ADMIN_EMAIL="admin@kurum\.gov\.tr"$/m);
  assert.match(envText, /^ADMIN_PASSWORD_HASH="scrypt\$[0-9a-f]+\$[0-9a-f]+"$/m);
  assert.match(envText, /^# Stripe API anahtarı$/m);
  assert.match(envText, /^STRIPE_SECRET_KEY="sk_test_123"$/m);
  assert.equal(envText.includes("INVALID-KEY!"), false);

  const artifacts = buildDeploymentArtifacts(toDeploymentConfig(parsed), 3000);
  assert.match(artifacts.nginxText, /proxy_pass http:\/\/127\.0\.0\.1:3000;/);
});

test("wizard/server E2E: .env.example değişkenleri, admin.json ve özel sunucu portu (3000) kurulum çıktısına yazılır", async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "setup-wizard-envmerge-"));
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(tmpRoot, "package.json"), JSON.stringify({ name: "env-merge-app" }), "utf8");
  fs.writeFileSync(
    path.join(tmpRoot, ".env.example"),
    [
      "# Ödeme servisi anahtarı",
      "STRIPE_SECRET_KEY=sk_test_123",
      "PORT=3000",
    ].join("\n"),
    "utf8",
  );

  const token = "wizard_secret_token_envmerge_123456";
  const server = createSetupServer(token, { projectRoot: tmpRoot });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const loginRes = await fetch(`${baseUrl}/setup?token=${token}`, { redirect: "manual" });
  const cookiePair = loginRes.headers.get("set-cookie").split(";")[0];
  const pageRes = await fetch(`${baseUrl}/setup`, { headers: { Cookie: cookiePair } });
  const html = await pageRes.text();
  const csrf = JSON.parse(html.match(/window\.__SETUP__=(\{[^;]+\});/)[1]).csrfToken;

  const customPayload = {
    ...VALID_PAYLOAD,
    server: { host: "127.0.0.1", port: 3000 },
  };

  const applyRes = await fetch(`${baseUrl}/api/apply`, {
    method: "POST",
    headers: {
      Cookie: cookiePair,
      "X-Setup-CSRF": csrf,
      Origin: `http://localhost:${port}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(customPayload),
  });
  assert.equal(applyRes.status, 202);

  let statusData;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 50));
    const sRes = await fetch(`${baseUrl}/api/status`, { headers: { Cookie: cookiePair } });
    statusData = await sRes.json();
    if (statusData.apply.status === "success" || statusData.apply.status === "error") break;
  }
  assert.equal(statusData.apply.status, "success");

  const envFile = fs.readFileSync(path.join(tmpRoot, ".env"), "utf8");
  assert.match(envFile, /^STRIPE_SECRET_KEY="sk_test_123"$/m);
  assert.match(envFile, /^ADMIN_EMAIL="admin@kurum\.gov\.tr"$/m);
  assert.match(envFile, /^ADMIN_PASSWORD_HASH="scrypt\$[0-9a-f]+\$[0-9a-f]+"$/m);
  assert.match(envFile, /^PORT=3000$/m);

  const adminJsonPath = path.join(tmpRoot, "data", "admin.json");
  assert.equal(fs.existsSync(adminJsonPath), true);
  const adminJson = JSON.parse(fs.readFileSync(adminJsonPath, "utf8"));
  assert.equal(adminJson.name, VALID_PAYLOAD.admin.name);
  assert.equal(adminJson.email, VALID_PAYLOAD.admin.email);
  assert.equal(verifyAdminPassword(VALID_PAYLOAD.admin.password, adminJson.passwordHash), true);
  assert.equal(typeof adminJson.createdAt, "string");

  const nginxConf = fs.readFileSync(path.join(tmpRoot, "data", "setup-artifacts", "nginx.conf.example"), "utf8");
  assert.match(nginxConf, /proxy_pass http:\/\/127\.0\.0\.1:3000;/);
});

test("wizard/server E2E: package.json içindeki build ve migrate betikleri gerçekte çalıştırılır ve eksik betikler skipped olarak işaretlenir", async (t) => {
  // 1. Senaryo: build ve migrate betikleri olan proje
  const tmpWithScripts = fs.mkdtempSync(path.join(os.tmpdir(), "setup-wizard-scripts-"));
  t.after(() => fs.rmSync(tmpWithScripts, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(tmpWithScripts, "package.json"),
    JSON.stringify({
      name: "scripted-app",
      scripts: {
        build: "node -e \"require('fs').writeFileSync('built.txt','ok')\"",
        migrate: "node -e \"require('fs').writeFileSync('migrated.txt', process.env.DATABASE_URL)\"",
      },
    }),
    "utf8",
  );

  const token = "wizard_secret_token_scripts_12345678";
  const server1 = createSetupServer(token, { projectRoot: tmpWithScripts });
  await new Promise((resolve) => server1.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server1.close(resolve)));
  const port1 = server1.address().port;
  const baseUrl1 = `http://127.0.0.1:${port1}`;

  const login1 = await fetch(`${baseUrl1}/setup?token=${token}`, { redirect: "manual" });
  const cookie1 = login1.headers.get("set-cookie").split(";")[0];
  const page1 = await fetch(`${baseUrl1}/setup`, { headers: { Cookie: cookie1 } });
  const csrf1 = JSON.parse((await page1.text()).match(/window\.__SETUP__=(\{[^;]+\});/)[1]).csrfToken;

  const apply1 = await fetch(`${baseUrl1}/api/apply`, {
    method: "POST",
    headers: {
      Cookie: cookie1,
      "X-Setup-CSRF": csrf1,
      Origin: `http://localhost:${port1}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...VALID_PAYLOAD, buildClient: true }),
  });
  assert.equal(apply1.status, 202);

  let status1;
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const sRes = await fetch(`${baseUrl1}/api/status`, { headers: { Cookie: cookie1 } });
    status1 = await sRes.json();
    if (status1.apply.status === "success" || status1.apply.status === "error") break;
  }
  assert.equal(status1.apply.status, "success", status1.apply.message);
  assert.equal(fs.existsSync(path.join(tmpWithScripts, "built.txt")), true, "built.txt oluşturulmalı");
  assert.equal(fs.readFileSync(path.join(tmpWithScripts, "built.txt"), "utf8"), "ok");
  assert.equal(fs.existsSync(path.join(tmpWithScripts, "migrated.txt")), true, "migrated.txt oluşturulmalı");
  assert.equal(fs.readFileSync(path.join(tmpWithScripts, "migrated.txt"), "utf8"), "file:./data/app.db");

  const stepMap1 = Object.fromEntries(status1.apply.steps.map((s) => [s.id, s]));
  assert.equal(stepMap1.buildServer.status, "done");
  assert.equal(stepMap1.buildClient.status, "skipped");
  assert.equal(stepMap1.migrate.status, "done");

  // 2. Senaryo: build ve migrate betikleri olmayan proje -> adımlar skipped olmalı
  const tmpNoScripts = fs.mkdtempSync(path.join(os.tmpdir(), "setup-wizard-noscripts-"));
  t.after(() => fs.rmSync(tmpNoScripts, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(tmpNoScripts, "package.json"),
    JSON.stringify({ name: "no-scripts-app", scripts: {} }),
    "utf8",
  );

  const server2 = createSetupServer(token, { projectRoot: tmpNoScripts });
  await new Promise((resolve) => server2.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server2.close(resolve)));
  const port2 = server2.address().port;
  const baseUrl2 = `http://127.0.0.1:${port2}`;

  const login2 = await fetch(`${baseUrl2}/setup?token=${token}`, { redirect: "manual" });
  const cookie2 = login2.headers.get("set-cookie").split(";")[0];
  const page2 = await fetch(`${baseUrl2}/setup`, { headers: { Cookie: cookie2 } });
  const csrf2 = JSON.parse((await page2.text()).match(/window\.__SETUP__=(\{[^;]+\});/)[1]).csrfToken;

  const apply2 = await fetch(`${baseUrl2}/api/apply`, {
    method: "POST",
    headers: {
      Cookie: cookie2,
      "X-Setup-CSRF": csrf2,
      Origin: `http://localhost:${port2}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...VALID_PAYLOAD, buildClient: true }),
  });
  assert.equal(apply2.status, 202);

  let status2;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 50));
    const sRes = await fetch(`${baseUrl2}/api/status`, { headers: { Cookie: cookie2 } });
    status2 = await sRes.json();
    if (status2.apply.status === "success" || status2.apply.status === "error") break;
  }
  assert.equal(status2.apply.status, "success");

  const stepMap2 = Object.fromEntries(status2.apply.steps.map((s) => [s.id, s]));
  assert.equal(stepMap2.buildServer.status, "skipped");
  assert.equal(stepMap2.buildClient.status, "skipped");
  assert.equal(stepMap2.migrate.status, "skipped");
});

test("wizard/server E2E: /api/start-app gerçek uygulama sürecini .env değişkenleriyle başlatır ve port açılana kadar bekler", async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "setup-wizard-startapp-"));

  // Dinamik boş port bul (>= 1024)
  const appPort = await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close((err) => (err ? reject(err) : resolve(p)));
    });
  });

  fs.writeFileSync(
    path.join(tmpRoot, "package.json"),
    JSON.stringify({
      name: "real-start-app",
      scripts: {
        start: "node index.mjs",
      },
    }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(tmpRoot, "index.mjs"),
    [
      'import http from "node:http";',
      "const port = Number(process.env.PORT || 5000);",
      "const server = http.createServer((req, res) => {",
      '  res.writeHead(200, { "Content-Type": "application/json" });',
      "  res.end(JSON.stringify({ ok: true, port, adminEmail: process.env.ADMIN_EMAIL, db: process.env.DATABASE_URL }));",
      "});",
      'server.listen(port, "127.0.0.1");',
    ].join("\n"),
    "utf8",
  );

  // Birim kontrol: resolveAppStartInvocation
  const inv = resolveAppStartInvocation(tmpRoot, null);
  assert.ok(inv);
  assert.equal(inv.cwd, tmpRoot);

  const token = "wizard_secret_token_startapp_1234567";
  const server = createSetupServer(token, { projectRoot: tmpRoot });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    if (typeof server.stopSpawnedApp === "function") {
      await server.stopSpawnedApp();
    }
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const loginRes = await fetch(`${baseUrl}/setup?token=${token}`, { redirect: "manual" });
  const cookiePair = loginRes.headers.get("set-cookie").split(";")[0];
  const pageRes = await fetch(`${baseUrl}/setup`, { headers: { Cookie: cookiePair } });
  const csrf = JSON.parse((await pageRes.text()).match(/window\.__SETUP__=(\{[^;]+\});/)[1]).csrfToken;

  const applyPayload = {
    ...VALID_PAYLOAD,
    server: { host: "127.0.0.1", port: appPort },
    buildClient: false,
  };

  const applyRes = await fetch(`${baseUrl}/api/apply`, {
    method: "POST",
    headers: {
      Cookie: cookiePair,
      "X-Setup-CSRF": csrf,
      Origin: `http://localhost:${port}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(applyPayload),
  });
  assert.equal(applyRes.status, 202);

  let statusData;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 50));
    const sRes = await fetch(`${baseUrl}/api/status`, { headers: { Cookie: cookiePair } });
    statusData = await sRes.json();
    if (statusData.apply.status === "success" || statusData.apply.status === "error") break;
  }
  assert.equal(statusData.apply.status, "success");

  // parseDotEnvFile birim kontrolü
  const parsedEnv = parseDotEnvFile(path.join(tmpRoot, ".env"));
  assert.equal(parsedEnv.PORT, String(appPort));
  assert.equal(parsedEnv.ADMIN_EMAIL, VALID_PAYLOAD.admin.email);

  // /api/start-app çağrısı
  const startRes = await fetch(`${baseUrl}/api/start-app`, {
    method: "POST",
    headers: {
      Cookie: cookiePair,
      "X-Setup-CSRF": csrf,
      Origin: `http://localhost:${port}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(startRes.status, 200);
  const startBody = await startRes.json();
  assert.equal(startBody.reachable, true);
  assert.equal(typeof startBody.pid, "number");

  // Başlatılan uygulamaya gerçek HTTP isteği
  const appRes = await fetch(`http://127.0.0.1:${appPort}/`);
  assert.equal(appRes.status, 200);
  const appData = await appRes.json();
  assert.equal(appData.ok, true);
  assert.equal(appData.port, appPort);
  assert.equal(appData.adminEmail, VALID_PAYLOAD.admin.email);
  assert.equal(appData.db, "file:./data/app.db");

  // İkinci kez /api/start-app çağrıldığında "Uygulama zaten çalışıyor." dönmeli
  const startAgainRes = await fetch(`${baseUrl}/api/start-app`, {
    method: "POST",
    headers: {
      Cookie: cookiePair,
      "X-Setup-CSRF": csrf,
      Origin: `http://localhost:${port}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(startAgainRes.status, 200);
  const startAgainBody = await startAgainRes.json();
  assert.equal(startAgainBody.reachable, true);
  assert.equal(startAgainBody.message, "Uygulama zaten çalışıyor.");
});

test("wizard/core: createSetupWizardCore (Next.js Route Handler / Electron IPC + custom dataDir), readSetupRuntimeConfig ve verifyAdminCredentials", async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "setup-core-project-"));
  const externalDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "setup-core-userdata-"));
  t.after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(externalDataDir, { recursive: true, force: true });
  });

  fs.writeFileSync(
    path.join(tmpRoot, "package.json"),
    JSON.stringify({ name: "desktop-or-nextjs-app", version: "1.0.0" }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(tmpRoot, ".env.example"),
    "CUSTOM_FEATURE_FLAG=enabled\n",
    "utf8",
  );

  let buildCalled = false;
  const core = createSetupWizardCore({
    projectRoot: tmpRoot,
    dataDir: externalDataDir,
    runBuildCommands: async () => {
      buildCalled = true;
    },
  });

  // 1. GET /setup HTML döndürmeli
  const htmlRes = await core.handle({ method: "GET", path: "/setup" });
  assert.equal(htmlRes.status, 200);
  assert.match(htmlRes.headers["content-type"], /text\/html/);
  assert.match(htmlRes.body, /<!doctype html>/i);

  // 2. GET /api/status kurulum öncesi installed: false döndürmeli
  const statusBefore = await core.handle({ method: "GET", path: "/api/status" });
  assert.equal(statusBefore.status, 200);
  assert.equal(statusBefore.body.installed, false);
  assert.equal(statusBefore.body.apply.status, "idle");

  // 3. POST /api/validate-step adım doğrulaması
  const badAdminStep = await core.handle({
    method: "POST",
    headers: { "x-setup-csrf": core.csrfToken },
    path: "/api/validate-step",
    body: { step: "admin", data: { name: "A", email: "bad", password: "short" } },
  });
  assert.equal(badAdminStep.status, 400);
  assert.equal(badAdminStep.body.ok, false);

  const goodAdminStep = await core.handle({
    method: "POST",
    headers: { "x-setup-csrf": core.csrfToken },
    path: "/api/validate-step",
    body: { step: "admin", data: VALID_PAYLOAD.admin },
  });
  assert.equal(goodAdminStep.status, 200);
  assert.equal(goodAdminStep.body.ok, true);

  // 4. POST /api/test-smtp doğrulaması
  const badSmtp = await core.handle({
    method: "POST",
    headers: { "x-setup-csrf": core.csrfToken },
    path: "/api/validate-email-format",
    body: { enabled: true, user: "a@yahoo.com", fromEmail: "a@yahoo.com", fromName: "Test", password: "short" },
  });
  assert.equal(badSmtp.status, 400);
  assert.equal(badSmtp.body.ok, false);

  const goodSmtp = await core.handle({
    method: "POST",
    headers: { "x-setup-csrf": core.csrfToken },
    path: "/api/test-smtp", // eski ad geriye uyumluluk için hâlâ çalışır
    body: { enabled: false },
  });
  assert.equal(goodSmtp.status, 200);
  assert.equal(goodSmtp.body.ok, true);
  assert.equal(goodSmtp.body.connectionTested, false);

  // 5. POST /api/apply (wait: true ile senkron tamamlanma)
  const applyRes = await core.handle({
    method: "POST",
    headers: { "x-setup-csrf": core.csrfToken },
    path: "/api/apply",
    body: { ...VALID_PAYLOAD, buildClient: true, wait: true },
  });
  assert.equal(applyRes.status, 200);
  assert.equal(applyRes.body.ok, true);
  assert.equal(applyRes.body.state.status, "success");
  assert.equal(buildCalled, true);

  // 6. Harici dataDir altında dosyaların oluştuğunu ve runtime config + admin doğrulamasını kontrol et
  assert.equal(fs.existsSync(path.join(externalDataDir, "installation.lock")), true);
  assert.equal(fs.existsSync(path.join(externalDataDir, "admin.json")), true);
  assert.equal(fs.existsSync(path.join(externalDataDir, "deployment-config.json")), true);
  assert.equal(fs.existsSync(path.join(externalDataDir, ".env")), true);

  const parsedEnv = parseEnvFile(path.join(externalDataDir, ".env"));
  assert.equal(parsedEnv.CUSTOM_FEATURE_FLAG, "enabled");
  assert.equal(parsedEnv.ADMIN_EMAIL, VALID_PAYLOAD.admin.email);

  const runtimeCfg = readSetupRuntimeConfig({ projectRoot: tmpRoot, dataDir: externalDataDir });
  assert.equal(runtimeCfg.installed, true);
  assert.equal(runtimeCfg.admin.email, VALID_PAYLOAD.admin.email);
  assert.equal(runtimeCfg.deployment.mode, "localhost");

  assert.equal(
    verifyAdminCredentials(
      { projectRoot: tmpRoot, dataDir: externalDataDir },
      "ADMIN@kurum.gov.tr",
      VALID_PAYLOAD.admin.password,
    ),
    true,
  );
  assert.equal(
    verifyAdminCredentials(
      { projectRoot: tmpRoot, dataDir: externalDataDir },
      VALID_PAYLOAD.admin.email,
      "Yanlis_Parola_123!",
    ),
    false,
  );
  assert.equal(core.verifyAdmin(VALID_PAYLOAD.admin.email, VALID_PAYLOAD.admin.password), true);
});

test("wizard/core: mountSetupGuard kurulum öncesi 302/503 döner, gömülü /api/setup/* uçlarını sunar ve kurulum sonrası next() çağırır", async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "setup-guard-e2e-"));
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(tmpRoot, "package.json"), JSON.stringify({ name: "express-guarded-app" }), "utf8");

  let mountedMiddleware = null;
  const fakeApp = {
    use(fn) {
      mountedMiddleware = fn;
    },
  };

  const mounted = mountSetupGuard(fakeApp, {
    projectRoot: tmpRoot,
    embedWizard: true,
    allowPaths: ["/health"],
  });
  assert.equal(typeof mounted.middleware, "function");
  assert.equal(mountedMiddleware, mounted.middleware);

  function invokeMiddleware(reqOverrides) {
    return new Promise((resolve, reject) => {
      const headers = {};
      const res = {
        statusCode: 200,
        headers,
        body: "",
        setHeader(k, v) {
          headers[k.toLowerCase()] = v;
        },
        status(code) {
          this.statusCode = code;
          return this;
        },
        writeHead(code, hdrs = {}) {
          this.statusCode = code;
          for (const [k, v] of Object.entries(hdrs)) {
            headers[k.toLowerCase()] = v;
          }
        },
        end(chunk = "") {
          this.body = chunk ? String(chunk) : "";
          resolve({ intercepted: true, statusCode: this.statusCode, headers, body: this.body });
        },
      };
      const req = {
        method: "GET",
        url: "/",
        path: "/",
        headers: {},
        ...reqOverrides,
      };
      Promise.resolve(
        mountedMiddleware(req, res, (err) => {
          if (err) reject(err);
          else resolve({ intercepted: false });
        }),
      ).catch(reject);
    });
  }

  // 1. allowPaths (/health) kurulum öncesinde de next() çağırmalı
  const healthRes = await invokeMiddleware({ path: "/health", url: "/health" });
  assert.equal(healthRes.intercepted, false);

  // 2. Kurulum öncesi tarayıcı isteği (GET /dashboard) -> 302 /setup
  const pageRedirect = await invokeMiddleware({
    path: "/dashboard",
    url: "/dashboard",
    headers: { accept: "text/html" },
  });
  assert.equal(pageRedirect.intercepted, true);
  assert.equal(pageRedirect.statusCode, 302);
  assert.equal(pageRedirect.headers.location, "/setup");

  // 3. Kurulum öncesi API isteği (GET /api/users) -> 503 JSON
  const apiBlocked = await invokeMiddleware({
    path: "/api/users",
    url: "/api/users",
    headers: { accept: "application/json" },
  });
  assert.equal(apiBlocked.intercepted, true);
  assert.equal(apiBlocked.statusCode, 503);
  const blockedPayload = JSON.parse(apiBlocked.body);
  assert.equal(blockedPayload.installed, false);
  assert.equal(blockedPayload.setupRequired, true);
  assert.equal(blockedPayload.redirectUrl, "/setup");

  // 4. Gömülü /api/setup/status çalışmalı
  const embeddedStatus = await invokeMiddleware({
    method: "GET",
    path: "/api/setup/status",
    url: "/api/setup/status",
  });
  assert.equal(embeddedStatus.intercepted, true);
  assert.equal(embeddedStatus.statusCode, 200);
  assert.equal(JSON.parse(embeddedStatus.body).installed, false);

  // 5. Gömülü /api/setup/apply ile kurulumu tamamla
  const embeddedApply = await invokeMiddleware({
    method: "POST",
    path: "/api/setup/apply",
    url: "/api/setup/apply",
    headers: { "x-setup-csrf": mounted.core.csrfToken },
    body: { ...VALID_PAYLOAD, wait: true },
  });
  assert.equal(embeddedApply.intercepted, true);
  assert.equal(embeddedApply.statusCode, 200);
  assert.equal(JSON.parse(embeddedApply.body).ok, true);

  // 6. Kurulum tamamlandıktan sonra /dashboard ve /api/users doğrudan next() çağırmalı
  const afterDashboard = await invokeMiddleware({ path: "/dashboard", url: "/dashboard" });
  assert.equal(afterDashboard.intercepted, false);

  const afterApi = await invokeMiddleware({ path: "/api/users", url: "/api/users" });
  assert.equal(afterApi.intercepted, false);
});

test("SPA / Static Web repo: runtime-config.json ve env-config.js gizli anahtarları sızdırmadan üretilir ve yerleşik statik sunucu ile sunulur", async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "setup-spa-static-"));
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

  fs.writeFileSync(
    path.join(tmpRoot, "index.html"),
    "<!doctype html><html><head><script src=\"/env-config.js\"></script></head><body><h1>SPA App</h1></body></html>\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(tmpRoot, ".env.example"),
    [
      "VITE_API_URL=https://api.example.com",
      "PUBLIC_APP_TITLE=Kurumsal SPA",
      "SECRET_TOKEN=hidden_secret_value",
      "DATABASE_URL=postgres://secret",
    ].join("\n"),
    "utf8",
  );

  // Serbest bir port bul
  const appPort = await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
    srv.on("error", reject);
  });

  const token = "wizard_secret_token_spastatic_123456";
  const server = createSetupServer(token, { projectRoot: tmpRoot });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    if (typeof server.stopSpawnedApp === "function") {
      await server.stopSpawnedApp();
    }
    await new Promise((resolve) => server.close(resolve));
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const loginRes = await fetch(`${baseUrl}/setup?token=${token}`, { redirect: "manual" });
  const cookiePair = loginRes.headers.get("set-cookie").split(";")[0];
  const pageRes = await fetch(`${baseUrl}/setup`, { headers: { Cookie: cookiePair } });
  const html = await pageRes.text();
  const csrf = JSON.parse(html.match(/window\.__SETUP__=(\{[^;]+\});/)[1]).csrfToken;

  const customPayload = {
    ...VALID_PAYLOAD,
    deployment: {
      ...VALID_PAYLOAD.deployment,
      publicUrl: `http://localhost:${appPort}/`,
    },
    server: { host: "127.0.0.1", port: appPort },
  };

  const applyRes = await fetch(`${baseUrl}/api/apply`, {
    method: "POST",
    headers: {
      Cookie: cookiePair,
      "X-Setup-CSRF": csrf,
      Origin: `http://localhost:${port}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(customPayload),
  });
  assert.equal(applyRes.status, 202);

  let statusData;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 50));
    const sRes = await fetch(`${baseUrl}/api/status`, { headers: { Cookie: cookiePair } });
    statusData = await sRes.json();
    if (statusData.apply.status === "success" || statusData.apply.status === "error") break;
  }
  assert.equal(statusData.apply.status, "success");

  // runtime-config.json ve env-config.js hem setup-artifacts hem de proje kökünde üretilmeli
  const rootRuntimeCfgPath = path.join(tmpRoot, "runtime-config.json");
  const rootEnvCfgJsPath = path.join(tmpRoot, "env-config.js");
  const artifactRuntimeCfgPath = path.join(tmpRoot, "data", "setup-artifacts", "runtime-config.json");
  assert.equal(fs.existsSync(rootRuntimeCfgPath), true);
  assert.equal(fs.existsSync(rootEnvCfgJsPath), true);
  assert.equal(fs.existsSync(artifactRuntimeCfgPath), true);

  const runtimeCfg = JSON.parse(fs.readFileSync(rootRuntimeCfgPath, "utf8"));
  assert.equal(runtimeCfg.deployment.mode, "localhost");
  assert.equal(runtimeCfg.deployment.publicUrl, `http://localhost:${appPort}`);
  assert.equal(runtimeCfg.env.VITE_API_URL, "https://api.example.com");
  assert.equal(runtimeCfg.env.PUBLIC_APP_TITLE, "Kurumsal SPA");
  assert.equal("SECRET_TOKEN" in runtimeCfg.env, false);
  assert.equal("DATABASE_URL" in runtimeCfg.env, false);
  assert.equal("SESSION_SECRET" in runtimeCfg.env, false);

  const envConfigJs = fs.readFileSync(rootEnvCfgJsPath, "utf8");
  assert.match(envConfigJs, /^window\.__SETUP_CONFIG__\s*=/);
  assert.equal(envConfigJs.includes("hidden_secret_value"), false);

  // /api/start-app yerleşik statik dosya sunucusunu başlatmalı
  const startRes = await fetch(`${baseUrl}/api/start-app`, {
    method: "POST",
    headers: {
      Cookie: cookiePair,
      "X-Setup-CSRF": csrf,
      Origin: `http://localhost:${port}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(startRes.status, 200);
  const startBody = await startRes.json();
  assert.equal(startBody.reachable, true);

  // Statik sunucu üzerinden index.html, runtime-config.json ve SPA fallback kontrolü
  const indexRes = await fetch(`http://127.0.0.1:${appPort}/`);
  assert.equal(indexRes.status, 200);
  assert.match(indexRes.headers.get("content-type"), /text\/html/);
  assert.match(await indexRes.text(), /<h1>SPA App<\/h1>/);

  const cfgRes = await fetch(`http://127.0.0.1:${appPort}/runtime-config.json`);
  assert.equal(cfgRes.status, 200);
  const servedCfg = await cfgRes.json();
  assert.equal(servedCfg.env.VITE_API_URL, "https://api.example.com");

  const spaRouteRes = await fetch(`http://127.0.0.1:${appPort}/dashboard/settings`);
  assert.equal(spaRouteRes.status, 200);
  assert.match(await spaRouteRes.text(), /<h1>SPA App<\/h1>/);
});

test("SETUP_ALLOWED_ORIGINS (Tauri/Sidecar CORS + Origin izni) ve CLI --port / --data-dir bayrakları", async (t) => {
  const parsedCli = parseArgs(["wizard", "--port", "5099", "--data-dir", "./custom-data"]);
  assert.equal(parsedCli.command, "wizard");
  assert.equal(parsedCli.port, 5099);
  assert.equal(parsedCli.dataDir, path.resolve("./custom-data"));

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "setup-cors-sidecar-"));
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(tmpRoot, "package.json"), JSON.stringify({ name: "sidecar-app" }), "utf8");

  const token = "wizard_secret_token_sidecar_12345678";
  const server = createSetupServer(token, {
    projectRoot: tmpRoot,
    allowedOrigins: ["tauri://localhost"],
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  // 1. OPTIONS preflight isteği tauri://localhost için 204 ve CORS başlıkları dönmeli
  const preflightRes = await fetch(`${baseUrl}/api/validate-step`, {
    method: "OPTIONS",
    headers: {
      Origin: "tauri://localhost",
      "Access-Control-Request-Method": "POST",
    },
  });
  assert.equal(preflightRes.status, 204);
  assert.equal(preflightRes.headers.get("access-control-allow-origin"), "tauri://localhost");
  assert.equal(preflightRes.headers.get("access-control-allow-credentials"), "true");

  // 2. Oturum aç ve tauri://localhost Origin'i ile POST /api/validate-step çağır
  const loginRes = await fetch(`${baseUrl}/setup?token=${token}`, { redirect: "manual" });
  const cookiePair = loginRes.headers.get("set-cookie").split(";")[0];
  const pageRes = await fetch(`${baseUrl}/setup`, { headers: { Cookie: cookiePair } });
  const html = await pageRes.text();
  const csrf = JSON.parse(html.match(/window\.__SETUP__=(\{[^;]+\});/)[1]).csrfToken;

  const validateRes = await fetch(`${baseUrl}/api/validate-step`, {
    method: "POST",
    headers: {
      Cookie: cookiePair,
      "X-Setup-CSRF": csrf,
      Origin: "tauri://localhost",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ step: "admin", data: VALID_PAYLOAD.admin }),
  });
  assert.equal(validateRes.status, 200);
  assert.equal(validateRes.headers.get("access-control-allow-origin"), "tauri://localhost");
  const validateBody = await validateRes.json();
  assert.equal(validateBody.ok, true);
});



test("Senaryo 2 (SPA/Static): /api/status senaryo + .env.example döndürür, opsiyonel admin ve customEnv ile kurulum tamamlanır ve ui.ts sabit :5173 içermez", async (t) => {
  const html = renderSetupPage("csrf_token_test");
  assert.equal(html.includes("127.0.0.1:5173/auth"), false, "ui.ts sabit 127.0.0.1:5173/auth içermemeli");
  assert.match(html, /id="scenarioInfo"/);
  assert.match(html, /id="customEnvSection"/);

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "setup-scenario2-ux-"));
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

  fs.writeFileSync(path.join(tmpRoot, "index.html"), "<!doctype html><html><body>SPA</body></html>\n", "utf8");
  fs.writeFileSync(
    path.join(tmpRoot, ".env.example"),
    "PORT=4173\nVITE_API_URL=http://localhost:8000\nCUSTOM_BACKEND_KEY=default_key\n",
    "utf8",
  );

  const token = "wizard_secret_token_scenario2_ux_123";
  const server = createSetupServer(token, { projectRoot: tmpRoot });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const loginRes = await fetch(`${baseUrl}/setup?token=${token}`, { redirect: "manual" });
  const cookiePair = loginRes.headers.get("set-cookie").split(";")[0];
  const pageRes = await fetch(`${baseUrl}/setup`, { headers: { Cookie: cookiePair } });
  const pageHtml = await pageRes.text();
  const csrf = JSON.parse(pageHtml.match(/window\.__SETUP__=(\{[^;]+\});/)[1]).csrfToken;

  const statusBeforeRes = await fetch(`${baseUrl}/api/status`, { headers: { Cookie: cookiePair } });
  assert.equal(statusBeforeRes.status, 200);
  const statusBefore = await statusBeforeRes.json();
  assert.equal(statusBefore.detected.kind, "static-web");
  assert.equal(statusBefore.detected.scenario?.number, 2);
  assert.equal(statusBefore.detected.scenario?.requiresAdmin, false);
  assert.equal(statusBefore.detected.defaultPort, 4173);
  assert.ok(Array.isArray(statusBefore.detected.envVariables));
  assert.ok(statusBefore.detected.envVariables.some((v) => v.key === "VITE_API_URL"));

  const applyPayload = {
    deployment: {
      mode: "localhost",
      publicUrl: "http://localhost:4173/",
      basePath: "/",
      allowedOrigins: ["http://localhost:4173", "http://127.0.0.1:4173"],
      trustProxyHops: 0,
    },
    server: { host: "127.0.0.1", port: 4173 },
    admin: { name: "", email: "", password: "" },
    email: { enabled: false },
    customEnv: {
      VITE_API_URL: "https://api.prod.example.com",
      CUSTOM_BACKEND_KEY: "overridden_value",
    },
    buildClient: false,
    overwriteExistingEnv: false,
  };

  const applyRes = await fetch(`${baseUrl}/api/apply`, {
    method: "POST",
    headers: {
      Cookie: cookiePair,
      "X-Setup-CSRF": csrf,
      Origin: `http://localhost:${port}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(applyPayload),
  });
  assert.equal(applyRes.status, 202);

  let statusAfter;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 50));
    const sRes = await fetch(`${baseUrl}/api/status`, { headers: { Cookie: cookiePair } });
    statusAfter = await sRes.json();
    if (statusAfter.apply.status === "success" || statusAfter.apply.status === "error") break;
  }
  assert.equal(statusAfter.apply.status, "success", statusAfter.apply.message);
  const adminStep = statusAfter.apply.steps.find((s) => s.id === "admin");
  assert.equal(adminStep?.status, "skipped");
  assert.equal(fs.existsSync(path.join(tmpRoot, "data", "admin.json")), false);

  const parsedEnv = parseDotEnvFile(path.join(tmpRoot, ".env"));
  assert.equal(parsedEnv.VITE_API_URL, "https://api.prod.example.com");
  assert.equal(parsedEnv.CUSTOM_BACKEND_KEY, "overridden_value");
  assert.equal("ADMIN_EMAIL" in parsedEnv, false);

  const runtimeCfg = JSON.parse(fs.readFileSync(path.join(tmpRoot, "runtime-config.json"), "utf8"));
  assert.equal(runtimeCfg.env.VITE_API_URL, "https://api.prod.example.com");
});

test("createSetupWizardCore: Senaryo 2 (SPA/Static) handle('/api/status') senaryo döndürür ve /api/apply opsiyonel admin ile başarıyla tamamlanır", async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "setup-core-scenario2-"));
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

  fs.writeFileSync(path.join(tmpRoot, "index.html"), "<!doctype html><html><body>SPA Core</body></html>\n", "utf8");
  fs.writeFileSync(
    path.join(tmpRoot, ".env.example"),
    "PORT=8080\nVITE_TITLE=MyCustomSpa\n",
    "utf8",
  );

  const core = createSetupWizardCore({ projectRoot: tmpRoot });
  const statusRes = await core.handle({ method: "GET", url: "/api/status" });
  assert.equal(statusRes.status, 200);
  assert.equal(statusRes.body.detected.scenario?.number, 2);
  assert.equal(statusRes.body.detected.scenario?.requiresAdmin, false);
  assert.equal(statusRes.body.detected.defaultPort, 8080);
  assert.ok(statusRes.body.detected.envVariables.some((v) => v.key === "VITE_TITLE"));

  const applyRes = await core.handle({
    method: "POST",
    headers: { "x-setup-csrf": core.csrfToken },
    url: "/api/apply",
    body: {
      deployment: {
        mode: "localhost",
        publicUrl: "http://localhost:8080/",
        basePath: "/",
        allowedOrigins: ["http://localhost:8080"],
        trustProxyHops: 0,
      },
      server: { host: "127.0.0.1", port: 8080 },
      admin: { name: "", email: "", password: "" },
      email: { enabled: false },
      customEnv: { VITE_TITLE: "MyConfiguredApp" },
      buildClient: false,
      overwriteExistingEnv: false,
      wait: true,
    },
  });
  assert.equal(applyRes.status, 200);
  assert.equal(applyRes.body.ok, true);
  assert.equal(applyRes.body.state.steps.find((s) => s.id === "admin")?.status, "skipped");
  assert.equal(fs.existsSync(path.join(tmpRoot, "data", "admin.json")), false);

  const parsedEnv = parseDotEnvFile(path.join(tmpRoot, ".env"));
  assert.equal(parsedEnv.VITE_TITLE, "MyConfiguredApp");
});

test("güvenlik: gömülü çekirdek CSRF/Origin ister, runtime-config sır sızdırmaz ve kurulum sonrası kapanır", async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "setup-core-sec-"));
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(tmpRoot, "package.json"), JSON.stringify({ name: "sec-app", scripts: { start: "node index.js" } }), "utf8");

  const core = createSetupWizardCore({ projectRoot: tmpRoot, runBuildCommands: async () => {} });
  const body = { ...VALID_PAYLOAD, email: { enabled: true, user: "x@gmail.com", fromEmail: "x@gmail.com", fromName: "X", password: "abcdabcdabcdabcd" }, wait: true };

  // CSRF başlığı yok -> 403, kurulum yapılmaz
  const noCsrf = await core.handle({ method: "POST", path: "/api/apply", body });
  assert.equal(noCsrf.status, 403);
  // Yanlış CSRF -> 403
  const badCsrf = await core.handle({ method: "POST", path: "/api/apply", headers: { "x-setup-csrf": "x" }, body });
  assert.equal(badCsrf.status, 403);
  // Farklı origin -> 403
  const badOrigin = await core.handle({
    method: "POST",
    path: "/api/apply",
    headers: { "x-setup-csrf": core.csrfToken, origin: "https://evil.example", host: "localhost:3000" },
    body,
  });
  assert.equal(badOrigin.status, 403);
  assert.equal(fs.existsSync(path.join(tmpRoot, "data", "installation.lock")), false);
  // Sabit/tahmin edilebilir anahtar yok
  assert.notEqual(core.csrfToken, createSetupWizardCore({ projectRoot: tmpRoot }).csrfToken);

  const ok = await core.handle({
    method: "POST",
    path: "/api/apply",
    headers: { "x-setup-csrf": core.csrfToken, origin: "http://localhost:3000", host: "localhost:3000" },
    body,
  });
  assert.equal(ok.status, 200);

  // Kurulum sonrası: runtime-config ve sayfa kapalı, durum sır içermez
  for (const p of ["/api/runtime-config", "/api/RuntimeConfig", "/setup", "/api/validate-step"]) {
    const res = await core.handle({ method: "GET", path: p });
    assert.equal(res.status, 404, p);
    assert.doesNotMatch(JSON.stringify(res.body), /SESSION_SECRET|EMAIL_PASS|scrypt\$/);
  }
  const status = await core.handle({ method: "GET", path: "/api/status" });
  assert.equal(status.body.installed, true);
  assert.doesNotMatch(JSON.stringify(status.body), /SESSION_SECRET|EMAIL_PASS|scrypt\$|abcdabcdabcdabcd/);
});

test("güvenlik: publicRuntimeConfig env ve parola özetini çıkarır", async () => {
  const { publicRuntimeConfig } = await import("../wizard/core.mjs");
  const out = publicRuntimeConfig({
    installed: true,
    env: { SESSION_SECRET: "s", EMAIL_PASS: "p" },
    deployment: { mode: "localhost" },
    admin: { name: "A", email: "a@b.co", passwordHash: "scrypt$x$y" },
  });
  assert.deepEqual(Object.keys(out).sort(), ["admin", "deployment", "installed"]);
  assert.equal(out.admin.passwordHash, undefined);
});

test("gömülü arayüz: mountSetupGuard sayfası /api/setup tabanını ve embedded bayrağını taşır, bağımsız sunucu /api kullanır", async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "setup-embed-ui-"));
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(tmpRoot, "package.json"), JSON.stringify({ name: "embed-ui", scripts: { start: "node index.js" } }), "utf8");

  const { core } = mountSetupGuard({ use() {} }, { projectRoot: tmpRoot });
  const page = await core.handle({ method: "GET", path: "/setup" });
  assert.equal(page.status, 200);
  const boot = JSON.parse(page.body.match(/window\.__SETUP__=(\{.*?\});/)[1]);
  assert.equal(boot.apiBase, "/api/setup");
  assert.equal(boot.embedded, true);
  assert.equal(boot.csrfToken, core.csrfToken);
  assert.doesNotMatch(page.body, /fetchJson\('\/api\//);

  const standalone = await createSetupWizardCore({ projectRoot: tmpRoot }).handle({ method: "GET", path: "/setup" });
  const sBoot = JSON.parse(standalone.body.match(/window\.__SETUP__=(\{.*?\});/)[1]);
  assert.equal(sBoot.apiBase, "/api");
  assert.equal(sBoot.embedded, false);
});

async function startDesktopFixture(t, appSource) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "setup-desktop-"));
  fs.writeFileSync(
    path.join(tmpRoot, "package.json"),
    JSON.stringify({ name: "desk-app", main: "main.js", scripts: { start: "node app.mjs" }, devDependencies: { electron: "^30.0.0" } }),
    "utf8",
  );
  fs.writeFileSync(path.join(tmpRoot, "main.js"), "const { app } = require('electron');\n", "utf8");
  fs.writeFileSync(path.join(tmpRoot, "app.mjs"), appSource, "utf8");

  const token = "wizard_secret_token_desktop_1234567890";
  const server = createSetupServer(token, { projectRoot: tmpRoot, desktopGraceMs: 1200 });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await server.stopSpawnedApp?.();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const loginRes = await fetch(`${baseUrl}/setup?token=${token}`, { redirect: "manual" });
  const cookie = loginRes.headers.get("set-cookie").split(";")[0];
  const page = await (await fetch(`${baseUrl}/setup`, { headers: { Cookie: cookie } })).text();
  const csrf = JSON.parse(page.match(/window\.__SETUP__=(\{[^;]+\});/)[1]).csrfToken;
  const post = (p, body = {}) =>
    fetch(`${baseUrl}${p}`, {
      method: "POST",
      headers: { Cookie: cookie, "X-Setup-CSRF": csrf, Origin: `http://localhost:${port}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const get = (p) => fetch(`${baseUrl}${p}`, { headers: { Cookie: cookie } });
  const applyRes = await post("/api/apply", { ...VALID_PAYLOAD, admin: { name: "", email: "", password: "" }, buildClient: false });
  assert.equal(applyRes.status, 202);
  let status;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 50));
    status = await (await get("/api/status")).json();
    if (status.apply.status !== "running") break;
  }
  assert.equal(status.apply.status, "success", JSON.stringify(status.apply));
  return { post, get, status };
}

test("masaüstü (Electron): start-app port yerine süreç denetler, app-health PID bildirir, kapanınca ayakta değil der", async (t) => {
  // Port açmayan, ayakta kalan masaüstü uygulaması
  const { post, get, status } = await startDesktopFixture(t, "setInterval(() => {}, 1000);\n");
  assert.equal(status.detected.scenario.number, 5);
  assert.equal(status.apply.isDesktop, true);

  const before = await (await get("/api/app-health")).json();
  assert.equal(before.desktop, true);
  assert.equal(before.reachable, false);

  const start = await post("/api/start-app", { mode: "desktop" });
  assert.equal(start.status, 200);
  const startBody = await start.json();
  assert.equal(startBody.reachable, true);
  assert.equal(startBody.desktop, true);
  assert.equal(typeof startBody.pid, "number");

  const health = await (await get("/api/app-health")).json();
  assert.equal(health.reachable, true);
  assert.equal(health.pid, startBody.pid);

  const again = await (await post("/api/start-app")).json();
  assert.equal(again.reachable, true);
  assert.match(again.message, /zaten çalışıyor/);
});

test("masaüstü (Electron): hemen kapanan uygulama için start-app 409 ve çıkış kodu döner", async (t) => {
  const { post, get } = await startDesktopFixture(t, "process.exit(3);\n");
  const start = await post("/api/start-app");
  assert.equal(start.status, 409);
  const body = await start.json();
  assert.equal(body.reachable, false);
  assert.match(body.message, /kapandı|başlatılamadı/);
  assert.match(body.message, /3/);
  const health = await (await get("/api/app-health")).json();
  assert.equal(health.reachable, false);
  assert.equal(health.exitCode, 3);
});

test("wrapShimCommand: Windows'ta npm/pnpm/yarn/bun cmd.exe üzerinden çalışır; resolveAppStartInvocation config komutunu sarar", async () => {
  const { wrapShimCommand } = await import("../wizard/server.mjs");
  const wrapped = wrapShimCommand("npm", ["run", "start"], "/x");
  if (process.platform === "win32") {
    assert.match(wrapped.command, /cmd/i);
    assert.deepEqual(wrapped.args.slice(0, 3), ["/d", "/s", "/c"]);
    assert.deepEqual(wrapped.args.slice(3), ["npm", "run", "start"]);
  } else {
    assert.equal(wrapped.command, "npm");
  }
  assert.equal(wrapShimCommand("go", ["run", "."]).command, "go");

  // Gerçekten çalışmalı (ENOENT olmamalı)
  const { spawnSync } = await import("node:child_process");
  const inv = wrapShimCommand("npm", ["--version"]);
  const res = spawnSync(inv.command, inv.args, { encoding: "utf8", windowsHide: true });
  assert.equal(res.status, 0, res.error?.message || res.stderr);

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "setup-wrap-"));
  try {
    fs.writeFileSync(path.join(tmpRoot, "setup.config.json"), JSON.stringify({ start: { command: "npm", args: ["run", "start"] } }), "utf8");
    const resolved = resolveAppStartInvocation(tmpRoot, null);
    assert.equal(resolved.command, wrapShimCommand("npm", ["run", "start"]).command);
    assert.equal(resolved.cwd, tmpRoot);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("masaüstü IPC: ipcMode çekirdek CSRF istemez, desktop senaryosu algılanır ve harici dataDir'e yazar", async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "setup-ipc-project-"));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "setup-ipc-userdata-"));
  t.after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(tmpRoot, "package.json"), JSON.stringify({ name: "ipc-app", main: "main.js", devDependencies: { electron: "^30.0.0" } }), "utf8");
  fs.writeFileSync(path.join(tmpRoot, "main.js"), "require('electron');\n", "utf8");

  const core = createSetupWizardCore({ projectRoot: tmpRoot, dataDir: userData, ipcMode: true, syncApply: true, runBuildCommands: async () => {} });
  const status = await core.handle({ method: "GET", path: "/api/status" });
  assert.equal(status.body.detected.scenario.number, 5);
  const apply = await core.handle({
    method: "POST",
    path: "/api/apply",
    body: { ...VALID_PAYLOAD, admin: { name: "", email: "", password: "" }, wait: true },
  });
  assert.equal(apply.status, 200, JSON.stringify(apply.body));
  assert.equal(apply.body.state.isDesktop, true);
  assert.equal(fs.existsSync(path.join(userData, "installation.lock")), true);
  assert.equal(fs.existsSync(path.join(tmpRoot, "data")), false, "proje dizinine veri yazılmamalı");
});

test("wizard/ui: sayfadaki satır içi betik geçerli JavaScript'tir (kaçış dizileri şablon semantiğiyle çözülür)", async () => {
  const vm = await import("node:vm");
  for (const opts of [{}, { apiBase: "/api/setup", embedded: true, title: "Başlık \\ \"x\"" }]) {
    const html = renderSetupPage("csrf_abc", opts);
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.ok(scripts.length >= 1);
    for (const script of scripts) {
      assert.doesNotThrow(() => new vm.Script(script), "betik sözdizimi hatası içermemeli");
    }
    // kaçış dizileri şablon semantiğiyle çözülmüş olmalı (çift ters eğik çizgi kalmamalı)
    const joined = scripts.join("\n");
    assert.equal(joined.includes(String.raw`/^https?:\\/\\//i`), false, "çift kaçış kalmamalı");
    assert.equal(joined.includes(String.raw`/^https?:\/\//i`), true, "tek kaçışlı düzenli ifade bulunmalı");
    assert.equal(joined.includes(String.raw`.join('\n')`), true);
  }
});

test("wizard/config: .env senaryoya göre sadeleşir; isteğe bağlı gruplar yalnızca etkinse/bildirildiyse yazılır", () => {
  const parsed = setupPayloadSchema.parse({
    ...VALID_PAYLOAD,
    deployment: { ...VALID_PAYLOAD.deployment, retention: { ...VALID_PAYLOAD.deployment.retention, enabled: false } },
    email: { ...VALID_PAYLOAD.email, enabled: false },
  });
  const server = { isStaticOnly: false, isDesktop: false, requiresDatabase: true };
  const lean = buildServerEnv(parsed, "s", "file:../data/app.db", [], server);
  assert.match(lean, /SESSION_SECRET=/);
  assert.match(lean, /PORT=/);
  assert.doesNotMatch(lean, /RETENTION_|EMAIL_|TRUST_PROXY_HOPS|ALLOW_RUNTIME/);

  const declared = buildServerEnv(parsed, "s", "file:../data/app.db", [{ key: "RETENTION_ENABLED", defaultValue: "" }, { key: "FOO", defaultValue: "bar" }], server);
  assert.match(declared, /RETENTION_ENABLED=false/);
  assert.match(declared, /FOO="?bar"?/);

  const spa = buildServerEnv(parsed, "s", "x", [{ key: "VITE_API_URL", defaultValue: "/api" }], { isStaticOnly: true, requiresDatabase: false });
  assert.doesNotMatch(spa, /SESSION_SECRET|DATABASE_URL|HOST=|PORT=|NODE_ENV/);
  assert.match(spa, /VITE_API_URL=/);

  const desktop = buildServerEnv(parsed, "s", "file:./app.db", [], { isDesktop: true, requiresDatabase: false });
  assert.doesNotMatch(desktop, /SESSION_SECRET|FRONTEND_URL|ALLOWED_ORIGINS|DATABASE_URL/);
});
