import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { createTerminalBootstrap, runTerminalBootstrap } from "./terminal-bootstrap.mjs";
import { createDesktopAppController } from "../wizard/app-process.mjs";

function fixture(t, config = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-setup-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fixture", dependencies: { example: "1" } }));
  fs.writeFileSync(path.join(root, "setup.config.json"), JSON.stringify(config));
  return root;
}

test("repair runs configured steps with live output and verifies packages before wizard", async (t) => {
  const root = fixture(t, { install: { steps: [{ command: process.execPath, args: ["-e", "require('fs').mkdirSync('node_modules/example',{recursive:true});console.log('installed fixture')"] }] } });
  const logs = [];
  const setup = createTerminalBootstrap({ root, log: (s) => logs.push(s) });
  await assert.rejects(setup.startWizard(), /Paket/);
  await setup.install();
  assert.equal(setup.status().packagesReady, true);
  assert.ok(logs.join("").includes("installed fixture"));
});

test("failed or unverified install never enables wizard", async (t) => {
  const root = fixture(t, { install: { command: process.execPath, args: ["-e", "process.exit(9)"] } });
  const setup = createTerminalBootstrap({ root, log() {} });
  await assert.rejects(setup.install(), /9/);
  assert.equal(setup.status().packagesReady, false);
  await assert.rejects(setup.startWizard(), /Paket/);
  fs.writeFileSync(path.join(root, "setup.config.json"), JSON.stringify({ install: { command: process.execPath, args: ["-e", "process.exit(0)"] } }));
  const unverified = createTerminalBootstrap({ root, log() {} });
  await assert.rejects(unverified.install(), /doğrulama/);
  assert.equal(unverified.status().packagesReady, false);
});

test("check-only status is read-only and static projects need no package manager install", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-static-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "index.html"), "hello");
  const setup = createTerminalBootstrap({ root, log() {} });
  assert.equal(setup.status().kind, "static-web");
  assert.equal(setup.status().packagesReady, true);
  assert.equal(fs.existsSync(path.join(root, "setup.config.json")), false);
  await setup.install();
  assert.equal(setup.status().packagesReady, true);
});

test("installed state blocks ordinary wizard and reset requires both confirmations and verified backup", async (t) => {
  const root = fixture(t, { install: { command: null } });
  fs.mkdirSync(path.join(root, "data"));
  fs.writeFileSync(path.join(root, "data/installation.lock"), "locked");
  fs.writeFileSync(path.join(root, ".env"), "PORT=58473\nDATABASE_URL=file:./data/app.db\n");
  const setup = createTerminalBootstrap({ root, log() {} });
  await assert.rejects(setup.startWizard(), /kurulu/);
  await assert.rejects(setup.reset({ confirmation: "wrong", backupAcknowledged: true }), /onay/);
  assert.equal(fs.existsSync(path.join(root, "data/installation.lock")), true);
  await assert.rejects(setup.reset({ confirmation: "SETUP VERİLERİNİ SİL" }), /yedek/);
  const result = await setup.reset({ confirmation: "SETUP VERİLERİNİ SİL", backupAcknowledged: true });
  assert.ok(fs.existsSync(result.backupRoot));
  assert.equal(fs.existsSync(path.join(root, "data/installation.lock")), false);
});

test("packages removed after repair block wizard again", async (t) => {
  const root = fixture(t, { install: { command: process.execPath, args: ["-e", "require('fs').mkdirSync('node_modules/example',{recursive:true})"] } });
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const setup = createTerminalBootstrap({ root, port: server.address().port, log() {} });
  await setup.install();
  fs.rmSync(path.join(root, "node_modules"), { recursive: true });
  await assert.rejects(setup.startWizard(), /Paket/);
});

test("refresh rereads changed installation configuration", async (t) => {
  const root = fixture(t, { install: { command: null } });
  const setup = createTerminalBootstrap({ root, log() {} });
  assert.equal(setup.status().packagesReady, true);
  fs.writeFileSync(path.join(root, "setup.config.json"), JSON.stringify({ install: { command: process.execPath, args: ["-e", "process.exit(8)"] } }));
  setup.refresh();
  assert.equal(setup.status().packagesReady, false);
  await assert.rejects(setup.install(), /8/);
});

test("terminal menu repairs, refreshes and exits with piped input", async (t) => {
  const root = fixture(t, { install: { command: process.execPath, args: ["-e", "require('fs').mkdirSync('node_modules/example',{recursive:true});console.log('menu-install')"] } });
  let text = "";
  const output = new Writable({ write(chunk, encoding, cb) { text += chunk; cb(); } });
  await runTerminalBootstrap({ root, input: Readable.from(["1\n4\n0\n"]), output, noOpen: true });
  assert.ok(fs.existsSync(path.join(root, "node_modules/example")));
  assert.match(text, /menu-install/);
  assert.match(text, /Paketler: hazır/);
});

test("CLI check-only emits only JSON, does not initialize config or consume a port", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-json-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "index.html"), "hello");
  const result = spawnSync(process.execPath, ["bin/setup.mjs", "--root", root, "--check-only", "--port", "58711"], { encoding: "utf8", timeout: 30000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).wizardPort, 58711);
  assert.equal(fs.existsSync(path.join(root, "setup.config.json")), false);
});

test("candidate selection targets the chosen project and rejects unknown candidates", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-candidates-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ["one", "two"]) {
    fs.mkdirSync(path.join(root, name));
    fs.writeFileSync(path.join(root, name, "package.json"), JSON.stringify({ name }));
  }
  const setup = createTerminalBootstrap({ root, log() {} });
  assert.equal(setup.status().hasAmbiguity, true);
  setup.selectCandidate("two");
  assert.equal(setup.status().directory, path.join(root, "two"));
  setup.prepare();
  assert.equal(fs.existsSync(path.join(root, "two/setup.config.json")), true);
  assert.equal(fs.existsSync(path.join(root, "setup.config.json")), false);
  assert.throws(() => setup.selectCandidate("../other"), /aday/);
});

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("real wizard handoff preserves reconfiguration and external data, and cancel closes process tree", { timeout: 45000 }, async (t) => {
  const root = fixture(t, { install: { command: null } });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-external-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dataDir, "installation.lock"), "locked");
  const port = await freePort();
  let ready;
  const urlPromise = new Promise((resolve) => { ready = resolve; });
  const setup = createTerminalBootstrap({ root, dataDir, port, noOpen: true, log(text) {
    const url = text.match(/http:\/\/127\.0\.0\.1:\d+\/setup\?token=[A-Za-z0-9_-]+/);
    if (url) ready(url[0]);
  } });
  t.after(() => setup.cancel());
  const running = setup.startWizard({ reconfigure: true });
  const settled = running.then(() => null, (err) => err);
  const url = await Promise.race([urlPromise, settled.then((err) => { throw err || new Error("wizard stopped before readiness"); })]);
  assert.equal(new URL(url).port, String(port));
  const response = await fetch(url, { redirect: "manual" });
  assert.equal(response.status, 303);
  const cookie = response.headers.get("set-cookie").split(";")[0];
  const page = await fetch(`http://127.0.0.1:${port}/setup`, { headers: { Cookie: cookie } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<html/);
  assert.equal(fs.readFileSync(path.join(dataDir, "installation.lock"), "utf8"), "locked");
  setup.cancel();
  assert.ok(await settled instanceof Error);
  const check = net.createServer();
  await new Promise((resolve, reject) => { check.once("error", reject); check.listen(port, "127.0.0.1", resolve); });
  await new Promise((resolve) => check.close(resolve));
});

test("occupied wizard port is reported without stopping its owner", async (t) => {
  const root = fixture(t, { install: { command: null } });
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const setup = createTerminalBootstrap({ root, port: server.address().port, noOpen: true, log() {} });
  await assert.rejects(setup.startWizard(), { code: "WIZARD_PORT_BUSY" });
  assert.equal(server.listening, true);
});

test("dependency timeout stops child and keeps wizard blocked", async (t) => {
  const root = fixture(t, { install: { command: process.execPath, args: ["-e", "setInterval(()=>{},1000)"] } });
  const previous = process.env.SETUP_JOB_TIMEOUT_MS;
  process.env.SETUP_JOB_TIMEOUT_MS = "120";
  t.after(() => { if (previous === undefined) delete process.env.SETUP_JOB_TIMEOUT_MS; else process.env.SETUP_JOB_TIMEOUT_MS = previous; });
  const setup = createTerminalBootstrap({ root, log() {} });
  t.after(() => setup.cancel());
  await assert.rejects(setup.install(), /zaman aşımı/);
  assert.equal(setup.status().packagesReady, false);
});

test("wizard rejects ports below its supported range before writing configuration", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-low-port-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "index.html"), "hello");
  const setup = createTerminalBootstrap({ root, port: 80, noOpen: true, log() {} });
  const timer = setTimeout(() => setup.cancel(), 5000);
  t.after(() => clearTimeout(timer));
  await assert.rejects(setup.startWizard(), /1024/);
  assert.equal(fs.existsSync(path.join(root, "setup.config.json")), false);
});

test("external data directory application port protects clean reset while running", async (t) => {
  const root = fixture(t, { install: { command: null } });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-running-data-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  fs.writeFileSync(path.join(dataDir, ".env"), `PORT=${server.address().port}\n`);
  fs.writeFileSync(path.join(dataDir, "installation.lock"), "locked");
  const setup = createTerminalBootstrap({ root, dataDir, log() {} });
  await assert.rejects(setup.reset({ confirmation: "SETUP VERİLERİNİ SİL", backupAcknowledged: true }), /çalışıyor/);
  assert.equal(fs.existsSync(path.join(dataDir, "installation.lock")), true);
});

test("CLI terminal to web handoff works while old bootstrap port is occupied and closes on parent exit", { timeout: 40000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-e2e-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "index.html"), "hello");
  const occupied = net.createServer();
  await new Promise((resolve) => occupied.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => occupied.close(resolve)));
  const port = await freePort();
  const child = spawn(process.execPath, ["bin/setup.mjs", "--root", root, "--port", String(port), "--no-open"], {
    windowsHide: true, env: { ...process.env, SETUP_BOOTSTRAP_PORT: String(occupied.address().port) },
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => child.kill());
  let transcript = "", stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Handoff timed out: ${transcript} ${stderr}`)); }, 30000);
    child.once("error", reject);
    child.once("exit", () => { clearTimeout(timer); reject(new Error(`CLI exited before handoff: ${stderr} ${transcript}`)); });
    child.stdout.on("data", (chunk) => {
      transcript += chunk;
      const match = transcript.match(/http:\/\/127\.0\.0\.1:\d+\/setup\?token=[A-Za-z0-9_-]+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
    child.stdin.write("2\n");
  });
  assert.equal(new URL(url).port, String(port));
  assert.match(transcript, /Paketleri Kur \/ Onar/);
  assert.equal((await fetch(url, { redirect: "manual" })).status, 303);
  assert.equal(occupied.listening, true);
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await exited;
  let closed = false;
  for (let i = 0; i < 30; i++) {
    try { await fetch(`http://127.0.0.1:${port}/setup`, { signal: AbortSignal.timeout(300) }); }
    catch { closed = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(closed, true, "wizard must stop when terminal parent exits");
});

test("multi-step install respects skipIfExists and working directories", async (t) => {
  const root = fixture(t, { install: { steps: [
    { command: process.execPath, args: ["-e", "process.exit(33)"], skipIfExists: "already" },
    { command: process.execPath, cwd: "service", args: ["-e", "require('fs').writeFileSync('first','ok')"] },
    { command: process.execPath, cwd: "service", args: ["-e", "const f=require('fs');if(f.readFileSync('first','utf8')!=='ok')process.exit(34);f.mkdirSync('../node_modules/example',{recursive:true})"] },
  ] } });
  fs.writeFileSync(path.join(root, "already"), "done");
  fs.mkdirSync(path.join(root, "service"));
  const setup = createTerminalBootstrap({ root, log() {} });
  await setup.install();
  assert.equal(setup.status().packagesReady, true);
  assert.equal(fs.readFileSync(path.join(root, "service/first"), "utf8"), "ok");
});

test("terminal clean reset requires typed confirmation and reports verified backup", async (t) => {
  const root = fixture(t, { install: { command: null } });
  fs.mkdirSync(path.join(root, "data"));
  fs.writeFileSync(path.join(root, "data/installation.lock"), "locked");
  fs.writeFileSync(path.join(root, ".env"), "PORT=58392\n");
  let transcript = "";
  const output = new Writable({ write(chunk, enc, cb) { transcript += chunk; cb(); } });
  await runTerminalBootstrap({ root, input: Readable.from(["5\ne\nwrong\n0\n"]), output });
  assert.equal(fs.existsSync(path.join(root, "data/installation.lock")), true);
  await runTerminalBootstrap({ root, input: Readable.from(["5\ne\nSETUP VERİLERİNİ SİL\n0\n"]), output });
  assert.equal(fs.existsSync(path.join(root, "data/installation.lock")), false);
  assert.match(transcript, /Doğrulanmış yedek/);
  assert.ok(fs.readdirSync(path.join(root, "backups")).length > 0);
});

test("POSIX timeout terminates descendants even after step leader exits", { skip: process.platform === "win32", timeout: 15000 }, async (t) => {
  const root = fixture(t, { install: { command: process.execPath, args: ["-e", "require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'}).unref();process.exit(0)"] } });
  const previous = process.env.SETUP_JOB_TIMEOUT_MS;
  process.env.SETUP_JOB_TIMEOUT_MS = "1500";
  t.after(() => { if (previous === undefined) delete process.env.SETUP_JOB_TIMEOUT_MS; else process.env.SETUP_JOB_TIMEOUT_MS = previous; });
  const setup = createTerminalBootstrap({ root, log() {} });
  t.after(() => setup.cancel(true));
  await assert.rejects(setup.install(), /zaman aşımı/);
});

test("npm-cli.js runtime check uses the current npm entry directly", (t) => {
  const root = fixture(t, { packageManager: "npm" });
  const entry = path.join(root, "npm-cli.js");
  fs.writeFileSync(entry, "console.log('9.1.0')");
  const previous = process.env.npm_execpath;
  process.env.npm_execpath = entry;
  t.after(() => { if (previous === undefined) delete process.env.npm_execpath; else process.env.npm_execpath = previous; });
  const setup = createTerminalBootstrap({ root, log() {} });
  assert.equal(setup.status().runtime.packageManagerVersion, "9.1.0");
});

test("desktop shutdown terminates leaf application behind command wrapper", { timeout: 15000 }, async (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, "leaf.mjs"), "setInterval(()=>{},1000)");
  fs.writeFileSync(path.join(root, "wrapper.mjs"), "import{spawn}from'node:child_process';import fs from'node:fs';const c=spawn(process.execPath,['leaf.mjs'],{stdio:'ignore'});fs.writeFileSync('leaf.pid',String(c.pid));setInterval(()=>{},1000)");
  const controller = createDesktopAppController({ projectRoot: root, graceMs: 500, startInvocation: { command: process.execPath, args: ["wrapper.mjs"] } });
  let pid;
  t.after(async () => { await controller.stop(); if (pid) { try { process.kill(pid, "SIGKILL"); } catch {} } });
  assert.equal((await controller.start()).status, 200);
  for (let i = 0; i < 20 && !fs.existsSync(path.join(root, "leaf.pid")); i++) await new Promise((r) => setTimeout(r, 50));
  pid = Number(fs.readFileSync(path.join(root, "leaf.pid"), "utf8"));
  process.kill(pid, 0);
  await controller.stop();
  let alive = true;
  for (let i = 0; i < 20; i++) {
    try { process.kill(pid, 0); } catch { alive = false; break; }
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(alive, false);
});

test("terminal bootstrap detects pre-installed packages on startup and runs all subproject install steps", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-hybrid-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "root-e2e", devDependencies: { "@playwright/test": "^1.0.0" } }));
  for (const sub of ["backend", "frontend", "execution", "llm-yonetimi"]) {
    fs.mkdirSync(path.join(root, sub), { recursive: true });
    fs.writeFileSync(
      path.join(root, sub, "package.json"),
      JSON.stringify({
        name: sub,
        dependencies: sub === "frontend" ? { react: "^18.0.0" } : { express: "^4.0.0" },
      }),
    );
  }
  const setup1 = createTerminalBootstrap({ root, log() {} });
  assert.equal(setup1.status().packagesReady, false);

  // Paketler diskte kurulduğunda yeni bir terminal oturumu açıldığında packagesReady doğrudan true başlamalı
  fs.mkdirSync(path.join(root, "node_modules", "@playwright"), { recursive: true });
  for (const sub of ["backend", "frontend", "execution", "llm-yonetimi"]) {
    fs.mkdirSync(path.join(root, sub, "node_modules", "pkg"), { recursive: true });
  }
  const setup2 = createTerminalBootstrap({ root, log() {} });
  assert.equal(setup2.status().packagesReady, true);
  assert.equal(setup2.status().installation.evidence.dependenciesInstalled, true);
});

test("terminal panel renders sequential options 1-5 and 0 without skipping numbers and protects against redundant reinstall", async (t) => {
  let runCount = 0;
  const root = fixture(t, {
    install: {
      command: process.execPath,
      args: ["-e", "require('fs').mkdirSync('node_modules/example',{recursive:true});require('fs').appendFileSync('install-runs','x')"],
    },
  });
  let transcript = "";
  const output = new Writable({ write(chunk, enc, cb) { transcript += chunk; cb(); } });
  // 1. kurulum -> başarılı
  // 1. kurulum tekrar seçildiğinde -> zaten kurulu uyarısı verir ve 'h' ile atlanır
  // 3. seçenek (kurulu değilken) -> hata yakalanır
  // 5. seçenek (temizken) -> hata yakalanır
  // 9. seçenek (geçersiz) -> uyarı verir
  // 0 -> çıkış
  await runTerminalBootstrap({
    root,
    input: Readable.from(["1\n1\nh\n3\n5\n9\n0\n"]),
    output,
    noOpen: true,
  });

  runCount = fs.readFileSync(path.join(root, "install-runs"), "utf8").length;
  assert.equal(runCount, 1, "paketler kurulduktan sonra onay verilmezse tekrar kurulum yapılmamalı");
  assert.match(transcript, /1\) Paketleri Kur \/ Onar/);
  assert.match(transcript, /2\) Kurulum Sihirbazına Geç/);
  assert.match(transcript, /3\) Yeniden Yapılandır/);
  assert.match(transcript, /4\) Yeniden Denetle/);
  assert.match(transcript, /5\) Yedekle ve Temiz Kuruluma Geç/);
  assert.match(transcript, /0\) Çıkış/);
  assert.match(transcript, /\[✓\] 3\. Bağımlılık kurulumu/);
  assert.match(transcript, /\[→\] 4\. Web kurulum sihirbazı/);
  assert.match(transcript, /Paket kurulumu atlandı/);
  assert.match(transcript, /Yeniden yapılandırma için mevcut kurulum gerekir/);
  assert.match(transcript, /Temizlenecek mevcut veya yarım kurulum bulunamadı/);
  assert.match(transcript, /Geçerli bir seçenek girin/);
});

test("terminal panel in installed state marks all steps complete and prevents accidental fresh wizard", async (t) => {
  const root = fixture(t, { install: { command: null } });
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.writeFileSync(path.join(root, "data/installation.lock"), "locked");
  fs.writeFileSync(path.join(root, ".env"), "PORT=58473\n");
  let transcript = "";
  const output = new Writable({ write(chunk, enc, cb) { transcript += chunk; cb(); } });
  // 2 seçildiğinde zaten kurulu uyarısı verir, 'h' ile iptal edilir, 0 ile çıkılır
  await runTerminalBootstrap({
    root,
    input: Readable.from(["2\nh\n0\n"]),
    output,
    noOpen: true,
  });
  assert.match(transcript, /Bu uygulama zaten kurulmuş durumda\. Tekrar kurulum yapmanıza gerek yoktur/);
  assert.match(transcript, /Sıfırdan kurulum tekrar yapılamaz/);
  assert.match(transcript, /İşlem iptal edildi/);
});
