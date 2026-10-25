#!/usr/bin/env node
/**
 * setup — Bağımsız GitHub Uygulama Kurulum Eklentisi CLI (v1.0)
 * Kullanım:
 *   node bin/setup.mjs              # bulunduğum dizini algıla ve kur
 *   node bin/setup.mjs init         # hedef GitHub reposuna setup.config.json entegre et
 *   node bin/setup.mjs detect       # yalnız algılama raporu
 *   node bin/setup.mjs setup        # terminalde ön kontrol ve paket kurulumu
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
import { findListeningProcess, resolveEffectivePackageManager } from "../scripts/setup-bootstrap-lib.mjs";
import { getVersion, parseSemver } from "../scripts/version.mjs";

import { parseArgs, checkDirectoryWritability, resolveProjectTarget, resolveWizardPort } from "../scripts/cli-options.mjs";
export { parseArgs, checkDirectoryWritability };

function printHelp() {
  const v = parseSemver(getVersion());
  console.log(`
setup ${v.fullTag} (${v.shortTag}) — Bağımsız GitHub Uygulama Kurulum Eklentisi

Komutlar:
  setup    Terminalde ön kontrol ve paket kurulumu, ardından web sihirbazı
  wizard   Doğrudan web kurulum sihirbazını aç (port 5050)
  init     Hedef repoya setup.config.json ve kurulum.bat / kurulum.sh başlatıcılarını ekle
  detect   Dizini ve içeriği analiz et, kurulum planını JSON olarak yaz
  plan     detect ile aynı
  version  Sürüm bilgisini göster
  help     Bu yardım mesajını göster

Seçenekler:
  --root <yol>       Hedef uygulama kök dizini (varsayılan: cwd)
  --candidate <yol>  Çoklu alt proje içeren repolarda belirli bir alt projeyi seç
  --port <numara>    Web kurulum sihirbazı portunu özelleştir (varsayılan: 5050)
  --data-dir <yol>   Kurulum verileri ve .env için harici dizin belirt
  --reconfigure      Kurulum kilidi olsa dahi sihirbazı yeniden yapılandırma modunda aç
  --force, -f        init sırasında mevcut setup.config.json ve başlatıcıların üzerine yaz
  --copy-tools       init sırasında setup çekirdeğini tools/setup içine kopyalar (--tools, --offline)
  --no-launchers     init sırasında kurulum.bat / kurulum.sh üretme
  --refresh-launchers  init sırasında başlatıcıları yedekleyip yenile; yapılandırmayı koru
  --update-package-json  init sırasında package.json'a "setup" script'i ekle (varsayılan: dokunma)
  --no-open          Tarayıcıyı otomatik açma
  --check-only       Yalnız durum JSON çıktısını ver ve çık

Örnek:
  # Node.js / npx ile:
  npx github:sirrakadembasti/setup init --root /path/to/github-repo
  node bin/setup.mjs --root /path/to/github-repo

  # Bun / bunx ile:
  bunx github:sirrakadembasti/setup init --root /path/to/github-repo
  bun bin/setup.mjs --root /path/to/github-repo
`);
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
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

  if (["init", "setup", "wizard"].includes(args.command) && !args.checkOnly) {
    const rootCheck = checkDirectoryWritability(args.root);
    if (!rootCheck.writable) {
      console.error(`[setup] Hata: "${args.root}" dizinine yazma izni bulunmuyor (${rootCheck.code || rootCheck.error}). Kurulum ve yapılandırma dosyaları oluşturulamayacağından lütfen izinleri düzenleyin veya yetkili kullanıcı olarak çalıştırın.`);
      process.exit(1);
      return;
    }
    if (args.dataDir) {
      const dataCheck = checkDirectoryWritability(args.dataDir);
      if (!dataCheck.writable) {
        console.error(`[setup] Hata: Belirtilen harici veri dizinine ("${args.dataDir}") yazma izni bulunmuyor (${dataCheck.code || dataCheck.error}).`);
        process.exit(1);
        return;
      }
    }
  }

  if (args.command === "init") {
    const res = initProject(args.root, {
      overwrite: args.force,
      updatePackageJson: args.updatePackageJson,
      createLaunchers: args.launchers,
      copyTools: args.copyTools,
      refreshLaunchers: args.refreshLaunchers,
    });
    console.log(`[setup] ${res.message}`);
    if (res.toolsCopied) console.log("[setup] Çevrimdışı (offline) kurulum dosyaları tools/setup dizinine kopyalandı.");
    if (res.launchersCreated) console.log("[setup] Başlatıcılar: kurulum.bat (Windows) / kurulum.sh (Linux/macOS)");
    for (const backup of res.launcherBackups || []) console.log(`[setup] Önceki başlatıcı yedeği: ${backup}`);
    if (res.packageJsonUpdated) console.log("[setup] package.json içine \"setup\" script'i eklendi.");
    process.exit(res.created || res.launchersCreated || res.toolsCopied || args.refreshLaunchers ? 0 : 1);
    return;
  }

  if (args.command === "setup" || (args.command === "wizard" && args.checkOnly)) {
    return import("../scripts/terminal-bootstrap.mjs")
      .then(({ runTerminalBootstrap }) => runTerminalBootstrap({
        root: args.root,
        candidate: args.candidate,
        dataDir: args.dataDir,
        port: args.port,
        reconfigure: args.reconfigure || process.env.SETUP_RECONFIGURE === "true",
        noOpen: args.noOpen,
        checkOnly: args.checkOnly,
      }))
      .catch((error) => {
        console.error(`[setup] Başlatıcı çalıştırılamadı: ${error.message}`);
        process.exitCode = 1;
      });
    return;
  }

  const detection = args.command === "wizard"
    ? resolveProjectTarget(args.root, args.candidate).detection
    : detectProject(args.root, { candidate: args.candidate });
  if (args.command === "wizard") detection.ports.wizard = resolveWizardPort({ port: args.port, config: detection.setupConfig || {} });
  const effectivePm = resolveEffectivePackageManager(detection.packageManager);
  const plan = buildInstallPlan({ ...detection, packageManager: effectivePm });

  if (args.command === "detect" || args.command === "plan") {
    console.log(JSON.stringify({ version: getVersion(), detection: { ...detection, packageManager: effectivePm }, plan }, null, 2));
    process.exit(plan.canInstall ? 0 : 1);
    return;
  }

  const pmNote = effectivePm !== detection.packageManager
    ? ` (${detection.packageManager} algılandı, sistemde ${effectivePm} etkin)`
    : "";
  console.log(`[setup v${getVersion()}] Proje: ${detection.projectName} (${detection.kind}, paket yöneticisi: ${effectivePm}${pmNote})`);
  console.log(`[setup] Kök: ${detection.root}`);
  if (detection.candidateRoot) {
    console.log(`[setup] Aday Alt Proje: ${detection.candidateRoot}`);
  }
  if (detection.subprojects) {
    console.log(`[setup] Çok Parçalı Yapı: Backend (${detection.subprojects.backend?.dir}) + Frontend (${detection.subprojects.frontend?.dir})`);
  }
  if (detection.hasAmbiguity && Array.isArray(detection.candidates)) {
    console.log("[setup] ⚠️ Bu repoda birden çok bağımsız alt proje algılandı:");
    for (const c of detection.candidates) {
      console.log(`  - ${c.name} (${c.dir}, rol: ${c.role}, tür: ${c.kind})`);
    }
    console.log("[setup] Belirli bir alt projeyi seçmek için: --candidate <dizin> kullanabilirsiniz.");
  }
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
  if (args.reconfigure) {
    process.env.SETUP_RECONFIGURE = "true";
  }
  if (args.port) {
    process.env.SETUP_WIZARD_PORT = String(args.port);
    process.env.SETUP_PORT = String(args.port);
  }

  const targetPort = args.port || Number(process.env.SETUP_WIZARD_PORT) || detection.ports.wizard;
  const holder = findListeningProcess(targetPort);
  if (holder?.pid && holder.pid !== process.pid) {
    console.warn(`[setup] Uyarı: ${targetPort} portu şu an başka bir süreç tarafından kullanılıyor: ${holder.name || "Bilinmeyen"} (PID ${holder.pid}).`);
    console.warn(`[setup] Çakışmayı önlemek için '--port <yeni-port>' belirtebilir veya bu süreci sonlandırabilirsiniz.`);
  }

  if (args.command === "wizard") {
    console.log("[setup] Web kurulum sihirbazı açılıyor...");
    return import("../wizard/server.mjs").then((mod) => mod.manageSetupWizardLifecycle(mod.startSetupWizard({ projectRoot: detection.root, dataDir: args.dataDir, reconfigure: args.reconfigure }))).catch((error) => {
      console.error("[setup] Sihirbaz açılamadı:", error.message);
      process.exit(1);
    });
    return;
  }
}

if (import.meta.url && process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`[setup] ${error.message}`);
    process.exitCode = 1;
  });
}
