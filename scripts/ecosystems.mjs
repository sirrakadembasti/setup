/**
 * Ek dil/ekosistem algılama ve kurulum/başlatma profilleri:
 *   .NET (Framework, Core/5+, ASP.NET MVC/Razor/Blazor/Web API, Worker, WinForms, WPF, WinUI, MAUI, Avalonia, Uno, Xamarin; C#/VB/F#),
 *   Java (Maven/Gradle; Spring Boot, Quarkus, Micronaut, JavaFX, Swing, Compose), PHP (Laravel, Symfony…), Ruby (Rails, Rack, Sinatra, Jekyll),
 *   Flutter, Swift, Go/Rust masaüstü, Lazarus/Delphi, Docker/Compose.
 * Bu modül yalnızca yerleşik Node modüllerine bağlıdır; polyglot.mjs ve detect-project.mjs onu kullanır.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const IGNORED_DIRS = new Set([
  "node_modules", ".git", ".hg", ".svn", "bin", "obj", ".vs", ".idea", "dist", "build", "out", "target", "packages",
  "vendor", ".gradle", ".venv", "venv", "__pycache__", "testresults", "artifacts", "pods", ".dart_tool", ".build",
]);

const exists = (...parts) => fs.existsSync(path.join(...parts));
const toPosix = (p) => p.split(path.sep).join("/");

function read(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function findFiles(root, test, maxDepth = 4) {
  const found = [];
  (function scan(dir, depth) {
    if (depth > maxDepth) return;
    for (const ent of listDir(dir)) {
      if (ent.isSymbolicLink()) continue;
      if (ent.isDirectory()) {
        if (!IGNORED_DIRS.has(ent.name.toLowerCase()) && !ent.name.startsWith(".")) scan(path.join(dir, ent.name), depth + 1);
      } else if (ent.isFile() && test(ent.name)) {
        found.push(path.join(dir, ent.name));
      }
    }
  })(root, 0);
  return found;
}

/** Python GUI/oyun kütüphaneleri (tkinter, Qt, wx, kivy, pygame, flet …). */
export const PYTHON_GUI_PATTERN =
  /\b(?:import\s+(?:tkinter|PyQt[56]|PySide[26]|wx|kivy|pygame|customtkinter|flet|dearpygui|pyglet|toga|arcade)|from\s+(?:tkinter|PyQt[56]|PySide[26]|wx|kivy|pygame|customtkinter|flet|dearpygui|pyglet|toga|arcade)\b)/;

// =============================================================== .NET

const tag = (text, name) => text.match(new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`, "i"))?.[1] ?? null;
const isTrue = (value) => /^true$/i.test(String(value || ""));

const DOTNET_LABELS = Object.freeze({
  mvc: "ASP.NET Core MVC",
  "razor-pages": "ASP.NET Core Razor Pages",
  "blazor-server": "Blazor",
  "blazor-wasm": "Blazor WebAssembly",
  webapi: "ASP.NET Core Web API",
  "minimal-api": "ASP.NET Core (minimal API)",
  "aspnet-mvc-framework": "ASP.NET MVC (.NET Framework)",
  "aspnet-webforms": "ASP.NET Web Forms (.NET Framework)",
  wcf: "WCF servisi (.NET Framework)",
  worker: ".NET Worker Service",
  console: ".NET konsol uygulaması",
  winforms: "Windows Forms",
  wpf: "WPF",
  winui: "WinUI 3",
  maui: ".NET MAUI",
  avalonia: "Avalonia",
  uno: "Uno Platform",
  xamarin: "Xamarin",
  winexe: "Windows masaüstü uygulaması",
  library: "Sınıf kitaplığı",
  test: "Test projesi",
});

function aspnetFlavor(dir, programText) {
  if (exists(dir, "Controllers") && exists(dir, "Views")) return "mvc";
  if (listDir(path.join(dir, "Pages")).some((e) => /\.cshtml$/i.test(e.name))) return "razor-pages";
  if (exists(dir, "Components", "App.razor") || exists(dir, "App.razor") || /AddRazorComponents|AddServerSideBlazor/.test(programText)) return "blazor-server";
  if (exists(dir, "Controllers") || /MapControllers|AddControllers/.test(programText)) return "webapi";
  return "minimal-api";
}

/** Tek bir .csproj / .vbproj / .fsproj dosyasını çözümler. */
export function parseDotnetProject(root, absFile) {
  const text = read(absFile);
  const dir = path.dirname(absFile);
  const ext = path.extname(absFile).slice(1).toLowerCase();
  const name = path.basename(absFile, path.extname(absFile));
  const sdk =
    text.match(/<Project\b[^>]*\bSdk="([^"]+)"/i)?.[1] ||
    text.match(/<Sdk\s+Name="([^"]+)"/i)?.[1] ||
    text.match(/<Import\b[^>]*\bSdk="([^"]+)"/i)?.[1] ||
    null;
  const sdkStyle = Boolean(sdk);
  const sdkLower = (sdk || "").toLowerCase();
  const singleTfm = tag(text, "TargetFramework");
  const tfms = (tag(text, "TargetFrameworks") || singleTfm || "").split(";").map((s) => s.trim()).filter(Boolean);
  const frameworkVersion = tag(text, "TargetFrameworkVersion");
  const outputType = tag(text, "OutputType");
  const pkgs = [...text.matchAll(/<PackageReference\b[^>]*\b(?:Include|Update)="([^"]+)"/gi)].map((m) => m[1]);
  const refs = [...text.matchAll(/<Reference\b[^>]*\bInclude="([^",]+)/gi)].map((m) => m[1].toLowerCase());
  const guids = (tag(text, "ProjectTypeGuids") || "").toLowerCase();
  const hasPkg = (...prefixes) => pkgs.some((p) => prefixes.some((x) => p.toLowerCase().startsWith(x.toLowerCase())));
  const hasRef = (...names) => refs.some((r) => names.some((n) => r === n.toLowerCase()));
  const exeLike = /^(win)?exe$/i.test(outputType || "");

  let ui;
  let category;
  const programText = read(path.join(dir, "Program.cs")) + read(path.join(dir, "Program.vb")) + read(path.join(dir, "Program.fs"));

  if (hasPkg("Microsoft.NET.Test.Sdk", "xunit", "nunit", "MSTest") || isTrue(tag(text, "IsTestProject")) || hasRef("Microsoft.VisualStudio.QualityTools.UnitTestFramework", "nunit.framework")) {
    ui = "test"; category = "test";
  } else if (isTrue(tag(text, "UseMaui")) || hasPkg("Microsoft.Maui")) {
    ui = "maui"; category = "desktop";
  } else if (sdkLower.startsWith("uno.sdk") || hasPkg("Uno.WinUI", "Uno.UI")) {
    ui = "uno"; category = "desktop";
  } else if (hasPkg("Avalonia")) {
    ui = "avalonia"; category = "desktop";
  } else if (isTrue(tag(text, "UseWinUI")) || hasPkg("Microsoft.WindowsAppSDK")) {
    ui = "winui"; category = "desktop";
  } else if (hasPkg("Xamarin.Forms", "Xamarin.Essentials") || /monoandroid|xamarin\.ios|xamarinios/i.test(text)) {
    ui = "xamarin"; category = "mobile";
  } else if (isTrue(tag(text, "UseWPF")) || hasRef("PresentationFramework") || /<ApplicationDefinition\b/i.test(text)) {
    ui = "wpf"; category = "desktop";
  } else if (isTrue(tag(text, "UseWindowsForms")) || hasRef("System.Windows.Forms")) {
    ui = "winforms"; category = "desktop";
  } else if (sdkLower.includes("blazorwebassembly") || hasPkg("Microsoft.AspNetCore.Components.WebAssembly")) {
    ui = "blazor-wasm"; category = "web";
  } else if (sdkLower.includes("sdk.web") || /<FrameworkReference\b[^>]*Microsoft\.AspNetCore\.App/i.test(text)) {
    ui = aspnetFlavor(dir, programText); category = "web";
  } else if (!sdkStyle && (guids.includes("349c5851-65df-11da-9384-00065b846f21") || hasRef("System.Web.Mvc"))) {
    ui = "aspnet-mvc-framework"; category = "web";
  } else if (!sdkStyle && (guids.includes("e24c65dc-7377-472b-9aba-bc803b73c61a") || (hasRef("System.Web") && (exists(dir, "Web.config") || exists(dir, "Global.asax"))))) {
    ui = "aspnet-webforms"; category = "web";
  } else if (!sdkStyle && hasRef("System.ServiceModel") && listDir(dir).some((e) => /\.svc$/i.test(e.name))) {
    ui = "wcf"; category = "web";
  } else if (sdkLower.includes("sdk.worker") || (hasPkg("Microsoft.Extensions.Hosting") && exeLike)) {
    ui = "worker"; category = "service";
  } else if (/^winexe$/i.test(outputType || "")) {
    ui = "winexe"; category = "desktop";
  } else if (exeLike) {
    ui = "console"; category = "console";
  } else {
    ui = "library"; category = "library";
  }

  // Klasik .NET Framework projesi: SDK özniteliği yok ve Framework sürümü / CSharp.targets / packages.config var.
  const legacy = !sdkStyle && Boolean(frameworkVersion || /Microsoft\.(?:CSharp|VisualBasic|FSharp)\.targets/i.test(text) || exists(dir, "packages.config"));
  const windowsOnly = legacy
    ? ["wpf", "winui", "aspnet-mvc-framework", "aspnet-webforms", "wcf"].includes(ui)
    : ["winforms", "wpf", "winui"].includes(ui) || (ui === "winexe" && /-windows/i.test(tfms.join(";")));
  const monoCapable = legacy && ["winforms", "console", "winexe"].includes(ui);

  return {
    rel: toPosix(path.relative(root, absFile)),
    dir: toPosix(path.relative(root, dir)) || ".",
    file: path.basename(absFile),
    name,
    language: ext === "vbproj" ? "vb" : ext === "fsproj" ? "fs" : "cs",
    assemblyName: tag(text, "AssemblyName") || name,
    sdk, sdkStyle, legacy, tfms, frameworkVersion, outputType, ui, category, windowsOnly, monoCapable,
    usesPackagesConfig: exists(dir, "packages.config"),
    usesPackageReference: pkgs.length > 0,
    label: DOTNET_LABELS[ui] || ui,
  };
}

const DOTNET_PRIORITY = { web: 0, desktop: 1, mobile: 2, service: 3, console: 4, library: 8, test: 9 };

/** Depodaki tüm .NET projelerini bulur ve çalıştırılacak ana projeyi seçer. */
export function analyzeDotnet(root, maxDepth = 4) {
  const projectFiles = findFiles(root, (n) => /\.(csproj|vbproj|fsproj)$/i.test(n), maxDepth);
  if (projectFiles.length === 0) return null;
  const projects = projectFiles.map((f) => parseDotnetProject(root, f));
  const solution = listDir(root).find((e) => e.isFile() && /\.(sln|slnx)$/i.test(e.name))?.name || null;
  const runnable = projects.filter((p) => !["library", "test"].includes(p.category));
  const pool = runnable.length > 0 ? runnable : projects.filter((p) => p.category !== "test");
  const primary = [...(pool.length > 0 ? pool : projects)].sort(
    (a, b) =>
      (DOTNET_PRIORITY[a.category] ?? 5) - (DOTNET_PRIORITY[b.category] ?? 5) ||
      a.rel.split("/").length - b.rel.split("/").length ||
      a.rel.localeCompare(b.rel),
  )[0];
  return { solution, projects, primary, legacy: primary.legacy, label: dotnetLabel(primary) };
}

function dotnetLabel(p) {
  if (!p) return ".NET";
  const fw = p.legacy ? `.NET Framework ${String(p.frameworkVersion || "").replace(/^v/i, "")}`.trim() : p.tfms.join(", ");
  const lang = p.language === "vb" ? "VB.NET " : p.language === "fs" ? "F# " : "";
  return `${lang}${p.label}${fw ? ` (${fw})` : ""}`;
}

function pickTfm(project, platform) {
  const { tfms, ui } = project;
  if (tfms.length <= 1) return null;
  if (ui === "maui") {
    if (platform === "win32") return tfms.find((t) => /-windows/i.test(t)) || null;
    if (platform === "darwin") return tfms.find((t) => /-maccatalyst/i.test(t)) || null;
    return null;
  }
  const portable = tfms.filter((t) => !/-(windows|android|ios|maccatalyst|tizen|browser)/i.test(t));
  if (platform === "win32" && project.category === "desktop") return tfms.find((t) => /-windows/i.test(t)) || portable[0] || tfms[0];
  return portable[0] || tfms[0];
}

/** Windows'ta MSBuild (Visual Studio / Build Tools) yolunu bulur. */
export function findMsbuild(env = process.env) {
  const candidates = [];
  for (const base of [env["ProgramFiles(x86)"], env.ProgramFiles]) {
    if (!base) continue;
    for (const edition of ["BuildTools", "Community", "Professional", "Enterprise"]) {
      for (const year of ["2022", "2019", "2017"]) {
        candidates.push(path.join(base, "Microsoft Visual Studio", year, edition, "MSBuild", "Current", "Bin", "MSBuild.exe"));
      }
    }
    candidates.push(path.join(base, "MSBuild", "14.0", "Bin", "MSBuild.exe"));
  }
  candidates.push(path.join(env.SystemRoot || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "MSBuild.exe"));
  return candidates.find((c) => fs.existsSync(c)) || null;
}

function findIisExpress(env = process.env) {
  return [env.ProgramFiles, env["ProgramFiles(x86)"]]
    .filter(Boolean)
    .map((b) => path.join(b, "IIS Express", "iisexpress.exe"))
    .find((c) => fs.existsSync(c)) || null;
}

function blocked(language, message, extra = {}) {
  return { language, steps: [], start: null, blocked: message, ...extra };
}

/** .NET kurulum/başlatma profili (platforma göre). */
export function dotnetProfile(root, port = 5000, options = {}) {
  const platform = options.platform || process.platform;
  const analysis = analyzeDotnet(root);
  if (!analysis) {
    return {
      language: "dotnet",
      steps: [
        { label: "Paketleri geri yükle (dotnet restore)", command: "dotnet", args: ["restore"] },
        { label: "Derlemeyi doğrula (dotnet build)", command: "dotnet", args: ["build", "--no-restore"] },
      ],
      start: { command: "dotnet", args: ["run"] },
    };
  }
  const p = analysis.primary;
  const isWeb = p.category === "web";
  const note = `${analysis.label}`;
  if (p.category === "library" || p.category === "test") {
    return blocked("dotnet", `${note}: çalıştırılabilir bir proje bulunamadı (yalnızca ${p.category === "test" ? "test" : "sınıf kitaplığı"} projeleri var). Bir web, konsol veya masaüstü projesi ekleyin ya da setup.config.json içinde 'start' komutu belirtin.`, { analysis, note });
  }

  // ---- Klasik .NET Framework (SDK stili olmayan projeler)
  if (p.legacy) {
    const target = analysis.solution || p.rel;
    if (platform === "win32") {
      const msbuild = options.msbuildPath ?? findMsbuild() ?? "msbuild";
      const steps = [];
      // Paket kullanmayan klasik projelerde geri yükleme gerekmez (eski MSBuild 4.0'da 'restore' hedefi de yoktur).
      if (p.usesPackagesConfig) steps.push({ label: "NuGet paketlerini geri yükle (nuget restore)", command: "nuget", args: ["restore", target] });
      else if (p.usesPackageReference) steps.push({ label: "NuGet paketlerini geri yükle", command: msbuild, args: ["-t:restore", target, "-nologo", "-v:minimal"] });
      steps.push({ label: "Derle (MSBuild)", command: msbuild, args: [target, "-p:Configuration=Debug", "-nologo", "-v:minimal"] });
      if (isWeb) {
        const iis = options.iisExpressPath ?? findIisExpress();
        if (!iis) {
          return { ...blocked("dotnet", `${note}: IIS Express bulunamadı. Visual Studio ile birlikte gelen IIS Express'i kurun: https://www.microsoft.com/download/details.aspx?id=48264`), steps, analysis, note };
        }
        return { language: "dotnet", steps, start: { command: iis, args: [`/path:${path.join(root, p.dir)}`, `/port:${port}`] }, analysis, note };
      }
      const exe = path.join(root, p.dir, "bin", "Debug", `${p.assemblyName}.exe`);
      return { language: "dotnet", steps, start: { command: exe, args: [] }, analysis, note };
    }
    if (isWeb) {
      return blocked("dotnet", `${note} yalnızca Windows'ta (IIS Express) çalışır. Linux/macOS'ta projeyi .NET 6+ sürümüne taşıyın veya Windows kullanın.`, { analysis, note });
    }
    if (!p.monoCapable) {
      return blocked("dotnet", `${note} yalnızca Windows'ta çalışır.`, { analysis, note });
    }
    const exe = path.join(root, p.dir, "bin", "Debug", `${p.assemblyName}.exe`);
    return {
      language: "dotnet",
      steps: [
        ...(p.usesPackagesConfig || p.usesPackageReference
          ? [{ label: "NuGet paketlerini geri yükle (msbuild -t:restore)", command: "msbuild", args: ["-t:restore", analysis.solution || p.rel] }]
          : []),
        { label: "Derle (msbuild, Mono)", command: "msbuild", args: [analysis.solution || p.rel, "-p:Configuration=Debug"] },
      ],
      start: { command: "mono", args: [exe] },
      analysis, note,
    };
  }

  // ---- SDK stili (.NET Core / .NET 5+ / .NET Standard hedefleyen yeni stil projeler)
  if (p.windowsOnly && platform !== "win32") {
    return blocked("dotnet", `${note} yalnızca Windows'ta çalışır (Windows API'lerine bağlı). Linux/macOS için Avalonia, MAUI veya ASP.NET Core kullanın.`, { analysis, note });
  }
  if (p.ui === "maui" && platform === "linux") {
    return blocked("dotnet", `${note} Linux'ta desteklenmez (yalnızca Windows, macOS, Android, iOS). Windows veya macOS kullanın.`, { analysis, note });
  }
  if (p.ui === "xamarin") {
    return blocked("dotnet", `${note}: Xamarin projeleri Visual Studio / Android-iOS iş yükleri gerektirir; otomatik başlatma desteklenmez. .NET MAUI'ye taşıyın.`, { analysis, note });
  }
  const target = analysis.solution && analysis.projects.length > 1 ? analysis.solution : p.rel;
  const tfm = pickTfm(p, platform);
  const frameworkArgs = tfm ? ["-f", tfm] : [];
  const steps = [];
  if (p.ui === "maui") steps.push({ label: ".NET MAUI iş yüklerini kur (dotnet workload restore)", command: "dotnet", args: ["workload", "restore", p.rel] });
  steps.push(
    { label: "Paketleri geri yükle (dotnet restore)", command: "dotnet", args: ["restore", target] },
    { label: "Derlemeyi doğrula (dotnet build)", command: "dotnet", args: ["build", "--no-restore", p.rel, ...frameworkArgs] },
  );
  const urlArgs = isWeb ? ["--urls", `http://127.0.0.1:${port}`] : [];
  return {
    language: "dotnet",
    steps,
    // Eski çalışma zamanını hedefleyen projeler yalnızca yeni çalışma zamanı kuruluysa da çalışabilsin.
    start: { command: "dotnet", args: ["run", "--project", p.rel, ...frameworkArgs, ...urlArgs], env: { DOTNET_ROLL_FORWARD: "LatestMajor" } },
    analysis, note,
  };
}

/** .NET projesi için (sınıflandırma) çekirdek algılama sonucu. */
function detectDotnet(dir) {
  const analysis = analyzeDotnet(dir);
  if (!analysis) return null;
  const category = analysis.primary.category;
  const web = category === "web";
  return {
    id: "dotnet",
    kind: web ? "dotnet-server" : "dotnet-desktop",
    role: web ? "backend" : "desktop",
    high: false,
    early: false,
    markers: ["dotnet"],
    label: analysis.label,
    details: { solution: analysis.solution, primary: analysis.primary, projectCount: analysis.projects.length, legacy: analysis.legacy },
  };
}

// =============================================================== Java

function javaSourceUsesGui(dir) {
  let found = false;
  let checked = 0;
  (function scan(d, depth) {
    if (found || depth > 6 || checked > 60) return;
    for (const ent of listDir(d)) {
      if (found || checked > 60) return;
      if (ent.isDirectory() && !IGNORED_DIRS.has(ent.name.toLowerCase())) scan(path.join(d, ent.name), depth + 1);
      else if (ent.isFile() && /\.(java|kt)$/i.test(ent.name)) {
        checked += 1;
        if (/\b(?:import\s+(?:javax\.swing|java\.awt|javafx\.)|extends\s+(?:JFrame|Application)\b)/.test(read(path.join(d, ent.name)))) found = true;
      }
    }
  })(path.join(dir, "src"), 0);
  return found;
}

function findJavaMainClass(dir) {
  let result = null;
  (function scan(d, depth) {
    if (result || depth > 8) return;
    for (const ent of listDir(d)) {
      if (result) return;
      const full = path.join(d, ent.name);
      if (ent.isDirectory() && !IGNORED_DIRS.has(ent.name.toLowerCase())) scan(full, depth + 1);
      else if (ent.isFile() && /\.java$/i.test(ent.name)) {
        const text = read(full);
        if (/public\s+static\s+void\s+main\s*\(/.test(text)) {
          const pkg = text.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1];
          result = `${pkg ? `${pkg}.` : ""}${ent.name.replace(/\.java$/i, "")}`;
        }
      }
    }
  })(path.join(dir, "src", "main", "java"), 0);
  return result;
}

export function analyzeJava(dir) {
  const hasPom = exists(dir, "pom.xml");
  const gradleFile = ["build.gradle.kts", "build.gradle"].find((f) => exists(dir, f));
  const hasSettings = exists(dir, "settings.gradle") || exists(dir, "settings.gradle.kts");
  if (!hasPom && !gradleFile && !hasSettings) return null;
  const tool = hasPom ? "maven" : "gradle";
  let text = `${read(path.join(dir, "pom.xml"))}\n${gradleFile ? read(path.join(dir, gradleFile)) : ""}`;
  // Çok modüllü projelerde alt modüllerin tanımları da çerçeve algısına katılır.
  for (const ent of listDir(dir)) {
    if (ent.isDirectory() && !IGNORED_DIRS.has(ent.name.toLowerCase()) && !ent.name.startsWith(".")) {
      text += `\n${read(path.join(dir, ent.name, "pom.xml"))}\n${read(path.join(dir, ent.name, "build.gradle"))}\n${read(path.join(dir, ent.name, "build.gradle.kts"))}`;
    }
  }
  const has = (re) => re.test(text);
  const frameworks = {
    springBoot: has(/spring-boot/i),
    quarkus: has(/quarkus/i),
    micronaut: has(/micronaut/i),
    javafx: has(/javafx|org\.openjfx/i),
    compose: has(/org\.jetbrains\.compose/i),
    application: has(/(?:id\s*\(?\s*["']application["']|apply\s+plugin:\s*["']application["']|^\s*application\s*\{)/m),
    ktor: has(/ktor/i),
    war: has(/<packaging>\s*war\s*<\/packaging>/i),
  };
  const desktop = frameworks.javafx || frameworks.compose || (!frameworks.springBoot && !frameworks.quarkus && !frameworks.micronaut && !frameworks.ktor && javaSourceUsesGui(dir));
  const wrapper = tool === "maven" ? ["mvnw", "mvnw.cmd"].some((f) => exists(dir, f)) : ["gradlew", "gradlew.bat"].some((f) => exists(dir, f));
  const framework = Object.entries({ "Spring Boot": frameworks.springBoot, Quarkus: frameworks.quarkus, Micronaut: frameworks.micronaut, JavaFX: frameworks.javafx, "Compose Desktop": frameworks.compose, Ktor: frameworks.ktor }).find(([, v]) => v)?.[0] || null;
  return { tool, frameworks, desktop, wrapper, framework, mainClass: findJavaMainClass(dir) };
}

function wrapperCommand(root, tool, platform) {
  const base = tool === "maven" ? "mvnw" : "gradlew";
  if (platform === "win32") return exists(root, `${base}.cmd`) || exists(root, `${base}.bat`)
    ? { command: path.join(root, exists(root, `${base}.cmd`) ? `${base}.cmd` : `${base}.bat`), args: [] }
    : null;
  return exists(root, base) ? { command: "sh", args: [path.join(root, base)] } : null;
}

export function javaProfile(root, port = 8080, options = {}) {
  const platform = options.platform || process.platform;
  const a = analyzeJava(root);
  if (!a) return null;
  const wrapper = wrapperCommand(root, a.tool, platform);
  const tool = wrapper || { command: a.tool === "maven" ? "mvn" : "gradle", args: [] };
  const run = (...args) => ({ command: tool.command, args: [...tool.args, ...args] });
  const env = { SERVER_PORT: String(port), PORT: String(port), QUARKUS_HTTP_PORT: String(port), MICRONAUT_SERVER_PORT: String(port) };
  let steps;
  let start;
  const note = `${a.framework || "Java"} (${a.tool === "maven" ? "Maven" : "Gradle"}${wrapper ? ", wrapper" : ""})`;
  if (a.tool === "maven") {
    steps = [{ label: "Bağımlılıkları indir ve derle (mvn compile)", ...run("-B", "-DskipTests", "compile") }];
    if (a.frameworks.springBoot) start = run("spring-boot:run");
    else if (a.frameworks.quarkus) start = run("quarkus:dev");
    else if (a.frameworks.micronaut) start = run("mn:run");
    else if (a.frameworks.javafx) start = run("javafx:run");
    else if (a.mainClass) start = { command: "java", args: ["-cp", "target/classes", a.mainClass] };
    else start = run("exec:java");
  } else {
    steps = [{ label: "Bağımlılıkları indir ve derle (gradle classes)", ...run("classes", "-x", "test") }];
    if (a.frameworks.springBoot) start = run("bootRun");
    else if (a.frameworks.quarkus) start = run("quarkusDev");
    else if (a.frameworks.micronaut) start = run("run");
    else start = run("run");
  }
  return { language: "java", steps, start: { ...start, env }, note, analysis: a };
}

function detectJava(dir) {
  const a = analyzeJava(dir);
  if (!a) return null;
  return {
    id: "java",
    kind: a.desktop ? "java-desktop" : "java-server",
    role: a.desktop ? "desktop" : "backend",
    high: true,
    early: false,
    markers: ["java", a.tool],
    label: `${a.framework || "Java"} (${a.tool === "maven" ? "Maven" : "Gradle"})`,
    details: a,
  };
}

// =============================================================== PHP

export function analyzePhp(dir) {
  const hasComposer = exists(dir, "composer.json");
  const hasIndex = exists(dir, "index.php") || exists(dir, "public", "index.php");
  if (!hasComposer && !hasIndex && !exists(dir, "artisan")) return null;
  if (!hasComposer && !hasIndex) return null;
  const composer = read(path.join(dir, "composer.json")).toLowerCase();
  let framework = null;
  if (exists(dir, "artisan") || composer.includes("laravel/framework")) framework = "Laravel";
  else if (composer.includes("symfony/framework-bundle")) framework = "Symfony";
  else if (composer.includes("codeigniter4")) framework = "CodeIgniter";
  else if (composer.includes("slim/slim")) framework = "Slim";
  else if (exists(dir, "wp-config.php") || exists(dir, "wp-content")) framework = "WordPress";
  const publicIndex = exists(dir, "public", "index.php");
  return { hasComposer, framework, publicIndex };
}

export function phpProfile(root, port = 8000) {
  const a = analyzePhp(root);
  if (!a) return null;
  const steps = [];
  if (a.hasComposer) steps.push({ label: "PHP bağımlılıklarını kur (composer install)", command: "composer", args: ["install", "--no-interaction", "--prefer-dist"] });
  else steps.push({ label: "PHP sürümünü doğrula", command: "php", args: ["--version"] });
  let start;
  if (a.framework === "Laravel") start = { command: "php", args: ["artisan", "serve", "--host=127.0.0.1", `--port=${port}`] };
  else if (a.publicIndex) start = { command: "php", args: ["-S", `127.0.0.1:${port}`, "-t", "public"] };
  else start = { command: "php", args: ["-S", `127.0.0.1:${port}`] };
  return { language: "php", steps, start, note: `PHP${a.framework ? ` / ${a.framework}` : ""}`, analysis: a };
}

function detectPhp(dir) {
  const a = analyzePhp(dir);
  if (!a) return null;
  // composer.json kesin işarettir (Node'dan önce gelir); yalnızca index.php olan basit projeler zayıf işaret sayılır.
  return { id: "php", kind: "php-server", role: "backend", high: a.hasComposer, early: false, markers: ["php"], label: `PHP${a.framework ? ` / ${a.framework}` : ""}`, details: a };
}

// =============================================================== Ruby

export function analyzeRuby(dir) {
  if (!exists(dir, "Gemfile")) return null;
  const gemfile = read(path.join(dir, "Gemfile"));
  const has = (gem) => new RegExp(`^\\s*gem\\s+["']${gem}["']`, "mi").test(gemfile);
  let framework = null;
  if (has("rails") || exists(dir, "config", "application.rb")) framework = "Rails";
  else if (has("sinatra")) framework = "Sinatra";
  else if (has("jekyll") || exists(dir, "_config.yml")) framework = "Jekyll";
  else if (exists(dir, "config.ru")) framework = "Rack";
  const entry = ["app.rb", "main.rb", "server.rb"].find((f) => exists(dir, f)) || null;
  return { framework, rackup: exists(dir, "config.ru"), entry };
}

export function rubyProfile(root, port = 3000) {
  const a = analyzeRuby(root);
  if (!a) return null;
  const steps = [{ label: "Ruby bağımlılıklarını kur (bundle install)", command: "bundle", args: ["install"] }];
  let start;
  if (a.framework === "Rails") start = { command: "bundle", args: ["exec", "rails", "server", "-b", "127.0.0.1", "-p", String(port)] };
  else if (a.framework === "Jekyll") start = { command: "bundle", args: ["exec", "jekyll", "serve", "--host", "127.0.0.1", "--port", String(port)] };
  else if (a.rackup) start = { command: "bundle", args: ["exec", "rackup", "--host", "127.0.0.1", "--port", String(port)] };
  else if (a.entry) start = { command: "bundle", args: ["exec", "ruby", a.entry, "-o", "127.0.0.1", "-p", String(port)] };
  else start = { command: "bundle", args: ["exec", "rackup", "--host", "127.0.0.1", "--port", String(port)] };
  return { language: "ruby", steps, start, note: `Ruby${a.framework ? ` / ${a.framework}` : ""}`, analysis: a };
}

function detectRuby(dir) {
  const a = analyzeRuby(dir);
  if (!a) return null;
  return { id: "ruby", kind: "ruby-server", role: "backend", high: true, early: false, markers: ["ruby"], label: `Ruby${a.framework ? ` / ${a.framework}` : ""}`, details: a };
}

// =============================================================== Flutter

export function analyzeFlutter(dir) {
  const pubspec = read(path.join(dir, "pubspec.yaml"));
  if (!pubspec || !/^\s*flutter\s*:/m.test(pubspec) || !/sdk\s*:\s*flutter/i.test(pubspec)) return null;
  const platforms = ["windows", "linux", "macos"].filter((p) => exists(dir, p));
  return { platforms, name: pubspec.match(/^name:\s*(\S+)/m)?.[1] || path.basename(dir) };
}

export function flutterProfile(root, port = 5000, options = {}) {
  const platform = options.platform || process.platform;
  const a = analyzeFlutter(root);
  if (!a) return null;
  const device = platform === "win32" ? "windows" : platform === "darwin" ? "macos" : "linux";
  const steps = [{ label: "Flutter paketlerini indir (flutter pub get)", command: "flutter", args: ["pub", "get"] }];
  if (!a.platforms.includes(device)) {
    return blocked("flutter", `Flutter projesinde '${device}' masaüstü desteği yok. Eklemek için: flutter create --platforms=${device} .`, { steps, analysis: a, note: "Flutter" });
  }
  return { language: "flutter", steps, start: { command: "flutter", args: ["run", "-d", device] }, note: `Flutter (${device})`, analysis: a };
}

function detectFlutter(dir) {
  const a = analyzeFlutter(dir);
  if (!a) return null;
  return { id: "flutter", kind: "flutter-desktop", role: "desktop", high: true, early: false, markers: ["flutter"], label: "Flutter", details: a };
}

// =============================================================== Go / Rust masaüstü

const GO_GUI = /wailsapp\/wails|fyne\.io\/fyne|gioui\.org|hajimehoshi\/ebiten|webview\/webview|go-gl\/glfw|raylib-go|andlabs\/ui/i;
const RUST_GUI = /^\s*(?:eframe|egui|iced|slint|gtk4?|fltk|druid|bevy|wry|tao|winit|relm4)\s*=/m;

function detectGoDesktop(dir) {
  const gomod = read(path.join(dir, "go.mod"));
  if (!gomod && !exists(dir, "wails.json")) return null;
  if (!exists(dir, "wails.json") && !GO_GUI.test(gomod)) return null;
  const wails = exists(dir, "wails.json") || /wailsapp\/wails/i.test(gomod);
  return { id: "go-desktop", kind: "go-desktop", role: "desktop", high: false, early: true, markers: ["go"], label: wails ? "Go / Wails" : "Go masaüstü (GUI)", details: { wails } };
}

function detectRustDesktop(dir) {
  const cargo = read(path.join(dir, "Cargo.toml"));
  if (!cargo || !RUST_GUI.test(cargo)) return null;
  if (exists(dir, "src-tauri", "tauri.conf.json") || exists(dir, "tauri.conf.json")) return null; // Tauri ayrı ele alınır
  return { id: "rust-desktop", kind: "rust-desktop", role: "desktop", high: false, early: true, markers: ["rust"], label: "Rust masaüstü (GUI)", details: {} };
}

// =============================================================== Swift

export function analyzeSwift(dir) {
  const pkg = read(path.join(dir, "Package.swift"));
  const xcode = listDir(dir).find((e) => /\.(xcodeproj|xcworkspace)$/i.test(e.name))?.name || null;
  if (!pkg && !xcode) return null;
  const server = /vapor|hummingbird|kitura/i.test(pkg);
  return { hasPackage: Boolean(pkg), xcode, server };
}

export function swiftProfile(root, port = 8080, options = {}) {
  const platform = options.platform || process.platform;
  const a = analyzeSwift(root);
  if (!a) return null;
  if (!a.hasPackage) {
    return blocked("swift", `Xcode projesi (${a.xcode}) yalnızca macOS'ta Xcode ile derlenir. Projeyi Xcode'da açın veya Package.swift ekleyin.`, { analysis: a, note: "Swift (Xcode)" });
  }
  if (!a.server && platform === "win32") {
    return blocked("swift", "Swift masaüstü uygulamaları Windows'ta desteklenmez. macOS veya Linux kullanın.", { analysis: a, note: "Swift" });
  }
  return {
    language: "swift",
    steps: [{ label: "Swift paketlerini çöz ve derle (swift build)", command: "swift", args: ["build"] }],
    start: { command: "swift", args: ["run"], env: { PORT: String(port) } },
    note: a.server ? "Swift / Vapor" : "Swift",
    analysis: a,
  };
}

function detectSwift(dir) {
  const a = analyzeSwift(dir);
  if (!a) return null;
  return { id: "swift", kind: "swift-app", role: a.server ? "backend" : "desktop", high: true, early: false, markers: ["swift"], label: a.server ? "Swift / Vapor" : "Swift", details: a };
}

// =============================================================== Lazarus / Delphi

/** Lazarus (.lpi) için derlenmiş ikilinin beklenen mutlak yolu; Delphi (.dproj) için Win32/Debug çıktısı. Yoksa null. */
export function pascalBinary(dir, platform = process.platform) {
  const files = listDir(dir).filter((e) => e.isFile()).map((e) => e.name);
  const exe = platform === "win32" ? ".exe" : "";
  const lpi = files.find((n) => /\.lpi$/i.test(n));
  if (lpi) {
    const base = lpi.replace(/\.lpi$/i, "");
    const target = read(path.join(dir, lpi)).match(/<Target>\s*<Filename\s+Value="([^"]+)"/i)?.[1];
    return { kind: "lazarus", project: lpi, binary: path.resolve(dir, target ? `${target}${exe}` : `${base}${exe}`) };
  }
  const dproj = files.find((n) => /\.dproj$/i.test(n));
  if (dproj) return { kind: "delphi", project: dproj, binary: path.join(dir, "Win32", "Debug", `${dproj.replace(/\.dproj$/i, "")}.exe`) };
  return null;
}

function detectPascal(dir) {
  const files = listDir(dir).filter((e) => e.isFile()).map((e) => e.name);
  const lpi = files.find((n) => /\.lpi$/i.test(n));
  if (lpi) return { id: "lazarus", kind: "lazarus-desktop", role: "desktop", high: false, early: true, markers: ["lazarus"], label: "Lazarus / Free Pascal", details: { project: lpi } };
  const dproj = files.find((n) => /\.dproj$/i.test(n));
  if (dproj) return { id: "delphi", kind: "delphi-desktop", role: "desktop", high: false, early: true, markers: ["delphi"], label: "Delphi", details: { project: dproj } };
  return null;
}

// =============================================================== Docker

export function analyzeDocker(dir) {
  const composeFile = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"].find((f) => exists(dir, f)) || null;
  const hasDockerfile = exists(dir, "Dockerfile");
  if (!composeFile && !hasDockerfile) return null;
  let port = null;
  if (composeFile) {
    const text = read(path.join(dir, composeFile));
    port = Number(text.match(/^\s*-\s*["']?(?:\d{1,3}(?:\.\d{1,3}){3}:)?(\d{2,5}):\d{2,5}(?:\/\w+)?["']?\s*$/m)?.[1]) || null;
  } else {
    port = Number(read(path.join(dir, "Dockerfile")).match(/^\s*EXPOSE\s+(\d{2,5})/im)?.[1]) || null;
  }
  return { composeFile, hasDockerfile, port };
}

export function dockerProfile(root, port = 5000) {
  const a = analyzeDocker(root);
  if (!a) return null;
  const hostPort = a.port || port;
  if (a.composeFile) {
    return {
      language: "docker",
      steps: [{ label: "Compose dosyasını doğrula (docker compose config)", command: "docker", args: ["compose", "config", "--quiet"] }],
      start: { command: "docker", args: ["compose", "up", "--build"], stop: { command: "docker", args: ["compose", "down"] } },
      port: hostPort,
      note: `Docker Compose (${a.composeFile})`,
      analysis: a,
    };
  }
  const image = `setup-${path.basename(root).toLowerCase().replace(/[^a-z0-9_.-]+/g, "-") || "app"}`;
  return {
    language: "docker",
    steps: [{ label: "Docker imajını derle (docker build)", command: "docker", args: ["build", "-t", image, "."] }],
    start: { command: "docker", args: ["run", "--rm", "-p", `${hostPort}:${a.port || hostPort}`, image] },
    port: hostPort,
    note: "Dockerfile",
    analysis: a,
  };
}

function detectDocker(dir) {
  const a = analyzeDocker(dir);
  if (!a) return null;
  return { id: "docker", kind: "docker-compose", role: "backend", high: false, early: false, markers: ["docker"], label: a.composeFile ? "Docker Compose" : "Dockerfile", details: a };
}

// =============================================================== Dışa açık giriş noktaları

/**
 * Bir dizindeki ek ekosistemi algılar. Dönüş: { id, kind, role, high, early, markers, label, details } | null
 *  - high : manifesto kesin (pom.xml, composer.json …); düğüm sunucusu yoksa Node sınıflandırmasından önce gelir
 *  - early: Python/Go/Rust/C++ zincirinden önce gelir (GUI varyantları)
 */
export function detectEcosystem(dir) {
  return (
    detectFlutter(dir) ||
    detectJava(dir) ||
    detectSwift(dir) ||
    detectPhp(dir) ||
    detectRuby(dir) ||
    detectGoDesktop(dir) ||
    detectRustDesktop(dir) ||
    detectPascal(dir) ||
    detectDotnet(dir) ||
    detectDocker(dir) ||
    null
  );
}

const PROFILE_BUILDERS = {
  "dotnet-server": dotnetProfile,
  "dotnet-desktop": dotnetProfile,
  "java-server": javaProfile,
  "java-desktop": javaProfile,
  "php-server": phpProfile,
  "ruby-server": rubyProfile,
  "flutter-desktop": flutterProfile,
  "swift-app": swiftProfile,
  "docker-compose": dockerProfile,
};

export const ECOSYSTEM_KINDS = Object.freeze({
  "java-server": "java",
  "java-desktop": "java",
  "php-server": "php",
  "ruby-server": "ruby",
  "flutter-desktop": "flutter",
  "swift-app": "swift",
  "docker-compose": "docker",
  "go-desktop": "go",
  "rust-desktop": "rust",
  "lazarus-desktop": "lazarus",
  "delphi-desktop": "delphi",
});

export const ECOSYSTEM_DESKTOP_KINDS = Object.freeze(["java-desktop", "flutter-desktop", "go-desktop", "rust-desktop", "lazarus-desktop", "delphi-desktop", "swift-app"]);
export const ECOSYSTEM_SERVER_KINDS = Object.freeze(["java-server", "php-server", "ruby-server", "docker-compose"]);

export function buildEcosystemProfile(root, kind, port, options = {}) {
  const builder = PROFILE_BUILDERS[kind];
  return builder ? builder(root, port, options) : null;
}

/** Ek ekosistemler için kurulum hazır mı? (checkDependencies tarafından kullanılır) */
/** Bundler gem'leri sisteme kurar (vendor/bundle ya da .bundle şart değil); doğru ölçüt `bundle check`'tir. */
function bundleCheckPasses(root) {
  try {
    const result = spawnSync("bundle", ["check"], { cwd: root, encoding: "utf8", timeout: 20000, windowsHide: true, shell: process.platform === "win32" });
    return result.status === 0;
  } catch {
    return false;
  }
}

export function ecosystemReadiness(root, options = {}) {
  if (exists(root, "pom.xml") || ["build.gradle", "build.gradle.kts"].some((f) => exists(root, f))) {
    const ready = exists(root, "target") || exists(root, "build") || exists(root, ".gradle");
    return { id: "java", ready };
  }
  if (exists(root, "composer.json")) return { id: "php", ready: exists(root, "vendor", "autoload.php") };
  if (exists(root, "Gemfile")) return { id: "ruby", ready: exists(root, "Gemfile.lock") && (exists(root, "vendor", "bundle") || exists(root, ".bundle") || (options.bundleCheck || bundleCheckPasses)(root)) };
  if (analyzeFlutter(root)) return { id: "flutter", ready: exists(root, ".dart_tool", "package_config.json") };
  if (exists(root, "Package.swift")) return { id: "swift", ready: exists(root, ".build") };
  const dotnet = analyzeDotnet(root);
  if (dotnet) {
    const p = dotnet.primary;
    const dir = path.join(root, p.dir === "." ? "" : p.dir);
    const ready = p.legacy ? exists(dir, "bin") || exists(root, "packages") : exists(dir, "obj", "project.assets.json");
    return { id: "dotnet", ready };
  }
  // Lazarus/Delphi: derlenmiş ikili yoksa kurulum (lazbuild/msbuild) henüz yapılmamıştır.
  const pascal = pascalBinary(root);
  if (pascal) return { id: pascal.kind, ready: fs.existsSync(pascal.binary) };
  return null;
}
