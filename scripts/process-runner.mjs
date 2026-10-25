import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveEffectivePackageManager } from "./setup-bootstrap-lib.mjs";
import { normalizeProcessEnv } from "../wizard/app-process.mjs";
import { redactSecrets } from "../wizard/shared.mjs";

export const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const shims = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../bin/shims");

export function resolveCommandInvocation(command, args = []) {
  if (command === "node") return { command: process.execPath, args };
  if (PACKAGE_MANAGERS.has(command)) {
    command = resolveEffectivePackageManager(command);
    const execPath = process.env.npm_execpath;
    if (execPath && new RegExp(`${command}(?:-cli)?(?:\\.c?js)?$`, "i").test(execPath)) return { command: process.execPath, args: [execPath, ...args] };
  }
  if (process.platform === "win32" && /^(npm|npx|pnpm|yarn|bun|bunx)$/.test(command)) return { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", command, ...args] };
  return { command, args };
}

function stopTree(child, force = false) {
  if (!child?.pid) return;
  if (!force && child.connected) {
    child.send({ type: "setup:shutdown" }, () => {});
    const timer = setTimeout(() => stopTree(child, true), 2500);
    timer.unref();
    child.once("close", () => clearTimeout(timer));
    return;
  }
  if (process.platform === "win32") {
    if (child.exitCode !== null || child.signalCode) return;
    const result = spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    if (result.status !== 0) { try { child.kill("SIGKILL"); } catch {} }
  } else {
    try { process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM"); } catch { try { child.kill(force ? "SIGKILL" : "SIGTERM"); } catch {} }
    if (!force) {
      const timer = setTimeout(() => stopTree(child, true), 2500);
      timer.unref();
      child.once("close", () => clearTimeout(timer));
    }
  }
}

export function createProcessRunner({ log = console.log } = {}) {
  let activeChild = null;
  let cancellation = null;
  function cancel(force = false, signal = "SIGINT") {
    if (activeChild) cancellation = signal;
    stopTree(activeChild, force);
  }
  function run(call, { cwd = process.cwd(), timeout = Number(process.env.SETUP_JOB_TIMEOUT_MS) || 900000, env = process.env, prependPaths = [shims], ipc = false, onStdout } = {}) {
    if (activeChild) throw new Error("Başka bir kurulum işlemi halen çalışıyor.");
    cancellation = null;
    return new Promise((resolve, reject) => {
      let failure, timer;
      const child = spawn(call.command, call.args, {
        cwd, env: normalizeProcessEnv(env, { FORCE_COLOR: "0" }, prependPaths), windowsHide: true,
        shell: false, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe", ...(ipc ? ["ipc"] : [])],
      });
      activeChild = child;
      child.stdout.on("data", (chunk) => {
        const text = String(chunk);
        log(redactSecrets(text));
        onStdout?.(text, { clearTimeout: () => clearTimeout(timer) });
      });
      child.stderr.on("data", (chunk) => log(redactSecrets(String(chunk))));
      child.once("error", (error) => { failure = Object.assign(new Error(`İşlem başlatılamadı: ${error.message}`), { exitCode: 127 }); });
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        activeChild = null;
        if (failure) reject(failure);
        else if (cancellation) reject(Object.assign(new Error("İşlem iptal edildi."), { exitCode: cancellation === "SIGINT" ? 130 : cancellation === "SIGHUP" ? 129 : 143 }));
        else if (code !== 0) reject(Object.assign(new Error(`İşlem başarısız (çıkış kodu ${code ?? signal}).`), { exitCode: code ?? 1 }));
        else resolve();
      });
      if (timeout > 0) timer = setTimeout(() => {
        failure = Object.assign(new Error(`İşlem zaman aşımına uğradı (${timeout} ms).`), { exitCode: 124 });
        stopTree(child);
      }, timeout);
    });
  }
  return { run, cancel, get running() { return Boolean(activeChild); } };
}
