#!/usr/bin/env node
/**
 * setup — Bağımsız GitHub Uygulama Kurulum Eklentisi CLI (v1.0)
 * Kullanım:
 *   node bin/setup.mjs              # bulunduğum dizini algıla ve kur
 *   node bin/setup.mjs init         # hedef GitHub reposuna setup.config.json entegre et
 *   node bin/setup.mjs detect       # yalnız algılama raporu
 *   node bin/setup.mjs setup        # bootstrap UI başlat (5049)
 *   node bin/setup.mjs wizard       # doğrudan kurulum sihirbazını başlat (5050)
 *   node bin/setup.mjs version      # sürüm bilgisini göster (v1.0.0)
 *   node bin/setup.mjs --root PATH  # hedef dizin
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { buildInstallPlan, detectProject } from "../scripts/detect-project.mjs";
import { initProject } from "../scripts/setup-api.mjs";
import { getVersion, parseSemver } from "../scripts/version.mjs";

const VALID_COMMANDS = new Set(["detect", "plan", "setup", "wizard", "init", "version", "help"]);
const PASSTHROUGH_FLAGS = new Set(["--no-open", "--check-only", "--force"]);

export function parseArgs(argv) {
  const args = { command: "setup", root: process.cwd(), force: false, launchers: true, updatePackageJson: false, port: null, dataDir: null, error: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--root") {
      const next = argv[i + 1];
      if (!next || next.startsWith("-")) {
        args.error = "--root seçeneği için geçerli bir dizin yolu belirtilmelidir.";
        return args;
      }
      args.root = path.resolve(argv[++i]);
    } else if (a === "--port") {
      const next = argv[i + 1];
      const portNum = Number(next);
      if (!next || next.startsWith("-") || !Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
        args.error = "--port seçeneği için geçerli bir port numarası (1-65535) belirtilmelidir.";
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
    } else if (a === "--update-package-json") {
      args.updatePackageJson = true;
    } else if (a === "--help" || a === "-h") {
      args.command = "help";
    } else if (a === "--version" || a === "-v") {
      args.command = "version";
    } else if (a === "--force" || a === "-f") {
      args.force = true;
    } else if (VALID_COMMANDS.has(a)) {
      args.command = a;
    } else if (PASSTHROUGH_FLAGS.has(a)) {
      // alt süreçlere aktarılan bayraklar
    } else {
      args.error = `Bilinmeyen komut veya seçenek: ${a}`;
      return args;
    }
  }
  return args;
}

function printHelp() {
  const v = parseSemver(getVersion());
  console.log(`
setup ${v.fullTag} (${v.shortTag}) — Bağımsız GitHub Uygulama Kurulum Eklentisi

Komutlar:
  setup    Kurulum başlatıcı arayüzünü aç (varsayılan, port 5049)
  wizard   Doğrudan web kurulum sihirbazını aç (port 5050)
  init     Hedef repoya setup.config.json ve kurulum.bat / kurulum.sh başlatıcılarını ekle
  detect   Dizini ve içeriği analiz et, kurulum planını JSON olarak yaz
  plan     detect ile aynı
  version  Sürüm bilgisini göster
  help     Bu yardım mesajını göster

Seçenekler:
  --root <yol>       Hedef uygulama kök dizini (varsayılan: cwd)
  --port <numara>    Sihirbaz veya başlatıcı portunu özelleştir
  --data-dir <yol>   Kurulum verileri ve .env için harici dizin belirt
  --force, -f        init sırasında mevcut setup.config.json ve başlatıcıların üzerine yaz
  --no-launchers     init sırasında kurulum.bat / kurulum.sh üretme
  --update-package-json  init sırasında package.json'a "setup" script'i ekle (varsayılan: dokunma)
  --no-open          Tarayıcıyı otomatik açma
  --check-only       Yalnız durum JSON çıktısını ver ve çık

Örnek:
  node bin/setup.mjs init --root /path/to/github-repo
  node bin/setup.mjs --root /path/to/github-repo
  node bin/setup.mjs detect --root .
`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.error(`[setup] Hata: ${args.error}`);
    printHelp();
    process.exit(1);
    return;
  }
  if (args.command === "help") {
    printHelp();
    return;
  }
  if (args.command === "version") {
    const v = parseSemver(getVersion());
    console.log(`setup ${v.fullTag} (${v.shortTag})`);
    return;
  }
  if (args.command === "init") {
    const res = initProject(args.root, { overwrite: args.force, updatePackageJson: args.updatePackageJson, createLaunchers: args.launchers });
    console.log(`[setup] ${res.message}`);
    if (res.launchersCreated) console.log("[setup] Başlatıcılar: kurulum.bat (Windows) / kurulum.sh (Linux/macOS)");
    if (res.packageJsonUpdated) console.log("[setup] package.json içine \"setup\" script'i eklendi.");
    process.exit(res.created || res.launchersCreated ? 0 : 1);
    return;
  }

  const detection = detectProject(args.root);
  const plan = buildInstallPlan(detection);

  if (args.command === "detect" || args.command === "plan") {
    console.log(JSON.stringify({ version: getVersion(), detection, plan }, null, 2));
    process.exit(plan.canInstall ? 0 : 1);
    return;
  }

  console.log(`[setup v${getVersion()}] Proje: ${detection.projectName} (${detection.kind}, paket yöneticisi: ${detection.packageManager})`);
  console.log(`[setup] Kök: ${detection.root}`);
  if (plan.canInstall && !fs.existsSync(path.join(detection.root, "setup.config.json"))) {
    initProject(detection.root, { overwrite: false, updatePackageJson: false, createLaunchers: false });
    console.log(`[setup] Otomatik tanı: ${detection.scenario.label}`);
    console.log("[setup] setup.config.json otomatik oluşturuldu.");
  } else {
    console.log(`[setup] Algılanan Mimari: ${detection.scenario.label}`);
  }
  console.log("[setup] Plan:");
  for (const step of plan.steps) {
    console.log(`  - ${step.label}`);
  }
  if (!plan.canInstall) {
    console.error("[setup] Bu dizinde kurulum planlanamadı. Geçerli bir package.json veya proje yapısı bulunamadı.");
    process.exit(1);
  }

  process.env.SETUP_PROJECT_ROOT = detection.root;
  process.env.SETUP_PROJECT_NAME = detection.projectName;
  if (args.dataDir) {
    process.env.SETUP_DATA_DIR = args.dataDir;
  }
  if (args.port) {
    if (args.command === "wizard") {
      process.env.SETUP_WIZARD_PORT = String(args.port);
      process.env.SETUP_PORT = String(args.port);
    } else {
      process.env.SETUP_BOOTSTRAP_PORT = String(args.port);
    }
  }

  if (args.command === "wizard") {
    console.log("[setup] Web kurulum sihirbazı açılıyor...");
    import("../wizard/server.mjs").then((mod) => mod.startSetupWizard()).catch((error) => {
      console.error("[setup] Sihirbaz açılamadı:", error.message);
      process.exit(1);
    });
    return;
  }

  console.log("[setup] Kurulum başlatıcı açılıyor...");
  import("../scripts/setup-bootstrap.mjs").catch((error) => {
    console.error("[setup] Başlatıcı açılamadı:", error.message);
    process.exit(1);
  });
}

if (import.meta.url && process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
