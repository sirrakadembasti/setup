import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

export function translateNpmArgs(args = [], baseCwd = process.cwd()) {
  let cwd = baseCwd;
  const bunArgs = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--prefix") {
      const next = args[++i];
      if (next) cwd = path.resolve(baseCwd, next);
    } else if (typeof a === "string" && a.startsWith("--prefix=")) {
      const val = a.slice("--prefix=".length);
      if (val) cwd = path.resolve(baseCwd, val);
    } else if (a === "ci" || a === "clean-install") {
      bunArgs.push("install");
    } else if (a === "--no-audit" || a === "--no-fund") {
      continue;
    } else {
      bunArgs.push(a);
    }
  }

  if (bunArgs.length === 0) bunArgs.push("install");
  return { cwd, args: bunArgs };
}

export function prepareBunLockFromNpmLock(cwd) {
  try {
    const pkgPath = path.join(cwd, "package.json");
    const lockPath = path.join(cwd, "package-lock.json");
    const bunLockPath = path.join(cwd, "bun.lock");
    const bunLockbPath = path.join(cwd, "bun.lockb");
    if (!fs.existsSync(pkgPath) || !fs.existsSync(lockPath)) return false;
    if (fs.existsSync(bunLockPath) || fs.existsSync(bunLockbPath)) return false;

    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    if (!lock?.packages || typeof lock.packages !== "object") return false;

    const hasOverrides = Boolean(
      pkg.overrides && typeof pkg.overrides === "object" && Object.keys(pkg.overrides).length > 0
    );
    const bunCache = path.join(os.homedir(), ".bun", "install", "cache");
    const missingEntries = [];

    if (fs.existsSync(bunCache)) {
      for (const [pkgKey, info] of Object.entries(lock.packages)) {
        if (!pkgKey || !info?.version || info.optional) continue;
        if (info.version.includes("-")) continue;
        const parts = pkgKey.split("node_modules/");
        const name = parts[parts.length - 1];
        if (!name) continue;
        let exactExists = false;
        let candidates = [];
        if (name.startsWith("@")) {
          const [scope, sub] = name.split("/");
          const scopeDir = path.join(bunCache, scope);
          exactExists = fs.existsSync(path.join(scopeDir, `${sub}@${info.version}@@@1`));
          if (!exactExists && fs.existsSync(scopeDir)) {
            candidates = fs
              .readdirSync(scopeDir)
              .filter((f) => f.startsWith(`${sub}@`) && f.endsWith("@@@1"))
              .map((f) => ({ ver: f.slice(sub.length + 1, -4), dir: path.join(scopeDir, f) }));
          }
        } else {
          exactExists = fs.existsSync(path.join(bunCache, `${name}@${info.version}@@@1`));
          if (!exactExists) {
            candidates = fs
              .readdirSync(bunCache)
              .filter((f) => f.startsWith(`${name}@`) && f.endsWith("@@@1"))
              .map((f) => ({ ver: f.slice(name.length + 1, -4), dir: path.join(bunCache, f) }));
          }
        }
        if (!exactExists && candidates.length > 0) {
          missingEntries.push({ pkgKey, name, originalVersion: info.version, candidates });
        }
      }
    }

    if (!hasOverrides && missingEntries.length === 0) return false;

    const optionSets = missingEntries.length === 0
      ? [[]]
      : missingEntries[0].candidates.map((c) => [{ entry: missingEntries[0], candidate: c }]);

    for (const choices of optionSets) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "setup-bunlock-"));
      try {
        const tmpPkg = JSON.parse(JSON.stringify(pkg));
        const tmpLock = JSON.parse(JSON.stringify(lock));
        delete tmpPkg.overrides;
        delete tmpPkg.scripts;
        if (tmpLock.packages[""]) delete tmpLock.packages[""].hasInstallScript;

        const restoredRanges = [];
        for (const { entry, candidate } of choices) {
          const candPkgPath = path.join(candidate.dir, "package.json");
          if (!fs.existsSync(candPkgPath)) continue;
          const candPkg = JSON.parse(fs.readFileSync(candPkgPath, "utf8"));
          const origInfo = tmpLock.packages[entry.pkgKey] || {};
          tmpLock.packages[entry.pkgKey] = {
            version: candPkg.version,
            ...(origInfo.dev ? { dev: true } : {}),
            license: candPkg.license || origInfo.license || "MIT",
            ...(candPkg.dependencies ? { dependencies: candPkg.dependencies } : {}),
            ...(candPkg.bin ? { bin: candPkg.bin } : {}),
            ...(candPkg.optionalDependencies ? { optionalDependencies: candPkg.optionalDependencies } : {}),
          };
          const tempRange = `^${candPkg.version}`;
          if (tmpPkg.dependencies?.[entry.name]) {
            restoredRanges.push({ name: entry.name, tempRange, origRange: pkg.dependencies[entry.name] });
            tmpPkg.dependencies[entry.name] = tempRange;
            if (tmpLock.packages[""]?.dependencies) tmpLock.packages[""].dependencies[entry.name] = tempRange;
          }
          if (tmpPkg.devDependencies?.[entry.name]) {
            restoredRanges.push({ name: entry.name, tempRange, origRange: pkg.devDependencies[entry.name] });
            tmpPkg.devDependencies[entry.name] = tempRange;
            if (tmpLock.packages[""]?.devDependencies) tmpLock.packages[""].devDependencies[entry.name] = tempRange;
          }
        }

        fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify(tmpPkg, null, 2));
        fs.writeFileSync(path.join(tmp, "package-lock.json"), JSON.stringify(tmpLock, null, 2));

        const lockRes = spawnSync("bun", ["install", "--lockfile-only", "--ignore-scripts"], {
          cwd: tmp,
          encoding: "utf8",
          windowsHide: true,
        });
        const tmpBunLock = path.join(tmp, "bun.lock");
        if (lockRes.status !== 0 || !fs.existsSync(tmpBunLock)) continue;

        let text = fs.readFileSync(tmpBunLock, "utf8");
        if (hasOverrides) {
          text = text.replace('"packages": {', `"overrides": ${JSON.stringify(pkg.overrides)},\n  "packages": {`);
        }
        for (const r of restoredRanges) {
          text = text.replace(`"${r.name}": "${r.tempRange}"`, `"${r.name}": "${r.origRange}"`);
        }
        fs.writeFileSync(tmpBunLock, text, "utf8");
        fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ ...pkg, scripts: undefined }, null, 2));

        const dryRes = spawnSync("bun", ["install", "--dry-run", "--ignore-scripts"], {
          cwd: tmp,
          encoding: "utf8",
          windowsHide: true,
        });
        if (dryRes.status === 0) {
          fs.copyFileSync(tmpBunLock, bunLockPath);
          return true;
        }
      } finally {
        try {
          fs.rmSync(tmp, { recursive: true, force: true });
        } catch {}
      }
    }
  } catch {}
  return false;
}

if (process.argv[1] && process.argv[1].endsWith("npm-shim.mjs")) {
  const translated = translateNpmArgs(process.argv.slice(2), process.cwd());
  if (translated.args.includes("install") || translated.args.includes("i")) {
    prepareBunLockFromNpmLock(translated.cwd);
  }
  const res = spawnSync("bun", translated.args, { cwd: translated.cwd, stdio: "inherit", shell: false });
  process.exit(res.status ?? (res.error ? 1 : 0));
}
