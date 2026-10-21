/**
 * Node.js dışı diller (Python, Go, C# .NET, Rust) için kurulum / başlatma / doğrulama profilleri.
 * Her profil `install.steps` (sırayla çalışan adımlar; son adımlar doğrulamadır) ve `start` komutu içerir.
 * Adım biçimi: { label, command, args, venv?: boolean, skipIfExists?: string }
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const LANGUAGE_KINDS = Object.freeze({
  "python-server": "python",
  "go-server": "go",
  "dotnet-server": "dotnet",
  "rust-server": "rust",
});

export const TOOLCHAIN_HINTS = Object.freeze({
  python: "Python 3: https://www.python.org/downloads/",
  go: "Go: https://go.dev/dl/",
  dotnet: ".NET SDK: https://dotnet.microsoft.com/download",
  cargo: "Rust (cargo): https://rustup.rs",
});

const VENV_DIR = ".venv";

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function exists(root, ...parts) {
  return fs.existsSync(path.join(root, ...parts));
}

/** Proje içindeki sanal ortamın Python yolu (yoksa null). */
export function resolveVenvPython(root) {
  const candidate =
    process.platform === "win32"
      ? path.join(root, VENV_DIR, "Scripts", "python.exe")
      : path.join(root, VENV_DIR, "bin", "python");
  return fs.existsSync(candidate) ? candidate : null;
}

/** Sistemde çalışan ilk Python yorumlayıcısı (python, python3, py). */
export function resolveSystemPython() {
  const candidates = process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"];
  for (const cmd of candidates) {
    const res = spawnSync(cmd, ["--version"], { encoding: "utf8", windowsHide: true, shell: false });
    if (!res.error && res.status === 0) return cmd;
  }
  return null;
}

/**
 * Bir adımın çalıştırılacak gerçek komutunu çözer.
 * venv=true ve sanal ortam varsa onun python'u; "python" için sistem python'u.
 */
export function resolveStepCommand(root, step) {
  if (step.command === "python") {
    if (step.venv) {
      const venvPython = resolveVenvPython(root);
      if (venvPython) return venvPython;
    }
    return resolveSystemPython() || "python";
  }
  return step.command;
}

function toolchainFor(step) {
  if (step.command === "python") return { command: "python", hint: TOOLCHAIN_HINTS.python };
  if (step.command === "go") return { command: "go", hint: TOOLCHAIN_HINTS.go };
  if (step.command === "dotnet") return { command: "dotnet", hint: TOOLCHAIN_HINTS.dotnet };
  if (step.command === "cargo") return { command: "cargo", hint: TOOLCHAIN_HINTS.cargo };
  return null;
}

/** Gerekli araç zinciri kurulu mu? Değilse okunur bir hata mesajı döndürür. */
export function checkToolchain(root, step) {
  const tool = toolchainFor(step);
  if (!tool) return { ok: true };
  const command = tool.command === "python" ? resolveSystemPython() : tool.command;
  if (!command) return { ok: false, message: `${tool.command} bulunamadı. Kurulum: ${tool.hint}` };
  const args = tool.command === "go" ? ["version"] : ["--version"];
  const res = spawnSync(command, args, { encoding: "utf8", windowsHide: true, shell: false, cwd: root });
  if (res.error || res.status !== 0) return { ok: false, message: `${tool.command} bulunamadı. Kurulum: ${tool.hint}` };
  return { ok: true };
}

// ---------------------------------------------------------------- Python

function pythonDependencyText(root) {
  return `${readText(path.join(root, "requirements.txt"))}\n${readText(path.join(root, "pyproject.toml"))}`.toLowerCase();
}

/** main.py / app.py ... içinde FastAPI/Starlette/Flask uygulama nesnesini bulur. */
export function findPythonApp(root) {
  const files = ["main.py", "app.py", "server.py", "src/main.py", "app/main.py", "src/app.py"];
  for (const rel of files) {
    const source = readText(path.join(root, rel));
    if (!source) continue;
    const asgi = source.match(/^(\w+)\s*=\s*(?:fastapi\.)?(FastAPI|Starlette)\s*\(/m);
    const flask = source.match(/^(\w+)\s*=\s*(?:flask\.)?Flask\s*\(/m);
    const module = rel.replace(/\.py$/, "").replaceAll("/", ".");
    if (asgi) return { kind: "asgi", file: rel, module, variable: asgi[1] };
    if (flask) return { kind: "flask", file: rel, module, variable: flask[1] };
  }
  return null;
}

function pythonProfile(root, port) {
  const deps = pythonDependencyText(root);
  const hasRequirements = exists(root, "requirements.txt");
  const installTarget = hasRequirements ? ["-r", "requirements.txt"] : ["-e", "."];
  const app = findPythonApp(root);
  const steps = [
    { label: "Sanal ortam oluştur (.venv)", command: "python", args: ["-m", "venv", VENV_DIR], skipIfExists: VENV_DIR },
    { label: hasRequirements ? "Bağımlılıkları kur (requirements.txt)" : "Projeyi kur (pyproject.toml)", command: "python", args: ["-m", "pip", "install", ...installTarget], venv: true },
  ];

  let start;
  if (exists(root, "manage.py")) {
    start = { command: "python", args: ["manage.py", "runserver", `127.0.0.1:${port}`], venv: true };
  } else if (app?.kind === "asgi") {
    if (!/\buvicorn\b/.test(deps)) {
      steps.push({ label: "uvicorn kur", command: "python", args: ["-m", "pip", "install", "uvicorn"], venv: true });
    }
    start = {
      command: "python",
      args: ["-m", "uvicorn", `${app.module}:${app.variable}`, "--host", "127.0.0.1", "--port", String(port)],
      venv: true,
    };
  } else if (app?.kind === "flask") {
    start = {
      command: "python",
      args: ["-m", "flask", "--app", `${app.module}:${app.variable}`, "run", "--host", "127.0.0.1", "--port", String(port)],
      venv: true,
    };
  } else {
    const entry = ["main.py", "app.py", "server.py"].find((file) => exists(root, file)) || "app.py";
    start = { command: "python", args: [entry], venv: true };
  }
  steps.push({ label: "Bağımlılık tutarlılığını doğrula (pip check)", command: "python", args: ["-m", "pip", "check"], venv: true });
  return { language: "python", steps, start };
}

// ---------------------------------------------------------------- Go

function goProfile(root) {
  const steps = [
    { label: "Modülleri indir (go mod download)", command: "go", args: ["mod", "download"] },
    { label: "Derlemeyi doğrula (go build ./...)", command: "go", args: ["build", "./..."] },
  ];
  let target = ".";
  if (!exists(root, "main.go")) {
    try {
      const cmdDir = path.join(root, "cmd");
      const entry = fs.readdirSync(cmdDir, { withFileTypes: true }).find((e) => e.isDirectory() && fs.existsSync(path.join(cmdDir, e.name, "main.go")));
      if (entry) target = `./cmd/${entry.name}`;
    } catch {
      /* cmd/ yok */
    }
  }
  return { language: "go", steps, start: { command: "go", args: ["run", target] } };
}

// ---------------------------------------------------------------- .NET

function findDotnetProject(root) {
  const rootFiles = safeReaddir(root).filter((e) => e.isFile()).map((e) => e.name);
  const rootProj = rootFiles.find((n) => /\.csproj$/i.test(n)) || rootFiles.find((n) => /\.(sln|slnx)$/i.test(n));
  if (rootFiles.some((n) => /\.csproj$/i.test(n))) return { restoreTarget: null, runProject: null };
  const candidates = [];
  for (const dir of safeReaddir(root).filter((e) => e.isDirectory() && !["node_modules", ".git", "bin", "obj"].includes(e.name))) {
    for (const file of safeReaddir(path.join(root, dir.name)).filter((e) => e.isFile() && /\.csproj$/i.test(e.name))) {
      const rel = `${dir.name}/${file.name}`;
      const isWeb = /Microsoft\.NET\.Sdk\.Web/.test(readText(path.join(root, dir.name, file.name)));
      candidates.push({ rel, isWeb });
    }
  }
  const chosen = candidates.find((c) => c.isWeb) || candidates[0];
  return { restoreTarget: rootProj || chosen?.rel || null, runProject: chosen?.rel || null };
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function dotnetProfile(root, port) {
  const { restoreTarget, runProject } = findDotnetProject(root);
  const target = restoreTarget ? [restoreTarget] : [];
  const steps = [
    { label: "Paketleri geri yükle (dotnet restore)", command: "dotnet", args: ["restore", ...target] },
    { label: "Derlemeyi doğrula (dotnet build)", command: "dotnet", args: ["build", "--no-restore", ...target] },
  ];
  const project = runProject ? ["--project", runProject] : [];
  return { language: "dotnet", steps, start: { command: "dotnet", args: ["run", ...project, "--urls", `http://127.0.0.1:${port}`] } };
}

// ---------------------------------------------------------------- Rust

function cargoPackageName(manifestText) {
  const pkg = manifestText.match(/\[package\][\s\S]*?^\s*name\s*=\s*"([^"]+)"/m);
  return pkg ? pkg[1] : null;
}

/** Çalıştırılacak Rust paketini seçer (çalışma alanı kökünde ilk ikili üye). */
export function findRustRunPackage(root) {
  const manifest = readText(path.join(root, "Cargo.toml"));
  if (/^\s*\[package\]/m.test(manifest)) return null; // kökte paket var: `cargo run` yeterli
  const members = manifest.match(/members\s*=\s*\[([^\]]*)\]/);
  if (!members) return null;
  for (const raw of members[1].split(",")) {
    const member = raw.trim().replace(/^["']|["']$/g, "");
    if (!member || /[*?]/.test(member)) continue;
    if (!exists(root, member, "src", "main.rs")) continue;
    const name = cargoPackageName(readText(path.join(root, member, "Cargo.toml")));
    if (name) return name;
  }
  return null;
}

function rustProfile(root) {
  const pkg = findRustRunPackage(root);
  const steps = [
    { label: "Bağımlılıkları indir (cargo fetch)", command: "cargo", args: ["fetch"] },
    { label: "Derlemeyi doğrula (cargo check)", command: "cargo", args: ["check"] },
  ];
  return { language: "rust", steps, start: { command: "cargo", args: ["run", ...(pkg ? ["-p", pkg] : [])] } };
}

/**
 * Dil çekirdeği profili. `kind` yoksa null döner.
 * @param {string} root
 * @param {string} kind detectProject().kind
 * @param {number} port uygulama portu
 */
export function resolveLanguageProfile(root, kind, port = 5000) {
  const language = LANGUAGE_KINDS[kind];
  if (!language) return null;
  if (language === "python") return pythonProfile(root, port);
  if (language === "go") return goProfile(root);
  if (language === "dotnet") return dotnetProfile(root, port);
  return rustProfile(root);
}
