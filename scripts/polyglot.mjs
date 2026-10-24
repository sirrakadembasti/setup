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
  "cpp-server": "cpp",
  "unity-game": "game",
  "unreal-game": "game",
  "godot-game": "game",
});

export const TOOLCHAIN_HINTS = Object.freeze({
  python: "Python 3: https://www.python.org/downloads/",
  go: "Go: https://go.dev/dl/",
  dotnet: ".NET SDK: https://dotnet.microsoft.com/download",
  cargo: "Rust (cargo): https://rustup.rs",
  cmake: "CMake: https://cmake.org/download/ (ve GCC/Clang/MSVC C/C++ derleyicisi)",
  godot: "Godot Engine: https://godotengine.org/download",
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
  if (step.command === "cmake") return { command: "cmake", hint: TOOLCHAIN_HINTS.cmake };
  if (step.command === "godot") return { command: "godot", hint: TOOLCHAIN_HINTS.godot };
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

function goProfile(root, port = 5000) {
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
  return { language: "go", steps, start: { command: "go", args: ["run", target] }, port };
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

function rustProfile(root, port = 5000) {
  const pkg = findRustRunPackage(root);
  const steps = [
    { label: "Bağımlılıkları indir (cargo fetch)", command: "cargo", args: ["fetch"] },
    { label: "Derlemeyi doğrula (cargo check)", command: "cargo", args: ["check"] },
  ];
  return { language: "rust", steps, start: { command: "cargo", args: ["run", ...(pkg ? ["-p", pkg] : [])] }, port };
}

/**
 * Dil çekirdeği profili. `kind` yoksa null döner.
 * @param {string} root
 * @param {string} kind detectProject().kind
 * @param {number} port uygulama portu
 */
// ---------------------------------------------------------------- C / C++ (CMake & Makefile)

export function findCppTarget(root) {
  const cmakeText = readText(path.join(root, "CMakeLists.txt"));
  if (cmakeText) {
    const execMatch = cmakeText.match(/add_executable\s*\(\s*([a-zA-Z0-9._-]+)/i);
    if (execMatch) return execMatch[1];
    const projMatch = cmakeText.match(/project\s*\(\s*([a-zA-Z0-9._-]+)/i);
    if (projMatch) return projMatch[1];
  }
  return path.basename(root).toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}

function cppProfile(root, port = 5000) {
  const targetName = findCppTarget(root);
  const isWin = process.platform === "win32";
  const binExt = isWin ? ".exe" : "";
  const isCMake = exists(root, "CMakeLists.txt");

  if (isCMake) {
    const steps = [
      { label: "CMake yapılandırması (cmake -B build)", command: "cmake", args: ["-B", "build"] },
      { label: "Derleme ve doğrulama (cmake --build build)", command: "cmake", args: ["--build", "build", "--config", "Release"] },
    ];
    return {
      language: "cpp",
      steps,
      start: {
        command: "cmake",
        args: ["--build", "build", "--target", "run"],
        fallbackCommand: isWin ? `build/Release/${targetName}${binExt}` : `build/${targetName}`,
      },
      port,
    };
  }

  const steps = [
    { label: "Derleme ve doğrulama (make)", command: "make", args: [] },
  ];
  return {
    language: "cpp",
    steps,
    start: { command: `./${targetName}${binExt}`, args: [] },
    port,
  };
}

// ---------------------------------------------------------------- Game Engines

function gameProfile(root, port = 5000) {
  if (exists(root, "project.godot")) {
    return {
      language: "game",
      steps: [
        { label: "Godot oyun projesi doğrulaması", command: "node", args: ["-e", "process.exit(0)"] },
      ],
      start: { command: "godot", args: ["--path", "."] },
      port,
    };
  }
  if (exists(root, "ProjectSettings", "ProjectVersion.txt")) {
    return {
      language: "game",
      steps: [
        { label: "Unity oyun projesi doğrulaması", command: "node", args: ["-e", "process.exit(0)"] },
      ],
      start: { command: "node", args: ["-e", "console.log('Unity projesi hazır.')"] },
      port,
    };
  }
  return {
    language: "game",
    steps: [
      { label: "Unreal Engine oyun projesi doğrulaması", command: "node", args: ["-e", "process.exit(0)"] },
    ],
    start: { command: "node", args: ["-e", "console.log('Unreal projesi hazır.')"] },
    port,
  };
}

export function resolveLanguageProfile(root, kind, port = 5000) {
  const language = LANGUAGE_KINDS[kind];
  if (!language) return null;
  if (language === "python") return pythonProfile(root, port);
  if (language === "go") return goProfile(root, port);
  if (language === "dotnet") return dotnetProfile(root, port);
  if (language === "rust") return rustProfile(root, port);
  if (language === "cpp") return cppProfile(root, port);
  if (language === "game") return gameProfile(root, port);
  return null;
}

/**
 * Projeye uygun çok dilli (Python, Go, .NET, Rust) veya özel migration komutunu belirler.
 * @param {string} root
 * @param {string} [kind] detectProject().kind
 * @param {object} [setupConfig]
 */
export function resolvePolyglotMigration(root, kind = null, setupConfig = null) {
  if (setupConfig?.migrate?.command && typeof setupConfig.migrate.command === "string") {
    const args = Array.isArray(setupConfig.migrate.args) ? setupConfig.migrate.args : [];
    const cmd = resolveStepCommand(root, setupConfig.migrate);
    return {
      label: setupConfig.migrate.label || `Özel migration (${cmd} ${args.join(" ")})`,
      command: cmd,
      args,
      cwd: root,
    };
  }

  const language = LANGUAGE_KINDS[kind];
  if (language === "python" || exists(root, "manage.py") || exists(root, "alembic.ini")) {
    const venvPython = resolveVenvPython(root) || resolveSystemPython() || "python";
    if (exists(root, "manage.py")) {
      return {
        label: "Django migration (manage.py migrate)",
        command: venvPython,
        args: ["manage.py", "migrate"],
        cwd: root,
      };
    }
    if (exists(root, "alembic.ini") || exists(root, "migrations", "env.py")) {
      return {
        label: "Alembic migration (alembic upgrade head)",
        command: venvPython,
        args: ["-m", "alembic", "upgrade", "head"],
        cwd: root,
      };
    }
  }

  if (language === "dotnet" || exists(root, "Migrations")) {
    const { runProject, restoreTarget } = findDotnetProject(root);
    const target = runProject || restoreTarget;
    if (exists(root, "Migrations") || target) {
      return {
        label: ".NET EF Core migration (dotnet ef database update)",
        command: "dotnet",
        args: ["ef", "database", "update", ...(target ? ["--project", target] : [])],
        cwd: root,
      };
    }
  }

  if (language === "rust") {
    if (exists(root, "diesel.toml")) {
      return {
        label: "Diesel migration (diesel migration run)",
        command: "diesel",
        args: ["migration", "run"],
        cwd: root,
      };
    }
    if (exists(root, "migrations") && exists(root, "Cargo.toml")) {
      return {
        label: "SQLx migration (sqlx migrate run)",
        command: "sqlx",
        args: ["migrate", "run"],
        cwd: root,
      };
    }
  }

  return null;
}
