import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSetupConfig } from "./detect-project.mjs";
import { resolveVenvPython } from "./polyglot.mjs";
import { initProject } from "./setup-api.mjs";
import { createTerminalBootstrap } from "./terminal-bootstrap.mjs";
import { resolveAppStartInvocation } from "../wizard/app-process.mjs";

function tree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "setup-lang-"));
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return dir;
}

// Gerçek derleyici/yorumlayıcı gerektirmeden, terminal akışının (durum + kurulum planı + başlatma komutu)
// her dil senaryosunda tutarlı çalıştığını doğrular. Böylece Linux/macOS/Windows'ta aynı sonuç beklenir.
const BACKEND_FIXTURES = {
  python: { "requirements.txt": "fastapi\nuvicorn\n", "main.py": "from fastapi import FastAPI\napp = FastAPI()\n" },
  go: { "go.mod": "module example.com/app\n\ngo 1.21\n", "main.go": "package main\nfunc main() {}\n" },
  dotnet: {
    "App.csproj": '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>',
    "Program.cs": "var app = WebApplication.CreateBuilder().Build(); app.Run();\n",
  },
  rust: { "Cargo.toml": '[package]\nname = "demo"\nversion = "0.1.0"\n', "src/main.rs": "fn main() {}\n" },
  cpp: { "CMakeLists.txt": "cmake_minimum_required(VERSION 3.10)\nproject(demo)\nadd_executable(demo main.cpp)\n", "main.cpp": "int main() { return 0; }\n" },
};

for (const [name, files] of Object.entries(BACKEND_FIXTURES)) {
  test(`${name}: terminal durumu Senaryo 4 ve kurulum planı üretir, init sonrası başlatma komutu çözülür`, () => {
    const root = tree(files);
    const status = createTerminalBootstrap({ root, log: () => {}, noOpen: true }).status();
    assert.equal(status.scenario.number, 4, `${name} Senaryo 4 olmalı`);
    assert.equal(status.plan.canInstall, true);
    assert.ok(status.plan.steps.length > 0);
    assert.equal(status.installation.state, "fresh");

    initProject(root, { createLaunchers: false });
    const invocation = resolveAppStartInvocation(root, loadSetupConfig(root));
    assert.ok(invocation?.command, `${name} için başlatma komutu bulunmalı`);
  });
}

test("electron: masaüstü senaryosu (Senaryo 5) algılanır ve kurulum planı üretir", () => {
  const root = tree({
    "package.json": JSON.stringify({ name: "desk", main: "main.js", scripts: { start: "electron ." }, devDependencies: { electron: "^30.0.0" } }),
    "main.js": "",
  });
  const status = createTerminalBootstrap({ root, log: () => {}, noOpen: true }).status();
  assert.equal(status.scenario.number, 5);
  assert.equal(status.scenario.isDesktop, true);
  assert.equal(status.plan.canInstall, true);
});

test("sanal ortam yorumlayıcısı yalnızca geçerli işletim sisteminin dizin düzeninde bulunur", () => {
  const win = tree({ ".venv/Scripts/python.exe": "" });
  const posix = tree({ ".venv/bin/python": "" });
  if (process.platform === "win32") {
    assert.ok(resolveVenvPython(win));
    assert.equal(resolveVenvPython(posix), null);
  } else {
    assert.ok(resolveVenvPython(posix));
    assert.equal(resolveVenvPython(win), null);
  }
});

test("üretilen kurulum.sh sözdizimi geçerlidir (POSIX sh -n)", (t) => {
  const probe = spawnSync("sh", ["-c", "exit 0"], { windowsHide: true });
  if (probe.error || probe.status !== 0) return t.skip("sh bulunamadı");
  const root = tree({ "package.json": JSON.stringify({ name: "demo", scripts: { start: "node s.js" } }), "s.js": "" });
  initProject(root, {});
  const launcher = path.join(root, "kurulum.sh");
  const text = fs.readFileSync(launcher, "utf8");
  assert.doesNotMatch(text, /\r/, "kurulum.sh LF satır sonu kullanmalı");
  const check = spawnSync("sh", ["-n", launcher], { encoding: "utf8", windowsHide: true });
  assert.equal(check.status, 0, check.stderr);
});

test("bağımlılığı olmayan Node projesi kurulu sayılır; workspaces olan kök ise node_modules bekler", async () => {
  const { checkDependencies } = await import("./setup-bootstrap-lib.mjs");
  const plain = tree({ "package.json": JSON.stringify({ name: "demo", scripts: { start: "node s.js" } }), "s.js": "" });
  assert.equal(checkDependencies(plain).ready, true, "kurulacak bağımlılık yok");
  const withDeps = tree({ "package.json": JSON.stringify({ name: "demo", dependencies: { express: "4" } }) });
  assert.equal(checkDependencies(withDeps).ready, false);
  const workspaces = tree({ "package.json": JSON.stringify({ name: "mono", workspaces: ["packages/*"] }) });
  assert.equal(checkDependencies(workspaces).ready, false, "workspaces kökü kurulum gerektirir");
});
