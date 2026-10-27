import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { buildInstallPlan, detectProject, loadSetupConfig } from "./detect-project.mjs";
import { initProject } from "./setup-api.mjs";
import {
  CLEAN_INSTALL_CONFIRMATION, clearCommandAvailabilityCache, describePortConflict,
  inspectInstallationState, isLocalPortOpen, readConfiguredPort, resetInstallation,
  resolveDesktopDataDir, resolveEffectivePackageManager, stopPortProcess, validateRuntime,
} from "./setup-bootstrap-lib.mjs";
import { resolveLanguageProfile } from "./polyglot.mjs";
import { createProcessRunner, PACKAGE_MANAGERS, resolveCommandInvocation as invocation } from "./process-runner.mjs";
import { runSteps } from "./run-steps.mjs";
import { resolveProjectTarget, resolveWizardPort } from "./cli-options.mjs";

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
  const runner = createProcessRunner({ log });
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
      project: detection.projectName, directory: root, repositoryRoot, kind: detection.kind,
      scenario: detection.scenario, candidates: detection.candidates || [], hasAmbiguity: Boolean(detection.hasAmbiguity),
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
    fs.accessSync(root, fs.constants.W_OK);
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

  return { status, selectCandidate, refresh, prepare, install, reset, startWizard, cancel: runner.cancel };
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
      const s = setup.status();
      log(`\n[setup] ${s.project} | ${s.scenario.label}\n${s.scenario.summary || ""}\nDizin: ${s.directory}\nSistem: ${s.platform} (${s.hostname})\nNode.js: ${s.runtime.nodeVersion} (${s.runtime.nodeSupported ? "uygun" : "uyumsuz"}) | ${s.runtime.packageManager}: ${s.runtime.packageManagerVersion || "gerekmiyor/bulunamadı"} (${s.runtime.packageManagerSupported ? "uygun" : "eksik/uyumsuz"})`);
      log(`Durum: ${{ fresh: "Yeni kurulum", partial: "Yarım/eski kurulum", installed: "Uygulama zaten kurulu" }[s.installation.state]} | Paketler: ${s.packagesReady ? "hazır" : "kurulum/onarım bekliyor"}`);
      log(`Bulunanlar: ${Object.entries(s.installation.evidence).filter(([, v]) => v).map(([k]) => evidenceLabels[k] || k).join(", ") || "Kurulum verisi yok"}`);
      for (const step of s.plan.steps) log(`  - ${step.label}`);
      if (s.hasAmbiguity) {
        log("Birden fazla aday alt proje bulundu:");
        s.candidates.forEach((c, i) => log(`  ${i + 1}) ${c.name} (${c.dir}, ${c.role}, ${c.kind})`));
        const answer = await ask("Aday numarası veya dizini (0: çıkış): ");
        if (answer === null || answer === "0") return;
        try { setup.selectCandidate(s.candidates[Number(answer) - 1]?.dir || answer); } catch (err) { log(`[HATA] ${err.message}`); }
        continue;
      }
      if (!s.plan.canInstall) throw new Error("Bu dizinde kurulum planlanamadı. Geçerli proje bulunamadı.");
      log(`\n1) Paketleri Kur / Onar\n2) Kurulum Sihirbazına Geç${s.installation.state === "installed" ? "\n3) Yeniden Yapılandır" : ""}\n4) Yeniden Denetle${s.installation.state !== "fresh" ? "\n5) Yedekle ve Temiz Kuruluma Geç" : ""}\n0) Çıkış`);
      const action = await ask("Seçiminiz: ");
      if (action === null || action === "0") return;
      try {
        if (action === "1") {
          if (!s.runtime.nodeSupported || !s.runtime.packageManagerSupported) throw new Error("Desteklenmeyen çalışma ortamı. Node.js >=18 ve geçerli bir paket yöneticisi gerekir.");
          await setup.install();
        } else if (action === "2" || action === "3") {
          if (action === "3" && s.installation.state !== "installed" && !options.reconfigure) throw new Error("Yeniden yapılandırma için mevcut kurulum gerekir.");
          try { await setup.startWizard({ reconfigure: action === "3" || options.reconfigure }); }
          catch (err) {
            if (err.code !== "WIZARD_PORT_BUSY") throw err;
            log(err.message);
            const answer = await ask("Portu kullanan doğrulanmış Node/kurulum süreci durdurulsun mu? [e/H]: ");
            if (answer?.toLowerCase() !== "e") continue;
            await setup.startWizard({ reconfigure: action === "3" || options.reconfigure, killOccupant: true });
          }
          return;
        } else if (action === "5") {
          if (s.installation.state === "fresh") throw new Error("Temizlenecek mevcut veya yarım kurulum bulunamadı.");
          log("Mevcut .env, yerel veritabanı, oturumlar ve yüklenen dosyalar kaldırılır. Önce doğrulanmış yedek alınır. Uygulamayı durdurun.");
          const ack = await ask("Zorunlu yedeği ve verilerin kaldırılmasını onaylıyor musunuz? [e/H]: ");
          if (ack?.toLowerCase() !== "e") continue;
          const confirmation = await ask(`Devam etmek için ${CLEAN_INSTALL_CONFIRMATION} yazın: `);
          await setup.reset({ backupAcknowledged: true, confirmation });
        } else if (action === "4") setup.refresh();
        else log("Geçerli bir seçenek girin.");
      } catch (err) { log(`[HATA] ${err.message}`); }
    }
  } finally {
    setup.cancel(); rl.close();
    process.removeListener("SIGINT", onInt);
    process.removeListener("SIGTERM", onTerm);
    process.removeListener("SIGHUP", onHup);
    process.removeListener("exit", onExit);
  }
}
