/** Shared dependency step executor for terminal setup and standalone use. */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { checkToolchain, resolveStepCommand } from "./polyglot.mjs";
import { createProcessRunner, resolveCommandInvocation, PACKAGE_MANAGERS } from "./process-runner.mjs";

export async function runSteps(root, steps, log = console.log, options = {}) {
  root = path.resolve(root);
  const runner = options.run ? null : createProcessRunner({ log });
  const execute = options.run || runner.run;
  const signals = new Map();
  if (runner) {
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      const handle = () => runner.cancel(false, signal);
      signals.set(signal, handle);
      process.on(signal, handle);
    }
  }
  const onExit = () => runner?.cancel(true);
  if (runner) process.on("exit", onExit);
  let current;
  try {
    if (!Array.isArray(steps)) throw Object.assign(new Error("Kurulum adımları bir dizi olmalıdır."), { exitCode: 2 });
    for (let i = 0; i < steps.length; i++) {
      current = steps[i];
      if (!current || typeof current.command !== "string" || !current.command.trim() || (current.args !== undefined && (!Array.isArray(current.args) || current.args.some((arg) => typeof arg !== "string")))) {
        throw Object.assign(new Error(`Geçersiz kurulum adımı: ${i + 1}`), { exitCode: 2 });
      }
      let cwd = current.cwd ? path.resolve(root, current.cwd) : root;
      const args = [...(current.args || [])];
      if (PACKAGE_MANAGERS.has(current.command) && args.includes("--prefix")) {
        const index = args.indexOf("--prefix");
        if (!args[index + 1]) throw Object.assign(new Error("--prefix için alt dizin belirtilmelidir."), { exitCode: 2 });
        cwd = path.resolve(cwd, args[index + 1]);
        args.splice(index, 2);
      }
      const title = `[${i + 1}/${steps.length}] ${current.label || `${current.command} ${args.join(" ")}`}`;
      if (current.skipIfExists && fs.existsSync(path.resolve(cwd, current.skipIfExists))) {
        log(`${title} — atlandı (${current.skipIfExists} mevcut)`);
        continue;
      }
      const toolchain = checkToolchain(cwd, current);
      if (!toolchain.ok) throw Object.assign(new Error(toolchain.message), { exitCode: 127 });
      log(title);
      const command = resolveStepCommand(cwd, current);
      await execute(resolveCommandInvocation(command, args), {
        cwd, ...(current.timeoutMs !== undefined ? { timeout: Number(current.timeoutMs) } : {}),
        ...(current.env ? { env: { ...process.env, ...current.env } } : {}),
        ...(options.prependPaths ? { prependPaths: options.prependPaths } : {}),
      });
    }
    log("Tüm kurulum ve doğrulama adımları başarıyla tamamlandı.");
    return { ok: true, code: 0 };
  } catch (error) {
    log(`[HATA] ${error.message}`);
    return { ok: false, code: error.exitCode || 1, step: current, error };
  } finally {
    for (const [signal, handle] of signals) process.removeListener(signal, handle);
    if (runner) process.removeListener("exit", onExit);
  }
}

if (import.meta.url && process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    const steps = JSON.parse(process.env.SETUP_STEPS || "[]");
    const root = path.resolve(process.argv[2] || process.env.SETUP_PROJECT_ROOT || process.cwd());
    const result = await runSteps(root, steps);
    process.exitCode = result.code;
  } catch (error) {
    console.error(`[HATA] SETUP_STEPS geçerli JSON değil: ${error.message}`);
    process.exitCode = 2;
  }
}
