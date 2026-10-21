/**
 * Kurulum adımlarını sırayla çalıştırır (Python/Go/.NET/Rust profilleri).
 * Kullanım: SETUP_STEPS='[{"command":"go","args":["mod","download"]}]' node run-steps.mjs <proje-kökü>
 * İlk başarısız adımda durur ve o adımın çıkış koduyla çıkar.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkToolchain, resolveStepCommand } from "./polyglot.mjs";

export async function runSteps(root, steps, log = console.log) {
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const title = `[${i + 1}/${steps.length}] ${step.label || `${step.command} ${(step.args || []).join(" ")}`}`;
    if (step.skipIfExists && fs.existsSync(path.join(root, step.skipIfExists))) {
      log(`${title} — atlandı (${step.skipIfExists} mevcut)`);
      continue;
    }
    const toolchain = checkToolchain(root, step);
    if (!toolchain.ok) {
      log(`[EKSİK] ${toolchain.message}`);
      return { ok: false, code: 127, step };
    }
    log(title);
    const command = resolveStepCommand(root, step);
    const args = Array.isArray(step.args) ? step.args : [];
    const code = await new Promise((resolve) => {
      const child = spawn(command, args, { cwd: root, windowsHide: true, shell: false, stdio: ["ignore", "inherit", "inherit"] });
      child.once("error", (err) => {
        log(`[HATA] ${command} başlatılamadı: ${err.message}`);
        resolve(127);
      });
      child.once("close", (c) => resolve(c ?? 1));
    });
    if (code !== 0) {
      log(`[HATA] Adım başarısız oldu (çıkış kodu ${code}): ${title}`);
      return { ok: false, code, step };
    }
  }
  log("Tüm kurulum ve doğrulama adımları başarıyla tamamlandı.");
  return { ok: true, code: 0 };
}

if (import.meta.url && process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  let steps;
  try {
    steps = JSON.parse(process.env.SETUP_STEPS || "[]");
  } catch {
    console.error("[HATA] SETUP_STEPS geçerli JSON değil.");
    process.exit(2);
  }
  const root = path.resolve(process.argv[2] || process.cwd());
  runSteps(root, steps).then((res) => process.exit(res.code));
}
