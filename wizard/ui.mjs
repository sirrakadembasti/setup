import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const uiTsSource = fs.readFileSync(path.join(currentDir, "ui.ts"), "utf8");

// ui.ts içindeki gövde bir TS şablon dizgesidir: `\\`, `\n` gibi kaçışlar tarayıcıya gitmeden önce
// şablon semantiğiyle çözülmelidir (aksi halde /\\d/ veya /^https?:\\/\\// gibi ifadeler bozulur).
// Gövdede yalnız ${pageTitle} ve ${boot} ifadeleri bulunur; başka ifade eklenirse derleme hata verir.
const renderTemplate = (() => {
  const startIdx = uiTsSource.indexOf("return `<!doctype html>");
  const endIdx = uiTsSource.lastIndexOf("`;");
  const body = uiTsSource.slice(startIdx + "return `".length, endIdx);
  return new Function("pageTitle", "boot", `return \`${body}\`;`);
})();

export function renderSetupPage(csrfToken, options = {}) {
  const pageTitle = String(options.title || "Uygulama Kurulum Sihirbazı")
    .replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] || ch));
  const boot = JSON.stringify({
    csrfToken,
    apiBase: String(options.apiBase || "/api"),
    embedded: Boolean(options.embedded),
  }).replace(/</g, "\\u003c");
  return renderTemplate(pageTitle, boot);
}
