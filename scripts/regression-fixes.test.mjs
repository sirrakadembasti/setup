import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { detectProject, loadSetupConfig } from "./detect-project.mjs";
import { createTerminalBootstrap } from "./terminal-bootstrap.mjs";
import { materializeEnvTemplate, setupPayloadSchema } from "../wizard/config.mjs";
import { createApplyState, executeSetupApply } from "../wizard/shared.mjs";
import { createStaticAppServer } from "../wizard/server.mjs";

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "setup-reg-"));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

function payload(overrides = {}) {
  return setupPayloadSchema.parse({
    deployment: { mode: "localhost", publicUrl: "http://127.0.0.1:3000", basePath: "/", allowedOrigins: ["http://127.0.0.1:3000"], trustProxyHops: 0 },
    server: { host: "127.0.0.1", port: 3000 },
    admin: {}, email: { enabled: false }, database: { provider: "sqlite" }, buildClient: false, ...overrides,
  }, { allowOptionalAdmin: true });
}

async function apply(proj, pl, reconfigure = true) {
  const paths = {
    serverRoot: proj, dataRoot: path.join(proj, "data"), env: path.join(proj, ".env"),
    lock: path.join(proj, "data", "installation.lock"), pending: path.join(proj, "data", "installation.pending"),
    setupArtifacts: path.join(proj, "data", "setup-artifacts"), databaseUrl: "file:./data/app.db",
  };
  const applyJob = createApplyState();
  applyJob.status = "running";
  return executeSetupApply({
    projectRoot: proj, dataDir: null, paths, detection: detectProject(proj), setupConfig: loadSetupConfig(proj),
    options: { reconfigure }, applyJob, payload: pl, markStep: () => {},
  });
}

const failingBuild = { name: "demo", scripts: { start: "node s.js", build: "node -e \"process.exit(1)\"" } };

test("başarısız yeniden yapılandırma mevcut kurulum kilidini silmez ve .env'i geri yükler", async () => {
  const proj = fixture({ "package.json": JSON.stringify(failingBuild), "s.js": "", ".env": "PORT=3000\nJWT_SECRET=gercek\n" });
  fs.mkdirSync(path.join(proj, "data"));
  const lock = path.join(proj, "data", "installation.lock");
  fs.writeFileSync(lock, JSON.stringify({ installedAt: "2026-01-01T00:00:00Z" }));
  await assert.rejects(apply(proj, payload({ buildClient: true })));
  assert.ok(fs.existsSync(lock), "kilit korunmalı");
  assert.match(fs.readFileSync(path.join(proj, ".env"), "utf8"), /gercek/);
});

test("başarısız ilk kurulum bu işlemde yazılan kilidi/.env'i bırakmaz", async () => {
  const proj = fixture({ "package.json": JSON.stringify(failingBuild), "s.js": "" });
  await assert.rejects(apply(proj, payload({ buildClient: true }), false));
  assert.ok(!fs.existsSync(path.join(proj, "data", "installation.lock")));
  assert.ok(!fs.existsSync(path.join(proj, ".env")));
});

test("yeniden yapılandırma özel anahtarları, gerçek sırları ve oturum sırrını korur", async () => {
  const proj = fixture({
    "package.json": JSON.stringify({ name: "demo", scripts: { start: "node s.js" } }), "s.js": "",
    ".env.example": "PORT=3000\nJWT_SECRET=change-me\n",
    ".env": 'PORT=3000\nJWT_SECRET=gercek-sir\nMY_CUSTOM_KEY=koru\nSESSION_SECRET="eski-oturum"\n',
  });
  await apply(proj, payload({ admin: { name: "Yönetici", email: "a@b.co", password: "Guclu-Parola-123" } }));
  const env = fs.readFileSync(path.join(proj, ".env"), "utf8");
  assert.match(env, /JWT_SECRET="gercek-sir"/);
  assert.match(env, /MY_CUSTOM_KEY="koru"/);
  assert.match(env, /SESSION_SECRET="eski-oturum"/);
});

test("ilk kurulumda .env.example'daki yer tutucu sır rastgele üretilir", async () => {
  const proj = fixture({
    "package.json": JSON.stringify({ name: "demo", scripts: { start: "node s.js" } }), "s.js": "",
    ".env.example": "PORT=3000\nJWT_SECRET=change-me\nJWT_REFRESH_SECRET=\nSTRIPE_SECRET=\n",
  });
  await apply(proj, payload(), false);
  const env = fs.readFileSync(path.join(proj, ".env"), "utf8");
  assert.doesNotMatch(env, /change-me/);
  assert.match(env, /JWT_SECRET="[0-9a-f]{64}"/);
  assert.match(env, /JWT_REFRESH_SECRET="[0-9a-f]{64}"/);
  assert.match(env, /STRIPE_SECRET=""/, "üçüncü taraf sırları üretilmez");
});

test("önceden var olan alt proje .env dosyası yedeklenir ve hata olunca geri yüklenir", async () => {
  const proj = fixture({
    "package.json": JSON.stringify({ name: "root", scripts: { start: "node s.js", build: "node -e \"process.exit(1)\"" } }), "s.js": "",
    "backend/package.json": JSON.stringify({ name: "be", scripts: { start: "node x.js", build: "node -e \"process.exit(1)\"" } }),
    "frontend/package.json": JSON.stringify({ name: "fe", scripts: { dev: "vite" } }),
    "backend/.env": "KULLANICI_DEGERI=1\n",
  });
  const detection = detectProject(proj);
  assert.ok(detection.subprojects?.backend, "backend alt projesi algılanmalı");
  await assert.rejects(apply(proj, payload({ buildClient: true }), false));
  assert.equal(fs.readFileSync(path.join(proj, "backend", ".env"), "utf8"), "KULLANICI_DEGERI=1\n");
  assert.ok(!fs.existsSync(path.join(proj, "frontend", ".env")), "bizim oluşturduğumuz .env silinir");
});

test("materializeEnvTemplate yer tutucu sırları üretir, zayıf parolaları bildirir", () => {
  const cache = new Map();
  const r = materializeEnvTemplate("JWT_SECRET=change-me\nADMIN_PASSWORD=admin123\nAPI_URL=http://x\nSESSION_SECRET=gercek-uzun-deger\n", cache);
  assert.deepEqual(r.generated, ["JWT_SECRET"]);
  assert.deepEqual(r.weak, ["ADMIN_PASSWORD"]);
  assert.match(r.text, /ADMIN_PASSWORD=admin123/);
  assert.match(r.text, /SESSION_SECRET=gercek-uzun-deger/);
  assert.equal(materializeEnvTemplate("JWT_SECRET=\n", cache).text.match(/"(.+)"/)[1], cache.get("JWT_SECRET"));
});

test("Seçenek 6 hazırlığı yer tutucu sırları üretir ve doğrudan başlatma kilidini işaretler", () => {
  const proj = fixture({
    "package.json": JSON.stringify({ name: "demo", scripts: { start: "node s.js" } }), "s.js": "",
    ".env.example": "PORT=3000\nJWT_SECRET=change-me\nADMIN_PASSWORD=admin123\n",
  });
  const logs = [];
  const t = createTerminalBootstrap({ root: proj, log: (m) => logs.push(m), noOpen: true });
  const { envPath } = t.ensureDefaultEnvironment();
  const env = fs.readFileSync(envPath, "utf8");
  assert.doesNotMatch(env, /change-me/);
  assert.match(env, /JWT_SECRET="[0-9a-f]{64}"/);
  assert.ok(logs.some((l) => /zayıf varsayılan parola/.test(l) && /ADMIN_PASSWORD/.test(l)));
  assert.equal(t.hasDirectStartLock(), true);
});

test("statik sunucu bozuk URL kodlamasında çökmez, 400 döner", async () => {
  const dir = fixture({ "index.html": "<h1>ok</h1>" });
  const server = createStaticAppServer(dir);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  const get = (p) => new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: p }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); }).on("error", reject);
  });
  try {
    assert.equal(await get("/%E0%A4%A"), 400);
    assert.equal(await get("/%00"), 400);
    assert.equal(await get("/"), 200);
  } finally {
    server.close();
  }
});
