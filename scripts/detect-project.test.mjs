import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildInstallPlan, detectPackageManager, detectProject, parseEnvExample } from "./detect-project.mjs";
import { initProject } from "./setup-api.mjs";
import { bumpSemver, getVersion, parseSemver } from "./version.mjs";

function mkTemp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "setup-detect-"));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test("boş dizin unknown/directory olarak algılanır ve kurulum planı red eder", (t) => {
  const { dir, cleanup } = mkTemp();
  t.after(cleanup);
  const d = detectProject(dir);
  const plan = buildInstallPlan(d);
  assert.equal(d.kind, "directory");
  assert.equal(plan.canInstall, false);
});

test("bozuk package.json kurulum planı tarafından reddedilir", (t) => {
  const { dir, cleanup } = mkTemp();
  t.after(cleanup);
  fs.writeFileSync(path.join(dir, "package.json"), "{ invalid json ", "utf8");
  const d = detectProject(dir);
  const plan = buildInstallPlan(d);
  assert.equal(d.hasPackageJson, false);
  assert.equal(d.packageJsonExists, true);
  assert.equal(plan.canInstall, false);
  assert.match(plan.steps.at(-1).label, /package\.json bozuk/);
});

test("workspace + server + express ve paket yöneticisi (npm/pnpm/yarn/bun) algılanır", (t) => {
  const { dir, cleanup } = mkTemp();
  t.after(cleanup);
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "ornek-app", workspaces: ["server", "client"] }),
    "utf8",
  );
  fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
  fs.mkdirSync(path.join(dir, "server"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "server", "package.json"),
    JSON.stringify({ name: "server", dependencies: { express: "^4.21.0" } }),
    "utf8",
  );
  fs.mkdirSync(path.join(dir, "client"), { recursive: true });
  fs.writeFileSync(path.join(dir, "client", "package.json"), "{}", "utf8");

  const d = detectProject(dir);
  const plan = buildInstallPlan(d);
  assert.equal(d.kind, "workspace-fullstack");
  assert.equal(d.packageManager, "pnpm");
  assert.equal(d.projectName, "ornek-app");
  assert.equal(d.stack.express, true);
  assert.equal(plan.canInstall, true);
  assert.ok(plan.steps.some((s) => s.id === "wizard"));
});

test("tek dizinli GitHub reposu (npm + .env.example) algılanır ve setup init ile yapılandırılır", (t) => {
  const { dir, cleanup } = mkTemp();
  t.after(cleanup);
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "github-web-app", scripts: { dev: "vite", start: "node server.js" }, dependencies: { react: "^18.0.0" } }),
    "utf8",
  );
  fs.writeFileSync(path.join(dir, "package-lock.json"), "{}\n", "utf8");
  fs.writeFileSync(
    path.join(dir, ".env.example"),
    "# Uygulama portu\nPORT=3000\nDATABASE_URL=\"file:./data/app.db\"\n",
    "utf8",
  );

  assert.equal(detectPackageManager(dir), "npm");
  const envEx = parseEnvExample(dir);
  assert.equal(envEx.file, ".env.example");
  assert.equal(envEx.variables.length, 2);
  assert.equal(envEx.variables[0].key, "PORT");
  assert.equal(envEx.variables[0].defaultValue, "3000");

  const initRes = initProject(dir, { updatePackageJson: true });
  assert.equal(initRes.created, true);
  assert.equal(fs.existsSync(path.join(dir, "setup.config.json")), true);
  const updatedPkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  assert.equal(updatedPkg.scripts.setup, "setup");
});

test("kurulum artıkları evidence alanına yazılır ve sürümleme v1.0.0 çalışır", (t) => {
  const { dir, cleanup } = mkTemp();
  t.after(cleanup);
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x" }), "utf8");
  fs.mkdirSync(path.join(dir, "server", "data"), { recursive: true });
  fs.writeFileSync(path.join(dir, "server", "data", "installation.lock"), "{}", "utf8");

  const d = detectProject(dir);
  assert.equal(d.runtime.installationLock, true);

  assert.equal(getVersion(), "1.0.0");
  assert.equal(parseSemver("v1.0").shortTag, "v1.0");
  assert.equal(parseSemver("1.0.0").fullTag, "v1.0.0");
  assert.equal(bumpSemver("1.0.0", "patch"), "1.0.1");
  assert.equal(bumpSemver("1.0.0", "minor"), "1.1.0");
  assert.equal(bumpSemver("1.0.0", "major"), "2.0.0");
});
