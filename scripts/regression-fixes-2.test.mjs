import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { detectProject, loadSetupConfig } from "./detect-project.mjs";
import { createProcessRunner } from "./process-runner.mjs";
import { initProject } from "./setup-api.mjs";
import { setupPayloadSchema } from "../wizard/config.mjs";
import { createApplyState, executeSetupApply } from "../wizard/shared.mjs";

function tmp(prefix = "setup-reg2-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const base = {
  deployment: { mode: "localhost", publicUrl: "http://127.0.0.1:3000", basePath: "/", allowedOrigins: ["http://127.0.0.1:3000"], trustProxyHops: 0 },
  email: { enabled: false }, database: { provider: "sqlite" }, buildClient: false,
};

test("frontend portu backend portuyla aynı olamaz", () => {
  assert.throws(
    () => setupPayloadSchema.parse({ ...base, server: { host: "127.0.0.1", port: 3000, frontendPort: 3000 }, admin: {} }, { allowOptionalAdmin: true }),
    (err) => err.issues.some((i) => i.path.includes("frontendPort")),
  );
  assert.doesNotThrow(() => setupPayloadSchema.parse({ ...base, server: { host: "127.0.0.1", port: 3000, frontendPort: 3001 }, admin: {} }, { allowOptionalAdmin: true }));
});

test("process-runner günlüklerde verilen sırları maskeler", async () => {
  const lines = [];
  const runner = createProcessRunner({ log: (t) => lines.push(t) });
  await runner.run(
    { command: process.execPath, args: ["-e", "console.log('anahtar=GIZLI-DEGER-123')"] },
    { secrets: ["GIZLI-DEGER-123"], prependPaths: [] },
  );
  const out = lines.join("");
  assert.doesNotMatch(out, /GIZLI-DEGER-123/);
  assert.match(out, /\*{6}/);
});

test("seed betiği yoksa özet hesabın veritabanında oluşturulmadığını açıkça söyler", async () => {
  const proj = tmp();
  fs.writeFileSync(path.join(proj, "package.json"), JSON.stringify({ name: "demo", scripts: { start: "node s.js" } }));
  fs.writeFileSync(path.join(proj, "s.js"), "");
  const payload = setupPayloadSchema.parse({
    ...base, server: { host: "127.0.0.1", port: 3000 },
    admin: { name: "Yönetici", email: "a@b.co", password: "Guclu-Parola-123" },
  }, { allowOptionalAdmin: true });
  const paths = {
    serverRoot: proj, dataRoot: path.join(proj, "data"), env: path.join(proj, ".env"),
    lock: path.join(proj, "data", "installation.lock"), pending: path.join(proj, "data", "installation.pending"),
    setupArtifacts: path.join(proj, "data", "setup-artifacts"), databaseUrl: "file:./data/app.db",
  };
  const summary = await executeSetupApply({
    projectRoot: proj, dataDir: null, paths, detection: detectProject(proj), setupConfig: loadSetupConfig(proj),
    options: {}, applyJob: createApplyState(), payload, markStep: () => {},
  });
  const text = summary.join("\n");
  assert.match(text, /OLUŞTURULMADI/);
  assert.doesNotMatch(text, /İlk yönetici hesabı oluşturuldu/);
});

test("init --copy-tools iç geliştirme planlarını ve not dosyasını kopyalamaz", () => {
  const proj = tmp();
  fs.writeFileSync(path.join(proj, "package.json"), JSON.stringify({ name: "demo", scripts: { start: "node s.js" } }));
  initProject(proj, { copyTools: true, createLaunchers: false });
  const docs = path.join(proj, "tools", "setup", "docs");
  assert.ok(fs.existsSync(path.join(docs, "ENTEGRASYON.md")));
  assert.ok(!fs.existsSync(path.join(docs, "superpowers")));
  assert.ok(!fs.existsSync(path.join(docs, "bilgi-notu.md")));
});

test("select-candidate etkin kökü seçilen projeye taşır ve depo dışı yolu reddeder", async (t) => {
  const { createSetupServer } = await import("../wizard/server.mjs");
  const dir = tmp("setup-reg2-cand-");
  for (const n of ["auth", "billing"]) {
    fs.mkdirSync(path.join(dir, "apps", n), { recursive: true });
    fs.writeFileSync(path.join(dir, "apps", n, "package.json"), JSON.stringify({ name: `${n}-svc`, scripts: { start: "node i.js" }, dependencies: { express: "4" } }));
    fs.writeFileSync(path.join(dir, "apps", n, ".env.example"), `PORT=${n === "auth" ? 4100 : 4200}\n${n.toUpperCase()}_ONLY=1\n`);
  }
  const token = "a-very-long-test-token-at-least-24-chars";
  const server = createSetupServer(token, { projectRoot: dir, launchers: false });
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const headers = { Authorization: `Bearer ${token}`, Origin: `http://127.0.0.1:${port}`, "Content-Type": "application/json" };
  const post = (candidate) => fetch(`http://127.0.0.1:${port}/api/select-candidate`, { method: "POST", headers, body: JSON.stringify({ candidate }) });

  const outside = await post("../");
  assert.notEqual(outside.status, 200, "depo dışı aday reddedilmeli");

  assert.equal((await post("apps/billing")).status, 200);
  const status = await (await fetch(`http://127.0.0.1:${port}/api/status`, { headers })).json();
  const keys = status.detected.envVariables.map((v) => v.key);
  assert.ok(keys.includes("BILLING_ONLY"));
  assert.ok(!keys.includes("AUTH_ONLY"), "diğer adayın değişkenleri listelenmemeli");
  assert.equal(status.detected.defaultPort, 4200);
  assert.equal(status.detected.candidateRoot, "apps/billing");
});

test("init başlatıcıları npx/bunx çağrısını sabit sürüme bağlar; 'none' ile sabitleme kapanır", () => {
  const prev = process.env.SETUP_LAUNCHER_REF;
  try {
    process.env.SETUP_LAUNCHER_REF = "abc1234def";
    const pinned = tmp();
    fs.writeFileSync(path.join(pinned, "package.json"), JSON.stringify({ name: "demo", scripts: { start: "node s.js" } }));
    initProject(pinned, {});
    for (const file of ["kurulum.bat", "kurulum.sh"]) {
      const text = fs.readFileSync(path.join(pinned, file), "utf8");
      assert.match(text, /github:sirrakadembasti\/setup#abc1234def /, `${file} sabitlenmeli`);
      assert.doesNotMatch(text, /github:sirrakadembasti\/setup [%"]/, `${file} sabitlenmemiş çağrı kalmamalı`);
    }
    process.env.SETUP_LAUNCHER_REF = "none";
    const loose = tmp();
    fs.writeFileSync(path.join(loose, "package.json"), JSON.stringify({ name: "demo", scripts: { start: "node s.js" } }));
    initProject(loose, {});
    assert.doesNotMatch(fs.readFileSync(path.join(loose, "kurulum.sh"), "utf8"), /setup#/);
  } finally {
    if (prev === undefined) delete process.env.SETUP_LAUNCHER_REF; else process.env.SETUP_LAUNCHER_REF = prev;
  }
});
