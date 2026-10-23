import { spawnSync } from "node:child_process";
import process from "node:process";

export function translatePnpmArgs(args = []) {
  if (!args || args.length === 0) return ["install"];
  const first = args[0];
  if (["install", "i", "add", "remove", "rm", "update", "upgrade", "outdated", "audit", "link", "unlink"].includes(first)) {
    return [...args];
  }
  let isRecursive = false;
  let isParallel = false;
  let filterVal = null;
  let filterHasEqual = false;
  const remaining = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-r" || a === "--recursive") {
      isRecursive = true;
    } else if (a === "--parallel") {
      isParallel = true;
    } else if (a.startsWith("--filter=")) {
      filterVal = a.slice("--filter=".length);
      filterHasEqual = true;
    } else if (a === "--filter" || a === "-F") {
      filterVal = args[++i] || "";
      filterHasEqual = false;
    } else if (a === "run") {
      continue;
    } else {
      remaining.push(a);
    }
  }

  const bunArgs = ["run"];
  if (isRecursive) {
    bunArgs.push("--workspaces");
  }
  if (filterVal !== null) {
    if (filterHasEqual) {
      bunArgs.push(`--filter=${filterVal}`);
    } else {
      bunArgs.push("--filter", filterVal);
    }
  }
  if (isParallel) {
    bunArgs.push("--parallel");
  }
  bunArgs.push(...remaining);
  return bunArgs;
}

if (process.argv[1] && process.argv[1].endsWith("pnpm-shim.mjs")) {
  const bunArgs = translatePnpmArgs(process.argv.slice(2));
  const res = spawnSync("bun", bunArgs, { stdio: "inherit", shell: false });
  process.exit(res.status ?? (res.error ? 1 : 0));
}
