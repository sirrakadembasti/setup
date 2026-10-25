import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { detectProject } from "./detect-project.mjs";

export function resolveWizardPort({ port, config = {}, env = process.env } = {}) {
  const value = Number(port ?? env.SETUP_WIZARD_PORT ?? env.SETUP_PORT ?? config.ports?.wizard ?? 5050);
  if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new Error("Geçersiz sihirbaz portu (1024-65535).");
  return value;
}

export function resolveProjectTarget(root, candidate) {
  const repositoryRoot = path.resolve(root);
  const assertInside = (target) => {
    const relative = path.relative(fs.realpathSync(repositoryRoot), fs.realpathSync(target));
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Aday proje depo dizini içinde olmalıdır.");
  };
  if (candidate) {
    const requested = path.resolve(repositoryRoot, candidate);
    if (!fs.existsSync(requested) || !fs.statSync(requested).isDirectory()) throw new Error("Geçerli bir aday alt proje seçin.");
    assertInside(requested);
  }
  const found = detectProject(repositoryRoot, { candidate });
  const effectiveRoot = found.candidateRoot ? path.resolve(repositoryRoot, found.candidateRoot) : repositoryRoot;
  assertInside(effectiveRoot);
  return { root: effectiveRoot, repositoryRoot, detection: effectiveRoot === repositoryRoot ? found : detectProject(effectiveRoot, { _internal: true }) };
}

export function checkDirectoryWritability(dirPath) {
  try {
    const target = path.resolve(dirPath);
    if (!fs.existsSync(target)) {
      const parent = path.dirname(target);
      fs.accessSync(parent, fs.constants.W_OK);
      return { writable: true, exists: false };
    }
    fs.accessSync(target, fs.constants.W_OK);
    return { writable: true, exists: true };
  } catch (err) {
    return { writable: false, error: err.message, code: err.code };
  }
}

const VALID_COMMANDS = new Set(["detect", "plan", "setup", "wizard", "init", "version", "help"]);

export function parseArgs(argv) {
  const args = { command: "setup", root: path.resolve(process.env.SETUP_PROJECT_ROOT || process.cwd()), candidate: null, force: false, launchers: true, refreshLaunchers: false, updatePackageJson: false, copyTools: false, port: null, dataDir: null, reconfigure: ["true", "1"].includes(process.env.SETUP_RECONFIGURE), noOpen: false, checkOnly: false, error: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--root") {
      const next = argv[i + 1];
      if (!next || next.startsWith("-")) {
        args.error = "--root seçeneği için geçerli bir dizin yolu belirtilmelidir.";
        return args;
      }
      args.root = path.resolve(argv[++i]);
    } else if (a === "--candidate") {
      const next = argv[i + 1];
      if (!next || next.startsWith("-")) {
        args.error = "--candidate seçeneği için geçerli bir alt proje dizini veya adı belirtilmelidir.";
        return args;
      }
      args.candidate = argv[++i];
    } else if (a === "--port") {
      const next = argv[i + 1];
      const portNum = Number(next);
      if (!next || next.startsWith("-") || !Number.isInteger(portNum) || portNum < 1024 || portNum > 65535) {
        args.error = "--port seçeneği için geçerli bir port numarası (1024-65535) belirtilmelidir.";
        return args;
      }
      args.port = portNum;
      i += 1;
    } else if (a === "--data-dir") {
      const next = argv[i + 1];
      if (!next || next.startsWith("-")) {
        args.error = "--data-dir seçeneği için geçerli bir dizin yolu belirtilmelidir.";
        return args;
      }
      args.dataDir = path.resolve(argv[++i]);
    } else if (a === "--launchers") {
      args.launchers = true;
    } else if (a === "--no-launchers") {
      args.launchers = false;
    } else if (a === "--refresh-launchers") {
      args.refreshLaunchers = true;
    } else if (a === "--no-open") {
      args.noOpen = true;
    } else if (a === "--check-only") {
      args.checkOnly = true;
    } else if (a === "--update-package-json") {
      args.updatePackageJson = true;
    } else if (a === "--reconfigure") {
      args.reconfigure = true;
    } else if (a === "--help" || a === "-h") {
      args.command = "help";
    } else if (a === "--version" || a === "-v") {
      args.command = "version";
    } else if (a === "--force" || a === "-f") {
      args.force = true;
    } else if (a === "--copy-tools" || a === "--tools" || a === "--offline") {
      args.copyTools = true;
    } else if (VALID_COMMANDS.has(a)) {
      args.command = a;
    } else {
      args.error = `Bilinmeyen komut veya seçenek: ${a}`;
      return args;
    }
  }
  if (args.checkOnly && !["setup", "wizard", "detect", "plan"].includes(args.command)) args.error = "--check-only yalnız setup, wizard, detect veya plan ile kullanılabilir.";
  if (args.refreshLaunchers && args.command !== "init") args.error = "--refresh-launchers yalnız init ile kullanılabilir.";
  return args;
}
