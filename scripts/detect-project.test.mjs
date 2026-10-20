import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildInstallPlan, detectPackageManager, detectProject, parseEnvExample } from "./detect-project.mjs";
import { checkDependencies, getSetupPaths, initProject } from "./setup-api.mjs";
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
    assert.ok(plan.steps.some((s) => s.id === "dependencies" && s.label.includes("Python / pip")));
    assert.ok(plan.steps.some((s) => s.id === "wizard"));

    const initRes = initProject(dir);
    assert.equal(initRes.created, true);
    assert.deepEqual(initRes.config.install, {
      command: "pip",
      args: ["install", "-r", "requirements.txt"],
      requireWorkspaces: false,
    });
    assert.deepEqual(initRes.config.start, {
      command: "python",
      args: ["app.py"],
    });
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
    assert.deepEqual(initRes.config.install, {
      command: "go",
      args: ["mod", "download"],
      requireWorkspaces: false,
    });
    assert.deepEqual(initRes.config.start, {
      command: "go",
      args: ["run", "."],
    });
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
