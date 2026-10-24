import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { parseArgs } from "../bin/setup.mjs";
import { buildInstallPlan, buildLoginUrl, detectAppRoutes, detectPackageManager, detectProject, normalizeLoginPath, parseEnvExample } from "./detect-project.mjs";
import { checkDependencies, getSetupPaths, initProject } from "./setup-api.mjs";
import { resolveLanguageProfile } from "./polyglot.mjs";
import { runSteps } from "./run-steps.mjs";
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

test("statik HTML reposu (package.json olmadan index.html) static-web olarak algılanır ve kurulabilir", (t) => {
  const { dir, cleanup } = mkTemp();
  t.after(cleanup);
  writeFile(dir, "index.html", "<!doctype html><html><body>Static App</body></html>\n");

  const d = detectProject(dir);
  const plan = buildInstallPlan(d);
  const deps = checkDependencies(dir);

  assert.equal(d.kind, "static-web");
  assert.equal(d.stack.staticHtml, true);
  assert.equal(d.stack.client, true);
  assert.equal(plan.canInstall, true);
  assert.ok(plan.steps.some((s) => s.id === "wizard"));
  assert.ok(plan.steps.some((s) => s.id === "start"));
  assert.equal(deps.ready, true);

  const initRes = initProject(dir);
  assert.equal(initRes.created, true);
  assert.deepEqual(initRes.config.install, { command: null, args: [], requireWorkspaces: false });
  assert.deepEqual(initRes.config.start, { command: "static", args: ["."] });
});

test("Next.js, Nuxt, SvelteKit ve Astro repoları ssr-fullstack olarak algılanır", (t) => {
  const cases = [
    {
      name: "next-app",
      files: {
        "package.json": JSON.stringify({ name: "next-app", scripts: { dev: "next dev", start: "next start" }, dependencies: { next: "^14.0.0", react: "^18.0.0" } }),
        "next.config.mjs": "export default {};\n",
      },
      flag: "nextjs",
    },
    {
      name: "nuxt-app",
      files: {
        "package.json": JSON.stringify({ name: "nuxt-app", scripts: { dev: "nuxt dev" }, dependencies: { nuxt: "^3.0.0" } }),
        "nuxt.config.ts": "export default defineNuxtConfig({});\n",
      },
      flag: "nuxt",
    },
    {
      name: "sveltekit-app",
      files: {
        "package.json": JSON.stringify({ name: "sveltekit-app", devDependencies: { "@sveltejs/kit": "^2.0.0" } }),
        "svelte.config.js": "export default {};\n",
      },
      flag: "sveltekit",
    },
    {
      name: "astro-app",
      files: {
        "package.json": JSON.stringify({ name: "astro-app", scripts: { dev: "astro dev" }, dependencies: { astro: "^4.0.0" } }),
        "astro.config.mjs": "export default {};\n",
      },
      flag: "astro",
    },
  ];

  for (const c of cases) {
    const { dir, cleanup } = mkTemp();
    try {
      for (const [rel, content] of Object.entries(c.files)) {
        writeFile(dir, rel, content);
      }
      const d = detectProject(dir);
      assert.equal(d.stack[c.flag], true, `${c.name}: stack.${c.flag} true olmalı`);
      assert.equal(d.stack.ssrFramework, true, `${c.name}: stack.ssrFramework true olmalı`);
      assert.equal(d.kind, "ssr-fullstack", `${c.name}: kind ssr-fullstack olmalı`);
    } finally {
      cleanup();
    }
  }
});

test("Python ve Go çok dilli (polyglot) sunucu repoları algılanır ve initProject uygun komutları yazar", (t) => {
  // Python
  {
    const { dir, cleanup } = mkTemp();
    t.after(cleanup);
    writeFile(dir, "requirements.txt", "flask>=3.0.0\n");
    writeFile(dir, "app.py", "print('hello')\n");

    const d = detectProject(dir);
    const plan = buildInstallPlan(d);
    assert.equal(d.stack.python, true);
    assert.equal(d.kind, "python-server");
    assert.equal(plan.canInstall, true);
    assert.ok(plan.steps.some((s) => s.id === "dependencies" && s.label.includes("Python venv + pip")));
    assert.ok(plan.steps.some((s) => s.id === "wizard"));

    const initRes = initProject(dir);
    assert.equal(initRes.created, true);
    assert.deepEqual(initRes.config.install.steps.map((st) => st.args.join(" ")), [
      "-m venv .venv",
      "-m pip install -r requirements.txt",
      "-m pip check",
    ]);
    assert.equal(initRes.config.install.steps[1].venv, true);
    assert.equal(initRes.config.install.command, "python");
    // Flask nesnesi yok: düz dosya girişi, proje içi venv ile
    assert.deepEqual(initRes.config.start, { command: "python", args: ["app.py"], venv: true });
  }

  // Go
  {
    const { dir, cleanup } = mkTemp();
    t.after(cleanup);
    writeFile(dir, "go.mod", "module example.com/app\n\ngo 1.22\n");
    writeFile(dir, "main.go", "package main\nfunc main() {}\n");

    const d = detectProject(dir);
    const plan = buildInstallPlan(d);
    assert.equal(d.stack.go, true);
    assert.equal(d.kind, "go-server");
    assert.equal(plan.canInstall, true);
    assert.ok(plan.steps.some((s) => s.id === "dependencies" && s.label.includes("go mod download")));

    const initRes = initProject(dir);
    assert.equal(initRes.created, true);
    assert.deepEqual(initRes.config.install.steps.map((st) => st.args.join(" ")), ["mod download", "build ./..."]);
    assert.equal(initRes.config.install.command, "go");
    assert.deepEqual(initRes.config.install.args, ["mod", "download"]);
    assert.deepEqual(initRes.config.start, {
      command: "go",
      args: ["run", "."],
    });
  }
});

test("C/C++ (CMake) ve oyun motoru (Unity, Unreal, Godot) repoları algılanır ve uygun komutları yazar", (t) => {
  // C/C++ CMake
  {
    const { dir, cleanup } = mkTemp();
    t.after(cleanup);
    writeFile(dir, "CMakeLists.txt", "project(MyCppApp)\nadd_executable(MyCppApp main.cpp)\n");
    writeFile(dir, "main.cpp", "int main() { return 0; }\n");

    const d = detectProject(dir);
    const plan = buildInstallPlan(d);
    assert.equal(d.stack.cpp, true);
    assert.equal(d.kind, "cpp-server");
    assert.equal(plan.canInstall, true);
    assert.ok(plan.steps.some((s) => s.id === "dependencies" && s.label.includes("CMake")));

    const initRes = initProject(dir);
    assert.equal(initRes.created, true);
    assert.equal(initRes.config.install.command, "cmake");
    assert.deepEqual(initRes.config.install.steps.map((st) => st.command), ["cmake", "cmake"]);
  }

  // Unity Game
  {
    const { dir, cleanup } = mkTemp();
    t.after(cleanup);
    writeFile(dir, "ProjectSettings/ProjectVersion.txt", "m_EditorVersion: 2022.3.0f1\n");

    const d = detectProject(dir);
    assert.equal(d.stack.unity, true);
    assert.equal(d.kind, "unity-game");
    assert.equal(d.scenario.number, 5);
  }

  // Unreal Game
  {
    const { dir, cleanup } = mkTemp();
    t.after(cleanup);
    writeFile(dir, "MyGame.uproject", "{}\n");

    const d = detectProject(dir);
    assert.equal(d.stack.unreal, true);
    assert.equal(d.kind, "unreal-game");
    assert.equal(d.scenario.number, 5);
  }

  // Godot Game
  {
    const { dir, cleanup } = mkTemp();
    t.after(cleanup);
    writeFile(dir, "project.godot", "config_version=5\n");

    const d = detectProject(dir);
    assert.equal(d.stack.godot, true);
    assert.equal(d.kind, "godot-game");
    assert.equal(d.scenario.number, 5);
  }
});

test("Electron ve Tauri masaüstü projeleri algılanır ve getSetupPaths harici dataDir ile güvenli çalışır", (t) => {
  // Electron
  {
    const { dir, cleanup } = mkTemp();
    const { dir: externalTempDir, cleanup: cleanupExt } = mkTemp();
    t.after(() => {
      cleanup();
      cleanupExt();
    });

    writeFile(
      dir,
      "package.json",
      JSON.stringify({ name: "electron-app", main: "main.js", dependencies: { electron: "^30.0.0" } }),
    );
    writeFile(dir, "main.js", 'const { app } = require("electron");\n');

    const d = detectProject(dir);
    assert.equal(d.stack.electron, true);
    assert.equal(d.kind, "electron-desktop");

    const paths = getSetupPaths(dir, { dataDir: externalTempDir });
    assert.equal(paths.dataRoot, path.resolve(externalTempDir));
    assert.equal(paths.env, path.join(path.resolve(externalTempDir), ".env"));
    assert.equal(paths.lock, path.join(path.resolve(externalTempDir), "installation.lock"));

    // setup.config.json içinden gelen "../outside" yol geçişi (path traversal) hala engellenmeli
    writeFile(
      dir,
      "setup.config.json",
      JSON.stringify({ name: "electron-app", paths: { env: "../outside/.env" } }),
    );
    assert.throws(() => getSetupPaths(dir, { dataDir: externalTempDir }), /Güvenli dizin sınırı ihlali/);
  }

  // Tauri
  {
    const { dir, cleanup } = mkTemp();
    t.after(cleanup);
    writeFile(dir, "package.json", JSON.stringify({ name: "tauri-app", dependencies: { "@tauri-apps/api": "^2.0.0" } }));
    writeFile(dir, "src-tauri/tauri.conf.json", JSON.stringify({ build: { devUrl: "http://localhost:5000" } }));

    const d = detectProject(dir);
    assert.equal(d.stack.tauri, true);
    assert.equal(d.kind, "tauri-desktop");
  }
});

test("detectScenarioProfile 5 senaryoyu doğru sınıflandırır ve initProject createLaunchers ile kurulum.bat/sh üretir", (t) => {
  // Senaryo 1: Express Node Sunucu
  {
    const { dir, cleanup } = mkTemp();
    t.after(cleanup);
    writeFile(dir, "package.json", JSON.stringify({ name: "s1-app", dependencies: { express: "^4.0.0" } }));
    writeFile(dir, "index.js", 'import express from "express";\n');
    const d = detectProject(dir);
    assert.equal(d.scenario.number, 1);
    assert.equal(d.scenario.id, "scenario-1-node-server");
    assert.equal(d.scenario.requiresAdmin, true);
    assert.equal(d.scenario.isStaticOnly, false);
  }

  // Senaryo 2: SPA / Statik Web
  {
    const { dir, cleanup } = mkTemp();
    t.after(cleanup);
    writeFile(dir, "index.html", "<!doctype html><html><body>SPA</body></html>\n");
    const d = detectProject(dir);
    assert.equal(d.scenario.number, 2);
    assert.equal(d.scenario.id, "scenario-2-spa-static");
    assert.equal(d.scenario.isStaticOnly, true);
    assert.equal(d.scenario.requiresAdmin, false);
    assert.equal(d.scenario.requiresDependencies, false);
  }

  // Senaryo 3: Next.js SSR Full-Stack
  {
    const { dir, cleanup } = mkTemp();
    t.after(cleanup);
    writeFile(dir, "package.json", JSON.stringify({ name: "s3-app", dependencies: { next: "^14.0.0" } }));
    writeFile(dir, "next.config.mjs", "export default {};\n");
    const d = detectProject(dir);
    assert.equal(d.scenario.number, 3);
    assert.equal(d.scenario.id, "scenario-3-fullstack");
    assert.equal(d.scenario.requiresDatabase, true);
  }

  // Senaryo 4: Python / Polyglot
  {
    const { dir, cleanup } = mkTemp();
    t.after(cleanup);
    writeFile(dir, "requirements.txt", "fastapi\nuvicorn\n");
    writeFile(dir, "app.py", "print('ok')\n");
    const d = detectProject(dir);
    assert.equal(d.scenario.number, 4);
    assert.equal(d.scenario.id, "scenario-4-polyglot");
  }

  // Senaryo 5: Masaüstü + createLaunchers
  {
    const { dir, cleanup } = mkTemp();
    t.after(cleanup);
    writeFile(dir, "package.json", JSON.stringify({ name: "s5-app", dependencies: { "@tauri-apps/api": "^2.0.0" } }));
    writeFile(dir, "src-tauri/tauri.conf.json", "{}");
    const d = detectProject(dir);
    assert.equal(d.scenario.number, 5);
    assert.equal(d.scenario.id, "scenario-5-desktop");
    assert.equal(d.scenario.isDesktop, true);

    const initRes = initProject(dir, { createLaunchers: true });
    assert.equal(initRes.created, true);
    assert.equal(initRes.launchersCreated, true);
    assert.equal(initRes.config.scenario.number, 5);
    assert.equal(fs.existsSync(path.join(dir, "kurulum.bat")), true);
    assert.equal(fs.existsSync(path.join(dir, "kurulum.sh")), true);
  }
});

test("Vite + React SPA (scripts.dev=vite, sunucu yok) Senaryo 2 olarak algılanır", (t) => {
  const { dir, cleanup } = mkTemp();
  t.after(cleanup);
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "vite-spa",
      scripts: { dev: "vite", build: "vite build", preview: "vite preview" },
      dependencies: { react: "^18.0.0" },
      devDependencies: { vite: "^5.0.0" },
    }),
    "utf8",
  );
  fs.writeFileSync(path.join(dir, "index.html"), "<html></html>\n", "utf8");
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "main.jsx"), "import React from 'react';\n", "utf8");

  const detection = detectProject(dir);
  assert.equal(detection.stack.nodeServer, false);
  assert.equal(detection.kind, "node-client");
  assert.equal(detection.scenario.number, 2);
  assert.equal(detection.scenario.requiresAdmin, false);
});

test("scripts.start gerçek bir Node sunucusunu çalıştırıyorsa Senaryo 1 olarak kalır", (t) => {
  const { dir, cleanup } = mkTemp();
  t.after(cleanup);
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "api", scripts: { start: "node src/main.js", dev: "vite" } }),
    "utf8",
  );
  const detection = detectProject(dir);
  assert.equal(detection.stack.nodeServer, true);
  assert.equal(detection.scenario.number, 1);
});

test("package.json içeren Python projesi Senaryo 4 olarak algılanır", (t) => {
  const { dir, cleanup } = mkTemp();
  t.after(cleanup);
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "py-tools", scripts: { lint: "eslint ." } }), "utf8");
  fs.writeFileSync(path.join(dir, "requirements.txt"), "flask\n", "utf8");
  fs.writeFileSync(path.join(dir, "app.py"), "print(1)\n", "utf8");
  const detection = detectProject(dir);
  assert.equal(detection.kind, "python-server");
  assert.equal(detection.scenario.number, 4);
});

test("ön yüz CLI script'leri (argümanlı, npx/cross-env önekli) sunucu kanıtı sayılmaz", (t) => {
  for (const dev of ["vite --host 0.0.0.0", "npx vite", "cross-env NODE_ENV=development vite", "react-scripts start", "serve -s dist"]) {
    const { dir, cleanup } = mkTemp();
    t.after(cleanup);
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "spa", scripts: { dev } }), "utf8");
    fs.writeFileSync(path.join(dir, "index.html"), "<html></html>\n", "utf8");
    const detection = detectProject(dir);
    assert.equal(detection.stack.nodeServer, false, dev);
    assert.equal(detection.scenario.number, 2, dev);
  }
});

test("initProject varsayılan olarak başlatıcıları ekler ve package.json'a dokunmaz", (t) => {
  const { dir, cleanup } = mkTemp();
  t.after(cleanup);
  const pkgText = JSON.stringify({ name: "plain-app", scripts: { start: "node index.js" } });
  fs.writeFileSync(path.join(dir, "package.json"), pkgText, "utf8");

  const res = initProject(dir);
  assert.equal(res.created, true);
  assert.equal(res.launchersCreated, true);
  assert.equal(res.packageJsonUpdated, false);
  assert.equal(fs.existsSync(path.join(dir, "kurulum.bat")), true);
  assert.equal(fs.existsSync(path.join(dir, "kurulum.sh")), true);
  assert.equal(fs.readFileSync(path.join(dir, "package.json"), "utf8"), pkgText);
  // .sh LF, .bat CRLF olmalı (shebang bozulmasın)
  const shContent = fs.readFileSync(path.join(dir, "kurulum.sh"), "utf8");
  const batContent = fs.readFileSync(path.join(dir, "kurulum.bat"), "utf8");
  assert.equal(shContent.includes("\r"), false);
  assert.equal(batContent.includes("\r\n"), true);
  // Hem npx hem bunx desteği mevcut olmalı
  assert.ok(batContent.includes("npx --yes github:sirrakadembasti/setup"), "bat npx içermeli");
  assert.ok(batContent.includes("bunx github:sirrakadembasti/setup"), "bat bunx içermeli");
  assert.ok(shContent.includes("npx --yes github:sirrakadembasti/setup"), "sh npx içermeli");
  assert.ok(shContent.includes("bunx github:sirrakadembasti/setup"), "sh bunx içermeli");
});

test("initProject createLaunchers:false ile başlatıcı üretmez; yapılandırma varken eksik başlatıcıları tamamlar", (t) => {
  const { dir, cleanup } = mkTemp();
  t.after(cleanup);
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "cfg-app", scripts: { start: "node index.js" } }), "utf8");

  const first = initProject(dir, { createLaunchers: false });
  assert.equal(first.created, true);
  assert.equal(first.launchersCreated, false);
  assert.equal(fs.existsSync(path.join(dir, "kurulum.bat")), false);

  const second = initProject(dir);
  assert.equal(second.created, false);
  assert.equal(second.launchersCreated, true);
  assert.equal(fs.existsSync(path.join(dir, "kurulum.sh")), true);

  const third = initProject(dir);
  assert.equal(third.created, false);
  assert.equal(third.launchersCreated, false);
});

test("CLI init: varsayılan başlatıcı ekler, --no-launchers ve --update-package-json bayraklarını işler", (t) => {
  assert.equal(parseArgs(["init"]).launchers, true);
  assert.equal(parseArgs(["init"]).updatePackageJson, false);
  assert.equal(parseArgs(["init", "--no-launchers"]).launchers, false);
  assert.equal(parseArgs(["init", "--update-package-json"]).updatePackageJson, true);

  const { dir, cleanup } = mkTemp();
  t.after(cleanup);
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "cli-app", scripts: { start: "node index.js" } }), "utf8");
  const bin = path.join(process.cwd(), "bin", "setup.mjs");
  const run = spawnSync(process.execPath, [bin, "init", "--root", dir], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(fs.existsSync(path.join(dir, "kurulum.bat")), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).scripts.setup, undefined);

  // yapılandırma + başlatıcı varken tekrar çalıştırmak hata (çıkış 1) verir
  const again = spawnSync(process.execPath, [bin, "init", "--root", dir], { encoding: "utf8" });
  assert.equal(again.status, 1);
});

test("bin/kurulum.sh package.json olmayan hedef projeyi (çağrıldığı dizin) kullanır", (t) => {
  const probe = spawnSync("sh", ["-c", "exit 0"]);
  if (probe.error || probe.status !== 0) return t.skip("sh bulunamadı");
  const { dir, cleanup } = mkTemp();
  t.after(cleanup);
  fs.writeFileSync(path.join(dir, "requirements.txt"), "flask\n", "utf8");
  fs.writeFileSync(path.join(dir, "app.py"), "print(1)\n", "utf8");
  const sh = path.join(process.cwd(), "bin", "kurulum.sh");
  const env = { ...process.env };
  delete env.SETUP_PROJECT_ROOT;
  const run = spawnSync("sh", [sh, "--check-only", "--no-open"], { cwd: dir, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.doesNotMatch(run.stdout, /package\.json bulunamad/);
  assert.match(run.stdout, /"kind": "python-server"/);
  assert.equal(fs.existsSync(path.join(dir, "setup.config.json")), true);
});

test("PHP desteği kaldırıldı: composer.json/artisan artık PHP olarak algılanmaz", (t) => {
  const { dir, cleanup } = mkTemp();
  t.after(cleanup);
  writeFile(dir, "composer.json", "{}\n");
  writeFile(dir, "artisan", "#!/usr/bin/env php\n");
  const d = detectProject(dir);
  assert.equal("php" in d.stack, false);
  assert.notEqual(d.kind, "php-server");
  assert.equal(buildInstallPlan(d).canInstall, false);
});

test("Rust (Cargo.toml) Senaryo 4 olarak algılanır; init cargo fetch/check ve cargo run yazar; Tauri Rust sayılmaz", (t) => {
  const { dir, cleanup } = mkTemp();
  t.after(cleanup);
  writeFile(dir, "Cargo.toml", '[package]\nname = "api"\nversion = "0.1.0"\n');
  fs.mkdirSync(path.join(dir, "src"));
  writeFile(dir, "src/main.rs", "fn main() {}\n");
  const d = detectProject(dir);
  assert.equal(d.stack.rust, true);
  assert.equal(d.kind, "rust-server");
  assert.equal(d.scenario.number, 4);
  assert.match(d.scenario.label, /Rust/);
  assert.ok(buildInstallPlan(d).steps.some((s) => s.id === "dependencies" && s.label.includes("cargo fetch")));
  const res = initProject(dir);
  assert.deepEqual(res.config.install.steps.map((st) => `${st.command} ${st.args.join(" ")}`), ["cargo fetch", "cargo check"]);
  assert.deepEqual(res.config.start, { command: "cargo", args: ["run"] });

  const tauri = mkTemp();
  t.after(tauri.cleanup);
  writeFile(tauri.dir, "Cargo.toml", '[package]\nname = "t"\n');
  fs.mkdirSync(path.join(tauri.dir, "src-tauri"));
  writeFile(tauri.dir, "src-tauri/tauri.conf.json", "{}\n");
  const td = detectProject(tauri.dir);
  assert.equal(td.stack.rust, false);
  assert.equal(td.scenario.number, 5);
});

function makeTree(t, files) {
  const { dir, cleanup } = mkTemp();
  t.after(cleanup);
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content, "utf8");
  }
  return dir;
}

test("polyglot: Python profilleri (Django, FastAPI, Flask, düz) doğru başlatma komutunu seçer", (t) => {
  const make = (files) => resolveLanguageProfile(makeTree(t, files), "python-server", 8123);
  const django = make({ "requirements.txt": "django\n", "manage.py": "" });
  assert.deepEqual(django.start.args, ["manage.py", "runserver", "127.0.0.1:8123"]);

  const fastapi = make({ "requirements.txt": "fastapi\n", "main.py": "from fastapi import FastAPI\napi = FastAPI()\n" });
  assert.deepEqual(fastapi.start.args, ["-m", "uvicorn", "main:api", "--host", "127.0.0.1", "--port", "8123"]);
  assert.ok(fastapi.steps.some((st) => st.args.includes("uvicorn")), "uvicorn eksikse kurulum adımı eklenir");

  const withUvicorn = make({ "requirements.txt": "fastapi\nuvicorn[standard]\n", "app/main.py": "app = FastAPI()\n" });
  assert.deepEqual(withUvicorn.start.args.slice(0, 3), ["-m", "uvicorn", "app.main:app"]);
  assert.equal(withUvicorn.steps.some((st) => st.args.includes("uvicorn")), false);

  const flask = make({ "requirements.txt": "flask\n", "server.py": "from flask import Flask\nweb = Flask(__name__)\n" });
  assert.deepEqual(flask.start.args, ["-m", "flask", "--app", "server:web", "run", "--host", "127.0.0.1", "--port", "8123"]);

  const pyproject = make({ "pyproject.toml": "[project]\nname='x'\n", "main.py": "print(1)\n" });
  assert.deepEqual(pyproject.steps[1].args, ["-m", "pip", "install", "-e", "."]);
  assert.deepEqual(pyproject.start.args, ["main.py"]);
  assert.equal(pyproject.steps.at(-1).args.join(" "), "-m pip check");
});

test("polyglot: Go cmd/ girişi, .NET çözüm dosyası + web projesi ve Rust çalışma alanı", (t) => {
  const go = resolveLanguageProfile(makeTree(t, { "go.mod": "module x\n", "cmd/server/main.go": "package main\n" }), "go-server");
  assert.deepEqual(go.start.args, ["run", "./cmd/server"]);

  const dn = resolveLanguageProfile(
    makeTree(t, {
      "app.sln": "",
      "lib/Lib.csproj": '<Project Sdk="Microsoft.NET.Sdk"/>',
      "web/Web.csproj": '<Project Sdk="Microsoft.NET.Sdk.Web"/>',
    }),
    "dotnet-server",
    5100,
  );
  assert.deepEqual(dn.steps[0].args, ["restore", "app.sln"]);
  assert.deepEqual(dn.start.args, ["run", "--project", "web/Web.csproj", "--urls", "http://127.0.0.1:5100"]);

  const dnRoot = resolveLanguageProfile(makeTree(t, { "App.csproj": "<Project/>" }), "dotnet-server", 5100);
  assert.deepEqual(dnRoot.steps[0].args, ["restore"]);
  assert.deepEqual(dnRoot.start.args, ["run", "--urls", "http://127.0.0.1:5100"]);

  const rs = resolveLanguageProfile(
    makeTree(t, {
      "Cargo.toml": '[workspace]\nmembers = ["crates/lib", "crates/web"]\n',
      "crates/lib/Cargo.toml": '[package]\nname = "lib"\n',
      "crates/lib/src/lib.rs": "",
      "crates/web/Cargo.toml": '[package]\nname = "web-api"\n',
      "crates/web/src/main.rs": "fn main() {}\n",
    }),
    "rust-server",
  );
  assert.deepEqual(rs.start.args, ["run", "-p", "web-api"]);
});

test("run-steps: adımları sırayla çalıştırır, skipIfExists'i atlar, ilk hatada durur", async (t) => {
  const { dir, cleanup } = mkTemp();
  t.after(cleanup);
  const node = process.execPath;
  const logs = [];
  const log = (line) => logs.push(line);
  const ok = await runSteps(dir, [
    { label: "yaz", command: node, args: ["-e", "require('fs').writeFileSync('a.txt','1')"] },
    { label: "atla", command: node, args: ["-e", "process.exit(9)"], skipIfExists: "a.txt" },
  ], log);
  assert.equal(ok.ok, true);
  assert.equal(fs.existsSync(path.join(dir, "a.txt")), true);
  assert.ok(logs.some((l) => l.includes("atlandı")));

  const fail = await runSteps(dir, [
    { label: "hata", command: node, args: ["-e", "process.exit(3)"] },
    { label: "çalışmamalı", command: node, args: ["-e", "require('fs').writeFileSync('b.txt','1')"] },
  ], log);
  assert.equal(fail.ok, false);
  assert.equal(fail.code, 3);
  assert.equal(fs.existsSync(path.join(dir, "b.txt")), false);
});

test("rotalar: giriş yolu ve dev portu sabit değil; yapılandırma/algılamadan gelir", (t) => {
  const { dir, cleanup } = mkTemp();
  t.after(cleanup);
  fs.mkdirSync(path.join(dir, "client"));
  fs.mkdirSync(path.join(dir, "server"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x", scripts: { start: "node server/index.js" } }), "utf8");
  fs.writeFileSync(path.join(dir, "server", "package.json"), JSON.stringify({ name: "s", dependencies: { express: "^4" } }), "utf8");
  fs.writeFileSync(path.join(dir, "client", "package.json"), JSON.stringify({ name: "c", scripts: { dev: "vite --port 4321" }, dependencies: { react: "^18" } }), "utf8");
  const d = detectProject(dir);
  assert.equal(d.routes.devPort, 4321, "dev portu client script'inden algılanır");
  assert.equal(d.routes.loginPath, "", "yapılandırma yoksa giriş yolu uygulama köküdür");

  fs.writeFileSync(path.join(dir, "setup.config.json"), JSON.stringify({ app: { loginPath: "giris/" }, ports: { dev: 3001 } }), "utf8");
  const configured = detectProject(dir);
  assert.equal(configured.routes.loginPath, "/giris");
  assert.equal(configured.routes.devPort, 3001);
});

test("rotalar: statik ve masaüstü senaryolarında dev portu/giriş yolu yoktur; yardımcılar güvenli", () => {
  const routes = detectAppRoutes(os.tmpdir(), { isStaticOnly: true }, { app: { loginPath: "/auth" }, ports: { dev: 5173 } });
  assert.deepEqual(routes, { loginPath: "", devPort: 5173 });
  const desktop = detectAppRoutes(os.tmpdir(), { isDesktop: true }, { app: { loginPath: "/auth" }, ports: { dev: 5173 } });
  assert.deepEqual(desktop, { loginPath: "", devPort: null });
  assert.equal(normalizeLoginPath("https://evil.example/x"), "");
  assert.equal(normalizeLoginPath("//evil.example"), "");
  assert.equal(normalizeLoginPath("/"), "");
  assert.equal(buildLoginUrl("http://localhost:5000/", "login"), "http://localhost:5000/login");
  assert.equal(buildLoginUrl("http://localhost:5000", ""), "http://localhost:5000");
});
