import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  detectProject,
  findProjectCandidates,
  findScatteredEnvExamples,
  parseEnvExample,
  buildInstallPlan,
} from "./detect-project.mjs";
import { resolveAppStartInvocation, createDualProcessController } from "../wizard/app-process.mjs";
import { parseArgs } from "../bin/setup.mjs";
import { executeSetupApply } from "../wizard/shared.mjs";
import { createSetupServer } from "../wizard/server.mjs";
import { initProject, checkDependencies } from "./setup-api.mjs";

function mkTemp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "setup-deep-discovery-"));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test("Derin Tarama: Kök dizinde package.json yokken alt dizindeki tekil proje algılanır (apps/web)", (t) => {
  const { dir, cleanup } = mkTemp();
  t.after(cleanup);

  // Kök dizinde sadece README ve docs var
  fs.writeFileSync(path.join(dir, "README.md"), "# Project Docs\n", "utf8");
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
  fs.writeFileSync(path.join(dir, "docs", "arch.md"), "# Architecture\n", "utf8");

  // Alt dizinde proje
  const sub = path.join(dir, "apps", "web");
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(
    path.join(sub, "package.json"),
    JSON.stringify({
      name: "sub-web",
      scripts: { dev: "vite", start: "vite preview" },
      dependencies: { react: "^18.2.0" },
    }),
    "utf8",
  );
  fs.writeFileSync(path.join(sub, "index.html"), "<!DOCTYPE html><html><body>Root</body></html>", "utf8");

  const d = detectProject(dir);
  const plan = buildInstallPlan(d);

  assert.equal(plan.canInstall, true);
  assert.equal(d.candidateRoot, "apps/web");
  assert.equal(d.scenario.id, "scenario-2-spa-static");
  assert.equal(d.projectName, "sub-web");
});

test("Çok Parçalı Repo: Özel adlı alt dizinler (srv/ ve ui/) frontend + backend fullstack olarak algılanır", (t) => {
  const { dir, cleanup } = mkTemp();
  t.after(cleanup);

  fs.writeFileSync(path.join(dir, "README.md"), "# Polyglot / Custom monorepo\n", "utf8");

  // srv/ klasöründe Express backend
  const srv = path.join(dir, "srv");
  fs.mkdirSync(srv, { recursive: true });
  fs.writeFileSync(
    path.join(srv, "package.json"),
    JSON.stringify({
      name: "custom-srv",
      scripts: { start: "node index.js" },
      dependencies: { express: "^4.21.0" },
    }),
    "utf8",
  );
  fs.writeFileSync(path.join(srv, "index.js"), "const express = require('express');\nconst app = express();\n", "utf8");

  // ui/ klasöründe Vite + Vue frontend
  const ui = path.join(dir, "ui");
  fs.mkdirSync(ui, { recursive: true });
  fs.writeFileSync(
    path.join(ui, "package.json"),
    JSON.stringify({
      name: "custom-ui",
      scripts: { dev: "vite", build: "vite build" },
      dependencies: { vue: "^3.4.0" },
    }),
    "utf8",
  );

  const d = detectProject(dir);
  const plan = buildInstallPlan(d);

  assert.equal(plan.canInstall, true);
  assert.ok(d.subprojects, "subprojects tanımlanmalı");
  assert.equal(d.subprojects.backend?.dir, "srv");
  assert.equal(d.subprojects.frontend?.dir, "ui");
  assert.equal(d.scenario.id, "scenario-3-fullstack");

  // Kurulum planı her iki alt proje için bağımlılık kurulum adımı içermeli
  const depStep = plan.steps.find((s) => s.id === "dependencies");
  assert.ok(depStep, "dependencies adımı bulunmalı");
  assert.match(depStep.label, /srv.*ui|ui.*srv|srv \+ ui/);
});

test("Dağınık Konfigürasyon: config/ ve deploy/ içindeki .env.example dosyaları birleştirilir", (t) => {
  const { dir, cleanup } = mkTemp();
  t.after(cleanup);

  fs.mkdirSync(path.join(dir, "deploy"), { recursive: true });
  fs.mkdirSync(path.join(dir, "config"), { recursive: true });

  fs.writeFileSync(
    path.join(dir, "deploy", ".env.sample"),
    "DATABASE_URL=postgres://user:pass@localhost:5432/app\nPORT=8080\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(dir, "config", ".env.example"),
    "JWT_SECRET=supersecret\nREDIS_HOST=127.0.0.1\n",
    "utf8",
  );

  const parsed = parseEnvExample(dir);
  assert.ok(parsed.variables.length >= 4);
  const keys = parsed.variables.map((v) => v.key);
  assert.ok(keys.includes("DATABASE_URL"));
  assert.ok(keys.includes("PORT"));
  assert.ok(keys.includes("JWT_SECRET"));
  assert.ok(keys.includes("REDIS_HOST"));
});

test("Eski Masaüstü Uygulaması: C# WinForms / WPF (.csproj) masaüstü senaryosu olarak algılanır", (t) => {
  const { dir, cleanup } = mkTemp();
  t.after(cleanup);

  fs.mkdirSync(path.join(dir, "src", "DesktopApp"), { recursive: true });
  const csprojContent = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>WinExe</OutputType>
    <TargetFramework>net8.0-windows</TargetFramework>
    <UseWindowsForms>true</UseWindowsForms>
  </PropertyGroup>
</Project>`;
  fs.writeFileSync(path.join(dir, "src", "DesktopApp", "DesktopApp.csproj"), csprojContent, "utf8");

  const d = detectProject(dir);
  assert.equal(d.kind, "dotnet-desktop");
  assert.equal(d.scenario.isDesktop, true);
  assert.equal(d.scenario.id, "scenario-5-desktop");

  const inv = resolveAppStartInvocation(dir);
  assert.equal(inv.command, "dotnet");
  assert.ok(inv.args.includes("run"));
});

test("Eski Masaüstü Uygulaması: Python Tkinter / PyQt GUI masaüstü senaryosu olarak algılanır", (t) => {
  const { dir, cleanup } = mkTemp();
  t.after(cleanup);

  fs.mkdirSync(path.join(dir, "app"), { recursive: true });
  const pyCode = `import tkinter as tk
root = tk.Tk()
root.title("Eski Masaüstü")
root.mainloop()
`;
  fs.writeFileSync(path.join(dir, "app", "gui.py"), pyCode, "utf8");
  fs.writeFileSync(path.join(dir, "requirements.txt"), "# no external gui deps needed for tkinter\n", "utf8");

  const d = detectProject(dir);
  assert.equal(d.kind, "python-desktop");
  assert.equal(d.scenario.isDesktop, true);
  assert.equal(d.scenario.id, "scenario-5-desktop");

  const inv = resolveAppStartInvocation(dir);
  assert.match(inv.args[0], /gui\.py/);
});

test("Belirsiz / Çoklu Aday: Birbirinden bağımsız birden çok proje adayı listelenir ve seçilebilir", (t) => {
  const { dir, cleanup } = mkTemp();
  t.after(cleanup);

  fs.mkdirSync(path.join(dir, "services", "auth-svc"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "services", "auth-svc", "package.json"),
    JSON.stringify({ name: "auth-svc", dependencies: { express: "^4.0.0" } }),
    "utf8",
  );

  fs.mkdirSync(path.join(dir, "services", "billing-svc"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "services", "billing-svc", "package.json"),
    JSON.stringify({ name: "billing-svc", dependencies: { express: "^4.0.0" } }),
    "utf8",
  );

  fs.mkdirSync(path.join(dir, "services", "reports-svc"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "services", "reports-svc", "package.json"),
    JSON.stringify({ name: "reports-svc", dependencies: { express: "^4.0.0" } }),
    "utf8",
  );

  const d = detectProject(dir);
  assert.ok(d.candidates && d.candidates.length >= 3);
  assert.equal(d.hasAmbiguity, true);

  // Belirli bir aday seçildiğinde o adayın projesi odaklanır
  const dSelected = detectProject(dir, { candidate: "services/billing-svc" });
  assert.equal(dSelected.projectName, "billing-svc");
  assert.equal(dSelected.candidateRoot, "services/billing-svc");
});

test("CLI parseArgs: --candidate seçeneğini doğru ayrıştırır", () => {
  const parsed = parseArgs(["--candidate", "apps/portal", "--root", "F:/my-repo"]);
  assert.equal(parsed.candidate, "apps/portal");
  assert.equal(parsed.root, path.resolve("F:/my-repo"));
});

test("executeSetupApply: .env dosyasını alt proje ve aday kök dizinlerine de kopyalar", async (t) => {
  const { dir, cleanup } = mkTemp();
  t.after(cleanup);

  // Kök dizinde srv ve ui alt projeleri oluştur
  const srv = path.join(dir, "srv");
  const ui = path.join(dir, "ui");
  fs.mkdirSync(srv, { recursive: true });
  fs.mkdirSync(ui, { recursive: true });

  fs.writeFileSync(
    path.join(srv, "package.json"),
    JSON.stringify({ name: "srv", dependencies: { express: "^4.21.0" } }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(ui, "package.json"),
    JSON.stringify({ name: "ui", dependencies: { vue: "^3.4.0" } }),
    "utf8",
  );

  const d = detectProject(dir);
  assert.ok(d.subprojects);

  const applyJob = { steps: [], status: "pending", message: "" };
  const payload = {
    server: { port: 5000, host: "127.0.0.1", proxy: 1 },
    admin: { name: "Admin", email: "admin@test.com", password: "Password123!" },
    database: { provider: "sqlite" },
    retention: { enabled: false },
    deployment: {
      mode: "localhost",
      publicUrl: "http://localhost:5000",
      basePath: "/",
      allowedOrigins: ["http://localhost:5000"],
      trustProxyHops: 1,
    },
    customEnv: { APP_CUSTOM: "hello" },
    buildClient: false,
  };

  const dataDir = path.join(dir, "data");
  fs.mkdirSync(dataDir, { recursive: true });

  await executeSetupApply({
    projectRoot: dir,
    dataDir,
    paths: {
      serverRoot: dir,
      dataRoot: dataDir,
      env: path.join(dir, ".env"),
      lock: path.join(dataDir, "installation.lock"),
      pending: path.join(dataDir, "installation.pending"),
      setupArtifacts: path.join(dataDir, "artifacts"),
      databaseUrl: "file:./data/app.db",
    },
    detection: d,
    setupConfig: null,
    payload,
    applyJob,
    markStep: () => {},
    appendLog: () => {},
    options: {},
  });

  assert.equal(applyJob.status, "success");
  assert.ok(fs.existsSync(path.join(dir, ".env")), "Kök .env oluşturulmalı");
  assert.ok(fs.existsSync(path.join(srv, ".env")), "srv/.env oluşturulmalı");
  assert.ok(fs.existsSync(path.join(ui, ".env")), "ui/.env oluşturulmalı");

  const srvEnvContent = fs.readFileSync(path.join(srv, ".env"), "utf8");
  assert.match(srvEnvContent, /APP_CUSTOM="?hello"?/);
});

test("Çift Süreç (Dual Orchestration): Fullstack alt projelerde (srv/ + ui/) resolveAppStartInvocation dual mod döndürür", (t) => {
  const { dir, cleanup } = mkTemp();
  t.after(cleanup);

  fs.mkdirSync(path.join(dir, "srv"), { recursive: true });
  fs.mkdirSync(path.join(dir, "ui"), { recursive: true });

  fs.writeFileSync(
    path.join(dir, "srv", "package.json"),
    JSON.stringify({ name: "srv", scripts: { start: "node index.js" }, dependencies: { express: "^4.0.0" } }),
    "utf8"
  );
  fs.writeFileSync(
    path.join(dir, "ui", "package.json"),
    JSON.stringify({ name: "ui", scripts: { dev: "vite" }, dependencies: { vue: "^3.0.0" } }),
    "utf8"
  );

  const inv = resolveAppStartInvocation(dir);
  assert.ok(inv, "Başlatma komutu çözülmeli");
  assert.equal(inv.type, "dual");
  assert.ok(inv.backend);
  assert.ok(inv.frontend);
  assert.equal(inv.backend.cwd, path.join(dir, "srv"));
  assert.equal(inv.frontend.cwd, path.join(dir, "ui"));
});

test("Çift Süreç (Dual Process Runner): Süreçler eşzamanlı başlar ve Kademeli Kapanma (Cascading Termination) çalışır", async (t) => {
  const { dir, cleanup } = mkTemp();
  t.after(cleanup);

  // Backend: 200ms sonra kendiliğinden kapanan mock süreç
  const backendScript = "setTimeout(() => process.exit(42), 200);";
  // Frontend: Uzun yaşayan mock süreç
  const frontendScript = "setInterval(() => {}, 1000);";

  const logs = [];
  const controller = createDualProcessController({
    projectRoot: dir,
    backendInvocation: { command: process.execPath, args: ["-e", backendScript], cwd: dir },
    frontendInvocation: { command: process.execPath, args: ["-e", frontendScript], cwd: dir },
    backendPort: 5600,
    frontendPort: 5601,
    envVars: { TEST_KEY: "1" },
    appendLog: (msg) => logs.push(msg),
  });
  t.after(() => controller.stop());

  const pids = await controller.start();
  assert.ok(pids.backendPid);
  assert.ok(pids.frontendPid);

  const initialStatus = controller.getSubprocesses();
  assert.equal(initialStatus.backend.alive, true);
  assert.equal(initialStatus.frontend.alive, true);
  assert.equal(initialStatus.backend.port, 5600);
  assert.equal(initialStatus.frontend.port, 5601);

  // Include process startup time on busy hosts, then require both processes to terminate.
  const startWait = Date.now();
  while (Date.now() - startWait < 10000) {
    const sub = controller.getSubprocesses();
    if (!sub.backend.alive && !sub.frontend.alive) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  const afterCrash = controller.getSubprocesses();
  assert.equal(afterCrash.backend.alive, false, "Backend kapanmış olmalı");
  assert.equal(afterCrash.frontend.alive, false, "Frontend de kademeli olarak kapanmış olmalı");
  assert.ok(logs.some((l) => l.includes("Backend kapandı") && l.includes("Frontend kademeli sonlandırılıyor")));
});

test("API: POST /api/select-candidate belirsiz repolarda adayı dinamik olarak değiştirir", async (t) => {
  const { dir, cleanup } = mkTemp();
  t.after(cleanup);

  fs.mkdirSync(path.join(dir, "apps", "auth"), { recursive: true });
  fs.mkdirSync(path.join(dir, "apps", "billing"), { recursive: true });

  fs.writeFileSync(
    path.join(dir, "apps", "auth", "package.json"),
    JSON.stringify({ name: "auth-svc", dependencies: { express: "^4.0.0" } }),
    "utf8"
  );
  fs.writeFileSync(
    path.join(dir, "apps", "billing", "package.json"),
    JSON.stringify({ name: "billing-svc", dependencies: { express: "^4.0.0" } }),
    "utf8"
  );

  const token = "a-very-long-test-token-at-least-24-chars";
  const server = createSetupServer(token, { projectRoot: dir, launchers: false });
  t.after(() => new Promise((r) => server.close(r)));

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = address.port;
  const authHeaders = {
    "Authorization": `Bearer ${token}`,
    "Origin": "http://127.0.0.1",
    "Content-Type": "application/json",
  };

  // Başlangıç durumu: İlk aday auth
  const res1 = await fetch(`http://127.0.0.1:${port}/api/status`, { headers: authHeaders });
  assert.equal(res1.status, 200);
  const status1 = await res1.json();
  assert.equal(status1.detected.hasAmbiguity, true);

  // POST /api/select-candidate ile billing seç
  const selectRes = await fetch(`http://127.0.0.1:${port}/api/select-candidate`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ candidate: "apps/billing" }),
  });
  assert.equal(selectRes.status, 200);
  const selectBody = await selectRes.json();
  assert.equal(selectBody.detected.projectName, "billing-svc");
  assert.equal(selectBody.detected.candidateRoot, "apps/billing");

  // Tekrar status sorgula: Artık billing aktif olmalı
  const res2 = await fetch(`http://127.0.0.1:${port}/api/status`, { headers: authHeaders });
  assert.equal(res2.status, 200);
  const status2 = await res2.json();
  assert.equal(status2.detected.projectName, "billing-svc");
  assert.equal(status2.detected.candidateRoot, "apps/billing");
});

test("Çok Parçalı Repo: Kök dizinde package.json yokken initProject subprojects için --prefix kurulum adımları üretir ve checkDependencies doğrular", (t) => {
  const { dir, cleanup } = mkTemp();
  t.after(cleanup);

  // Kök dizinde package.json YOK. Alt dizinler: srv ve ui
  fs.mkdirSync(path.join(dir, "srv"), { recursive: true });
  fs.mkdirSync(path.join(dir, "ui"), { recursive: true });
  fs.writeFileSync(path.join(dir, "srv", "package.json"), JSON.stringify({ name: "srv", dependencies: { express: "^4.0.0" } }), "utf8");
  fs.writeFileSync(path.join(dir, "ui", "package.json"), JSON.stringify({ name: "ui", dependencies: { vue: "^3.0.0" } }), "utf8");

  const initRes = initProject(dir, { createLaunchers: false });
  assert.equal(initRes.created, true);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, "setup.config.json"), "utf8"));
  assert.ok(Array.isArray(cfg.install?.steps), "install.steps tanımlanmalı");
  assert.equal(cfg.install.steps.length, 2);
  assert.deepEqual(cfg.install.steps[0].args, ["--prefix", "srv", "install"]);
  assert.deepEqual(cfg.install.steps[1].args, ["--prefix", "ui", "install"]);

  // node_modules yokken checkDependencies false dönmeli
  const depsBefore = checkDependencies(dir);
  assert.equal(depsBefore.ready, false);

  // Alt dizinlere node_modules eklenince checkDependencies true dönmeli
  fs.mkdirSync(path.join(dir, "srv", "node_modules", "express"), { recursive: true });
  fs.mkdirSync(path.join(dir, "ui", "node_modules", "vue"), { recursive: true });
  const depsAfter = checkDependencies(dir);
  assert.equal(depsAfter.ready, true);
});


test("Hibrit Çok Parçalı Repo (xfactor mimarisi): Kök package.json + backend/frontend/execution/llm-yonetimi alt paketlerini tam algılar ve kurar", (t) => {
  const { dir, cleanup } = mkTemp();
  t.after(cleanup);

  // Kök package.json (sadece e2e ve dev orkestrasyonu)
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "xfactor-e2e",
      private: true,
      scripts: { dev: "node scripts/dev.mjs" },
      devDependencies: { "@playwright/test": "^1.46.0" },
    }),
    "utf8",
  );

  // backend, frontend, execution, llm-yonetimi ve tools/setup (yoksayılmalı)
  fs.mkdirSync(path.join(dir, "backend"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "backend", "package.json"),
    JSON.stringify({
      name: "xfactor-backend",
      scripts: { start: "node server.js", dev: "node --watch server.js" },
      dependencies: { express: "^4.19.2" },
    }),
    "utf8",
  );
  fs.writeFileSync(path.join(dir, "backend", "server.js"), "import express from 'express';\n", "utf8");

  fs.mkdirSync(path.join(dir, "frontend"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "frontend", "package.json"),
    JSON.stringify({
      name: "app-builder-dashboard",
      scripts: { dev: "vite", build: "vite build" },
      dependencies: { react: "^18.3.1" },
      devDependencies: { vite: "^6.4.3" },
    }),
    "utf8",
  );

  fs.mkdirSync(path.join(dir, "execution"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "execution", "package.json"),
    JSON.stringify({
      name: "xfactor-execution",
      dependencies: { "playwright-core": "1.62.1" },
    }),
    "utf8",
  );
  fs.writeFileSync(path.join(dir, "execution", "server.js"), "import http from 'node:http';\n", "utf8");

  fs.mkdirSync(path.join(dir, "llm-yonetimi"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "llm-yonetimi", "package.json"),
    JSON.stringify({
      name: "@xfactor/llm-yonetimi",
      scripts: { start: "node examples/server.js" },
      dependencies: { express: "^4.19.2" },
    }),
    "utf8",
  );

  // tools/setup kopyası aday veya alt proje olarak algılanmamalı
  fs.mkdirSync(path.join(dir, "tools", "setup"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "tools", "setup", "package.json"),
    JSON.stringify({ name: "setup", version: "1.0.0" }),
    "utf8",
  );

  const d = detectProject(dir);
  assert.equal(d.hasAmbiguity, undefined);
  assert.equal(d.kind, "node-fullstack");
  assert.equal(d.scenario.id, "scenario-3-fullstack");
  assert.equal(d.subprojects?.backend?.dir, "backend");
  assert.equal(d.subprojects?.frontend?.dir, "frontend");

  const initRes = initProject(dir, { createLaunchers: false });
  assert.equal(initRes.created, true);

  // setup.config.json yazıldıktan sonra da detectProject aynı sonucu vermeli
  const dAfterInit = detectProject(dir);
  assert.equal(dAfterInit.kind, "node-fullstack");
  assert.equal(dAfterInit.scenario.id, "scenario-3-fullstack");
  assert.equal(dAfterInit.subprojects?.backend?.dir, "backend");
  assert.equal(dAfterInit.subprojects?.frontend?.dir, "frontend");

  const cfg = JSON.parse(fs.readFileSync(path.join(dir, "setup.config.json"), "utf8"));
  assert.ok(Array.isArray(cfg.install?.steps), "install.steps tanımlanmalı");
  const stepTargets = cfg.install.steps.map((s) => {
    const idx = Array.isArray(s.args) ? s.args.indexOf("--prefix") : -1;
    return idx !== -1 ? s.args[idx + 1] : (s.cwd || ".");
  });
  assert.ok(stepTargets.includes("."), "Kök dizin kurulum adımı olmalı");
  assert.ok(stepTargets.includes("backend"), "backend kurulum adımı olmalı");
  assert.ok(stepTargets.includes("frontend"), "frontend kurulum adımı olmalı");
  assert.ok(stepTargets.includes("execution"), "execution kurulum adımı olmalı");
  assert.ok(stepTargets.includes("llm-yonetimi"), "llm-yonetimi kurulum adımı olmalı");
  assert.ok(!stepTargets.some((t) => t.includes("tools")), "tools/setup kurulum adımı olmamalı");

  // Sadece kök node_modules varken checkDependencies false dönmeli
  fs.mkdirSync(path.join(dir, "node_modules", "@playwright"), { recursive: true });
  assert.equal(checkDependencies(dir).ready, false);

  // Tüm alt dizinlerin node_modules klasörleri oluşunca checkDependencies true dönmeli
  for (const sub of ["backend", "frontend", "execution", "llm-yonetimi"]) {
    fs.mkdirSync(path.join(dir, sub, "node_modules", "pkg"), { recursive: true });
  }
  assert.equal(checkDependencies(dir).ready, true);
});

test("npm-shim: translateNpmArgs --prefix ve ci argümanlarını Bun için doğru çevirir", async () => {
  const { translateNpmArgs } = await import("../bin/shims/npm-shim.mjs");
  const base = path.resolve("D:/xfactor-main/backend");
  const res = translateNpmArgs(["--prefix", "../llm-yonetimi", "ci", "--ignore-scripts", "--no-audit", "--no-fund"], base);
  assert.equal(res.cwd, path.resolve(base, "../llm-yonetimi"));
  assert.deepEqual(res.args, ["install", "--ignore-scripts"]);
});

test("buildServerEnv: localhost modunda .env.example NODE_ENV=development değerini korur ve frontendPort originlerini ALLOWED_ORIGINS'e ekler", async () => {
  const { buildServerEnv, setupPayloadSchema } = await import("../wizard/config.mjs");
  const payload = setupPayloadSchema.parse({
    deployment: {
      mode: "localhost",
      publicUrl: "http://127.0.0.1:8000",
      basePath: "/",
      allowedOrigins: ["http://127.0.0.1:8000"],
      trustProxyHops: 0,
      retention: { enabled: false, actionLogDays: 180, readNotificationDays: 90, emailLogDays: 60, passwordResetDays: 30 },
    },
    server: { host: "127.0.0.1", port: 8000, frontendPort: 5173 },
    admin: { name: "Admin User", email: "admin@example.com", password: "Guclu_Parola_2026!" },
    email: { enabled: false },
    buildClient: false,
    overwriteExistingEnv: false,
  });
  const envText = buildServerEnv(
    payload,
    "secret-123",
    "file:./data/app.db",
    [{ key: "NODE_ENV", defaultValue: "development" }],
    { isStaticOnly: false, isDesktop: false, requiresDatabase: true, usesLocalDatabase: false, usesNodeEnv: true },
  );
  assert.match(envText, /NODE_ENV=development/);
  assert.match(envText, /ALLOWED_ORIGINS="[^"]*http:\/\/127\.0\.0\.1:5173[^"]*"/);
});

test("applicationHealth: tekil orkestrasyon komutu API portunda 404, devPort üzerinde 200 döndüğünde devPort UI adresini doğrular", async (t) => {
  const http = await import("node:http");
  const net = await import("node:net");
  const { dir, cleanup } = mkTemp();
  t.after(cleanup);

  const getFreePort = async () => {
    const s = net.createServer();
    await new Promise((r) => s.listen(0, "127.0.0.1", r));
    const p = s.address().port;
    await new Promise((r) => s.close(r));
    return p;
  };
  const apiPort = await getFreePort();
  const uiDevPort = await getFreePort();

  // API sunucusu: / üzerinde 404 döner (yalnızca /api/* sunar)
  const apiSrv = http.createServer((req, res) => {
    res.writeHead(404);
    res.end("Not Found");
  });
  await new Promise((r) => apiSrv.listen(apiPort, "127.0.0.1", r));
  t.after(() => new Promise((r) => apiSrv.close(r)));

  // UI dev sunucusu: uiDevPort üzerinde 200 döner
  const uiSrv = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html><body>XFactor UI</body></html>");
  });
  await new Promise((r) => uiSrv.listen(uiDevPort, "127.0.0.1", r));
  t.after(() => new Promise((r) => uiSrv.close(r)));

  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "orchestrated-app", scripts: { dev: "node scripts/dev.mjs" } }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(dir, "setup.config.json"),
    JSON.stringify({ ports: { app: apiPort, dev: uiDevPort } }),
    "utf8",
  );
  fs.mkdirSync(path.join(dir, "data"), { recursive: true });
  fs.writeFileSync(path.join(dir, "data", "installation.lock"), "{}", "utf8");
  fs.writeFileSync(path.join(dir, ".env"), `PORT=${apiPort}\n`, "utf8");

  const token = "orchestrated-test-token-1234567890";
  const server = createSetupServer(token, { projectRoot: dir, launchers: false });
  t.after(() => new Promise((r) => server.close(r)));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const wizPort = server.address().port;

  const res = await fetch(`http://127.0.0.1:${wizPort}/api/app-health`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.apiReachable, true);
  assert.equal(body.uiReachable, true);
  assert.equal(body.reachable, true);
  assert.equal(body.uiPort, uiDevPort);
  assert.equal(body.loginUrl, `http://127.0.0.1:${uiDevPort}`);
});
