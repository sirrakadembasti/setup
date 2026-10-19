/**
 * setup — Bağımsız GitHub Uygulama Kurulum Eklentisi API (v1.0)
 * Uygulama içinden: import { detectProject, buildInstallPlan, initProject, inspect } from "setup"
 */
import fs from "node:fs";
import path from "node:path";
import { buildInstallPlan, detectPackageManager, detectProject, DEFAULT_PORTS, loadSetupConfig, parseEnvExample } from "./detect-project.mjs";
import { getVersion, parseSemver } from "./version.mjs";

export { buildInstallPlan, detectPackageManager, detectProject, DEFAULT_PORTS, loadSetupConfig, parseEnvExample };
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

  const config = {
    name: detection.projectName,
    version: "1.0.0",
    description: `${detection.projectName} otomatik kurulum yapılandırması`,
    packageManager: pm,
    ports: {
      bootstrap: detection.ports.bootstrap,
      wizard: detection.ports.wizard,
      app: detection.ports.app,
    },
    install: {
      command: pm,
      args: installArgs,
      requireWorkspaces: detection.workspaces.isWorkspace,
    },
    ...(existingPkg?.scripts?.start
      ? {
          start: {
            command: pm,
            args: ["run", "start"],
          },
        }
      : {}),
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

  return {
    created: true,
    configPath,
    packageJsonUpdated,
    config,
    detection,
    message: `setup.config.json oluşturuldu (${configPath}).`,
  };
}
