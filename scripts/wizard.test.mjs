import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServerEnv, hashAdminPassword, setupPayloadSchema, toDeploymentConfig, verifyAdminPassword } from "../wizard/config.mjs";
import { buildDeploymentArtifacts } from "../utils/deployment-config.mjs";
import { renderSetupPage } from "../wizard/ui.mjs";
import { createSetupServer, sameOrigin } from "../wizard/server.mjs";

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


