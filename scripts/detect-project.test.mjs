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

  const detected = detectProject(dir);
  assert.equal(detected.ports.app, 3000);

  const initRes = initProject(dir, { updatePackageJson: true });
  assert.equal(initRes.created, true);
  assert.equal(fs.existsSync(path.join(dir, "setup.config.json")), true);
  const writtenConfig = JSON.parse(fs.readFileSync(path.join(dir, "setup.config.json"), "utf8"));
  assert.equal(writtenConfig.ports.app, 3000);
  assert.deepEqual(writtenConfig.start, { command: "npm", args: ["run", "start"] });
  const updatedPkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  assert.equal(updatedPkg.scripts.setup, "setup");
});

test("initProject setupBin seçeneği ile gömülü (submodule) kurulum betiklerini yazar", (t) => {
  const { dir, cleanup } = mkTemp();
  t.after(cleanup);
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "embedded-setup-app", scripts: { start: "node index.js" } }),
    "utf8",
  );

  const initRes = initProject(dir, {
    updatePackageJson: true,
    setupBin: "tools/setup/bin/setup.mjs",
  });
  assert.equal(initRes.created, true);
  assert.equal(initRes.packageJsonUpdated, true);
  const updatedPkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  assert.equal(updatedPkg.scripts.setup, "node tools/setup/bin/setup.mjs");
  assert.equal(updatedPkg.scripts.wizard, "node tools/setup/bin/setup.mjs wizard");
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

function writeFile(dir, rel, content) {
  const file = path.join(dir, ...rel.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

test("package.json'da yazan ama kaynakta import edilmeyen express kullanılmıyor sayılır", (t) => {
  const { dir, cleanup } = mkTemp();
  t.after(cleanup);
  writeFile(dir, "package.json", JSON.stringify({ name: "a", dependencies: { express: "^4.21.0" } }));
  writeFile(dir, "index.mjs", 'import http from "node:http";\n// import express from "express";\n/* require("express") */\n');
  // node_modules içindeki kullanım sayılmaz
  writeFile(dir, "node_modules/x/index.js", 'require("express");\n');

  const d = detectProject(dir);
  assert.equal(d.stack.express, false);
  assert.deepEqual(d.dependencyUsage.express, { declared: true, used: false, sourceScanned: true });
});

test("import, require, dinamik import ve alt yol (subpath) kullanımları algılanır", (t) => {
  const forms = [
    'import express from "express";',
    "const express = require('express');",
    'const m = await import("express");',
    'import { Router } from "express/lib/router";',
    'export { json } from "express";',
  ];
  for (const src of forms) {
    const { dir, cleanup } = mkTemp();
    try {
      writeFile(dir, "package.json", JSON.stringify({ name: "a", dependencies: { express: "^4.21.0" } }));
      writeFile(dir, "server/src/app.ts", `${src}\n`);
      const d = detectProject(dir);
      assert.equal(d.stack.express, true, `algılanmadı: ${src}`);
      assert.equal(d.dependencyUsage.express.used, true);
    } finally {
      cleanup();
    }
  }
});

test("benzer adlı paketler (express-rate-limit, vue-router) yanlış eşleşmez", (t) => {
  const { dir, cleanup } = mkTemp();
  t.after(cleanup);
  writeFile(
    dir,
    "package.json",
    JSON.stringify({ name: "a", dependencies: { express: "^4", "express-rate-limit": "^7", vue: "^3", "vue-router": "^4" } }),
  );
  writeFile(dir, "src/index.js", 'import rl from "express-rate-limit";\nimport { createRouter } from "vue-router";\n');
  const d = detectProject(dir);
  assert.equal(d.stack.express, false);
  assert.equal(d.dependencyUsage.vue.used, false);
});

test("yalnız CLI üzerinden kullanılan paketler (vite, next) package.json script'lerinden algılanır", (t) => {
  const { dir, cleanup } = mkTemp();
  t.after(cleanup);
  writeFile(
    dir,
    "package.json",
    JSON.stringify({ name: "a", scripts: { dev: "vite --port 3000", build: "next build" }, devDependencies: { vite: "^5", next: "^14" } }),
  );
  writeFile(dir, "src/main.js", 'console.log("merhaba");\n');
  const d = detectProject(dir);
  assert.equal(d.stack.vite, true);
  assert.equal(d.stack.nextjs, true);
  assert.equal(d.dependencyUsage.vite.used, true);
});

test("test dosyalarındaki import'lar (*.test.*, *.spec.*, __tests__/, test/) kullanım sayılmaz", (t) => {
  const { dir, cleanup } = mkTemp();
  t.after(cleanup);
  writeFile(dir, "package.json", JSON.stringify({ name: "a", dependencies: { express: "^4" } }));
  writeFile(dir, "src/index.mjs", 'import http from "node:http";\n');
  writeFile(dir, "src/app.test.mjs", 'import express from "express";\n');
  writeFile(dir, "src/app.spec.ts", 'import express from "express";\n');
  writeFile(dir, "src/__tests__/a.js", 'require("express");\n');
  writeFile(dir, "test/e2e.js", 'require("express");\n');
  const d = detectProject(dir);
  assert.equal(d.stack.express, false);
  assert.equal(d.dependencyUsage.express.used, false);
});

test("kaynak dosya yoksa doğrulama yapılamaz ve package.json bildirimi esas alınır", (t) => {
  const { dir, cleanup } = mkTemp();
  t.after(cleanup);
  writeFile(dir, "package.json", JSON.stringify({ name: "a", dependencies: { express: "^4" } }));
  const d = detectProject(dir);
  assert.equal(d.stack.express, true);
  assert.deepEqual(d.dependencyUsage.express, { declared: true, used: false, sourceScanned: false });
});
