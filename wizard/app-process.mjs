import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectPackageManager, loadSetupConfig } from "../scripts/detect-project.mjs";
import { resolveStepCommand } from "../scripts/polyglot.mjs";

/**
 * Hedef uygulamanın başlatma komutunu bulan ve (masaüstü için) süreci yöneten ortak kod.
 * Hem `server.mjs` (HTTP) hem `core.mjs` (gömülü/IPC) tarafından kullanılır.
 */

const cmdAvailabilityCache = new Map();
export function isCommandAvailable(cmd) {
  if (cmdAvailabilityCache.has(cmd)) return cmdAvailabilityCache.get(cmd);
  try {
    const isWin = process.platform === "win32";
    const checkCmd = isWin ? "where" : "which";
    const res = spawnSync(checkCmd, [cmd], { stdio: "ignore", windowsHide: true });
    const available = res.status === 0;
    cmdAvailabilityCache.set(cmd, available);
    return available;
  } catch {
    cmdAvailabilityCache.set(cmd, false);
    return false;
  }
}

export function resolveEffectivePackageManager(pm) {
  let effective = ["pnpm", "yarn", "bun", "npm"].includes(pm) ? pm : "npm";
  if (effective === "npm" && !isCommandAvailable("npm") && isCommandAvailable("bun")) {
    effective = "bun";
  }
  return effective;
}

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
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    let val = match[2].trim();
    if (val.startsWith('"') && val.endsWith('"')) {
      try {
        val = JSON.parse(val);
      } catch {
        val = val.slice(1, -1);
      }
    } else if (val.startsWith("'") && val.endsWith("'")) {
      val = val.slice(1, -1);
    }
    vars[key] = String(val);
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
    if (startCmd === "npm" && !isCommandAvailable("npm") && isCommandAvailable("bun")) {
      startCmd = "bun";
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

function safeFolderName(name) {
  const cleaned = String(name || "app").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return cleaned || "app";
}

/** İşletim sistemine göre kullanıcı uygulama verisi kök dizini (SETUP_USER_DATA_HOME ile değiştirilebilir). */
export function userDataHome({ env = process.env, platform = process.platform, homedir = os.homedir() } = {}) {
  if (env.SETUP_USER_DATA_HOME) return path.resolve(env.SETUP_USER_DATA_HOME);
  if (platform === "win32") return env.APPDATA || path.join(homedir, "AppData", "Roaming");
  if (platform === "darwin") return path.join(homedir, "Library", "Application Support");
  return env.XDG_CONFIG_HOME || path.join(homedir, ".config");
}

/**
 * Masaüstü senaryosunda yerel veri dizinini seçer: açıkça verilen `dataDir`, `SETUP_DATA_DIR` veya
 * `setup.config.json` `paths.dataDir` varsa onlara dokunmaz (`explicit` aynen döner / `null`);
 * hiçbiri yoksa kullanıcı verisi dizininde `<proje-adı>` klasörünü verir. Diğer senaryolarda `explicit` döner.
 */
export function resolveDesktopDataDir({ detection, setupConfig = null, explicit = null, env = process.env, platform = process.platform, homedir = os.homedir() } = {}) {
  if (!detection?.scenario?.isDesktop) return explicit || null;
  if (explicit) return explicit;
  if (env.SETUP_DATA_DIR) return null;
  if (typeof setupConfig?.paths?.dataDir === "string" && setupConfig.paths.dataDir.trim()) return null;
  const name = safeFolderName(setupConfig?.name || detection.projectName);
  return path.join(userDataHome({ env, platform, homedir }), name);
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
        env: { ...process.env, ...envVars, ...(dataDir ? { SETUP_DATA_DIR: dataDir } : {}) },
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
