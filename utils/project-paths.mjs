import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function getProjectRoot() {
  if (process.env.SETUP_PROJECT_ROOT) {
    return path.resolve(process.env.SETUP_PROJECT_ROOT);
  }
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidate = path.resolve(currentDir, "..");
  if (fs.existsSync(path.join(candidate, "package.json"))) {
    return candidate;
  }
  return process.cwd();
}
