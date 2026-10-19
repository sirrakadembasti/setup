import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

export const SUPPORTED_NODE_MAJORS = Object.freeze([18, 20, 22, 24]);
export const CLEAN_INSTALL_CONFIRMATION = "SETUP VERİLERİNİ SİL";

function isInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertInside(parent, target) {
  if (!isInside(parent, target)) {
    throw new Error(`Güvenli dizin sınırı ihlali: ${target}`);
  }
}

/**
 * Hedef projenin tek dizinli (root) mi yoksa server/ alt dizinli mi olduğunu algılar
 * ve tüm kurulum/veri yollarını güvenli biçimde döndürür.
 */
export function getSetupPaths(projectRoot, options = {}) {
  const root = path.resolve(projectRoot);
  let rootSetupConfig = null;
  const rootConfigPath = path.join(root, "setup.config.json");
  if (fs.existsSync(rootConfigPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(rootConfigPath, "utf8"));
      if (parsed && typeof parsed === "object") rootSetupConfig = parsed;
    } catch {
      rootSetupConfig = null;
    }
  }
  const hasServerSubdir =
    fs.existsSync(path.join(root, "server", "package.json")) ||
    fs.existsSync(path.join(root, "server", "data")) ||
    fs.existsSync(path.join(root, "server", ".env"));
  const baseServiceDir = hasServerSubdir ? path.join(root, "server") : root;
  const cfgPaths = rootSetupConfig?.paths;
  const customDataDir = typeof cfgPaths?.dataDir === "string" && cfgPaths.dataDir.trim() ? cfgPaths.dataDir.trim() : null;
  const customEnv = typeof cfgPaths?.env === "string" && cfgPaths.env.trim() ? cfgPaths.env.trim() : null;
  const customLock = typeof cfgPaths?.lockFile === "string" && cfgPaths.lockFile.trim() ? cfgPaths.lockFile.trim() : null;

  if (customDataDir) assertInside(root, path.resolve(root, customDataDir));
  if (customEnv) assertInside(root, path.resolve(root, customEnv));
  if (customLock) assertInside(root, path.resolve(root, customLock));

  const externalDataDir = options.dataDir || process.env.SETUP_DATA_DIR || null;
  const resolvedExternalData = externalDataDir ? path.resolve(root, externalDataDir) : null;
  const isExternalOutsideRoot = Boolean(resolvedExternalData && !isInside(root, resolvedExternalData));

  const dataRoot = resolvedExternalData
    ? resolvedExternalData
    : customDataDir
      ? path.resolve(root, customDataDir)
      : path.join(baseServiceDir, "data");
  const uploadsRoot = path.join(baseServiceDir, "uploads");
  const backupsRoot = path.join(baseServiceDir, "backups");
  const env = customEnv
    ? path.resolve(root, customEnv)
    : isExternalOutsideRoot
      ? path.join(resolvedExternalData, ".env")
      : path.join(baseServiceDir, ".env");
  const lock = customLock ? path.resolve(root, customLock) : path.join(dataRoot, "installation.lock");
  const databaseUrl = hasServerSubdir ? "file:../data/app.db" : "file:./data/app.db";

  const values = {
    projectRoot: root,
    hasServerSubdir,
    serverRoot: baseServiceDir,
    dataRoot,
    uploadsRoot,
    backupsRoot,
    env,
    rootEnv: path.join(root, ".env"),
    databaseUrl,
    appDb: path.join(dataRoot, "app.db"),
    appDbWal: path.join(dataRoot, "app.db-wal"),
    appDbShm: path.join(dataRoot, "app.db-shm"),
    appDbJournal: path.join(dataRoot, "app.db-journal"),
    sessionsDb: path.join(dataRoot, "sessions.db"),
    sessionsDbWal: path.join(dataRoot, "sessions.db-wal"),
    sessionsDbShm: path.join(dataRoot, "sessions.db-shm"),
    sessionsDbJournal: path.join(dataRoot, "sessions.db-journal"),
    lock,
    pending: path.join(dataRoot, "installation.pending"),
    deploymentConfig: path.join(dataRoot, "deployment-config.json"),
    deploymentConfigTemp: path.join(dataRoot, "deployment-config.json.tmp"),
    adminConfig: path.join(dataRoot, "admin.json"),
    setupArtifacts: path.join(dataRoot, "setup-artifacts"),
    nodeModules: path.join(root, "node_modules"),
    pnpmStore: path.join(root, "node_modules", ".pnpm"),
  };
  for (const target of Object.values(values).filter((value) => typeof value === "string" && !value.startsWith("file:"))) {
    if (resolvedExternalData && isInside(resolvedExternalData, target)) {
      continue;
    }
    assertInside(root, target);
  }
  return values;
}

function hasUploadedFiles(uploadsRoot) {
  if (!fs.existsSync(uploadsRoot)) return false;
  return fs.readdirSync(uploadsRoot).some((name) => name !== ".gitkeep");
}

function anyExists(...targets) {
  return targets.some((target) => fs.existsSync(target));
}

function hasNonEmptyNodeModules(dir) {
  const nm = path.join(dir, "node_modules");
  if (!fs.existsSync(nm)) return false;
  try {
    return fs.readdirSync(nm).some((name) => !name.startsWith(".") || name === ".pnpm" || name === ".bin");
  } catch {
    return false;
  }
}

export function checkDependencies(projectRoot) {
  const paths = getSetupPaths(projectRoot);
  const hasRootPkg = fs.existsSync(path.join(paths.projectRoot, "package.json"));
  const serverDir = path.join(paths.projectRoot, "server");
  const clientDir = path.join(paths.projectRoot, "client");
  const serverEntry = fs.existsSync(path.join(serverDir, "package.json"));
  const clientEntry = fs.existsSync(path.join(clientDir, "package.json"));
  const hasAnyPackageJson = hasRootPkg || serverEntry || clientEntry;
  const rootPackages = hasAnyPackageJson ? hasNonEmptyNodeModules(paths.projectRoot) : true;
  const serverModules = serverEntry ? fs.existsSync(path.join(serverDir, "node_modules")) : true;
  const clientModules = clientEntry ? fs.existsSync(path.join(clientDir, "node_modules")) : true;

  const ready = !hasAnyPackageJson ? true : rootPackages && serverModules && clientModules;
  return {
    ready,
    rootPackages,
    serverModules,
    clientModules,
    serverEntry,
    clientEntry,
  };
}

export function inspectInstallationState(projectRoot) {
  const paths = getSetupPaths(projectRoot);
  const deps = checkDependencies(projectRoot);
  const evidence = {
    installationLock: fs.existsSync(paths.lock),
    environmentFile: anyExists(paths.env, paths.rootEnv),
    applicationDatabase: anyExists(paths.appDb, paths.appDbWal, paths.appDbShm, paths.appDbJournal),
    sessionDatabase: anyExists(paths.sessionsDb, paths.sessionsDbWal, paths.sessionsDbShm, paths.sessionsDbJournal),
    deploymentConfig: fs.existsSync(paths.deploymentConfig),
    pendingInstallation: fs.existsSync(paths.pending),
    uploadedFiles: hasUploadedFiles(paths.uploadsRoot),
    dependenciesInstalled: deps.ready,
  };

  let state = "fresh";
  if (evidence.installationLock) state = "installed";
  else if (Object.entries(evidence).some(([key, present]) => key !== "dependenciesInstalled" && present)) state = "partial";

  return { state, evidence, dependencies: deps };
}

export function validateRuntime(nodeVersion, packageManagerVersion = null, options = {}) {
  const normalizedNode = String(nodeVersion || "").replace(/^v/i, "");
  const nodeMajor = Number(normalizedNode.split(".")[0]);
  const allowedMajors = Array.isArray(options.supportedNodeMajors) && options.supportedNodeMajors.length > 0
    ? options.supportedNodeMajors
    : SUPPORTED_NODE_MAJORS;
  const normalizedPm = String(packageManagerVersion || "").trim();
  const pmSupported = options.requiredPackageManagerVersion
    ? normalizedPm === options.requiredPackageManagerVersion
    : normalizedPm.length > 0 && /^\d+\.\d+/.test(normalizedPm);

  return {
    nodeVersion: normalizedNode || null,
    nodeSupported: allowedMajors.includes(nodeMajor),
    supportedNodeMajors: [...allowedMajors],
    packageManager: options.packageManager || "npm",
    packageManagerVersion: normalizedPm || null,
    packageManagerSupported: pmSupported,
  };
}

function hashFile(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function assertNoUnsafeSymlinks(target, allowedRoot) {
  if (!fs.existsSync(target)) return;
  const lstat = fs.lstatSync(target);
  if (lstat.isSymbolicLink()) {
    let realTarget;
    try {
      realTarget = fs.realpathSync(target);
    } catch {
      throw new Error(`Güvenli olmayan veya kırık sembolik bağlantı tespit edildi: ${target}`);
    }
    if (!isInside(allowedRoot, realTarget)) {
      throw new Error(`Güvenli dizin sınırı ihlali (sembolik bağlantı proje dışını gösteriyor): ${target} -> ${realTarget}`);
    }
    return;
  }
  if (lstat.isDirectory()) {
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
      assertNoUnsafeSymlinks(path.join(target, entry.name), allowedRoot);
    }
  }
}

function collectFiles(target, base = target, allowedRoot = null) {
  if (!fs.existsSync(target)) return [];
  const lstat = fs.lstatSync(target);
  if (lstat.isSymbolicLink()) {
    const realTarget = fs.realpathSync(target);
    if (allowedRoot) assertInside(allowedRoot, realTarget);
    const realStat = fs.statSync(realTarget);
    if (realStat.isFile()) return [{ absolute: realTarget, relative: path.basename(target) }];
    return [];
  }
  if (lstat.isFile()) return [{ absolute: target, relative: path.basename(target) }];
  const files = [];
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const absolute = path.join(target, entry.name);
    if (entry.isSymbolicLink()) {
      const realTarget = fs.realpathSync(absolute);
      if (allowedRoot) assertInside(allowedRoot, realTarget);
      const realStat = fs.statSync(realTarget);
      if (realStat.isFile()) {
        files.push({ absolute: realTarget, relative: path.relative(base, absolute) });
      }
    } else if (entry.isDirectory()) {
      files.push(...collectFiles(absolute, base, allowedRoot));
    } else if (entry.isFile()) {
      files.push({ absolute, relative: path.relative(base, absolute) });
    }
  }
  return files;
}

function backupItems(paths) {
  const relBase = path.relative(paths.projectRoot, paths.serverRoot);
  const prefix = relBase ? (p) => path.join(relBase, p) : (p) => p;
  const items = [
    { source: paths.env, destination: prefix(".env") },
    { source: paths.appDb, destination: prefix(path.join("data", "app.db")) },
    { source: paths.appDbWal, destination: prefix(path.join("data", "app.db-wal")) },
    { source: paths.appDbShm, destination: prefix(path.join("data", "app.db-shm")) },
    { source: paths.appDbJournal, destination: prefix(path.join("data", "app.db-journal")) },
    { source: paths.sessionsDb, destination: prefix(path.join("data", "sessions.db")) },
    { source: paths.sessionsDbWal, destination: prefix(path.join("data", "sessions.db-wal")) },
    { source: paths.sessionsDbShm, destination: prefix(path.join("data", "sessions.db-shm")) },
    { source: paths.sessionsDbJournal, destination: prefix(path.join("data", "sessions.db-journal")) },
    { source: paths.lock, destination: prefix(path.join("data", "installation.lock")) },
    { source: paths.pending, destination: prefix(path.join("data", "installation.pending")) },
    { source: paths.deploymentConfig, destination: prefix(path.join("data", "deployment-config.json")) },
    { source: paths.adminConfig, destination: prefix(path.join("data", "admin.json")) },
    { source: paths.setupArtifacts, destination: prefix(path.join("data", "setup-artifacts")) },
    { source: paths.uploadsRoot, destination: prefix("uploads") },
  ];
  if (paths.rootEnv !== paths.env) {
    items.push({ source: paths.rootEnv, destination: ".env" });
  }
  return items;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function createVerifiedBackup(projectRoot, backupName = `reinstall-${timestamp()}`) {
  const paths = getSetupPaths(projectRoot);
  fs.mkdirSync(paths.backupsRoot, { recursive: true });
  const backupRoot = path.join(paths.backupsRoot, backupName);
  assertInside(paths.backupsRoot, backupRoot);
  if (fs.existsSync(backupRoot)) throw new Error("Aynı adlı temiz kurulum yedeği zaten mevcut.");
  fs.mkdirSync(backupRoot, { recursive: false, mode: 0o700 });

  const copied = [];
  try {
    for (const item of backupItems(paths)) {
      if (!fs.existsSync(item.source)) continue;
      assertInside(paths.projectRoot, item.source);
      assertNoUnsafeSymlinks(item.source, paths.projectRoot);
      const destination = path.join(backupRoot, item.destination);
      assertInside(backupRoot, destination);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.cpSync(item.source, destination, { recursive: true, errorOnExist: true, dereference: true });

      const sourceFiles = collectFiles(item.source, item.source, paths.projectRoot);
      const destinationFiles = collectFiles(destination, destination, backupRoot);
      if (sourceFiles.length !== destinationFiles.length) throw new Error(`Yedek dosya sayısı doğrulanamadı: ${item.destination}`);
      for (const sourceFile of sourceFiles) {
        const destinationFile = fs.statSync(item.source).isFile()
          ? destination
          : path.join(destination, sourceFile.relative);
        const sourceHash = hashFile(sourceFile.absolute);
        const destinationHash = hashFile(destinationFile);
        if (sourceHash !== destinationHash) throw new Error(`Yedek özeti eşleşmedi: ${item.destination}`);
        copied.push({
          source: path.relative(paths.projectRoot, sourceFile.absolute).replaceAll(path.sep, "/"),
          backup: path.relative(backupRoot, destinationFile).replaceAll(path.sep, "/"),
          bytes: fs.statSync(sourceFile.absolute).size,
          sha256: sourceHash,
        });
      }
    }

    const manifest = {
      createdAt: new Date().toISOString(),
      projectRoot: paths.projectRoot,
      reason: "Temiz kurulum öncesi zorunlu doğrulanmış yedek",
      files: copied,
    };
    fs.writeFileSync(path.join(backupRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    return { backupRoot, files: copied.length };
  } catch (error) {
    fs.rmSync(backupRoot, { recursive: true, force: true });
    throw error;
  }
}

function clearUploads(uploadsRoot) {
  if (!fs.existsSync(uploadsRoot)) return;
  for (const name of fs.readdirSync(uploadsRoot)) {
    if (name === ".gitkeep") continue;
    const target = path.join(uploadsRoot, name);
    assertInside(uploadsRoot, target);
    fs.rmSync(target, { recursive: true, force: true });
  }
}

export function resetInstallation(projectRoot, options = {}) {
  const expectedConfirmation = options.expectedConfirmation || CLEAN_INSTALL_CONFIRMATION;
  if (options.confirmation !== expectedConfirmation) {
    throw new Error("Temiz kurulum onay metni eşleşmiyor.");
  }
  if (options.backupAcknowledged !== true) {
    throw new Error("Zorunlu yedek onayı verilmedi.");
  }

  const current = inspectInstallationState(projectRoot);
  if (current.state === "fresh") throw new Error("Temizlenecek mevcut veya yarım kurulum bulunamadı.");
  const paths = getSetupPaths(projectRoot);
  for (const envCandidate of [paths.env, paths.rootEnv]) {
    if (fs.existsSync(envCandidate)) {
      const match = fs.readFileSync(envCandidate, "utf8").match(/^\s*DATABASE_URL\s*=\s*["']?([^"'\r\n]+)["']?\s*$/m);
      if (match && !match[1].trim().startsWith("file:")) {
        throw new Error("Otomatik temiz kurulum yalnız yerel dosya tabanlı (SQLite) veritabanında kullanılabilir. Harici veritabanını ayrıca yedekleyip temizlemelisiniz.");
      }
    }
  }
  const backup = createVerifiedBackup(projectRoot);

  const removable = [
    paths.env,
    paths.rootEnv,
    paths.appDb,
    paths.appDbWal,
    paths.appDbShm,
    paths.appDbJournal,
    paths.sessionsDb,
    paths.sessionsDbWal,
    paths.sessionsDbShm,
    paths.sessionsDbJournal,
    paths.lock,
    paths.pending,
    paths.deploymentConfig,
    paths.deploymentConfigTemp,
    paths.adminConfig,
    paths.setupArtifacts,
  ];
  for (const target of removable) {
    assertInside(paths.projectRoot, target);
    fs.rmSync(target, { recursive: true, force: true });
  }
  clearUploads(paths.uploadsRoot);
  return { ...backup, state: inspectInstallationState(projectRoot) };
}

export function readConfiguredPort(projectRoot) {
  const paths = getSetupPaths(projectRoot);
  for (const candidate of [paths.env, paths.rootEnv]) {
    if (!fs.existsSync(candidate)) continue;
    const match = fs.readFileSync(candidate, "utf8").match(/^\s*PORT\s*=\s*["']?(\d+)["']?\s*$/m);
    if (match?.[1]) {
      const port = Number(match[1]);
      if (Number.isInteger(port) && port >= 1 && port <= 65535) return port;
    }
  }
  return 5000;
}

export function isLocalPortOpen(port, timeoutMs = 600) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const done = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

export function stopPortProcess(port, options = {}) {
  const holder = findListeningProcess(port);
  if (!holder?.pid) {
    return { stopped: false, pid: null, message: `127.0.0.1:${port} için süreç bulunamadı.` };
  }
  if (holder.pid === process.pid) {
    return { stopped: false, pid: holder.pid, message: "Kendi kurulum başlatıcı sürecinizi durduramazsınız." };
  }
  if (options.requireNodeOrSetupProcess) {
    const descriptor = `${holder.name || ""} ${holder.commandLine || ""}`.toLowerCase();
    if (descriptor.trim() && !/node|npm|pnpm|yarn|bun|tsx|setup|wizard/.test(descriptor)) {
      return {
        stopped: false,
        pid: holder.pid,
        name: holder.name,
        message: `PID ${holder.pid} (${holder.name || "bilinmeyen"}) bir Node/kurulum süreci olmadığı için güvenlik amacıyla otomatik durdurulmadı.`,
      };
    }
  }
  let killed = false;
  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/PID", String(holder.pid), "/F"], {
      encoding: "utf8",
      windowsHide: true,
      shell: false,
    });
    killed = result.status === 0;
  } else {
    const pid = holder.pid;
    try {
      process.kill(pid, "SIGTERM");
      killed = true;
      setTimeout(() => {
        try {
          process.kill(pid, 0);
          process.kill(pid, "SIGKILL");
        } catch {
          /* zaten kapandı */
        }
      }, 800);
    } catch {
      try {
        process.kill(pid, "SIGKILL");
        killed = true;
      } catch {
        killed = false;
      }
    }
  }
  return {
    stopped: killed,
    pid: holder.pid,
    name: holder.name,
    message: killed
      ? `PID ${holder.pid} durduruldu.`
      : `PID ${holder.pid} durdurulamadı. Elle deneyin.`,
  };
}

function runCapture(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
    shell: false,
  });
  return result.status === 0 ? String(result.stdout || "") : "";
}

function findPidViaProcNetTcp(wantedPort) {
  const hexPort = wantedPort.toString(16).toUpperCase().padStart(4, "0");
  const inodes = new Set();
  for (const procFile of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    if (!fs.existsSync(procFile)) continue;
    try {
      const lines = fs.readFileSync(procFile, "utf8").split(/\r?\n/).slice(1);
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 10) continue;
        const localAddr = parts[1];
        const state = parts[3];
        const inode = parts[9];
        if (state === "0A" && localAddr.endsWith(`:${hexPort}`) && inode && inode !== "0") {
          inodes.add(inode);
        }
      }
    } catch {
      /* /proc okuma hatası yoksayılır */
    }
  }
  if (inodes.size === 0 || !fs.existsSync("/proc")) return null;
  try {
    for (const entry of fs.readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      const fdDir = `/proc/${entry}/fd`;
      try {
        for (const fd of fs.readdirSync(fdDir)) {
          try {
            const target = fs.readlinkSync(`${fdDir}/${fd}`);
            for (const inode of inodes) {
              if (target === `socket:[${inode}]` || target.includes(`[${inode}]`)) {
                return Number(entry);
              }
            }
          } catch {
            /* fd kapanmış veya yetki yok */
          }
        }
      } catch {
        /* başka kullanıcının süreci */
      }
    }
  } catch {
    /* /proc taranamadı */
  }
  return null;
}

export function findListeningProcess(port) {
  const wanted = Number(port);
  if (!Number.isInteger(wanted) || wanted < 1 || wanted > 65535) return null;

  let pid = null;
  if (process.platform === "win32") {
    for (const line of runCapture("netstat", ["-ano", "-p", "TCP"]).split(/\r?\n/)) {
      const match = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
      if (match && Number(match[1]) === wanted) {
        pid = Number(match[2]);
        break;
      }
    }
  } else {
    const lsof = runCapture("lsof", ["-nP", `-iTCP:${wanted}`, "-sTCP:LISTEN", "-t"]);
    const first = lsof.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (first && /^\d+$/.test(first)) {
      pid = Number(first);
    }
    if (!pid) {
      const ss = runCapture("ss", ["-Htlpn", `sport = :${wanted}`]);
      const ssMatch = ss.match(/pid=(\d+)/);
      if (ssMatch?.[1]) pid = Number(ssMatch[1]);
    }
    if (!pid) {
      const fuser = runCapture("fuser", [`${wanted}/tcp`]);
      const fuserMatch = fuser.match(/(\d+)/);
      if (fuserMatch?.[1]) pid = Number(fuserMatch[1]);
    }
    if (!pid) {
      pid = findPidViaProcNetTcp(wanted);
    }
  }

  if (!Number.isInteger(pid) || pid <= 0) return null;

  let name = null;
  let commandLine = null;
  if (process.platform === "win32") {
    const tasklist = runCapture("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]);
    const csv = tasklist.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (csv) {
      const columns = csv.match(/"([^"]*)"/g)?.map((value) => value.slice(1, -1));
      if (columns?.[0]) name = columns[0];
    }
    const wmic = runCapture("wmic", ["process", "where", `ProcessId=${pid}`, "get", "CommandLine", "/value"]);
    const match = wmic.match(/CommandLine=(.+)/i);
    if (match?.[1]) commandLine = match[1].trim();
  } else {
    const ps = runCapture("ps", ["-p", String(pid), "-o", "comm=,args="]);
    const line = ps.split(/\r?\n/).map((value) => value.trim()).find(Boolean);
    if (line) {
      const [comm, ...rest] = line.split(/\s+/);
      name = comm || null;
      commandLine = rest.length ? line : null;
    }
  }

  return { pid, name, commandLine };
}

export function describePortConflict(port) {
  const holder = findListeningProcess(port);
  const lines = [
    `Kurulum başlangıç sunucusu açılamadı: 127.0.0.1:${port} portu zaten kullanımda.`,
    "",
    "Bu hata, önceki kurulum penceresi kapatıldığında arka planda",
    "kalan kurulum sürecinin portu bırakmamasından kaynaklanır.",
  ];
  if (holder) {
    lines.push(
      "",
      `Portu tutan süreç: PID ${holder.pid}${holder.name ? ` (${holder.name})` : ""}`,
    );
    if (holder.commandLine) lines.push(`Komut: ${holder.commandLine}`);
    if (process.platform === "win32") {
      lines.push(
        "",
        "Süreci durdurmak için yönetici olmayan bir terminalde:",
        `  taskkill /PID ${holder.pid} /F`,
      );
    } else {
      lines.push(
        "",
        "Süreci durdurmak için:",
        `  kill ${holder.pid}`,
      );
    }
  } else {
    lines.push(
      "",
      "Portu tutan süreç otomatik bulunamadı. Elle denetleyin:",
      process.platform === "win32"
        ? `  netstat -ano | findstr ":${port}"`
        : `  lsof -nP -iTCP:${port} -sTCP:LISTEN`,
    );
  }
  lines.push(
    "",
    "Yapılması gerekenler:",
    "  1. Hâlâ açık bir kurulum penceresi varsa onu kullanın veya kapatın.",
    "  2. Yukarıdaki komutla kalan kurulum sürecini durdurun.",
    "  3. kurulum.bat / kurulum.sh dosyasını yeniden çalıştırın.",
    "",
    "Not: Kurulum verileri bu hata nedeniyle değiştirilmez.",
  );
  return {
    port,
    holder,
    message: lines.join("\n"),
  };
}
