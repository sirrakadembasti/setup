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
 * @returns {boolean} en az bir başlatıcı yazıldıysa true
 */
function writeLaunchers(resolved, overwrite) {
  let launchersCreated = false;
  const batPath = path.join(resolved, "kurulum.bat");
  const shPath = path.join(resolved, "kurulum.sh");
  if (!fs.existsSync(batPath) || overwrite) {
    const batContent = [
      "@echo off",
      "setlocal EnableExtensions",
      "chcp 65001 >nul",
      "cd /d \"%~dp0\"",
      "set \"JS_RUNNER=node\"",
      "where node >nul 2>&1",
      "if errorlevel 1 (",
      "  where bun >nul 2>&1",
      "  if not errorlevel 1 set \"JS_RUNNER=bun\"",
      ")",
      "if exist \"tools\\setup\\bin\\setup.mjs\" (",
      "  %JS_RUNNER% \"tools\\setup\\bin\\setup.mjs\" %*",
      ") else if exist \"node_modules\\setup\\bin\\setup.mjs\" (",
      "  %JS_RUNNER% \"node_modules\\setup\\bin\\setup.mjs\" %*",
      ") else (",
      "  where npx >nul 2>&1",
      "  if not errorlevel 1 (",
      "    npx --yes github:sirrakadembasti/setup %*",
      "  ) else (",
      "    where bunx >nul 2>&1",
      "    if not errorlevel 1 (",
      "      bunx github:sirrakadembasti/setup %*",
      "    ) else (",
      "      echo [HATA] setup calistirmak icin npx [Node.js] veya bunx [Bun] gereklidir.",
      "      echo Node.js: https://nodejs.org",
      "      echo Bun:     https://bun.sh",
      "      pause",
      "      exit /b 1",
      "    )",
      "  )",
      ")",
      "if not errorlevel 1 goto :end",
      "echo.",
      "echo ============================================================",
      "echo [HATA] Kurulum baslatilamadi [Hata kodu: %errorlevel%].",
      "echo.",
      "echo Bu durum genellikle sirket agindaki SSL veya guvenlik duvari",
      "echo GitHub'dan indirmeyi engellediginde olusur.",
      "echo.",
      "echo COZUM [Cevrimdisi / Offline Kullanim]:",
      "echo   1. setup klasorunu bu projenin icine 'tools\\setup' olarak kopyalayin.",
      "echo   2. kurulum.bat dosyasini yeniden calistirin.",
      "echo ============================================================",
      "pause",
      "exit /b %errorlevel%",
      "",
      ":end",
      "exit /b 0",
      "",
    ].join("\r\n");
    fs.writeFileSync(batPath, batContent, "utf8");
    launchersCreated = true;
  }
  if (!fs.existsSync(shPath) || overwrite) {
    const shContent = [
      "#!/usr/bin/env sh",
      "set -u",
      "cd \"$(dirname \"$0\")\" || exit 1",
      "JS_RUNNER=\"node\"",
      "if ! command -v node >/dev/null 2>&1 && command -v bun >/dev/null 2>&1; then",
      "  JS_RUNNER=\"bun\"",
      "fi",
      "if [ -f \"tools/setup/bin/setup.mjs\" ]; then",
      "  exec \"$JS_RUNNER\" \"tools/setup/bin/setup.mjs\" \"$@\"",
      "elif [ -f \"node_modules/setup/bin/setup.mjs\" ]; then",
      "  exec \"$JS_RUNNER\" \"node_modules/setup/bin/setup.mjs\" \"$@\"",
      "elif command -v npx >/dev/null 2>&1; then",
      "  exec npx --yes github:sirrakadembasti/setup \"$@\"",
      "elif command -v bunx >/dev/null 2>&1; then",
      "  exec bunx github:sirrakadembasti/setup \"$@\"",
      "else",
      "  printf '%s\\n' '[HATA] setup çalıştırmak için npx (Node.js) veya bunx (Bun) gereklidir.' >&2",
      "  printf '%s\\n' 'Node.js: https://nodejs.org' >&2",
      "  printf '%s\\n' 'Bun:     https://bun.sh' >&2",
      "  exit 1",
      "fi",
      "if [ $? -ne 0 ]; then",
      "  printf '\\n%s\\n' '============================================================'",
      "  printf '%s\\n' '[HATA] Kurulum başlatılamadı.'",
      "  printf '%s\\n' 'GitHub indirmesi başarısız olduysa setup klasörünü projenize'",
      "  printf '%s\\n' \"'tools/setup' olarak kopyalayıp tekrar deneyiniz.\"",
      "  printf '%s\\n' '============================================================'",
      "  exit 1",
      "fi",
      "",
    ].join("\n");
    fs.writeFileSync(shPath, shContent, { encoding: "utf8", mode: 0o755 });
    try {
      fs.chmodSync(shPath, 0o755);
    } catch {
      /* Windows'ta chmod göz ardı edilir */
    }
    launchersCreated = true;
  }
  return launchersCreated;
}

/**
 * Herhangi bir GitHub reposuna setup.config.json yapılandırmasını ve
 * isteğe bağlı package.json kurulum betiklerini entegre eder.
 * @param {string} root
 * @param {{ overwrite?: boolean, updatePackageJson?: boolean, createLaunchers?: boolean, setupBin?: string }} options
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
    const items = ["bin", "scripts", "wizard", "utils", "CHANGELOG.md", "README.md", "ENTEGRASYON.md", "package.json", "VERSION"];
    for (const item of items) {
      const src = path.join(setupRoot, item);
      const dst = path.join(targetToolsDir, item);
      if (fs.existsSync(src)) {
        fs.cpSync(src, dst, { recursive: true, force: true });
      }
    }
    toolsCopied = true;
  }

  if (fs.existsSync(configPath) && !options.overwrite) {
    const launchersCreated = options.createLaunchers === false ? false : writeLaunchers(resolved, false);
    return {
      created: false,
      configPath,
      launchersCreated,
      toolsCopied,
      detection,
      message: launchersCreated
        ? "setup.config.json zaten mevcut; eksik başlatıcılar (kurulum.bat / kurulum.sh) eklendi. Yapılandırmanın üzerine yazmak için --force kullanın."
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

  const launchersCreated = options.createLaunchers === false ? false : writeLaunchers(resolved, Boolean(options.overwrite));

  return {
    created: true,
    configPath,
    packageJsonUpdated,
    launchersCreated,
    toolsCopied,
    config,
    detection,
    message: `setup.config.json oluşturuldu (${configPath}).`,
  };
}
