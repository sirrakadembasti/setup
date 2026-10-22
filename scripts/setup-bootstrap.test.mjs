import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CLEAN_INSTALL_CONFIRMATION,
  createVerifiedBackup,
  describePortConflict,
  findListeningProcess,
  getSetupPaths,
  inspectInstallationState,
  readConfiguredPort,
  resetInstallation,
  stopPortProcess,
  validateRuntime,
} from "./setup-bootstrap-lib.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kur-bootstrap-"));
  fs.mkdirSync(path.join(root, "server"), { recursive: true });
  fs.writeFileSync(path.join(root, "server", "package.json"), "{}\n", "utf8");
  const paths = getSetupPaths(root);
  fs.mkdirSync(paths.dataRoot, { recursive: true });
  fs.mkdirSync(paths.uploadsRoot, { recursive: true });
  fs.mkdirSync(paths.backupsRoot, { recursive: true });
  fs.mkdirSync(path.join(paths.serverRoot, "node_modules"), { recursive: true });
  fs.mkdirSync(path.join(root, "client", "node_modules"), { recursive: true });
  fs.mkdirSync(paths.pnpmStore, { recursive: true });
  fs.writeFileSync(path.join(root, "client", "package.json"), "{}\n", "utf8");
  fs.writeFileSync(path.join(paths.dataRoot, "README.md"), "korunacak\n", "utf8");
  fs.writeFileSync(path.join(paths.uploadsRoot, ".gitkeep"), "", "utf8");
  return { root, paths, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("Node.js LTS (18/20/22/24) ve paket yöneticisi sürümleri doğrulanır", () => {
  assert.equal(validateRuntime("v18.20.4", "10.2.0").nodeSupported, true);
  assert.equal(validateRuntime("v20.15.0", "10.2.0").nodeSupported, true);
  assert.equal(validateRuntime("v22.23.0", "9.15.1").nodeSupported, true);
  assert.equal(validateRuntime("24.21.0", "9.15.1").packageManagerSupported, true);
  assert.equal(validateRuntime("16.20.0", "9.15.1").nodeSupported, false);
  assert.equal(validateRuntime("22.10.0", "").packageManagerSupported, false);
});

test("boş dizin yeni kurulum olarak algılanır", (t) => {
  const item = fixture();
  t.after(item.cleanup);
  const state = inspectInstallationState(item.root);
  assert.equal(state.state, "fresh");
  assert.equal(state.evidence.installationLock, false);
});

test("eksik workspace paketleri sihirbaza geçiş için yeterli sayılmaz", (t) => {
  const item = fixture();
  t.after(item.cleanup);
  fs.rmSync(path.join(item.paths.serverRoot, "node_modules"), { recursive: true, force: true });
  const state = inspectInstallationState(item.root);
  assert.equal(state.evidence.dependenciesInstalled, false);
  assert.equal(state.dependencies.ready, false);
  assert.equal(state.dependencies.serverModules, false);
});

test("tam workspace veya tek dizinli proje paketleri dependenciesInstalled olarak görünür", (t) => {
  const item = fixture();
  t.after(item.cleanup);
  const state = inspectInstallationState(item.root);
  assert.equal(state.evidence.dependenciesInstalled, true);
  assert.equal(state.dependencies.ready, true);
});

test("env veya veritabanı varsa yarım kurulum algılanır", (t) => {
  const item = fixture();
  t.after(item.cleanup);
  fs.writeFileSync(item.paths.env, "PORT=5055\n", "utf8");
  fs.writeFileSync(item.paths.appDb, "db-content", "utf8");
  assert.equal(inspectInstallationState(item.root).state, "partial");
  assert.equal(readConfiguredPort(item.root), 5055);
});

test("yanlış doğrulama metni hiçbir veriyi değiştirmez", (t) => {
  const item = fixture();
  t.after(item.cleanup);
  fs.writeFileSync(item.paths.appDb, "important-data", "utf8");
  assert.throws(() => resetInstallation(item.root, {
    confirmation: "SİL",
    backupAcknowledged: true,
  }), /onay metni/);
  assert.equal(fs.readFileSync(item.paths.appDb, "utf8"), "important-data");
});

test("harici veya özel veritabanı otomatik temizlenmez", (t) => {
  const item = fixture();
  t.after(item.cleanup);
  fs.writeFileSync(item.paths.env, "DATABASE_URL=postgresql://db.example/appdb\n", "utf8");
  assert.throws(() => resetInstallation(item.root, {
    confirmation: CLEAN_INSTALL_CONFIRMATION,
    backupAcknowledged: true,
  }), /yalnız yerel dosya tabanlı \(SQLite\)/);
  assert.equal(fs.existsSync(item.paths.env), true);
  assert.equal(fs.readdirSync(item.paths.backupsRoot).length, 0);
});

test("temiz kurulum önce doğrulanmış yedek alır ve yalnız çalışma verilerini temizler", (t) => {
  const item = fixture();
  t.after(item.cleanup);
  fs.mkdirSync(item.paths.setupArtifacts, { recursive: true });
  fs.writeFileSync(item.paths.env, "SESSION_SECRET=secret\nPORT=5000\n", "utf8");
  fs.writeFileSync(item.paths.appDb, "app-data", "utf8");
  fs.writeFileSync(item.paths.sessionsDb, "session-data", "utf8");
  fs.writeFileSync(item.paths.lock, "{}\n", "utf8");
  fs.writeFileSync(item.paths.deploymentConfig, "{}\n", "utf8");
  fs.writeFileSync(path.join(item.paths.setupArtifacts, "nginx.conf.example"), "proxy", "utf8");
  fs.writeFileSync(path.join(item.paths.uploadsRoot, "file.png"), "image", "utf8");

  const result = resetInstallation(item.root, {
    confirmation: CLEAN_INSTALL_CONFIRMATION,
    backupAcknowledged: true,
  });

  assert.equal(fs.existsSync(path.join(result.backupRoot, "manifest.json")), true);
  const manifest = JSON.parse(fs.readFileSync(path.join(result.backupRoot, "manifest.json"), "utf8"));
  assert.ok(manifest.files.some((entry) => entry.source === "server/data/app.db" && entry.sha256));
  assert.ok(manifest.files.some((entry) => entry.source === "server/.env" && entry.sha256));
  assert.equal(fs.existsSync(item.paths.appDb), false);
  assert.equal(fs.existsSync(item.paths.env), false);
  assert.equal(fs.existsSync(item.paths.lock), false);
  assert.equal(fs.existsSync(path.join(item.paths.uploadsRoot, "file.png")), false);
  assert.equal(fs.existsSync(path.join(item.paths.uploadsRoot, ".gitkeep")), true);
  assert.equal(fs.existsSync(path.join(item.paths.dataRoot, "README.md")), true);
  assert.equal(result.state.state, "fresh");
});

test("dış dizini gösteren sembolik bağlantı (symlink) yedekleme sırasında reddedilir", (t) => {
  const item = fixture();
  t.after(item.cleanup);
  const outsideFile = path.join(os.tmpdir(), `outside-secret-${process.pid}.txt`);
  fs.writeFileSync(outsideFile, "secret-outside", "utf8");
  t.after(() => fs.rmSync(outsideFile, { force: true }));

  try {
    fs.symlinkSync(outsideFile, path.join(item.paths.uploadsRoot, "leak.txt"));
  } catch (err) {
    if (err.code === "EPERM") {
      t.skip("Windows'ta symlink oluşturma yetkisi (Geliştirici Modu) bulunmadığından atlandı");
      return;
    }
    throw err;
  }
  assert.throws(
    () => createVerifiedBackup(item.root, "symlink-test"),
    /sembolik bağlantı proje dışını gösteriyor|Güvenli dizin sınırı ihlali/,
  );
  assert.equal(fs.existsSync(path.join(item.paths.backupsRoot, "symlink-test")), false);
});

test("port dinleyen süreç bulunur ve çakışma açıklaması üretilir", async (t) => {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const holder = findListeningProcess(port);
  assert.ok(holder, "dinleyen süreç bulunmalı");
  assert.equal(typeof holder.pid, "number");
  assert.ok(holder.pid > 0);

  const conflict = describePortConflict(port);
  assert.equal(conflict.port, port);
  assert.equal(conflict.holder.pid, holder.pid);
  assert.match(conflict.message, /EADDRINUSE|address already in use|zaten kullanımda/);
  assert.match(conflict.message, /kurulum\.bat/);
  assert.match(conflict.message, /taskkill|kill/);
  assert.match(conflict.message, /değiştirilmez/i);
});

test("boş portta süreç bulunamaz ve yine de yol gösterilir", () => {
  const holder = findListeningProcess(1);
  assert.equal(holder, null);

  const conflict = describePortConflict(1);
  assert.equal(conflict.holder, null);
  assert.match(conflict.message, /netstat|lsof/);
  assert.match(conflict.message, /kurulum\.bat/);
});

test("kurulum betikleri sihirbaz portu olan SETUP_PORT'u ezmez", () => {
  const root = process.cwd();
  const batPath = [path.join(root, "kurulum.bat"), path.join(root, "bin", "kurulum.bat")].find((p) => fs.existsSync(p));
  const shPath = [path.join(root, "kurulum.sh"), path.join(root, "bin", "kurulum.sh")].find((p) => fs.existsSync(p));
  assert.ok(batPath, "kurulum.bat bulunmalı");
  assert.ok(shPath, "kurulum.sh bulunmalı");
  const bat = fs.readFileSync(batPath, "utf8");
  const sh = fs.readFileSync(shPath, "utf8");
  assert.equal(/set\s+"SETUP_PORT=/.test(bat), false, "kurulum.bat SETUP_PORT atamamalı");
  assert.match(bat, /CHECK_PORT=/);
  assert.equal(/SETUP_PORT=/.test(sh), false, "kurulum.sh SETUP_PORT atamamalı");
  assert.match(sh, /CHECK_PORT=/);
});

test("stopPortProcess dinleyen süreci durdurur", async (t) => {
  const { spawn } = await import("node:child_process");
  const holder = spawn(
    process.execPath,
    [
      "-e",
      "const net=require('net');const s=net.createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port)});setInterval(()=>{},1000)",
    ],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("holder timeout")), 5000);
    holder.stdout.once("data", (chunk) => {
      clearTimeout(timer);
      resolve(Number(String(chunk).trim()));
    });
    holder.once("error", reject);
  });
  t.after(() => {
    try {
      holder.kill();
    } catch {}
  });

  assert.equal(findListeningProcess(port)?.pid, holder.pid);
  const result = stopPortProcess(port, { requireNodeOrSetupProcess: true });
  assert.equal(result.stopped, true);
  assert.equal(result.pid, holder.pid);

  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(findListeningProcess(port), null);
});

test("setup-bootstrap --check-only static-web (Senaryo 2) dizininde packagesReady=true döndürür", async (t) => {
  const { spawnSync } = await import("node:child_process");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kur-static-web-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "index.html"), "<!doctype html><html><body>Hello</body></html>\n", "utf8");

  const bootstrapScript = path.join(process.cwd(), "scripts", "setup-bootstrap.mjs");
  const res = spawnSync(process.execPath, [bootstrapScript, "--check-only"], {
    env: { ...process.env, SETUP_PROJECT_ROOT: root },
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(res.status, 0, res.stderr);
  const status = JSON.parse(res.stdout);
  assert.equal(status.kind, "static-web");
  assert.equal(status.scenario?.number, 2);
  assert.equal(status.packagesReady, true);
  assert.equal(status.installation?.dependencies?.ready, true);
});

test("setup-bootstrap --check-only python-server (Senaryo 4) dizininde senaryo ve Python kurulum planını döndürür", async (t) => {
  const { spawnSync } = await import("node:child_process");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kur-python-srv-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "requirements.txt"), "fastapi==0.115.0\n", "utf8");
  fs.writeFileSync(path.join(root, "app.py"), "print('ok')\n", "utf8");

  const bootstrapScript = path.join(process.cwd(), "scripts", "setup-bootstrap.mjs");
  const res = spawnSync(process.execPath, [bootstrapScript, "--check-only"], {
    env: { ...process.env, SETUP_PROJECT_ROOT: root },
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(res.status, 0, res.stderr);
  const status = JSON.parse(res.stdout);
  assert.equal(status.kind, "python-server");
  assert.equal(status.scenario?.number, 4);
  assert.equal(status.packagesReady, false);
  assert.ok(Array.isArray(status.plan?.steps), "plan.steps dizi olmalı");
  assert.ok(
    status.plan.steps.some((step) => step.id === "dependencies" && /Python|pip/i.test(step.label)),
    "plan.steps Python bağımlılık adımını içermeli",
  );
});

