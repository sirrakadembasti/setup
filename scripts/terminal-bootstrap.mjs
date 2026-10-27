import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { buildInstallPlan, detectProject, loadSetupConfig, parseEnvExample } from "./detect-project.mjs";
import { initProject } from "./setup-api.mjs";
import {
  CLEAN_INSTALL_CONFIRMATION, clearCommandAvailabilityCache, describePortConflict,
  getSetupPaths, inspectInstallationState, isLocalPortOpen, readConfiguredPort, resetInstallation,
  resolveDesktopDataDir, resolveEffectivePackageManager, stopPortProcess, validateRuntime,
} from "./setup-bootstrap-lib.mjs";
import { resolveLanguageProfile } from "./polyglot.mjs";
import { createProcessRunner, PACKAGE_MANAGERS, resolveCommandInvocation as invocation } from "./process-runner.mjs";
import { runSteps } from "./run-steps.mjs";
import { resolveProjectTarget, resolveWizardPort } from "./cli-options.mjs";
import { createDualProcessController, parseDotEnvFile, resolveAppStartInvocation, withApplicationPort } from "../wizard/app-process.mjs";
import { probeApplicationUrl } from "../wizard/app-readiness.mjs";
import { createStaticAppServer } from "../wizard/server.mjs";

const setupRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidenceLabels = {
  installationLock: "Kurulum kilidi", environmentFile: "Ortam dosyası", applicationDatabase: "Uygulama veritabanı",
  sessionDatabase: "Oturum veritabanı", deploymentConfig: "Dağıtım profili", pendingInstallation: "Yarım işlem",
  uploadedFiles: "Yüklenen dosyalar", dependenciesInstalled: "Paketler",
};

export function createTerminalBootstrap(options = {}) {
  const repositoryRoot = path.resolve(options.root || process.env.SETUP_PROJECT_ROOT || process.cwd());
  const log = options.log || console.log;
  let candidate = options.candidate;
  let root = repositoryRoot;
  let detection, config, dataDir, pm, packagesReady, runtimeCache;
  let application = { state: "idle" };
  let activeDualController = null;
  let activeStaticServer = null;
  const runner = createProcessRunner({ log });
  function cancelAll(force = false, signal = "SIGINT") {
    runner.cancel(force, signal);
    if (activeDualController) {
      void activeDualController.stop();
      activeDualController = null;
    }
    if (activeStaticServer) {
      try { activeStaticServer.close(); } catch {}
      activeStaticServer = null;
    }
  }
  function refreshDetection() {
    clearCommandAvailabilityCache();
    const target = resolveProjectTarget(repositoryRoot, candidate);
    root = target.root;
    detection = target.detection;
    config = loadSetupConfig(root) || {};
    dataDir = options.dataDir || resolveDesktopDataDir({ detection, setupConfig: config });
    pm = resolveEffectivePackageManager(config.packageManager || detection.packageManager);
    runtimeCache = null;
    packagesReady = !detection.scenario.requiresDependencies || config.install?.command === null || inspectInstallationState(root, { dataDir }).dependencies.ready;
  }
  refreshDetection();

  function resolveSubprojectsList() {
    const fromDet = Array.isArray(detection.subprojectList) && detection.subprojectList.length > 0
      ? [...detection.subprojectList]
      : (detection.subprojects ? Object.values(detection.subprojects).filter(Boolean) : []);
    const seen = new Set(fromDet.map((s) => s.dir));
    for (const dir of ["backend", "frontend", "server", "client", "srv", "ui", "api", "web"]) {
      if (seen.has(dir)) continue;
      const pkgPath = path.join(root, dir, "package.json");
      if (fs.existsSync(pkgPath)) {
        let name = dir;
        try { name = JSON.parse(fs.readFileSync(pkgPath, "utf8")).name || dir; } catch {}
        fromDet.push({ dir, name, kind: "node" });
        seen.add(dir);
      }
    }
    return fromDet;
  }

  function buildModuleStatuses() {
    const subList = resolveSubprojectsList();
    if (subList.length === 0) return [];
    const mods = [];
    let rootPkg;
    try { rootPkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")); } catch {}
    const rootHasDeps = Boolean(rootPkg && (Object.keys(rootPkg.dependencies || {}).length > 0 || Object.keys(rootPkg.devDependencies || {}).length > 0));
    if (rootHasDeps) {
      mods.push({
        dir: ".",
        name: rootPkg.name || path.basename(root),
        kind: "root",
        packagesReady: fs.existsSync(path.join(root, "node_modules")),
        hasEnv: fs.existsSync(path.join(root, ".env")),
        hasEnvExample: [".env.example", ".env.sample", ".env.template"].some((f) => fs.existsSync(path.join(root, f))),
      });
    }
    for (const s of subList) {
      if (!s?.dir) continue;
      const subDir = path.join(root, s.dir);
      const subReady = fs.existsSync(path.join(subDir, "node_modules")) || Boolean(detection.workspaces?.isWorkspace && fs.existsSync(path.join(root, "node_modules")));
      mods.push({
        dir: s.dir,
        name: s.name || s.dir,
        kind: s.kind || "node",
        packagesReady: subReady,
        hasEnv: fs.existsSync(path.join(subDir, ".env")),
        hasEnvExample: [".env.example", ".env.sample", ".env.template"].some((f) => fs.existsSync(path.join(subDir, f))),
      });
    }
    return mods;
  }

  function status() {
    const wizardPort = resolveWizardPort({ port: options.port, config });
    const hasNode = ["package.json", "server/package.json", "client/package.json"].some((f) => fs.existsSync(path.join(root, f))) || Boolean(detection.subprojects);
    if (!runtimeCache) {
      const pmCall = invocation(pm, ["--version"]);
      const ver = hasNode ? spawnSync(pmCall.command, pmCall.args, { cwd: root, encoding: "utf8", windowsHide: true }) : null;
      runtimeCache = validateRuntime(process.version, ver?.status === 0 ? String(ver.stdout).trim() : "", { packageManager: pm });
    }
    const runtime = { ...runtimeCache };
    if (!hasNode && runtime.nodeSupported) runtime.packageManagerSupported = true;
    return {
      project: detection.projectName, repositoryName: path.basename(root), directory: root, repositoryRoot, kind: detection.kind,
      scenario: detection.scenario, candidates: detection.candidates || [], hasAmbiguity: Boolean(detection.hasAmbiguity),
      modules: buildModuleStatuses(),
      plan: buildInstallPlan({ ...detection, ports: { ...detection.ports, wizard: wizardPort }, packageManager: pm }), platform: `${process.platform}/${process.arch}`,
      hostname: os.hostname(), runtime, installation: inspectInstallationState(root, { dataDir }), packagesReady,
      wizardPort,
      configuredPort: readConfiguredPort(root, { dataDir }),
      application,
    };
  }

  function selectCandidate(value) {
    const found = detectProject(repositoryRoot);
    const choice = found.candidates?.find((c) => c.dir === value || c.name === value);
    if (!choice) throw new Error("Geçerli bir aday alt proje seçin.");
    candidate = choice.dir;
    refreshDetection();
  }

  function refresh() {
    const previousRoot = root;
    const previousInstall = JSON.stringify(config.install);
    const previouslyReady = packagesReady;
    refreshDetection();
    if (root === previousRoot && JSON.stringify(config.install) === previousInstall && previouslyReady && inspectInstallationState(root, { dataDir }).dependencies.ready) packagesReady = true;
  }

  function prepare() {
    if (detection.hasAmbiguity) throw new Error("Önce bir aday alt proje seçin (--candidate <dizin>).");
    if (!buildInstallPlan(detection).canInstall) throw new Error("Bu dizinde kurulum planlanamadı. Geçerli proje bulunamadı.");
    try {
      fs.accessSync(root, fs.constants.W_OK);
    } catch {
      throw new Error(`Hedef dizinde yazma izni yok: ${root}. Lütfen dizin izinlerini kontrol edin.`);
    }
    if (!fs.existsSync(path.join(root, "setup.config.json"))) {
      initProject(root, { overwrite: false, updatePackageJson: false, createLaunchers: false });
      config = loadSetupConfig(root) || {};
      log("[setup] setup.config.json otomatik oluşturuldu.");
    }
  }

  function run(call, { timeout, cwd = root, wizard = false, reconfigure = false, ipc = false, env = {} } = {}) {
    const port = wizard ? status().wizardPort : null;
    let buffer = "", opened = false;
    return runner.run(call, {
      cwd, timeout, ipc, prependPaths: [path.join(setupRoot, "bin/shims")],
      onMessage(message) {
        if (message?.type === "setup:application") {
          application = { state: message.state, message: message.message };
          options.onApplicationState?.(application);
        }
      },
      env: {
        ...process.env, ...env, SETUP_PROJECT_ROOT: root, SETUP_PROJECT_NAME: detection.projectName,
        ...(dataDir ? { SETUP_DATA_DIR: dataDir } : {}),
        ...(wizard ? { SETUP_PORT: String(port), SETUP_WIZARD_PORT: String(port), SETUP_RECONFIGURE: reconfigure ? "true" : "false" } : {}),
      },
      onStdout(text, controls) {
        if (!wizard || opened) return;
        buffer = (buffer + text).slice(-8192);
        const match = buffer.match(/http:\/\/127\.0\.0\.1:\d+\/setup\?token=[A-Za-z0-9_-]+/);
        if (match) { opened = true; controls.clearTimeout(); if (!options.noOpen) openBrowser(match[0]); }
      },
    });
  }

  function installSteps() {
    if (!detection.scenario.requiresDependencies || config.install?.command === null) return [];
    if (config.install?.steps?.length) return config.install.steps;
    const subList = Array.isArray(detection.subprojectList) && detection.subprojectList.length > 0
      ? detection.subprojectList
      : (detection.subprojects ? Object.values(detection.subprojects) : []);
    if (subList.length > 0 && !detection.workspaces?.isWorkspace && (!config.install?.command || PACKAGE_MANAGERS.has(config.install.command))) {
      const steps = [];
      let rootPkg;
      try { rootPkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")); } catch {}
      const rootHasDeps = Boolean(rootPkg && (Object.keys(rootPkg.dependencies || {}).length > 0 || Object.keys(rootPkg.devDependencies || {}).length > 0));
      if (rootHasDeps) steps.push({ command: pm, args: ["install"], label: `${rootPkg.name || "root"} (${pm} install)` });
      for (const s of subList) {
        if (s?.dir) steps.push({ command: pm, args: ["install"], cwd: s.dir, label: s.name || s.dir });
      }
      if (steps.length > 0) return steps;
    }
    if (config.install?.command) return [{ command: config.install.command, args: config.install.args || ["install"] }];
    const profile = resolveLanguageProfile(root, detection.kind, detection.ports.app);
    if (profile) {
      const steps = [...profile.steps];
      if (fs.existsSync(path.join(root, "package.json"))) steps.push({ command: pm, args: ["install"] });
      return steps;
    }
    return [{ command: pm, args: ["install"] }];
  }

  async function install() {
    packagesReady = false;
    prepare();
    const steps = installSteps();
    if (!steps.length) { packagesReady = true; log("[setup] Paket kurulumu gerekmiyor."); return; }
    const result = await runSteps(root, steps, log, { run });
    if (!result.ok) throw result.error;
    if (!inspectInstallationState(root, { dataDir }).dependencies.ready) throw new Error("Paket kurulumu bitti ancak doğrulama eksik. Paketleri Kur / Onar ile tekrar deneyin.");
    packagesReady = true;
    log("[setup] Bağımlılık kurulumu ve doğrulaması tamamlandı.");
  }

  async function reset(payload = {}) {
    if (runner.running) throw new Error("Çalışan işlem varken temiz kurulum başlatılamaz.");
    if (await isLocalPortOpen(readConfiguredPort(root, { dataDir }))) throw new Error("Uygulama çalışıyor. Önce servisi durdurun.");
    const result = resetInstallation(root, { ...payload, dataDir });
    packagesReady = !detection.scenario.requiresDependencies || config.install?.command === null;
    log(`[setup] Doğrulanmış yedek: ${result.backupRoot} (${result.files} dosya)`);
    return result;
  }

  function ensureDefaultEnvironment() {
    prepare();
    const paths = getSetupPaths(root, { dataDir });
    fs.mkdirSync(paths.dataRoot, { recursive: true });
    let createdEnv = false;
    if (!fs.existsSync(paths.env) && !fs.existsSync(paths.rootEnv)) {
      let templateContent = null;
      for (const candidateDir of [root, paths.serverRoot]) {
        for (const tpl of [".env.example", ".env.sample", ".env.template"]) {
          const tplPath = path.join(candidateDir, tpl);
          if (fs.existsSync(tplPath)) {
            templateContent = fs.readFileSync(tplPath, "utf8");
            break;
          }
        }
        if (templateContent !== null) break;
      }
      const defaultPort = detection.ports?.app || 5000;
      if (templateContent !== null) {
        const hasPortLine = /^\s*(?:export\s+)?PORT\s*=/m.test(templateContent);
        const content = hasPortLine ? templateContent : `${templateContent.trimEnd()}\nPORT=${defaultPort}\n`;
        fs.writeFileSync(paths.env, content, "utf8");
      } else {
        const exampleItems = parseEnvExample(root);
        const lines = [];
        let hasPort = false;
        for (const item of exampleItems) {
          if (item.key === "PORT") hasPort = true;
          lines.push(`${item.key}=${item.value ?? ""}`);
        }
        if (!hasPort) lines.unshift(`PORT=${defaultPort}`);
        fs.writeFileSync(paths.env, `${lines.join("\n")}\n`, "utf8");
      }
      if (paths.rootEnv !== paths.env && fs.existsSync(path.join(root, "package.json")) && !fs.existsSync(paths.rootEnv)) {
        fs.copyFileSync(paths.env, paths.rootEnv);
      }
      createdEnv = true;
      log(`[setup] Varsayılan .env dosyası otomatik hazırlandı: ${paths.env}`);
    }
    const subList = resolveSubprojectsList();
    for (const sub of subList) {
      if (!sub?.dir) continue;
      const subDir = path.join(root, sub.dir);
      const subEnvPath = path.join(subDir, ".env");
      if (!fs.existsSync(subEnvPath)) {
        let copiedFromSubTpl = false;
        for (const tpl of [".env.example", ".env.sample", ".env.template"]) {
          const tplPath = path.join(subDir, tpl);
          if (fs.existsSync(tplPath)) {
            fs.copyFileSync(tplPath, subEnvPath);
            copiedFromSubTpl = true;
            log(`[setup] Alt modül .env dosyası şablondan oluşturuldu: ${sub.dir}/.env`);
            break;
          }
        }
        if (!copiedFromSubTpl && fs.existsSync(paths.env) && ["backend", "server", "api"].includes(sub.dir.toLowerCase())) {
          fs.copyFileSync(paths.env, subEnvPath);
          log(`[setup] Alt modül .env dosyası hazırlandı: ${sub.dir}/.env`);
        }
      }
    }
    if (!fs.existsSync(paths.lock)) {
      fs.writeFileSync(
        paths.lock,
        JSON.stringify({ installedAt: new Date().toISOString(), mode: "direct-terminal-start", project: detection.projectName }, null, 2),
        "utf8",
      );
      log(`[setup] Kurulum kilidi oluşturuldu: ${paths.lock}`);
    }
    return { envPath: paths.env, lockPath: paths.lock, createdEnv };
  }

  async function startApp({ waitForExit = true, startTimeoutMs = 15000 } = {}) {
    const current = status();
    if (!current.runtime.nodeSupported || !current.runtime.packageManagerSupported) {
      throw new Error("Desteklenmeyen çalışma ortamı. Node.js >=18 ve geçerli bir paket yöneticisi gerekir.");
    }
    if (!packagesReady || (detection.scenario.requiresDependencies && config.install?.command !== null && !current.installation.dependencies.ready)) {
      throw new Error("Paketler eksik. Önce 1) Paketleri Kur / Onar adımını tamamlayın.");
    }
    const { envPath } = ensureDefaultEnvironment();
    const envVars = parseDotEnvFile(envPath);
    const appPort = Number(envVars.PORT) || readConfiguredPort(root, { dataDir }) || detection.ports?.app || 5000;
    const frontendPort = Number(envVars.FRONTEND_PORT) || detection.ports?.frontend || (appPort === 5000 ? 5001 : appPort + 1);
    const inv = resolveAppStartInvocation(root, config);
    if (!inv) {
      throw new Error("Hedef uygulama için başlatma komutu bulunamadı (package.json scripts.start/dev veya setup.config.json start).");
    }

    if (inv.type === "dual") {
      log(`[setup] Çok parçalı hedef uygulama başlatılıyor (Backend: ${appPort}, Frontend: ${frontendPort})...`);
      activeDualController = createDualProcessController({
        projectRoot: root,
        backendInvocation: inv.backend,
        frontendInvocation: inv.frontend,
        backendPort: appPort,
        frontendPort,
        envVars,
        prependPaths: [path.join(setupRoot, "bin/shims")],
        appendLog(text) {
          if (text && text.trim()) log(text.trimEnd());
        },
      });
      await activeDualController.start();
      const targetUrl = `http://127.0.0.1:${frontendPort}`;
      const backendUrl = `http://127.0.0.1:${appPort}`;
      const deadline = Date.now() + startTimeoutMs;
      let ready = false;
      while (Date.now() < deadline && activeDualController.alive()) {
        const [fOk, bOk] = await Promise.all([
          probeApplicationUrl(targetUrl, { timeout: 600, allowNotFound: true }),
          probeApplicationUrl(backendUrl, { timeout: 600, allowNotFound: true }),
        ]);
        if (fOk && bOk) {
          ready = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      if (ready) {
        log(`[setup] Hedef uygulama hazır ve çalışıyor: ${targetUrl} (API: ${backendUrl})`);
        if (!options.noOpen) openBrowser(targetUrl);
      } else {
        log(`[setup] Hedef uygulama süreçleri başlatıldı (${targetUrl}).`);
      }
      if (!waitForExit) return { ok: true, url: targetUrl, backendPort: appPort, frontendPort, mode: "dual" };
      while (activeDualController && activeDualController.alive()) {
        await new Promise((r) => setTimeout(r, 500));
      }
      return { ok: true, url: targetUrl, backendPort: appPort, frontendPort, mode: "dual" };
    }

    if (inv.type === "static") {
      const targetUrl = `http://127.0.0.1:${appPort}`;
      activeStaticServer = createStaticAppServer(inv.staticDir);
      await new Promise((resolve, reject) => {
        activeStaticServer.once("error", reject);
        activeStaticServer.listen(appPort, "127.0.0.1", resolve);
      });
      log(`[setup] Statik hedef uygulama çalışıyor: ${targetUrl}`);
      if (!options.noOpen) openBrowser(targetUrl);
      if (!waitForExit) return { ok: true, url: targetUrl, port: appPort, mode: "static" };
      await new Promise((resolve) => activeStaticServer.once("close", resolve));
      return { ok: true, url: targetUrl, port: appPort, mode: "static" };
    }

    const finalInv = withApplicationPort(inv, appPort);
    const targetUrl = `http://127.0.0.1:${appPort}`;
    log(`[setup] Hedef uygulama başlatılıyor (${targetUrl})...`);
    let browserOpened = false;
    const probeLoop = (async () => {
      const deadline = Date.now() + startTimeoutMs;
      while (Date.now() < deadline && runner.running) {
        if (await probeApplicationUrl(targetUrl, { timeout: 600, allowNotFound: true })) {
          browserOpened = true;
          log(`[setup] Hedef uygulama hazır ve çalışıyor: ${targetUrl}`);
          if (!options.noOpen) openBrowser(targetUrl);
          return true;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      return false;
    })();

    const runPromise = run(finalInv, {
      cwd: finalInv.cwd || root,
      timeout: 0,
      env: { ...envVars, PORT: String(appPort) },
    });

    if (!waitForExit) {
      await Promise.race([probeLoop, runPromise]);
      return { ok: true, url: targetUrl, port: appPort, mode: "single", opened: browserOpened };
    }
    await runPromise;
    return { ok: true, url: targetUrl, port: appPort, mode: "single", opened: browserOpened };
  }

  async function startWizard({ reconfigure = options.reconfigure || false, killOccupant = false } = {}) {
    const current = status();
    if (!current.runtime.nodeSupported || !current.runtime.packageManagerSupported) throw new Error("Desteklenmeyen çalışma ortamı. Node.js >=18 ve geçerli bir paket yöneticisi gerekir.");
    if (current.installation.state === "installed" && !reconfigure) throw new Error("Uygulama zaten kurulu. Yeniden Yapılandır veya Temiz Kurulum seçin.");
    if (!reconfigure && (!packagesReady || (detection.scenario.requiresDependencies && config.install?.command !== null && !current.installation.dependencies.ready))) throw new Error("Paketler eksik. Önce Paketleri Kur / Onar adımını tamamlayın.");
    if (!Number.isInteger(current.wizardPort) || current.wizardPort < 1024 || current.wizardPort > 65535) throw new Error("Geçersiz sihirbaz portu (1024-65535).");
    prepare();
    if (await isLocalPortOpen(current.wizardPort, 400)) {
      if (!killOccupant) throw Object.assign(new Error(describePortConflict(current.wizardPort).message), { code: "WIZARD_PORT_BUSY" });
      const stop = stopPortProcess(current.wizardPort, { requireNodeOrSetupProcess: true });
      if (!stop.stopped) throw new Error(stop.message);
      for (let i = 0; i < 20 && await isLocalPortOpen(current.wizardPort, 100); i++) await new Promise((r) => setTimeout(r, 100));
      if (await isLocalPortOpen(current.wizardPort, 100)) throw new Error("Sihirbaz portu halen kullanımda. --port ile başka port seçin.");
    }
    let embedded;
    try { embedded = JSON.parse(fs.readFileSync(path.join(root, "server/package.json"), "utf8")); } catch {}
    let call = { command: process.execPath, args: [path.join(setupRoot, "wizard/server.mjs"), ...(reconfigure ? ["--reconfigure"] : [])] };
    const useEmbedded = embedded?.scripts?.setup && ["pnpm", "bun"].includes(pm);
    if (useEmbedded) {
      const extra = reconfigure ? ["--", "--reconfigure"] : [];
      call = invocation(pm, pm === "pnpm" ? ["--filter", embedded.name || "server", "run", "setup", ...extra] : ["run", "--filter", embedded.name || "server", "setup", ...extra]);
    }
    log("[setup] Web kurulum sihirbazı başlatılıyor. Terminali sihirbaz bitene kadar açık tutun.");
    await run(call, { wizard: true, reconfigure, ipc: !useEmbedded });
  }

  return { status, selectCandidate, refresh, prepare, install, reset, ensureDefaultEnvironment, startApp, startWizard, cancel: cancelAll };
}

function openBrowser(url) {
  let call;
  if (process.platform === "win32") call = { command: "cmd.exe", args: ["/d", "/s", "/c", "start", "", url] };
  else if (process.platform === "darwin") call = { command: "open", args: [url] };
  else if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) call = { command: "xdg-open", args: [url] };
  if (!call) return;
  const child = spawn(call.command, call.args, { detached: true, windowsHide: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}

function formatStepLine(step, index, s) {
  const num = index + 1;
  const isInstalled = s.installation.state === "installed";
  const isPartial = s.installation.state === "partial";
  const runtimeOk = Boolean(s.runtime.nodeSupported && s.runtime.packageManagerSupported);
  if (step.id === "precheck") {
    return runtimeOk
      ? `  [✓] ${num}. ${step.label} — Uygun`
      : `  [✗] ${num}. ${step.label} — Uyumsuz/Eksik`;
  }
  if (step.id === "ports") {
    return `  [✓] ${num}. ${step.label} — Hazır (Sihirbaz Portu: ${s.wizardPort})`;
  }
  if (step.id === "dependencies") {
    if (s.packagesReady) return `  [✓] ${num}. ${step.label} — Tamamlandı (Tekrar kurulum gerekmez)`;
    return `  [→] ${num}. ${step.label} — Sıradaki Adım (Seçenek 1)`;
  }
  if (step.id === "wizard") {
    if (isInstalled) return `  [✓] ${num}. ${step.label} — Tamamlandı`;
    if (s.packagesReady) return `  [→] ${num}. ${step.label} — Sıradaki Adım (Seçenek 2 veya 6)`;
    return `  [ ] ${num}. ${step.label} — Bekliyor (Önce 1. adımı tamamlayın)`;
  }
  if (step.id === "apply") {
    if (isInstalled) return `  [✓] ${num}. ${step.label} — Tamamlandı`;
    if (isPartial) return `  [!] ${num}. ${step.label} — Kısmi/Eski kurulum verisi mevcut`;
    return `  [ ] ${num}. ${step.label} — Bekliyor`;
  }
  if (step.id === "start") {
    if (isInstalled) return `  [✓] ${num}. ${step.label} — Kurulum Tamamlandı (Seçenek 6 ile başlatılabilir)`;
    return `  [ ] ${num}. ${step.label} — Bekliyor`;
  }
  if (step.id === "abort") {
    return `  [✗] ${num}. ${step.label}`;
  }
  return `  - ${step.label}`;
}

export function formatTerminalPanel(s) {
  const divider = "========================================================================";
  const subDivider = "------------------------------------------------------------------------";
  const stateLabel = {
    fresh: "Yeni kurulum",
    partial: "Yarım/eski kurulum",
    installed: "Uygulama zaten kurulu",
  }[s.installation.state] || s.installation.state;
  const pkgLabel = s.packagesReady ? "hazır" : "kurulum/onarım bekliyor";
  const foundList = Object.entries(s.installation.evidence)
    .filter(([, v]) => v)
    .map(([k]) => evidenceLabels[k] || k)
    .join(", ") || "Kurulum verisi yok";

  const repoDisplay = s.repositoryName && s.repositoryName !== s.project
    ? `${s.repositoryName} (${s.project})`
    : s.project;

  const lines = [
    "",
    divider,
    ` [setup] Hedef Proje: ${repoDisplay} | ${s.scenario.label}`,
    ...(s.scenario.summary ? [` ${s.scenario.summary}`] : []),
    subDivider,
    `Dizin: ${s.directory}`,
    `Sistem: ${s.platform} (${s.hostname})`,
    `Node.js: ${s.runtime.nodeVersion} (${s.runtime.nodeSupported ? "uygun" : "uyumsuz"}) | ${s.runtime.packageManager}: ${s.runtime.packageManagerVersion || "gerekmiyor/bulunamadı"} (${s.runtime.packageManagerSupported ? "uygun" : "eksik/uyumsuz"})`,
    `Durum: ${stateLabel} | Paketler: ${pkgLabel}`,
    `Bulunanlar: ${foundList}`,
  ];

  if (Array.isArray(s.modules) && s.modules.length > 0) {
    lines.push(
      subDivider,
      "HEDEF PROJE ALT MODÜLLERİ VE BİLEŞEN DURUMU:",
      ...s.modules.map((m) => {
        const mark = m.packagesReady ? "[✓]" : "[ ]";
        const pkgState = m.packagesReady ? "Paketler: hazır" : "Paketler: kurulum bekliyor";
        const envState = m.hasEnv ? " | .env: hazır" : (m.hasEnvExample ? " | .env: şablondan üretilecek" : "");
        return `  ${mark} ${m.dir === "." ? "root (ana dizin)" : m.dir} (${m.name}) — ${pkgState}${envState}`;
      }),
    );
  }

  lines.push(
    subDivider,
    "KURULUM ADIMLARI VE İLERLEME DURUMU:",
    ...s.plan.steps.map((step, idx) => formatStepLine(step, idx, s)),
  );

  if (!s.hasAmbiguity && s.plan.canInstall) {
    lines.push(subDivider);
    if (!s.runtime.nodeSupported || !s.runtime.packageManagerSupported) {
      lines.push("[UYARI] Çalışma ortamı gereksinimleri eksik. Node.js >=18 ve uygun paket yöneticisi kurulu olmalıdır.");
    } else if (s.installation.state === "installed") {
      lines.push("[BİLGİ] Bu uygulama zaten kurulmuş durumda. Tekrar kurulum yapmanıza gerek yoktur.");
      lines.push("[ÖNERİ] Uygulamayı hemen çalıştırmak için '6', mevcut ayarları güncellemek için '3', temiz kurulum için '5' seçeneğini kullanın.");
    } else if (s.packagesReady) {
      lines.push("[BİLGİ] Paket kurulumu tamamlanmış durumda. Paketleri tekrar kurmanıza gerek yoktur.");
      lines.push("[ÖNERİ] Web arayüzünden yapılandırıp başlatmak için '2', varsayılan .env ile doğrudan başlatmak için '6' seçeneğini girin.");
    } else {
      lines.push("[ÖNERİ] Kuruluma başlamak için önce '1' (Paketleri Kur / Onar) seçeneğini girin.");
    }

    const opt1Tag = s.packagesReady
      ? "[✓ Tamamlandı - Tekrar kurulum gerekmez]"
      : "[→ Sıradaki Adım - Bağımlılıkları kur]";
    const opt2Tag = s.installation.state === "installed"
      ? "[✓ Tamamlandı - Tekrar kurulum kapalı]"
      : s.packagesReady
        ? `[→ Sıradaki Adım - Port: ${s.wizardPort}]`
        : "[Bekliyor - Önce 1. adımı tamamlayın]";
    const opt3Tag = s.installation.state === "installed"
      ? "[→ Önerilen - Mevcut ayarları güncelle]"
      : "[Pasif - İlk kurulum sonrası aktif olur]";
    const opt4Tag = "[Durumu ve dosyaları tekrar kontrol et]";
    const opt5Tag = s.installation.state !== "fresh"
      ? "[Aktif - Yedek al ve kurulumu sıfırla]"
      : "[Pasif - Silinecek kurulum verisi yok]";
    const opt6Tag = s.packagesReady
      ? "[→ Hazır - Varsayılan .env ile hedef uygulamayı hemen başlat]"
      : "[Bekliyor - Önce 1. adımı tamamlayın]";

    lines.push(
      subDivider,
      "İŞLEM MENÜSÜ:",
      `1) Paketleri Kur / Onar              ${opt1Tag}`,
      `2) Kurulum Sihirbazına Geç           ${opt2Tag}`,
      `3) Yeniden Yapılandır                ${opt3Tag}`,
      `4) Yeniden Denetle                   ${opt4Tag}`,
      `5) Yedekle ve Temiz Kuruluma Geç     ${opt5Tag}`,
      `6) Uygulamayı Doğrudan Başlat        ${opt6Tag}`,
      "0) Çıkış",
      divider,
    );
  } else {
    lines.push(divider);
  }
  return lines.join("\n");
}

export async function runTerminalBootstrap(options = {}) {
  const output = options.output || process.stdout;
  const input = options.input || process.stdin;
  const log = (text) => output.write(`${text}\n`);
  const setup = createTerminalBootstrap({ ...options, log });
  if (options.checkOnly) { log(JSON.stringify(setup.status(), null, 2)); return; }
  const rl = createInterface({ input, crlfDelay: Infinity });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (question) => { output.write(question); const answer = await lines.next(); return answer.done ? null : answer.value.trim(); };
  let cancelled = false;
  const onSignal = (signal) => { cancelled = true; setup.cancel(); rl.close(); process.exitCode = signal === "SIGINT" ? 130 : 143; };
  const onExit = () => setup.cancel(true);
  const onInt = () => onSignal("SIGINT");
  const onTerm = () => onSignal("SIGTERM");
  const onHup = () => onSignal("SIGHUP");
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  process.on("SIGHUP", onHup);
  process.on("exit", onExit);
  try {
    while (!cancelled) {
      let s;
      try {
        s = setup.status();
      } catch (err) {
        log(`[HATA] Proje durumu okunurken beklenmeyen bir hata oluştu: ${err.message}`);
        return;
      }
      log(formatTerminalPanel(s));
      if (s.hasAmbiguity) {
        log("Birden fazla aday alt proje bulundu:");
        s.candidates.forEach((c, i) => log(`  ${i + 1}) ${c.name} (${c.dir}, ${c.role}, ${c.kind})`));
        const answer = await ask("Aday numarası veya dizini (0: çıkış): ");
        if (answer === null || answer === "0") return;
        try { setup.selectCandidate(s.candidates[Number(answer) - 1]?.dir || answer); } catch (err) { log(`[HATA] ${err.message}`); }
        continue;
      }
      if (!s.plan.canInstall) throw new Error("Bu dizinde kurulum planlanamadı. Geçerli proje bulunamadı.");
      const action = await ask("Seçiminiz (1-6 veya 0): ");
      if (action === null || action === "0") return;
      if (action === "") {
        log("[UYARI] Boş seçim yapıldı. Lütfen menüden geçerli bir seçenek girin (1-6 veya 0).");
        continue;
      }
      try {
        if (action === "1") {
          if (!s.runtime.nodeSupported || !s.runtime.packageManagerSupported) {
            throw new Error("Desteklenmeyen çalışma ortamı. Node.js >=18 ve geçerli bir paket yöneticisi gerekir.");
          }
          if (s.packagesReady && s.installation.dependencies?.ready) {
            log("[BİLGİ] Tüm paketler zaten kurulu ve doğrulandı. Tekrar kurulum yapılmasına gerek yoktur.");
            const confirmReinstall = await ask("Paketleri yine de yeniden doğrulamak / onarmak istiyor musunuz? [e/H]: ");
            if (!["e", "evet"].includes((confirmReinstall || "").toLowerCase())) {
              log("[BİLGİ] Paket kurulumu atlandı. Sıradaki adım için '2' (Kurulum Sihirbazına Geç) veya '6' (Uygulamayı Doğrudan Başlat) seçeneğini kullanabilirsiniz.");
              continue;
            }
          }
          await setup.install();
          log("[BAŞARILI] Paket kurulumu tamamlandı. Sıradaki adım: 2) Kurulum Sihirbazına Geç veya 6) Uygulamayı Doğrudan Başlat");
        } else if (action === "2" || action === "3") {
          let useReconfigure = action === "3" || Boolean(options.reconfigure);
          if (action === "2" && s.installation.state === "installed" && !useReconfigure) {
            log("[UYARI] Bu uygulama zaten kurulu (Kurulum kilidi mevcut). Sıfırdan kurulum tekrar yapılamaz.");
            const switchToReconf = await ask("Mevcut verileri koruyarak Yeniden Yapılandır (3. adım) moduna geçmek ister misiniz? [e/H]: ");
            if (!["e", "evet"].includes((switchToReconf || "").toLowerCase())) {
              log("[BİLGİ] İşlem iptal edildi. Temiz kurulum için 5) Yedekle ve Temiz Kuruluma Geç seçeneğini kullanabilirsiniz.");
              continue;
            }
            useReconfigure = true;
          }
          if (action === "3" && s.installation.state !== "installed" && !options.reconfigure) {
            throw new Error("Yeniden yapılandırma için mevcut kurulum gerekir. Önce 2) Kurulum Sihirbazına Geç adımını tamamlayın.");
          }
          if (!useReconfigure && !s.packagesReady) {
            throw new Error("Paketler eksik. Önce 1) Paketleri Kur / Onar adımını tamamlayın.");
          }
          try { await setup.startWizard({ reconfigure: useReconfigure }); }
          catch (err) {
            if (err.code !== "WIZARD_PORT_BUSY") throw err;
            log(`[UYARI] ${err.message}`);
            const answer = await ask("Portu kullanan doğrulanmış Node/kurulum süreci durdurulsun mu? [e/H]: ");
            if (!["e", "evet"].includes((answer || "").toLowerCase())) continue;
            await setup.startWizard({ reconfigure: useReconfigure, killOccupant: true });
          }
          return;
        } else if (action === "5") {
          if (s.installation.state === "fresh") {
            throw new Error("Temizlenecek mevcut veya yarım kurulum bulunamadı. Uygulama zaten temiz durumda.");
          }
          log("[UYARI] Mevcut .env, yerel veritabanı, oturumlar ve yüklenen dosyalar kaldırılır. Önce doğrulanmış yedek alınır. Uygulamayı durdurun.");
          const ack = await ask("Zorunlu yedeği ve verilerin kaldırılmasını onaylıyor musunuz? [e/H]: ");
          if (!["e", "evet"].includes((ack || "").toLowerCase())) {
            log("[BİLGİ] Temiz kurulum işlemi iptal edildi.");
            continue;
          }
          const confirmation = await ask(`Devam etmek için ${CLEAN_INSTALL_CONFIRMATION} yazın: `);
          await setup.reset({ backupAcknowledged: true, confirmation });
          log("[BAŞARILI] Mevcut kurulum yedeklendi ve sıfırlandı. Artık temiz kurulum yapabilirsiniz.");
        } else if (action === "4") {
          setup.refresh();
          log("[BİLGİ] Proje ve kurulum durumu yeniden denetlendi.");
        } else if (action === "6") {
          await setup.startApp({ waitForExit: options.waitForAppExit !== false });
          return;
        } else {
          log(`[UYARI] Geçersiz seçim: '${action}'. Geçerli bir seçenek girin (1-6 veya 0).`);
        }
      } catch (err) {
        log(`[HATA] ${err.message}`);
      }
    }
  } finally {
    setup.cancel(); rl.close();
    process.removeListener("SIGINT", onInt);
    process.removeListener("SIGTERM", onTerm);
    process.removeListener("SIGHUP", onHup);
    process.removeListener("exit", onExit);
  }
}
