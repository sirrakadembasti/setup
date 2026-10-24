import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectPackageManager, detectProject, loadSetupConfig, parseEnvContent } from "../scripts/detect-project.mjs";
import { resolveLanguageProfile, resolveStepCommand } from "../scripts/polyglot.mjs";
import {
  clearCommandAvailabilityCache,
  isCommandAvailable,
  resolveDesktopDataDir,
  resolveEffectivePackageManager,
  userDataHome,
} from "../scripts/setup-bootstrap-lib.mjs";

export {
  clearCommandAvailabilityCache,
  isCommandAvailable,
  resolveDesktopDataDir,
  resolveEffectivePackageManager,
  userDataHome,
};

/**
 * Ortam değişkenlerini normalize eder.
 * Windows'ta process.env case-insensitive iken düz JS nesnesinde 'Path', 'PATH', 'path'
 * ayrı anahtarlar haline gelebilir. Bu durum spawn çağrılarında shims veya ortam yollarının
 * çelişkili çözülmesine yol açar.
 *
 * Bu fonksiyon:
 * 1. Tüm PATH türevlerini (Path, PATH, path) tek bir kanonik anahtara (Windows'ta 'Path', POSIX'te 'PATH') birleştirir.
 * 2. İstenen öncelikli dizinleri (shims, .venv/Scripts vb.) en başa ekler, yinelenen yolları temizler.
 * 3. extraEnv değişkenlerini güvenle harmanlar.
 */
export function normalizeProcessEnv(baseEnv = process.env, extraEnv = {}, prependPaths = []) {
  const isWin = process.platform === "win32";
  const canonicalKey = isWin ? "Path" : "PATH";
  const pathParts = [];

  for (const p of prependPaths) {
    if (p && typeof p === "string" && p.trim()) {
      pathParts.push(p.trim());
    }
  }

  const envObj = {};
  for (const [key, val] of Object.entries(baseEnv || {})) {
    if (key.toUpperCase() === "PATH") {
      if (val) pathParts.push(val);
    } else {
      envObj[key] = val;
    }
  }

  for (const [key, val] of Object.entries(extraEnv || {})) {
    if (key.toUpperCase() === "PATH") {
      if (val) pathParts.push(val);
    } else {
      envObj[key] = val;
    }
  }

  const fullPath = pathParts
    .join(path.delimiter)
    .split(path.delimiter)
    .map((s) => s.trim())
    .filter(Boolean);

  const seen = new Set();
  const deduped = [];
  for (const entry of fullPath) {
    const check = isWin ? entry.toLowerCase() : entry;
    if (!seen.has(check)) {
      seen.add(check);
      deduped.push(entry);
    }
  }

  envObj[canonicalKey] = deduped.join(path.delimiter);

  if (isWin) {
    delete envObj.PATH;
    delete envObj.path;
  }

  return envObj;
}

/**
 * Hedef uygulamanın başlatma komutunu bulan ve (masaüstü için) süreci yöneten ortak kod.
 * Hem `server.mjs` (HTTP) hem `core.mjs` (gömülü/IPC) tarafından kullanılır.
 */

export function resolvePnpmInvocation(args) {
  const pnpmScript = process.env.npm_execpath;
  if (pnpmScript && /pnpm(?:\.c?js)?$/i.test(pnpmScript)) {
    return { command: process.execPath, args: [pnpmScript, ...args] };
  }
  if (process.platform === "win32") {
    return { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", "pnpm", ...args] };
  }
  return { command: "pnpm", args };
}

export function pmRunInvocation(pm, scriptName, prefixDir = null) {
  const safePm = resolveEffectivePackageManager(pm);
  if (process.platform === "win32") {
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", safePm, "run", scriptName],
      cwd: prefixDir,
    };
  }
  return {
    command: safePm,
    args: ["run", scriptName],
    cwd: prefixDir,
  };
}

export function readJsonFileSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function parseDotEnvFile(envFilePath) {
  const vars = {};
  if (!envFilePath || !fs.existsSync(envFilePath)) return vars;
  let content = "";
  try {
    content = fs.readFileSync(envFilePath, "utf8");
  } catch {
    return vars;
  }
  const items = parseEnvContent(content);
  for (const item of items) {
    vars[item.key] = item.value;
  }
  return vars;
}

export function scriptToInvocation(scriptStr, pm, scriptName, cwd) {
  const directNodeMatch = String(scriptStr || "").trim().match(/^node\s+([^\s&|;"']+)(?:\s+(.*))?$/);
  if (directNodeMatch) {
    const extraArgs = directNodeMatch[2] ? directNodeMatch[2].trim().split(/\s+/).filter(Boolean) : [];
    return {
      command: process.execPath,
      args: [directNodeMatch[1], ...extraArgs],
      cwd,
    };
  }
  return pmRunInvocation(pm, scriptName, cwd);
}

const WINDOWS_CMD_SHIMS = new Set(["npm", "npx", "pnpm", "yarn", "bun", "bunx"]);

/** Windows'ta npm/pnpm/yarn/bun/npx birer .cmd olduğundan doğrudan spawn edilemez (ENOENT). */
export function wrapShimCommand(command, args = [], cwd) {
  if (process.platform === "win32" && WINDOWS_CMD_SHIMS.has(String(command).toLowerCase())) {
    return { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", command, ...args], cwd };
  }
  return { command, args, cwd };
}

export function resolveAppStartInvocation(projectRoot, setupConfig = null) {
  const root = path.resolve(projectRoot);
  const cfg = setupConfig ?? loadSetupConfig(root);
  if (cfg?.start?.command && typeof cfg.start.command === "string") {
    if (cfg.start.command === "static") {
      return {
        type: "static",
        staticDir: path.resolve(root, cfg.start.args?.[0] || "."),
      };
    }
    // python için proje içi .venv varsa onun yorumlayıcısı kullanılır
    let startCmd = resolveStepCommand(root, cfg.start);
    if (["pnpm", "yarn", "bun", "npm"].includes(String(startCmd).toLowerCase().trim())) {
      startCmd = resolveEffectivePackageManager(startCmd);
    }
    return wrapShimCommand(
      startCmd,
      Array.isArray(cfg.start.args) ? cfg.start.args : [],
      root,
    );
  }

  const rootPkg = readJsonFileSafe(path.join(root, "package.json"));
  const serverPkg = readJsonFileSafe(path.join(root, "server", "package.json"));
  const pm = resolveEffectivePackageManager(cfg?.packageManager || detectPackageManager(root, rootPkg));

  if (serverPkg?.scripts?.start) {
    return scriptToInvocation(serverPkg.scripts.start, pm, "start", path.join(root, "server"));
  }
  if (rootPkg?.scripts?.start) {
    return scriptToInvocation(rootPkg.scripts.start, pm, "start", root);
  }
  if (rootPkg?.scripts?.preview) {
    return scriptToInvocation(rootPkg.scripts.preview, pm, "preview", root);
  }
  if (rootPkg?.scripts?.dev) {
    return scriptToInvocation(rootPkg.scripts.dev, pm, "dev", root);
  }

  const entryCandidates = [
    "server/index.mjs",
    "server/index.js",
    "index.mjs",
    "index.js",
    "server.js",
    "app.js",
  ];
  for (const relEntry of entryCandidates) {
    if (fs.existsSync(path.join(root, relEntry))) {
      return {
        command: process.execPath,
        args: [relEntry],
        cwd: root,
      };
    }
  }

  const detection = detectProject(root);

  if (detection.candidateRoot) {
    const candPath = path.join(root, detection.candidateRoot);
    const candPkg = readJsonFileSafe(path.join(candPath, "package.json"));
    const candPm = resolveEffectivePackageManager(cfg?.packageManager || detectPackageManager(candPath, candPkg));
    if (candPkg?.scripts?.start) {
      return scriptToInvocation(candPkg.scripts.start, candPm, "start", candPath);
    }
    if (candPkg?.scripts?.preview) {
      return scriptToInvocation(candPkg.scripts.preview, candPm, "preview", candPath);
    }
    if (candPkg?.scripts?.dev) {
      return scriptToInvocation(candPkg.scripts.dev, candPm, "dev", candPath);
    }
    for (const relStatic of ["dist", "build", "public", "."]) {
      const candidateDir = path.resolve(candPath, relStatic);
      if (fs.existsSync(path.join(candidateDir, "index.html"))) {
        return {
          type: "static",
          staticDir: candidateDir,
        };
      }
    }
  }

  if (detection.subprojects?.backend) {
    const bPath = path.join(root, detection.subprojects.backend.dir);
    const bPkg = readJsonFileSafe(path.join(bPath, "package.json"));
    const bPm = resolveEffectivePackageManager(cfg?.packageManager || detectPackageManager(bPath, bPkg));
    let bInv = null;
    if (bPkg?.scripts?.start) {
      bInv = scriptToInvocation(bPkg.scripts.start, bPm, "start", bPath);
    } else if (bPkg?.scripts?.dev) {
      bInv = scriptToInvocation(bPkg.scripts.dev, bPm, "dev", bPath);
    }

    if (detection.subprojects?.frontend) {
      const fPath = path.join(root, detection.subprojects.frontend.dir);
      const fPkg = readJsonFileSafe(path.join(fPath, "package.json"));
      const fPm = resolveEffectivePackageManager(cfg?.packageManager || detectPackageManager(fPath, fPkg));

      // 1. Hibrit Yaklaşım: Eğer frontend'de derlenmiş statik çıktı varsa
      for (const relStatic of ["dist", "build", "public", "."]) {
        const candidateDir = path.resolve(fPath, relStatic);
        if (fs.existsSync(path.join(candidateDir, "index.html"))) {
          return {
            type: "dual-static",
            command: bInv?.command,
            args: bInv?.args,
            cwd: bInv?.cwd,
            backend: bInv,
            staticDir: candidateDir,
          };
        }
      }

      // 2. Çift Süreç (Dev/Eşzamanlı mod)
      let fInv = null;
      if (fPkg?.scripts?.start) {
        fInv = scriptToInvocation(fPkg.scripts.start, fPm, "start", fPath);
      } else if (fPkg?.scripts?.preview) {
        fInv = scriptToInvocation(fPkg.scripts.preview, fPm, "preview", fPath);
      } else if (fPkg?.scripts?.dev) {
        fInv = scriptToInvocation(fPkg.scripts.dev, fPm, "dev", fPath);
      }

      if (bInv && fInv) {
        return {
          type: "dual",
          command: bInv.command,
          args: bInv.args,
          cwd: bInv.cwd,
          backend: bInv,
          frontend: fInv,
        };
      }
    }

    if (bInv) return bInv;
  }

  const langProfile = resolveLanguageProfile(root, detection.kind, detection.ports?.app || 5000);
  if (langProfile?.start?.command) {
    if (langProfile.start.fallbackCommand && fs.existsSync(path.join(root, langProfile.start.fallbackCommand))) {
      return {
        command: path.resolve(root, langProfile.start.fallbackCommand),
        args: [],
        cwd: root,
      };
    }
    let startCmd = resolveStepCommand(root, langProfile.start);
    if (["pnpm", "yarn", "bun", "npm"].includes(String(startCmd).toLowerCase().trim())) {
      startCmd = resolveEffectivePackageManager(startCmd);
    }
    return wrapShimCommand(
      startCmd,
      Array.isArray(langProfile.start.args) ? langProfile.start.args : [],
      langProfile.start.cwd || root,
    );
  }

  for (const relStatic of ["dist", "build", "public", "."]) {
    const candidateDir = path.resolve(root, relStatic);
    if (fs.existsSync(path.join(candidateDir, "index.html"))) {
      return {
        type: "static",
        staticDir: candidateDir,
      };
    }
  }

  return null;
}

/**
 * Masaüstü (Electron/Tauri) uygulamasını ayrı süreç olarak başlatır ve port yerine sürecin
 * ayakta olup olmadığını denetler. `start()` ve `health()` `{ status, body }` döndürür.
 */
export function createDesktopAppController({ projectRoot, setupConfig = null, getEnvPath, dataDir = null, graceMs = 3000, startInvocation = null }) {
  let child = null;
  let exitInfo = null;
  const alive = () => Boolean(child && child.exitCode === null && child.signalCode === null);

  return {
    alive,
    async stop() {
      if (!child) return;
      const current = child;
      const pid = current.pid;
      child = null;
      const exitPromise =
        current.exitCode !== null
          ? Promise.resolve()
          : new Promise((resolve) => {
              const timer = setTimeout(resolve, 1500);
              current.once("exit", () => {
                clearTimeout(timer);
                resolve();
              });
            });
      try {
        current.kill();
      } catch {
        // zaten kapanmış olabilir
      }
      if (process.platform !== "win32" && pid) {
        try {
          process.kill(-pid, "SIGTERM");
        } catch {
          // süreç grubu yok
        }
      }
      await exitPromise;
    },
    health() {
      const up = alive();
      return {
        status: 200,
        body: {
          desktop: true,
          reachable: up,
          pid: up ? child.pid : null,
          exitCode: exitInfo?.code ?? null,
          hint: up
            ? "Masaüstü uygulaması çalışıyor."
            : exitInfo
              ? `Masaüstü uygulaması kapandı (çıkış kodu: ${exitInfo.code ?? exitInfo.signal}).`
              : "Masaüstü uygulaması henüz başlatılmadı.",
        },
      };
    },
    async start() {
      if (alive()) {
        return { status: 200, body: { message: "Masaüstü uygulaması zaten çalışıyor.", reachable: true, desktop: true, pid: child.pid } };
      }
      const invocation = startInvocation || resolveAppStartInvocation(projectRoot, setupConfig);
      if (!invocation || invocation.type === "static") {
        return {
          status: 409,
          body: {
            message: "Masaüstü uygulaması için başlatma komutu bulunamadı (setup.config.json start veya scripts.start).",
            reachable: false,
            desktop: true,
          },
        };
      }
      exitInfo = null;
      const envVars = parseDotEnvFile(typeof getEnvPath === "function" ? getEnvPath() : null);
      let spawnError = null;
      child = spawn(invocation.command, invocation.args, {
        cwd: invocation.cwd || projectRoot,
        env: normalizeProcessEnv(process.env, { ...envVars, ...(dataDir ? { SETUP_DATA_DIR: dataDir } : {}) }),
        detached: process.platform !== "win32",
        windowsHide: false,
        stdio: "ignore",
      });
      child.on("error", (err) => {
        spawnError = err;
      });
      child.on("exit", (code, signal) => {
        exitInfo = { code, signal };
      });
      child.unref();
      // Masaüstü uygulamaları port açmaz: kısa bir süre ayakta kalıyorsa başlamış sayılır.
      const startedAt = Date.now();
      while (Date.now() - startedAt < Number(graceMs) && !spawnError && alive()) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (spawnError || !alive()) {
        const reason = spawnError ? spawnError.message : `çıkış kodu ${exitInfo?.code ?? exitInfo?.signal ?? "bilinmiyor"}`;
        return {
          status: 409,
          body: { message: `Masaüstü uygulaması başlatılamadı veya hemen kapandı (${reason}).`, reachable: false, desktop: true },
        };
      }
      return { status: 200, body: { message: "Masaüstü uygulaması başlatıldı.", reachable: true, desktop: true, pid: child.pid } };
    },
  };
}

/**
 * Çok parçalı (Frontend + Backend) projeler için eşzamanlı çift süreç orkestratörü.
 * - Backend'i ana porta (PORT), Frontend'i ikincil porta (PORT) bağlar.
 * - Frontend'e API_URL, VITE_API_URL, NEXT_PUBLIC_API_URL ortam değişkenlerini bağlar.
 * - Kademeli Kapanma (Cascading Termination): Süreçlerden biri çökerse diğerini de sonlandırır.
 */
export function createDualProcessController({
  projectRoot,
  backendInvocation,
  frontendInvocation,
  backendPort = 5000,
  frontendPort = 5001,
  envVars = {},
  prependPaths = [],
  appendLog = null,
}) {
  let backendChild = null;
  let frontendChild = null;
  let backendStderr = "";
  let frontendStderr = "";
  const exitInfo = { backend: null, frontend: null };
  let isShuttingDown = false;

  const alive = () =>
    Boolean(
      backendChild &&
      backendChild.exitCode === null &&
      backendChild.signalCode === null &&
      (!frontendChild || (frontendChild.exitCode === null && frontendChild.signalCode === null))
    );

  const stop = async () => {
    isShuttingDown = true;
    const targets = [backendChild, frontendChild].filter(Boolean);
    backendChild = null;
    frontendChild = null;

    for (const child of targets) {
      try {
        child.kill();
      } catch {}
      if (process.platform !== "win32" && child.pid) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {}
      } else if (process.platform === "win32" && child.pid) {
        try {
          spawnSync("taskkill", ["/pid", String(child.pid), "/f", "/t"]);
        } catch {}
      }
    }
  };

  const start = async () => {
    isShuttingDown = false;
    exitInfo.backend = null;
    exitInfo.frontend = null;
    backendStderr = "";
    frontendStderr = "";

    // 1. Backend environment: PORT = backendPort
    const backendEnv = normalizeProcessEnv(
      process.env,
      { ...envVars, PORT: String(backendPort) },
      prependPaths
    );

    // 2. Frontend environment: PORT = frontendPort, API_URL köprüsü
    const apiUrl = `http://127.0.0.1:${backendPort}`;
    const frontendEnv = normalizeProcessEnv(
      process.env,
      {
        ...envVars,
        PORT: String(frontendPort),
        API_URL: apiUrl,
        VITE_API_URL: apiUrl,
        NEXT_PUBLIC_API_URL: apiUrl,
        REACT_APP_API_URL: apiUrl,
      },
      prependPaths
    );

    // Backend başlat
    backendChild = spawn(backendInvocation.command, backendInvocation.args, {
      cwd: backendInvocation.cwd || projectRoot,
      env: backendEnv,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    backendChild.stderr?.on("data", (chunk) => {
      backendStderr = (backendStderr + chunk.toString()).slice(-4000);
      appendLog?.(`[backend-err] ${chunk.toString()}`);
    });

    backendChild.on("exit", (code, signal) => {
      exitInfo.backend = { code, signal };
      if (!isShuttingDown && frontendChild && frontendChild.exitCode === null && frontendChild.signalCode === null) {
        appendLog?.(`[supervisor] Backend kapandı (kod: ${code ?? signal}), Frontend kademeli sonlandırılıyor...`);
        try { frontendChild.kill(); } catch {}
        if (process.platform === "win32" && frontendChild.pid) {
          try { spawnSync("taskkill", ["/pid", String(frontendChild.pid), "/f", "/t"]); } catch {}
        }
      }
    });

    // Frontend başlat
    if (frontendInvocation) {
      frontendChild = spawn(frontendInvocation.command, frontendInvocation.args, {
        cwd: frontendInvocation.cwd || projectRoot,
        env: frontendEnv,
        detached: process.platform !== "win32",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      frontendChild.stderr?.on("data", (chunk) => {
        frontendStderr = (frontendStderr + chunk.toString()).slice(-4000);
        appendLog?.(`[frontend-err] ${chunk.toString()}`);
      });

      frontendChild.on("exit", (code, signal) => {
        exitInfo.frontend = { code, signal };
        if (!isShuttingDown && backendChild && backendChild.exitCode === null && backendChild.signalCode === null) {
          appendLog?.(`[supervisor] Frontend kapandı (kod: ${code ?? signal}), Backend kademeli sonlandırılıyor...`);
          try { backendChild.kill(); } catch {}
          if (process.platform === "win32" && backendChild.pid) {
            try { spawnSync("taskkill", ["/pid", String(backendChild.pid), "/f", "/t"]); } catch {}
          }
        }
      });
    }

    backendChild.unref();
    frontendChild?.unref();

    return {
      backendPid: backendChild.pid,
      frontendPid: frontendChild?.pid ?? null,
    };
  };

  const isProcessAlive = (child) => Boolean(child && child.exitCode === null && child.signalCode === null && !child.killed);

  const getSubprocesses = () => ({
    backend: {
      pid: backendChild?.pid ?? null,
      port: backendPort,
      alive: isProcessAlive(backendChild),
      exitCode: exitInfo.backend?.code ?? null,
      signal: exitInfo.backend?.signal ?? null,
      errorDetail: backendStderr.trim().split(/\r?\n/).slice(-3).join(" | ") || null,
    },
    frontend: frontendChild
      ? {
          pid: frontendChild.pid,
          port: frontendPort,
          alive: isProcessAlive(frontendChild),
          exitCode: exitInfo.frontend?.code ?? null,
          signal: exitInfo.frontend?.signal ?? null,
          errorDetail: frontendStderr.trim().split(/\r?\n/).slice(-3).join(" | ") || null,
        }
      : null,
  });

  return {
    start,
    stop,
    alive,
    getSubprocesses,
    getExitInfo: () => exitInfo,
    getErrors: () => ({ backend: backendStderr, frontend: frontendStderr }),
  };
}
