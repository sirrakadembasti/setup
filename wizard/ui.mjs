import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const uiTsSource = fs.readFileSync(path.join(currentDir, "ui.ts"), "utf8");

export function renderSetupPage(csrfToken, options = {}) {
  const pageTitle = String(options.title || "Uygulama Kurulum Sihirbazı")
    .replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] || ch));
  const boot = JSON.stringify({ csrfToken }).replace(/</g, "\\u003c");
  const startIdx = uiTsSource.indexOf("return `<!doctype html>");
  const endIdx = uiTsSource.lastIndexOf("`;");
  const templateBody = uiTsSource.slice(startIdx + "return `".length, endIdx);
  return templateBody
    .replaceAll("${pageTitle}", pageTitle)
    .replaceAll("${boot}", boot);
}
