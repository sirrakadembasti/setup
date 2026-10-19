#!/usr/bin/env node
/**
 * setup — Sürümleme (Versioning) Mekanizması
 * Kullanım:
 *   node scripts/version.mjs                    # mevcut sürümü yazdırır (v1.0.0)
 *   node scripts/version.mjs bump patch         # 1.0.0 -> 1.0.1
 *   node scripts/version.mjs bump minor         # 1.0.0 -> 1.1.0
 *   node scripts/version.mjs bump major         # 1.0.0 -> 2.0.0
 *   node scripts/version.mjs set 1.0.0          # belirli bir sürüme sabitle
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const versionFile = path.join(rootDir, "VERSION");
const pkgFile = path.join(rootDir, "package.json");
const changelogFile = path.join(rootDir, "CHANGELOG.md");

export function parseSemver(versionString) {
  const cleaned = String(versionString || "").trim().replace(/^v/i, "");
  const match = cleaned.match(/^(\d+)\.(\d+)(?:\.(\d+))?$/);
  if (!match) {
    throw new Error(`Geçersiz sürüm formatı: ${versionString} (Beklenen: X.Y.Z veya vX.Y)`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3] ?? 0),
    formatted: `${Number(match[1])}.${Number(match[2])}.${Number(match[3] ?? 0)}`,
    shortTag: `v${Number(match[1])}.${Number(match[2])}`,
    fullTag: `v${Number(match[1])}.${Number(match[2])}.${Number(match[3] ?? 0)}`,
  };
}

export function getVersion() {
  if (fs.existsSync(versionFile)) {
    const raw = fs.readFileSync(versionFile, "utf8").trim();
    if (raw) return parseSemver(raw).formatted;
  }
  if (fs.existsSync(pkgFile)) {
    const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
    if (pkg.version) return parseSemver(pkg.version).formatted;
  }
  return "1.0.0";
}

export function bumpSemver(current, type = "patch") {
  const parsed = parseSemver(current);
  if (type === "major") return `${parsed.major + 1}.0.0`;
  if (type === "minor") return `${parsed.major}.${parsed.minor + 1}.0`;
  if (type === "patch") return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  throw new Error(`Bilinmeyen sürüm artış tipi: ${type} (major | minor | patch kullanın)`);
}

export function writeVersion(newVersion, options = {}) {
  const parsed = parseSemver(newVersion);
  fs.writeFileSync(versionFile, `${parsed.formatted}\n`, "utf8");

  if (fs.existsSync(pkgFile)) {
    const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
    pkg.version = parsed.formatted;
    fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  }

  if (options.updateChangelog && fs.existsSync(changelogFile)) {
    const existing = fs.readFileSync(changelogFile, "utf8");
    const dateStr = new Date().toISOString().slice(0, 10);
    const header = `## [${parsed.fullTag}] - ${dateStr}`;
    if (!existing.includes(`[${parsed.fullTag}]`)) {
      const note = options.note || "Sürüm güncellemesi.";
      const updated = existing.replace(
        "# Değişiklik Günlüğü (Changelog)\n",
        `# Değişiklik Günlüğü (Changelog)\n\n${header}\n- ${note}\n`,
      );
      fs.writeFileSync(changelogFile, updated, "utf8");
    }
  }

  if (options.gitTag) {
    spawnSync("git", ["tag", "-f", parsed.fullTag], { cwd: rootDir, stdio: "ignore" });
    if (parsed.patch === 0) {
      spawnSync("git", ["tag", "-f", parsed.shortTag], { cwd: rootDir, stdio: "ignore" });
    }
  }

  return parsed;
}

if (import.meta.url && process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const cmd = args[0] || "get";
  const withTag = args.includes("--tag");
  if (cmd === "get") {
    const v = parseSemver(getVersion());
    console.log(`${v.fullTag} (${v.shortTag})`);
  } else if (cmd === "bump") {
    const level = args[1] || "patch";
    const next = bumpSemver(getVersion(), level);
    const res = writeVersion(next, { updateChangelog: true, gitTag: withTag });
    console.log(`[setup] Sürüm yükseltildi: ${res.fullTag}`);
  } else if (cmd === "set") {
    const target = args[1];
    if (!target) {
      console.error("Kullanım: node scripts/version.mjs set <X.Y.Z>");
      process.exit(1);
    }
    const res = writeVersion(target, { updateChangelog: true, gitTag: withTag });
    console.log(`[setup] Sürüm ayarlandı: ${res.fullTag}`);
  } else {
    console.error(`Bilinmeyen sürüm komutu: ${cmd}`);
    process.exit(1);
  }
}
