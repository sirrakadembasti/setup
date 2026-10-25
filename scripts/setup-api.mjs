/**
 * setup — Bağımsız GitHub Uygulama Kurulum Eklentisi API (v1.0)
 * Uygulama içinden: import { detectProject, buildInstallPlan, initProject, inspect } from "setup"
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildInstallPlan, detectPackageManager, detectProject, detectScenarioProfile, DEFAULT_PORTS, loadSetupConfig, parseEnvExample } from "./detect-project.mjs";
import { resolveLanguageProfile } from "./polyglot.mjs";
import { getVersion, parseSemver } from "./version.mjs";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const setupRoot = path.resolve(scriptRoot, "..");

export { buildInstallPlan, detectPackageManager, detectProject, detectScenarioProfile, DEFAULT_PORTS, loadSetupConfig, parseEnvExample };
export { getVersion, parseSemver };
export {
  CLEAN_INSTALL_CONFIRMATION,
  checkDependencies,
  describePortConflict,
  findListeningProcess,
  getSetupPaths,
  inspectInstallationState,
  isLocalPortOpen,
  readConfiguredPort,
  resetInstallation,
  stopPortProcess,
  validateRuntime,
} from "./setup-bootstrap-lib.mjs";
export {
  createSetupWizardCore,
  mountSetupGuard,
  parseEnvFile,
  readSetupRuntimeConfig,
  verifyAdminCredentials,
} from "../wizard/core.mjs";

/**
 * Hızlı kurulum ön kontrolü.
 * @param {string} root
 */
export async function inspect(root = process.cwd()) {
  const detection = detectProject(root);
  const plan = buildInstallPlan(detection);
  return { version: getVersion(), detection, plan };
}

/**
 * Hedef projeye çift tıklanabilir kurulum.bat / kurulum.sh başlatıcılarını yazar.
 * Mevcut dosyaların üzerine yalnız overwrite=true ise yazılır.
 * @returns {{changed: boolean, backups: string[]}} değişiklik ve yedek bilgileri
 */
function writeLaunchers(resolved, overwrite, backup = false) {
  const result = { changed: false, backups: [] };
  for (const extension of ["bat", "sh"]) {
    const fileName = `kurulum.${extension}`;
    const destination = path.join(resolved, fileName);
    const source = fs.readFileSync(path.join(setupRoot, "bin", fileName), "utf8").replace(/^\uFEFF/, "");
    const marker = extension === "bat" ? 'set "LAUNCHER_MODE=package"' : "LAUNCHER_MODE=package";
    if (!source.includes(marker)) throw new Error(`Başlatıcı şablonu geçersiz: ${fileName}`);
    let content = source.replace(marker, extension === "bat" ? 'set "LAUNCHER_MODE=project"' : "LAUNCHER_MODE=project");
    content = extension === "bat" ? content.replace(/\r?\n/g, "\r\n") : content.replace(/\r\n/g, "\n");
    const exists = fs.existsSync(destination);
    if (exists && !overwrite) continue;
    if (exists && fs.readFileSync(destination, "utf8") === content) continue;
    if (exists && backup) {
      const backupFile = `${destination}.${Date.now()}.bak`;
      fs.copyFileSync(destination, backupFile, fs.constants.COPYFILE_EXCL);
      result.backups.push(backupFile);
    }
    fs.writeFileSync(destination, content, { encoding: "utf8", mode: extension === "sh" ? 0o755 : 0o644 });
    if (extension === "sh") { try { fs.chmodSync(destination, 0o755); } catch {} }
    result.changed = true;
  }
  return result;
}
/**
 * Herhangi bir GitHub reposuna setup.config.json yapılandırmasını ve
 * isteğe bağlı package.json kurulum betiklerini entegre eder.
 * @param {string} root
 * @param {{ overwrite?: boolean, updatePackageJson?: boolean, createLaunchers?: boolean, setupBin?: string, copyTools?: boolean, refreshLaunchers?: boolean }} options
 * `createLaunchers` varsayılan olarak açıktır (kapatmak için false); `updatePackageJson` varsayılan olarak kapalıdır.
 */
export function initProject(root = process.cwd(), options = {}) {
  const resolved = path.resolve(root);
  const detection = detectProject(resolved);
  const configPath = path.join(resolved, "setup.config.json");

  let toolsCopied = false;
  if (options.copyTools && resolved !== setupRoot) {
    const targetToolsDir = path.join(resolved, "tools", "setup");
    fs.mkdirSync(targetToolsDir, { recursive: true });
    const canonical = (value) => process.platform === "win32" ? fs.realpathSync(value).toLowerCase() : fs.realpathSync(value);
    const copyingItself = canonical(targetToolsDir) === canonical(setupRoot);
    const items = copyingItself ? [] : ["bin", "scripts", "wizard", "utils", "templates", "CHANGELOG.md", "README.md", "ENTEGRASYON.md", "package.json", "VERSION"];
    for (const item of items) {
      const src = path.join(setupRoot, item);
      const dst = path.join(targetToolsDir, item);
      if (fs.existsSync(src)) {
        fs.cpSync(src, dst, { recursive: true, force: true });
      }
    }
    toolsCopied = !copyingItself;
  }

  if (fs.existsSync(configPath) && !options.overwrite) {
    const launcherResult = options.createLaunchers === false ? { changed: false, backups: [] } : writeLaunchers(resolved, Boolean(options.refreshLaunchers), Boolean(options.refreshLaunchers));
    const launchersCreated = launcherResult.changed;
    return {
      created: false,
      configPath,
      launchersCreated,
      launcherBackups: launcherResult.backups,
      toolsCopied,
      detection,
      message: launchersCreated
        ? "setup.config.json korundu; başlatıcılar (kurulum.bat / kurulum.sh) oluşturuldu veya yenilendi."
        : "setup.config.json zaten mevcut. Üzerine yazmak için --force kullanın.",
    };
  }

  const pm = detection.packageManager || "npm";
  const installArgs = ["install"];
  const hasServerSubdir = detection.stack.hasServerSubdir;
  const envPath = hasServerSubdir ? "server/.env" : ".env";
  const dataDir = hasServerSubdir ? "server/data" : "data";
  const lockFile = `${dataDir}/installation.lock`;

  const pkgPath = path.join(resolved, "package.json");
  let existingPkg = null;
  if (fs.existsSync(pkgPath)) {
    try {
      existingPkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    } catch {
      existingPkg = null;
    }
  }

  const exists = (rootDir, ...parts) => fs.existsSync(path.join(rootDir, ...parts));
  let install = {
    command: pm,
    args: installArgs,
    requireWorkspaces: detection.workspaces.isWorkspace,
  };
  if (detection.subprojects && !existingPkg) {
    const steps = [];
    for (const [role, sub] of Object.entries(detection.subprojects)) {
      if (sub?.dir) {
        steps.push({
          label: `${sub.name || role} bağımlılıklarını kur (${pm} install)`,
          command: pm,
          args: ["--prefix", sub.dir, "install"],
        });
      }
    }
    if (steps.length > 0) {
      install.steps = steps;
    }
  }
  let start = null;

  const languageProfile = resolveLanguageProfile(resolved, detection.kind, detection.ports.app);
  if (languageProfile) {
    const [primary] = languageProfile.steps.filter((step) => !step.skipIfExists);
    const hasNodeDeps = existingPkg && (
      (existingPkg.dependencies && Object.keys(existingPkg.dependencies).length > 0) ||
      (existingPkg.devDependencies && Object.keys(existingPkg.devDependencies).length > 0)
    );
    const steps = [...languageProfile.steps];
    if (hasNodeDeps) {
      steps.push({
        label: `Node paketlerini kur (${pm} install)`,
        command: pm,
        args: installArgs,
      });
    }
    install = {
      command: primary.command,
      args: primary.args,
      steps,
      requireWorkspaces: false,
    };
    start = languageProfile.start;
  } else if (detection.kind === "static-web") {
    install = {
      command: null,
      args: [],
      requireWorkspaces: false,
    };
    start = {
      command: "static",
      args: ["."],
    };
  } else if (detection.stack.electron || detection.stack.tauri) {
    const scripts = existingPkg?.scripts || {};
    if (detection.stack.tauri && scripts.tauri) {
      start = { command: pm, args: ["run", "tauri", "dev"] };
    } else if (scripts.start) {
      start = { command: pm, args: ["run", "start"] };
    } else if (detection.stack.electron) {
      start = { command: "npx", args: ["electron", "."] };
    } else if (scripts.dev) {
      start = { command: pm, args: ["run", "dev"] };
    }
  } else if (existingPkg?.scripts?.start) {
    start = {
      command: pm,
      args: ["run", "start"],
    };
  } else if (existingPkg?.scripts?.preview) {
    start = {
      command: pm,
      args: ["run", "preview"],
    };
  }

  const config = {
    name: detection.projectName,
    version: "1.0.0",
    description: `${detection.projectName} otomatik kurulum yapılandırması`,
    scenario: {
      id: detection.scenario.id,
      number: detection.scenario.number,
      label: detection.scenario.label,
    },
    packageManager: pm,
    ports: {
      bootstrap: detection.ports.bootstrap,
      wizard: detection.ports.wizard,
      app: detection.ports.app,
    },
    install,
    ...(start ? { start } : {}),
    wizard: {
      enabled: true,
      title: `${detection.projectName} Kurulum Sihirbazı`,
    },
    paths: {
      env: envPath,
      dataDir,
      lockFile,
    },
  };

  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  let packageJsonUpdated = false;
  if (options.updatePackageJson && existingPkg) {
    try {
      const pkg = existingPkg;
      pkg.scripts = pkg.scripts || {};
      const setupRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
      const relSetupRoot = path.relative(resolved, setupRoot);
      const isEmbeddedSubdir =
        setupRoot !== resolved &&
        relSetupRoot !== "" &&
        !relSetupRoot.startsWith("..") &&
        !path.isAbsolute(relSetupRoot);

      if (typeof options.setupBin === "string" && options.setupBin.trim()) {
        const binPath = options.setupBin.trim().replaceAll("\\", "/");
        if (!pkg.scripts.setup) {
          pkg.scripts.setup = `node ${binPath}`;
          packageJsonUpdated = true;
        }
        if (!pkg.scripts.wizard) {
          pkg.scripts.wizard = `node ${binPath} wizard`;
          packageJsonUpdated = true;
        }
      } else if (isEmbeddedSubdir) {
        const relBin = path.relative(resolved, path.join(setupRoot, "bin", "setup.mjs")).replaceAll(path.sep, "/");
        if (!pkg.scripts.setup) {
          pkg.scripts.setup = `node ${relBin} setup`;
          packageJsonUpdated = true;
        }
        if (!pkg.scripts.wizard) {
          pkg.scripts.wizard = `node ${relBin} wizard`;
          packageJsonUpdated = true;
        }
      } else if (!pkg.scripts.setup) {
        pkg.scripts.setup = "setup";
        packageJsonUpdated = true;
      }

      if (packageJsonUpdated) {
        fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
      }
    } catch {
      /* package.json güncellenemedi */
    }
  }

  const launcherResult = options.createLaunchers === false ? { changed: false, backups: [] } : writeLaunchers(resolved, Boolean(options.overwrite || options.refreshLaunchers), Boolean(options.refreshLaunchers));
  const launchersCreated = launcherResult.changed;

  return {
    created: true,
    configPath,
    packageJsonUpdated,
    launchersCreated,
    launcherBackups: launcherResult.backups,
    toolsCopied,
    config,
    detection,
    message: `setup.config.json oluşturuldu (${configPath}).`,
  };
}
