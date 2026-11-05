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
