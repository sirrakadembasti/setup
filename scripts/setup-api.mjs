/**
 * setup — Bağımsız GitHub Uygulama Kurulum Eklentisi API (v1.0)
 * Uygulama içinden: import { detectProject, buildInstallPlan, initProject, inspect } from "setup"
 */
import fs from "node:fs";
import path from "node:path";
import { buildInstallPlan, detectPackageManager, detectProject, detectScenarioProfile, DEFAULT_PORTS, loadSetupConfig, parseEnvExample } from "./detect-project.mjs";
import { getVersion, parseSemver } from "./version.mjs";

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
 * Herhangi bir GitHub reposuna setup.config.json yapılandırmasını ve
 * isteğe bağlı package.json kurulum betiklerini entegre eder.
 * @param {string} root
 * @param {{ overwrite?: boolean, updatePackageJson?: boolean, setupBin?: string }} options
 */
export function initProject(root = process.cwd(), options = {}) {
  const resolved = path.resolve(root);
  const detection = detectProject(resolved);
  const configPath = path.join(resolved, "setup.config.json");

  if (fs.existsSync(configPath) && !options.overwrite) {
    return {
      created: false,
      configPath,
      detection,
      message: "setup.config.json zaten mevcut. Üzerine yazmak için --force kullanın.",
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
  let start = null;

  if (detection.kind === "python-server") {
    install = {
      command: "pip",
      args: exists(resolved, "requirements.txt") ? ["install", "-r", "requirements.txt"] : ["install", "-e", "."],
      requireWorkspaces: false,
    };
    start = {
      command: "python",
      args: exists(resolved, "manage.py") ? ["manage.py", "runserver", `127.0.0.1:${detection.ports.app}`] : ["app.py"],
    };
  } else if (detection.kind === "go-server") {
    install = {
      command: "go",
      args: ["mod", "download"],
      requireWorkspaces: false,
    };
    start = {
      command: "go",
      args: ["run", "."],
    };
  } else if (detection.kind === "dotnet-server") {
    install = {
      command: "dotnet",
      args: ["restore"],
      requireWorkspaces: false,
    };
    start = {
      command: "dotnet",
      args: ["run", "--urls", `http://127.0.0.1:${detection.ports.app}`],
    };
  } else if (detection.kind === "php-server") {
    install = {
      command: "composer",
      args: ["install"],
      requireWorkspaces: false,
    };
    start = {
      command: "php",
      args: ["-S", `127.0.0.1:${detection.ports.app}`],
    };
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

  let launchersCreated = false;
  if (options.createLaunchers === true) {
    const batPath = path.join(resolved, "kurulum.bat");
    const shPath = path.join(resolved, "kurulum.sh");
    if (!fs.existsSync(batPath) || options.overwrite) {
      const batContent = [
        "@echo off",
        "setlocal EnableExtensions",
        "chcp 65001 >nul",
        "cd /d \"%~dp0\"",
        "if exist \"tools\\setup\\bin\\setup.mjs\" (",
        "  node \"tools\\setup\\bin\\setup.mjs\" %*",
        ") else if exist \"node_modules\\setup\\bin\\setup.mjs\" (",
        "  node \"node_modules\\setup\\bin\\setup.mjs\" %*",
        ") else (",
        "  npx --yes github:sirrakadembasti/setup %*",
        ")",
        "",
      ].join("\r\n");
      fs.writeFileSync(batPath, batContent, "utf8");
      launchersCreated = true;
    }
    if (!fs.existsSync(shPath) || options.overwrite) {
      const shContent = [
        "#!/usr/bin/env sh",
        "set -u",
        "cd \"$(dirname \"$0\")\" || exit 1",
        "if [ -f \"tools/setup/bin/setup.mjs\" ]; then",
        "  exec node \"tools/setup/bin/setup.mjs\" \"$@\"",
        "elif [ -f \"node_modules/setup/bin/setup.mjs\" ]; then",
        "  exec node \"node_modules/setup/bin/setup.mjs\" \"$@\"",
        "else",
        "  exec npx --yes github:sirrakadembasti/setup \"$@\"",
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
  }

  return {
    created: true,
    configPath,
    packageJsonUpdated,
    launchersCreated,
    config,
    detection,
    message: `setup.config.json oluşturuldu (${configPath}).`,
  };
}
