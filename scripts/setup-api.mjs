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
 * @param {{ overwrite?: boolean, updatePackageJson?: boolean }} options
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
  const pkgPath = path.join(resolved, "package.json");
  if (options.updatePackageJson && fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      pkg.scripts = pkg.scripts || {};
      if (!pkg.scripts.setup) {
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
