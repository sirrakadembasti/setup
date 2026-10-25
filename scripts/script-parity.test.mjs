import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import test from "node:test";
import { initProject } from "./setup-api.mjs";
import { runSteps } from "./run-steps.mjs";
import { resolveCommandInvocation } from "./process-runner.mjs";
import { isCommandAvailable } from "./setup-bootstrap-lib.mjs";

const packageRoot = process.cwd();
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "setup parity "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  fs.writeFileSync(path.join(root, "index.html"), "hello");
  return root;
}
function nodeRun(args, options = {}) {
  return spawnSync(process.execPath, args, { cwd: packageRoot, encoding: "utf8", windowsHide: true, timeout: 30000, ...options });
}

function shellPath(t, extension) {
  if (extension === "bat") {
    if (process.platform !== "win32") { t.skip("Windows batch only"); return null; }
    return process.env.ComSpec || "cmd.exe";
  }
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["sh"], { encoding: "utf8" });
  const sh = probe.stdout?.trim().split(/\r?\n/)[0];
  if (!sh) t.skip("sh unavailable");
  return sh;
}
function launch(shell, executable, launcher, args, root, env = process.env) {
  const options = { cwd: root, env: { ...env, SETUP_NO_PAUSE: "1" }, encoding: "utf8", windowsHide: true, timeout: 30000 };
  return shell === "bat"
    ? spawnSync([`"${launcher}"`, ...args.map((arg) => `"${arg}"`)].join(" "), { ...options, shell: executable })
    : spawnSync(executable, [launcher, ...args], options);
}

test("direct bootstrap forwards root, candidate, port and external data options", (t) => {
  const root = fixture(t);
  const candidate = path.join(root, "selected");
  fs.mkdirSync(candidate);
  fs.writeFileSync(path.join(candidate, "index.html"), "selected");
  const dataDir = path.join(root, "external data");
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(dataDir, "installation.lock"), "locked");
  const result = nodeRun(["scripts/setup-bootstrap.mjs", "--root", root, "--candidate", "selected", "--port", "58711", "--data-dir", dataDir, "--check-only", "--no-open"]);
  assert.equal(result.status, 0, result.stderr);
  const status = JSON.parse(result.stdout);
  assert.equal(status.directory, candidate);
  assert.equal(status.wizardPort, 58711);
  assert.equal(status.installation.state, "installed");
  assert.equal(fs.existsSync(path.join(candidate, "setup.config.json")), false);
});

test("direct bootstrap rejects unknown and malformed options instead of silently ignoring them", () => {
  for (const args of [["--bogus", "--check-only"], ["--port", "bad", "--check-only"], ["--root"]]) {
    const result = nodeRun(["scripts/setup-bootstrap.mjs", ...args]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
  }
});

test("runSteps respects per-step cwd and skip marker and stops at first failure", async (t) => {
  const root = fixture(t);
  const sub = path.join(root, "service");
  fs.mkdirSync(sub);
  fs.writeFileSync(path.join(sub, "already"), "done");
  const result = await runSteps(root, [
    { command: process.execPath, cwd: "service", skipIfExists: "already", args: ["-e", "process.exit(32)"] },
    { command: process.execPath, cwd: "service", args: ["-e", "require('fs').writeFileSync('ran','yes')"] },
    { command: process.execPath, cwd: "service", args: ["-e", "process.exit(7)"] },
    { command: process.execPath, cwd: "service", args: ["-e", "require('fs').writeFileSync('unreachable','bad')"] },
  ], () => {});
  assert.equal(result.code, 7);
  assert.equal(fs.readFileSync(path.join(sub, "ran"), "utf8"), "yes");
  assert.equal(fs.existsSync(path.join(sub, "unreachable")), false);
});

test("refresh-launchers preserves configuration and saves previous launcher contents", (t) => {
  const root = fixture(t);
  const original = '{"name":"keep-settings","ports":{"wizard":58715},"install":{"command":null}}\n';
  fs.writeFileSync(path.join(root, "setup.config.json"), original);
  fs.writeFileSync(path.join(root, "kurulum.bat"), "@echo old-bat\r\n");
  fs.writeFileSync(path.join(root, "kurulum.sh"), "#!/bin/sh\necho old-sh\n");
  const result = initProject(root, { refreshLaunchers: true });
  assert.equal(result.launchersCreated, true);
  assert.equal(fs.readFileSync(path.join(root, "setup.config.json"), "utf8"), original);
  const files = fs.readdirSync(root).filter((name) => name.includes(".bak"));
  assert.equal(files.length, 2);
  assert.ok(files.some((name) => fs.readFileSync(path.join(root, name), "utf8").includes("old-bat")));
  assert.ok(files.some((name) => fs.readFileSync(path.join(root, name), "utf8").includes("old-sh")));
});

for (const shell of ["bat", "sh"]) {
  test(`${shell} package launcher accepts Node 25 and forwards options without requiring a package manager`, (t) => {
    if (shell === "bat" && process.platform !== "win32") return t.skip("Windows batch only");
    let sh;
    if (shell === "sh") {
      const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["sh"], { encoding: "utf8" });
      sh = probe.stdout?.trim().split(/\r?\n/)[0];
      if (!sh) return t.skip("sh unavailable");
    }
    const root = fixture(t);
    const preload = path.join(root, "runtime.cjs");
    fs.writeFileSync(preload, "Object.defineProperty(process.versions,'node',{value:'25.1.0'});Object.defineProperty(process,'version',{value:'v25.1.0'});");
    const launcher = path.join(packageRoot, "bin", `kurulum.${shell}`);
    const runtimePath = [path.dirname(process.execPath), process.env.SystemRoot ? path.join(process.env.SystemRoot, "System32") : "/usr/bin", ...(sh ? [path.dirname(sh)] : [])].join(path.delimiter);
    const env = { ...process.env, PATH: runtimePath, Path: runtimePath, SETUP_PROJECT_ROOT: root, SETUP_NO_PAUSE: "1", NODE_OPTIONS: `--require="${preload.replaceAll("\\", "/")}"` };
    const args = ["--check-only", "--no-open", "--root", root, "--port", "58721"];
    const result = shell === "bat"
      ? spawnSync(`"${launcher}" --check-only --no-open --root "${root}" --port 58721`, { shell: process.env.ComSpec || "cmd.exe", cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 30000 })
      : spawnSync(sh, [launcher, ...args], { cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 30000 });
    const diagnostic = shell === "sh" && result.status !== 0 ? spawnSync(sh, ["-c", "command -v node; node -p process.versions.node"], { env, encoding: "utf8", windowsHide: true }) : null;
    assert.equal(result.status, 0, result.stdout + result.stderr + (diagnostic ? diagnostic.stdout + diagnostic.stderr : ""));
    const status = JSON.parse(result.stdout);
    assert.equal(status.directory, root);
    assert.equal(status.wizardPort, 58721);
    assert.equal(status.runtime.nodeVersion, "25.1.0");
  });

  test(`${shell} generated launcher uses copied tools, accepts Node 25 and preserves options`, (t) => {
    const executable = shellPath(t, shell);
    if (!executable) return;
    const root = fixture(t);
    initProject(root, { copyTools: true });
    const preload = path.join(root, "runtime.cjs");
    fs.writeFileSync(preload, "Object.defineProperty(process.versions,'node',{value:'25.1.0'});Object.defineProperty(process,'version',{value:'v25.1.0'});");
    const result = launch(shell, executable, path.join(root, `kurulum.${shell}`), ["--check-only", "--no-open", "--port", "58723"], root, {
      ...process.env, NODE_OPTIONS: `--require="${preload.replaceAll("\\", "/")}"`, SETUP_PROJECT_ROOT: root,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const status = JSON.parse(result.stdout);
    assert.equal(status.directory, root);
    assert.equal(status.wizardPort, 58723);
    assert.equal(status.runtime.nodeVersion, "25.1.0");
  });

  test(`${shell} generated launcher propagates the local entry exit code`, (t) => {
    const executable = shellPath(t, shell);
    if (!executable) return;
    const root = fixture(t);
    initProject(root);
    const local = path.join(root, "tools/setup/bin");
    fs.mkdirSync(local, { recursive: true });
    fs.writeFileSync(path.join(local, "setup.mjs"), "process.exit(7)");
    const result = launch(shell, executable, path.join(root, `kurulum.${shell}`), [], root, { ...process.env, SETUP_PROJECT_ROOT: root });
    assert.equal(result.status, 7, result.stdout + result.stderr);
  });

  test(`${shell} package launcher falls back from incompatible Node to real Bun`, (t) => {
    const executable = shellPath(t, shell);
    if (!executable) return;
    if (!isCommandAvailable("bun")) return t.skip("Bun unavailable");
    const root = fixture(t);
    const preload = path.join(root, "runtime.cjs");
    fs.writeFileSync(preload, "if(!process.versions.bun){Object.defineProperty(process.versions,'node',{value:'16.1.0'});Object.defineProperty(process,'version',{value:'v16.1.0'});}");
    const result = launch(shell, executable, path.join(packageRoot, "bin", `kurulum.${shell}`), ["--check-only", "--no-open"], root, {
      ...process.env, NODE_OPTIONS: `--require="${preload.replaceAll("\\", "/")}"`, SETUP_PROJECT_ROOT: root,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const status = JSON.parse(result.stdout);
    assert.notEqual(status.runtime.nodeVersion, "16.1.0");
    assert.equal(status.runtime.nodeSupported, true);
  });
}

test("npm run setup forwards the same root and port options as the CLI", (t) => {
  if (!isCommandAvailable("npm")) return t.skip("npm unavailable");
  const root = fixture(t);
  const invocation = resolveCommandInvocation("npm", ["--silent", "run", "setup", "--", "--root", root, "--port", "58725", "--check-only"]);
  const result = spawnSync(invocation.command, invocation.args, { cwd: packageRoot, encoding: "utf8", windowsHide: true, timeout: 30000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const status = JSON.parse(result.stdout);
  assert.equal(status.directory, root);
  assert.equal(status.wizardPort, 58725);
});

test("standalone run-steps times out and terminates the child process tree", (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, "leaf.mjs"), "setInterval(()=>{},1000)");
  fs.writeFileSync(path.join(root, "wrapper.mjs"), "import{spawn}from'node:child_process';import fs from'node:fs';const c=spawn(process.execPath,['leaf.mjs'],{stdio:'inherit'});fs.writeFileSync('leaf.pid',String(c.pid));setInterval(()=>{},1000)");
  t.after(() => { try { process.kill(Number(fs.readFileSync(path.join(root, "leaf.pid"), "utf8")), "SIGKILL"); } catch {} });
  const result = nodeRun(["scripts/run-steps.mjs", root], { env: {
    ...process.env, SETUP_JOB_TIMEOUT_MS: "1500", SETUP_STEPS: JSON.stringify([{ command: process.execPath, args: ["wrapper.mjs"] }]),
  } });
  assert.equal(result.status, 124, result.stdout + result.stderr);
  assert.match(result.stdout, /zaman aşımı/);
  const pid = Number(fs.readFileSync(path.join(root, "leaf.pid"), "utf8"));
  assert.throws(() => process.kill(pid, 0));
});

test("standalone run-steps rejects malformed step definitions with exit 2", (t) => {
  const root = fixture(t);
  for (const steps of ["{", "{}", '[{"command":null}]']) {
    const result = nodeRun(["scripts/run-steps.mjs", root], { env: { ...process.env, SETUP_STEPS: steps } });
    assert.equal(result.status, 2, result.stdout + result.stderr);
  }
});

test("wizard check-only is read-only and reports the selected candidate", (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, "selected"));
  fs.writeFileSync(path.join(root, "selected/index.html"), "selected");
  const result = nodeRun(["bin/setup.mjs", "wizard", "--root", root, "--candidate", "selected", "--check-only", "--port", "58731"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const status = JSON.parse(result.stdout);
  assert.equal(status.directory, path.join(root, "selected"));
  assert.equal(status.wizardPort, 58731);
  assert.equal(fs.existsSync(path.join(root, "setup.config.json")), false);
  assert.equal(fs.existsSync(path.join(root, "selected/setup.config.json")), false);
});

test("an offline copy can refresh its own project launchers without copying itself", (t) => {
  const root = fixture(t);
  initProject(root, { copyTools: true });
  const config = fs.readFileSync(path.join(root, "setup.config.json"), "utf8");
  const entry = path.join(root, "tools/setup/bin/setup.mjs");
  const result = nodeRun([entry, "init", "--root", root, "--copy-tools", "--refresh-launchers"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(fs.readFileSync(path.join(root, "setup.config.json"), "utf8"), config);
});

test("Windows generated launcher preserves literal percent segments in local tool and data paths", (t) => {
  if (process.platform !== "win32") return t.skip("Windows batch only");
  const parent = fixture(t);
  const root = path.join(parent, "%SETUP_PARITY_SEGMENT%");
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, "index.html"), "hello");
  initProject(root, { copyTools: true });
  const data = path.join(root, "external data");
  fs.mkdirSync(data);
  fs.writeFileSync(path.join(data, "installation.lock"), "locked");
  const result = spawnSync('"%SETUP_PARITY_LAUNCHER%" --check-only --data-dir "%SETUP_PARITY_DATA%"', {
    shell: process.env.ComSpec || "cmd.exe", cwd: root, windowsHide: true, encoding: "utf8", timeout: 30000,
    env: { ...process.env, SETUP_PARITY_LAUNCHER: path.join(root, "kurulum.bat"), SETUP_PARITY_DATA: data, SETUP_PARITY_SEGMENT: "WRONG", SETUP_PROJECT_ROOT: root, SETUP_NO_PAUSE: "1" },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const status = JSON.parse(result.stdout);
  assert.equal(status.directory, root);
  assert.equal(status.installation.paths.dataRoot, data);
  assert.equal(fs.readFileSync(path.join(status.installation.paths.dataRoot, "installation.lock"), "utf8"), "locked");
});

for (const portSource of ["argument", "environment"]) {
test(`direct wizard starts in selected candidate with ${portSource} port and managed shutdown`, { timeout: 45000 }, async (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, "selected"));
  fs.writeFileSync(path.join(root, "selected/index.html"), "selected");
  fs.writeFileSync(path.join(root, "selected/setup.config.json"), JSON.stringify({ install: { command: null }, ports: { wizard: 5050 } }));
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const env = { ...process.env };
  delete env.SETUP_PORT;
  delete env.SETUP_WIZARD_PORT;
  if (portSource === "environment") env.SETUP_WIZARD_PORT = String(port);
  const child = spawn(process.execPath, ["bin/setup.mjs", "wizard", "--root", root, "--candidate", "selected", ...(portSource === "argument" ? ["--port", String(port)] : []), "--no-open"], {
    cwd: packageRoot, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  t.after(() => child.kill());
  let text = "", errors = "";
  child.stderr.on("data", (chunk) => { errors += chunk; });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`wizard readiness timed out: ${text} ${errors}`)); }, 30000);
    child.once("error", reject);
    child.once("exit", () => { clearTimeout(timer); reject(new Error(`wizard exited: ${errors}`)); });
    child.stdout.on("data", (chunk) => {
      text += chunk;
      const match = text.match(/http:\/\/127\.0\.0\.1:\d+\/setup\?token=[A-Za-z0-9_-]+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
  });
  assert.equal(new URL(url).port, String(port));
  assert.equal((await fetch(url, { redirect: "manual" })).status, 303);
  assert.equal(fs.existsSync(path.join(root, "setup.config.json")), false);
  assert.equal(fs.existsSync(path.join(root, "selected/setup.config.json")), true);
  const closed = new Promise((resolve) => child.once("close", resolve));
  child.send({ type: "setup:shutdown" });
  assert.equal(await closed, 0);
});
}

test("Windows remote fallback preserves percent arguments and propagates the manager exit code", (t) => {
  if (process.platform !== "win32") return t.skip("Windows batch only");
  const parent = fixture(t);
  const root = path.join(parent, "%SETUP_PARITY_SEGMENT%");
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, "index.html"), "hello");
  initProject(root);
  const fakeBin = path.join(parent, "fake bins");
  fs.mkdirSync(fakeBin);
  fs.writeFileSync(path.join(fakeBin, "npx.cmd"), `@echo off\r\n"${process.execPath}" "%~dp0remote.mjs" %*\r\nexit /b %errorlevel%\r\n`);
  fs.writeFileSync(path.join(fakeBin, "remote.mjs"), "console.log(JSON.stringify(process.argv.slice(2)));process.exit(7)");
  const runtimePath = [fakeBin, path.dirname(process.execPath), path.join(process.env.SystemRoot, "System32")].join(path.delimiter);
  const data = path.join(root, "external data");
  const result = spawnSync('"%SETUP_PARITY_LAUNCHER%" --data-dir "%SETUP_PARITY_DATA%"', {
    shell: process.env.ComSpec || "cmd.exe", cwd: root, windowsHide: true, encoding: "utf8", timeout: 30000,
    env: { ...process.env, PATH: runtimePath, Path: runtimePath, SETUP_PARITY_LAUNCHER: path.join(root, "kurulum.bat"), SETUP_PARITY_DATA: data, SETUP_PARITY_SEGMENT: "WRONG", SETUP_PROJECT_ROOT: root, SETUP_NO_PAUSE: "1" },
  });
  assert.equal(result.status, 7, result.stdout + result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), ["--yes", "github:sirrakadembasti/setup", "--data-dir", data]);
});

test("Bun step execution uses the selected runtime for node commands", (t) => {
  if (!isCommandAvailable("bun")) return t.skip("Bun unavailable");
  const root = fixture(t);
  const result = spawnSync("bun", [path.join(packageRoot, "scripts/run-steps.mjs"), root], {
    cwd: packageRoot, windowsHide: true, encoding: "utf8", timeout: 30000,
    env: { ...process.env, SETUP_STEPS: JSON.stringify([{ command: "node", args: ["-e", "require('fs').writeFileSync('engine',process.versions.bun?'bun':'node')"] }]) },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(fs.readFileSync(path.join(root, "engine"), "utf8"), "bun");
});
