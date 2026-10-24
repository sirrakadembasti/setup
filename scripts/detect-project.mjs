import fs from "node:fs";
import path from "node:path";

const DEFAULT_PORTS = Object.freeze({ bootstrap: 5049, wizard: 5050, app: 5000 });

function readJsonSafe(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function exists(root, ...parts) {
  return fs.existsSync(path.join(root, ...parts));
}

function hasFileWithSuffix(root, suffixes) {
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    return entries.some(
      (entry) =>
        entry.isFile() &&
        suffixes.some((suffix) => entry.name.toLowerCase().endsWith(suffix.toLowerCase())),
    );
  } catch {
    return false;
  }
}

function hasValidPackageJson(root) {
  return readJsonSafe(path.join(root, "package.json")) !== null;
}

export function loadSetupConfig(root) {
  const candidates = [
    path.join(root, "setup.config.json"),
    path.join(root, "templates", "setup.config.json"),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      const parsed = readJsonSafe(file);
      if (parsed) return parsed;
    }
  }
  return null;
}

export function detectPackageManager(root, pkg = null) {
  const packageJson = pkg || readJsonSafe(path.join(root, "package.json"));
  const declared = String(packageJson?.packageManager || "").trim();
  if (declared.startsWith("pnpm")) return "pnpm";
  if (declared.startsWith("yarn")) return "yarn";
  if (declared.startsWith("bun")) return "bun";
  if (declared.startsWith("npm")) return "npm";

  if (exists(root, "pnpm-lock.yaml") || exists(root, "pnpm-workspace.yaml")) return "pnpm";
  if (exists(root, "yarn.lock")) return "yarn";
  if (exists(root, "bun.lockb") || exists(root, "bun.lock")) return "bun";
  return "npm";
}

export function parseEnvContent(content) {
  const result = [];
  if (!content) return result;
  const lines = content.split(/\r?\n/);
  let i = 0;
  let lastComment = "";

  while (i < lines.length) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (!line) {
      lastComment = "";
      i++;
      continue;
    }

    if (line.startsWith("#")) {
      lastComment = line.replace(/^#+\s*/, "").trim();
      i++;
      continue;
    }

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/s);
    if (!match) {
      i++;
      continue;
    }

    const key = match[1];
    let valPart = match[2];

    if (valPart.startsWith('"')) {
      let val = valPart.slice(1);
      let endIdx = -1;
      for (let c = 0; c < val.length; c++) {
        if (val[c] === '"' && (c === 0 || val[c - 1] !== '\\')) {
          endIdx = c;
          break;
        }
      }
      if (endIdx !== -1) {
        val = val.slice(0, endIdx);
      } else {
        const multiline = [val];
        i++;
        while (i < lines.length) {
          const nextLine = lines[i];
          let foundQuote = -1;
          for (let c = 0; c < nextLine.length; c++) {
            if (nextLine[c] === '"' && (c === 0 || nextLine[c - 1] !== '\\')) {
              foundQuote = c;
              break;
            }
          }
          if (foundQuote !== -1) {
            multiline.push(nextLine.slice(0, foundQuote));
            break;
          } else {
            multiline.push(nextLine);
            i++;
          }
        }
        val = multiline.join("\n");
      }
      try {
        val = JSON.parse(`"${val.replace(/\\"/g, '"').replace(/"/g, '\\"')}"`);
      } catch {}
      result.push({ key, value: String(val), comment: lastComment || null });
      lastComment = "";
      i++;
      continue;
    }

    if (valPart.startsWith("'")) {
      let val = valPart.slice(1);
      let endIdx = val.indexOf("'");
      if (endIdx !== -1) {
        val = val.slice(0, endIdx);
      } else {
        const multiline = [val];
        i++;
        while (i < lines.length) {
          const nextLine = lines[i];
          const foundQuote = nextLine.indexOf("'");
          if (foundQuote !== -1) {
            multiline.push(nextLine.slice(0, foundQuote));
            break;
          } else {
            multiline.push(nextLine);
            i++;
          }
        }
        val = multiline.join("\n");
      }
      result.push({ key, value: String(val), comment: lastComment || null });
      lastComment = "";
      i++;
      continue;
    }

    let val = valPart;
    const commentMatch = val.match(/\s+#.*$/);
    if (commentMatch) {
      val = val.slice(0, commentMatch.index);
    }
    val = val.trim();
    result.push({ key, value: String(val), comment: lastComment || null });
    lastComment = "";
    i++;
  }

  return result;
}

export function findScatteredEnvExamples(root, maxDepth = 3) {
  const found = [];
  const envFileRegex = /^(?:\.env|env)\.(?:example|sample|template)$/i;
  const ignored = new Set([
    "node_modules", ".git", ".hg", ".svn", "dist", "build", "out", ".next", ".nuxt", ".output",
    "coverage", ".turbo", ".cache", ".vercel", "vendor", "data", "uploads", "backups",
    "bin", "obj", "target", ".venv", "venv", ".idea", ".vs", "graphify-out", "__pycache__",
  ]);

  function scan(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name.toLowerCase())) {
          scan(fullPath, depth + 1);
        }
      } else if (entry.isFile()) {
        if (envFileRegex.test(entry.name)) {
          found.push(fullPath);
        }
      }
    }
  }

  scan(root, 0);
  return found;
}

export function parseEnvExample(root) {
  const scattered = findScatteredEnvExamples(root, 3);
  const candidates = [
    path.join(root, ".env.example"),
    path.join(root, ".env.sample"),
    path.join(root, ".env.template"),
    path.join(root, "server", ".env.example"),
    path.join(root, "server", ".env.sample"),
    ...scattered,
  ];

  const foundFiles = [];
  const seenPaths = new Set();
  for (const f of candidates) {
    if (fs.existsSync(f) && !seenPaths.has(f)) {
      seenPaths.add(f);
      foundFiles.push(f);
    }
  }

  if (foundFiles.length === 0) return { file: null, variables: [] };

  const varMap = new Map();
  for (const file of foundFiles) {
    try {
      const content = fs.readFileSync(file, "utf8");
      const parsed = parseEnvContent(content);
      for (const item of parsed) {
        if (!varMap.has(item.key) || (!varMap.get(item.key).defaultValue && item.value)) {
          varMap.set(item.key, {
            key: item.key,
            defaultValue: item.value,
            description: item.comment,
            sourceFile: path.relative(root, file).replaceAll(path.sep, "/"),
          });
        }
      }
    } catch {}
  }

  const primaryFile = path.relative(root, foundFiles[0]).replaceAll(path.sep, "/");
  const relFiles = foundFiles.map((f) => path.relative(root, f).replaceAll(path.sep, "/"));
  return {
    file: primaryFile,
    files: relFiles,
    variables: Array.from(varMap.values()),
  };
}

export function parsePnpmWorkspaceYaml(content) {
  const patterns = [];
  if (!content) return patterns;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    const m = line.match(/^\s*-\s*['"]?([^'"]+)['"]?\s*$/);
    if (m) {
      patterns.push(m[1].trim());
    }
  }
  return patterns;
}

export function findWorkspacePackageDirs(root, patterns = []) {
  const dirs = [];
  const visited = new Set();

  for (const rawPat of patterns) {
    if (!rawPat) continue;
    const pat = rawPat.replace(/\\/g, "/").replace(/\/+$/, "");
    if (pat.endsWith("/*") || pat.endsWith("/**")) {
      const parentRel = pat.slice(0, pat.lastIndexOf("/"));
      const parentAbs = path.join(root, parentRel);
      if (fs.existsSync(parentAbs) && fs.statSync(parentAbs).isDirectory()) {
        try {
          for (const ent of fs.readdirSync(parentAbs, { withFileTypes: true })) {
            if (ent.isDirectory() && !ent.name.startsWith(".")) {
              const subDir = path.join(parentAbs, ent.name);
              if (fs.existsSync(path.join(subDir, "package.json")) && !visited.has(subDir)) {
                visited.add(subDir);
                dirs.push(path.relative(root, subDir).replaceAll(path.sep, "/"));
              }
            }
          }
        } catch {}
      }
    } else {
      const targetAbs = path.join(root, pat);
      if (fs.existsSync(path.join(targetAbs, "package.json")) && !visited.has(targetAbs)) {
        visited.add(targetAbs);
        dirs.push(path.relative(root, targetAbs).replaceAll(path.sep, "/"));
      }
    }
  }

  return dirs;
}

function detectWorkspaces(root) {
  const pkg = readJsonSafe(path.join(root, "package.json"));
  const pm = detectPackageManager(root, pkg);
  const pnpmYamlPath = path.join(root, "pnpm-workspace.yaml");
  const hasPnpmWorkspaceYaml = fs.existsSync(pnpmYamlPath);
  let rawPatterns = [];

  if (pkg) {
    const ws = pkg.workspaces || pkg.packages;
    if (Array.isArray(ws)) rawPatterns.push(...ws);
    else if (ws && Array.isArray(ws.packages)) rawPatterns.push(...ws.packages);
  }

  if (hasPnpmWorkspaceYaml) {
    try {
      const pnpmYamlText = fs.readFileSync(pnpmYamlPath, "utf8");
      rawPatterns.push(...parsePnpmWorkspaceYaml(pnpmYamlText));
    } catch {}
  }

  if (rawPatterns.length === 0 && (hasPnpmWorkspaceYaml || exists(root, "turbo.json") || exists(root, "lerna.json"))) {
    rawPatterns.push("apps/*", "packages/*");
  }

  const packageDirs = findWorkspacePackageDirs(root, rawPatterns);
  const isWorkspace = packageDirs.length > 0 || rawPatterns.length > 0 || hasPnpmWorkspaceYaml;

  return {
    isWorkspace,
    packages: packageDirs.length > 0 ? packageDirs : rawPatterns,
    packageDirs,
    packageManager: pm,
    declaredPackageManager: pkg?.packageManager || null,
    name: pkg?.name || null,
    scripts: pkg?.scripts || {},
  };
}

function hasDependency(pkg, depName) {
  if (!pkg || typeof pkg !== "object") return false;
  return Boolean(
    (pkg.dependencies && pkg.dependencies[depName]) ||
    (pkg.devDependencies && pkg.devDependencies[depName]) ||
    (pkg.peerDependencies && pkg.peerDependencies[depName]),
  );
}

/** Kaynakta kullanımı doğrulanan paketler. */
const TRACKED_PACKAGES = Object.freeze([
  "express",
  "fastify",
  "koa",
  "hono",
  "react",
  "vue",
  "next",
  "nuxt",
  "@sveltejs/kit",
  "astro",
  "vite",
  "electron",
  "@tauri-apps/api",
  "@tauri-apps/cli",
]);
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx", ".vue", ".svelte"]);
const IGNORED_DIRS = new Set([
  "node_modules", ".git", ".hg", ".svn", "dist", "build", "out", ".next", ".nuxt", ".output",
  "coverage", ".turbo", ".cache", ".vercel", "vendor", "data", "uploads", "backups",
  // test kodu ve fikstürleri çalışma zamanı kullanımını yansıtmaz
  "test", "tests", "__tests__", "__mocks__", "__fixtures__", "fixtures", "e2e",
]);
const TEST_FILE_PATTERN = /\.(?:test|spec)\.[^.]+$/i;
const SCAN_LIMITS = Object.freeze({ maxDepth: 8, maxFiles: 3000, maxFileBytes: 1024 * 1024 });

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** import/export from, yan etkili import, require() ve import() biçimlerini (alt yollar dahil) yakalar. */
function importPattern(name) {
  const q = "[\"'`]";
  return new RegExp(
    `(?:\\bfrom\\s*|\\bimport\\s*|\\b(?:require|import)\\s*\\(\\s*)${q}${escapeRegExp(name)}(?:/[^"'\`]*)?${q}`,
  );
}

function scriptPattern(name) {
  return new RegExp(`(?:^|[\\s;&|(])${escapeRegExp(name)}(?:$|[\\s;&|)])`);
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

function* walkSourceFiles(root) {
  const stack = [{ dir: root, depth: 0 }];
  let count = 0;
  while (stack.length) {
    const { dir, depth } = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < SCAN_LIMITS.maxDepth && !IGNORED_DIRS.has(entry.name)) stack.push({ dir: full, depth: depth + 1 });
      } else if (
        entry.isFile() &&
        SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) &&
        !TEST_FILE_PATTERN.test(entry.name)
      ) {
        if (++count > SCAN_LIMITS.maxFiles) return;
        yield full;
      }
    }
  }
}

/**
 * Paketlerin package.json'da bildirilip bildirilmediğini ve kaynakta gerçekten kullanılıp kullanılmadığını belirler.
 * Kullanım: kaynak dosyalarda import/require veya package.json script'lerinde CLI çağrısı.
 */
export function detectDependencyUsage(root, pkgs = [], names = TRACKED_PACKAGES) {
  const usage = {};
  const scripts = pkgs.flatMap((pkg) => Object.values(pkg?.scripts || {})).map(String);
  const pending = new Map();
  for (const name of names) {
    const usedInScripts = scripts.some((s) => scriptPattern(name).test(s));
    usage[name] = { declared: pkgs.some((pkg) => hasDependency(pkg, name)), used: usedInScripts, sourceScanned: false };
    if (!usedInScripts) pending.set(name, importPattern(name));
  }

  let scanned = false;
  for (const file of walkSourceFiles(root)) {
    scanned = true;
    if (!pending.size) break;
    let source;
    try {
      if (fs.statSync(file).size > SCAN_LIMITS.maxFileBytes) continue;
      source = stripComments(fs.readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    for (const [name, pattern] of pending) {
      if (pattern.test(source)) {
        usage[name].used = true;
        pending.delete(name);
      }
    }
  }
  for (const name of names) usage[name].sourceScanned = scanned;
  return usage;
}

/** Kullanım kanıtı varsa true; kaynak taranamadıysa package.json bildirimine güvenilir. */
function isPackageInUse(entry) {
  return Boolean(entry && (entry.used || (entry.declared && !entry.sourceScanned)));
}

/** Yalnız ön yüz araçlarını (vite, next, serve...) çalıştıran script, sunucu kanıtı sayılmaz. */
const FRONTEND_CLI_PATTERN = /^(?:npx\s+|pnpm\s+(?:exec\s+)?|yarn\s+|bunx?\s+)?(?:cross-env\s+(?:\S+=\S+\s+)*)?(?:vite|next|nuxt|nuxi|astro|svelte-kit|react-scripts|vue-cli-service|webpack(?:-dev-server)?|parcel|serve|http-server|live-server|electron|electron-forge|tauri)(?:\s|$)/;

function hasServerScript(pkg) {
  return ["start", "dev"].some((name) => {
    const cmd = String(pkg?.scripts?.[name] || "").trim();
    return cmd !== "" && !FRONTEND_CLI_PATTERN.test(cmd);
  });
}

function detectStack(root, usage, workspaces = {}) {
  const rootPkg = readJsonSafe(path.join(root, "package.json"));
  const hasServerSubdir =
    exists(root, "server", "package.json") ||
    exists(root, "server", "index.ts") ||
    exists(root, "server", "index.js") ||
    exists(root, "server", "src", "index.ts");
  const hasRootServerEntry =
    exists(root, "index.js") ||
    exists(root, "index.mjs") ||
    exists(root, "index.ts") ||
    exists(root, "server.js") ||
    exists(root, "app.js") ||
    exists(root, "src", "index.ts") ||
    exists(root, "src", "index.js") ||
    exists(root, "src", "server.ts") ||
    hasServerScript(rootPkg);

  const hasWorkspaceServer =
    Array.isArray(workspaces?.packageDirs) &&
    workspaces.packageDirs.some((dir) => {
      if (/api|server|backend/i.test(dir)) return true;
      const pkg = readJsonSafe(path.join(root, dir, "package.json"));
      return (
        hasDependency(pkg, "express") ||
        hasDependency(pkg, "fastify") ||
        hasDependency(pkg, "koa") ||
        hasDependency(pkg, "hono") ||
        hasServerScript(pkg)
      );
    });

  const hasWorkspaceClient =
    Array.isArray(workspaces?.packageDirs) &&
    workspaces.packageDirs.some((dir) => {
      if (/web|client|frontend|ui/i.test(dir)) return true;
      const pkg = readJsonSafe(path.join(root, dir, "package.json"));
      return (
        hasDependency(pkg, "react") ||
        hasDependency(pkg, "vue") ||
        hasDependency(pkg, "vite") ||
        hasDependency(pkg, "next") ||
        hasDependency(pkg, "nuxt") ||
        hasDependency(pkg, "@sveltejs/kit") ||
        hasDependency(pkg, "astro")
      );
    });

  const hasWorkspacePrisma =
    Array.isArray(workspaces?.packageDirs) &&
    workspaces.packageDirs.some((dir) => {
      const pkg = readJsonSafe(path.join(root, dir, "package.json"));
      return (
        exists(root, dir, "prisma", "schema.prisma") ||
        exists(root, dir, "schema.prisma") ||
        hasDependency(pkg, "prisma") ||
        hasDependency(pkg, "@prisma/client")
      );
    });

  const hasServerFramework =
    isPackageInUse(usage.express) ||
    isPackageInUse(usage.fastify) ||
    isPackageInUse(usage.koa) ||
    isPackageInUse(usage.hono);

  const nextjs = isPackageInUse(usage.next) || exists(root, "next.config.js") || exists(root, "next.config.mjs");
  const nuxt = isPackageInUse(usage.nuxt) || exists(root, "nuxt.config.ts") || exists(root, "nuxt.config.js");
  const sveltekit = isPackageInUse(usage["@sveltejs/kit"]) || exists(root, "svelte.config.js");
  const astro = isPackageInUse(usage.astro) || exists(root, "astro.config.mjs") || exists(root, "astro.config.ts");
  const ssrFramework = Boolean(nextjs || nuxt || sveltekit || astro);
  const staticHtml =
    exists(root, "index.html") || exists(root, "public", "index.html") || exists(root, "dist", "index.html");

  return {
    nodeServer: hasServerSubdir || hasRootServerEntry || hasWorkspaceServer || hasServerFramework,
    hasServerSubdir,
    client:
      exists(root, "client", "package.json") ||
      exists(root, "client", "src") ||
      hasWorkspaceClient ||
      isPackageInUse(usage.react) ||
      isPackageInUse(usage.vue) ||
      isPackageInUse(usage.next) ||
      nuxt ||
      sveltekit ||
      astro ||
      staticHtml,
    prisma:
      exists(root, "server", "prisma", "schema.prisma") ||
      exists(root, "prisma", "schema.prisma") ||
      hasWorkspacePrisma,
    vite:
      exists(root, "client", "vite.config.ts") ||
      exists(root, "client", "vite.config.js") ||
      exists(root, "vite.config.ts") ||
      exists(root, "vite.config.js") ||
      isPackageInUse(usage.vite),
    nextjs,
    nuxt,
    sveltekit,
    astro,
    ssrFramework,
    express: isPackageInUse(usage.express),
    fastify: isPackageInUse(usage.fastify),
    koa: isPackageInUse(usage.koa),
    hono: isPackageInUse(usage.hono),
    staticHtml,
    python:
      exists(root, "pyproject.toml") ||
      exists(root, "requirements.txt") ||
      exists(root, "manage.py") ||
      exists(root, "app.py") ||
      exists(root, "main.py"),
    go: exists(root, "go.mod") || exists(root, "main.go"),
    dotnet: hasFileWithSuffix(root, [".csproj", ".sln"]),
    rust: exists(root, "Cargo.toml") && !exists(root, "src-tauri", "tauri.conf.json") && !exists(root, "tauri.conf.json"),
    cpp: exists(root, "CMakeLists.txt") || exists(root, "Makefile") || exists(root, "meson.build"),
    unity: exists(root, "ProjectSettings", "ProjectVersion.txt") || (exists(root, "Assets") && exists(root, "Packages", "manifest.json")),
    unreal: hasFileWithSuffix(root, [".uproject"]),
    godot: exists(root, "project.godot"),
    electron:
      isPackageInUse(usage.electron) ||
      Boolean(rootPkg?.main && isPackageInUse(usage.electron)) ||
      exists(root, "electron-builder.yml") ||
      exists(root, "forge.config.js"),
    tauri:
      exists(root, "src-tauri", "tauri.conf.json") ||
      exists(root, "tauri.conf.json") ||
      isPackageInUse(usage["@tauri-apps/cli"]) ||
      isPackageInUse(usage["@tauri-apps/api"]),
    docker: exists(root, "docker-compose.yml") || exists(root, "compose.yaml") || exists(root, "Dockerfile"),
  };
}

function detectInstallEvidence(root) {
  return {
    nodeModules: exists(root, "node_modules"),
    lockfile:
      exists(root, "pnpm-lock.yaml") ||
      exists(root, "package-lock.json") ||
      exists(root, "yarn.lock") ||
      exists(root, "bun.lockb") ||
      exists(root, "bun.lock"),
    serverNodeModules: exists(root, "server", "node_modules"),
    clientNodeModules: exists(root, "client", "node_modules"),
  };
}

function detectRuntimeArtifacts(root) {
  return {
    env: exists(root, "server", ".env") || exists(root, ".env"),
    envExample: parseEnvExample(root),
    dataDir: exists(root, "server", "data") || exists(root, "data"),
    installationLock:
      exists(root, "server", "data", "installation.lock") ||
      exists(root, "data", "installation.lock"),
    uploads: exists(root, "server", "uploads") || exists(root, "uploads"),
  };
}

function detectEnvExamplePort(runtime) {
  const vars = runtime?.envExample?.variables;
  if (!Array.isArray(vars)) return null;
  for (const item of vars) {
    if (item && (item.key === "PORT" || item.key === "APP_PORT")) {
      const p = Number.parseInt(String(item.defaultValue || "").trim(), 10);
      if (Number.isInteger(p) && p >= 1024 && p <= 65535) {
        return p;
      }
    }
  }
  return null;
}

function validPort(value) {
  const p = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isInteger(p) && p >= 1 && p <= 65535 ? p : null;
}

/** "/auth", "auth/" ve "" gibi girdileri "/auth" veya "" (uygulama kökü) biçimine getirir. */
export function normalizeLoginPath(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "/") return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) return "";
  const cleaned = `/${raw.replace(/^\/+/, "").replace(/\/+$/, "")}`;
  return /^[\w\-./~%]*$/.test(cleaned) ? cleaned : "";
}

/** Uygulama adresine yapılandırılmış/algılanmış giriş yolunu ekler. */
export function buildLoginUrl(baseUrl, loginPath) {
  return `${String(baseUrl ?? "").replace(/\/+$/, "")}${normalizeLoginPath(loginPath)}`;
}

/** Ayrı bir geliştirme (ön yüz) sunucusunun portunu `--port`, `-p` veya `server.port` ayarından bulur. */
function detectDevServerPort(root) {
  const dirs = [root, path.join(root, "client"), path.join(root, "frontend"), path.join(root, "web")];
  for (const dir of dirs) {
    const pkg = readJsonSafe(path.join(dir, "package.json"));
    const script = String(pkg?.scripts?.dev || pkg?.scripts?.start || "");
    const fromScript = script.match(/(?:--port(?:=|\s+)|\s-p\s+)(\d{2,5})\b/);
    if (fromScript && validPort(fromScript[1])) return validPort(fromScript[1]);
    for (const name of ["vite.config.js", "vite.config.mjs", "vite.config.ts", "vite.config.mts"]) {
      try {
        const source = stripComments(fs.readFileSync(path.join(dir, name), "utf8"));
        const fromConfig = source.match(/\bport\s*:\s*(\d{2,5})\b/);
        if (fromConfig && validPort(fromConfig[1])) return validPort(fromConfig[1]);
      } catch {
        // dosya yok
      }
    }
  }
  return null;
}

export function detectSourcePort(root, stack = {}) {
  // Go source port detection
  if (stack.go || exists(root, "go.mod") || exists(root, "main.go")) {
    const candidates = [
      path.join(root, "main.go"),
      path.join(root, "server.go"),
      path.join(root, "app.go"),
    ];
    try {
      const cmdDir = path.join(root, "cmd");
      if (fs.existsSync(cmdDir)) {
        for (const sub of fs.readdirSync(cmdDir, { withFileTypes: true })) {
          if (sub.isDirectory()) {
            candidates.push(path.join(cmdDir, sub.name, "main.go"));
          }
        }
      }
    } catch {}

    for (const f of candidates) {
      if (fs.existsSync(f)) {
        try {
          const src = fs.readFileSync(f, "utf8");
          const m = src.match(/(?:ListenAndServe(?:TLS)?\s*\(\s*(?:["'](?:[a-zA-Z0-9_.-]+)?:(\d{2,5})["']|.*?:(\d{2,5}))|flag\.(?:Int|IntVar)\s*\([^)]*?"port"[^)]*?,\s*(\d{2,5})\b)/);
          const portNum = Number(m?.[1] || m?.[2] || m?.[3]);
          if (validPort(portNum)) return portNum;
          const simpleMatch = src.match(/["']:(8080|8000|3000|80|443|5000|8888|9000)["']/);
          if (simpleMatch && validPort(Number(simpleMatch[1]))) return validPort(Number(simpleMatch[1]));
        } catch {}
      }
    }
  }

  // Rust source port detection
  if (stack.rust || exists(root, "Cargo.toml")) {
    const candidates = [
      path.join(root, "src", "main.rs"),
      path.join(root, "src", "bin", "main.rs"),
      path.join(root, "src", "server.rs"),
    ];
    for (const f of candidates) {
      if (fs.existsSync(f)) {
        try {
          const src = fs.readFileSync(f, "utf8");
          const m = src.match(/(?:bind\s*\(\s*["'](?:[a-zA-Z0-9_.-]+)?:(\d{2,5})["']|["'](?:127\.0\.0\.1|0\.0\.0\.0|localhost):(\d{2,5})["']|SocketAddr[a-zA-Z0-9_:]*,\s*(\d{2,5})\s*\))/);
          const portNum = Number(m?.[1] || m?.[2] || m?.[3]);
          if (validPort(portNum)) return portNum;
          const simpleMatch = src.match(/["'](?:127\.0\.0\.1|0\.0\.0\.0|localhost):(8080|8000|3000|80|443|5000|8888|9000)["']/);
          if (simpleMatch && validPort(Number(simpleMatch[1]))) return validPort(Number(simpleMatch[1]));
        } catch {}
      }
    }
  }

  return null;
}

/**
 * Giriş yolu ve (varsa) ayrı geliştirme sunucusu portu. Sabit varsayım yok:
 * `SETUP_LOGIN_PATH` / `setup.config.json` (`app.loginPath`) ve `SETUP_DEV_PORT` /
 * `ports.dev` öncelikli, aksi halde proje dosyalarından algılanır; bulunamazsa
 * giriş yolu uygulama köküdür ve ayrı bir dev portu yoktur (`null`).
 */
export function detectAppRoutes(root, scenario = {}, setupConfig = null) {
  const loginRaw = process.env.SETUP_LOGIN_PATH ?? setupConfig?.app?.loginPath ?? setupConfig?.loginPath;
  const loginPath = scenario.isStaticOnly || scenario.isDesktop ? "" : normalizeLoginPath(loginRaw);
  const devPort = scenario.isDesktop
    ? null
    : validPort(process.env.SETUP_DEV_PORT) || validPort(setupConfig?.ports?.dev) || (scenario.requiresDatabase ? detectDevServerPort(root) : null);
  return { loginPath, devPort };
}

export const CANDIDATE_IGNORED_DIRS = new Set([
  "node_modules", ".git", ".hg", ".svn", "dist", "build", "out", ".next", ".nuxt", ".output",
  "coverage", ".turbo", ".cache", ".vercel", "vendor", "data", "uploads", "backups",
  "bin", "obj", "target", ".venv", "venv", ".idea", ".vs", "graphify-out", "__pycache__",
]);

export function isDotnetDesktopProject(root) {
  const csprojFiles = [];
  function scan(dir, depth) {
    if (depth > 3) return;
    try {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.isDirectory() && !CANDIDATE_IGNORED_DIRS.has(ent.name.toLowerCase())) {
          scan(path.join(dir, ent.name), depth + 1);
        } else if (ent.isFile() && ent.name.toLowerCase().endsWith(".csproj")) {
          csprojFiles.push(path.join(dir, ent.name));
        }
      }
    } catch {}
  }
  scan(root, 0);

  if (csprojFiles.length === 0) return false;

  for (const f of csprojFiles) {
    try {
      const text = fs.readFileSync(f, "utf8");
      if (
        /<UseWindowsForms>true<\/UseWindowsForms>/i.test(text) ||
        /<UseWPF>true<\/UseWPF>/i.test(text) ||
        /<OutputType>WinExe<\/OutputType>/i.test(text) ||
        /net[0-9.]+-windows/i.test(text)
      ) {
        return true;
      }
    } catch {}
  }
  return false;
}

export function isPythonDesktopProject(root) {
  let hasGuiImport = false;
  let hasServerImport = false;

  function scan(dir, depth) {
    if (depth > 3 || hasGuiImport) return;
    try {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.isDirectory() && !CANDIDATE_IGNORED_DIRS.has(ent.name.toLowerCase())) {
          scan(path.join(dir, ent.name), depth + 1);
        } else if (ent.isFile() && ent.name.toLowerCase().endsWith(".py")) {
          try {
            const content = fs.readFileSync(path.join(dir, ent.name), "utf8");
            if (/\b(?:import\s+tkinter|from\s+tkinter|import\s+PyQt[56]|from\s+PyQt[56]|import\s+PySide[26]|from\s+PySide[26]|import\s+wx|from\s+wx)\b/.test(content)) {
              hasGuiImport = true;
            }
            if (/\b(?:FastAPI|Starlette|Flask|django)\b/.test(content)) {
              hasServerImport = true;
            }
          } catch {}
        }
      }
    } catch {}
  }
  scan(root, 0);

  return hasGuiImport && !hasServerImport;
}

export function isCppDesktopProject(root) {
  const cmake = path.join(root, "CMakeLists.txt");
  if (fs.existsSync(cmake)) {
    try {
      const text = fs.readFileSync(cmake, "utf8");
      if (/find_package\s*\(\s*(?:Qt|wxWidgets)/i.test(text) || /add_executable\s*\([^)]*WIN32/i.test(text)) {
        return true;
      }
    } catch {}
  }
  return false;
}

export function classifyCandidate(candidateDir, relDir) {
  const pkg = readJsonSafe(path.join(candidateDir, "package.json"));
  let role = "general";
  let kind = "unknown";
  let name = pkg?.name || path.basename(candidateDir);
  const markers = [];

  // 1. Node.js package.json
  if (pkg) {
    markers.push("package.json");
    const scripts = pkg.scripts || {};
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const scriptText = Object.values(scripts).join(" ");

    const isFrontend =
      deps.react || deps.vue || deps["@sveltejs/kit"] || deps.svelte || deps.astro || deps.next || deps.nuxt ||
      FRONTEND_CLI_PATTERN.test(scriptText) ||
      fs.existsSync(path.join(candidateDir, "vite.config.ts")) ||
      fs.existsSync(path.join(candidateDir, "vite.config.js")) ||
      fs.existsSync(path.join(candidateDir, "index.html"));

    const isServer =
      deps.express || deps.fastify || deps.koa || deps.hono || deps["@nestjs/core"] ||
      hasServerScript(pkg) ||
      fs.existsSync(path.join(candidateDir, "server.js")) ||
      fs.existsSync(path.join(candidateDir, "index.js")) ||
      fs.existsSync(path.join(candidateDir, "src", "index.ts"));

    const isDesktop =
      deps.electron || deps["@tauri-apps/api"] || deps["@tauri-apps/cli"] ||
      fs.existsSync(path.join(candidateDir, "tauri.conf.json")) ||
      fs.existsSync(path.join(candidateDir, "src-tauri", "tauri.conf.json"));

    if (isDesktop) {
      role = "desktop";
      kind = deps.electron ? "electron-desktop" : "tauri-desktop";
    } else if (isServer && isFrontend) {
      role = "fullstack";
      kind = "node-fullstack";
    } else if (isServer) {
      role = "backend";
      kind = "node-server";
    } else if (isFrontend) {
      role = "frontend";
      kind = (deps.next || deps.nuxt || deps["@sveltejs/kit"] || deps.astro) ? "ssr-fullstack" : "node-client";
    } else {
      role = "general";
      kind = "node-package";
    }
    return { dir: relDir, fullPath: candidateDir, name, role, kind, markers, pkg };
  }

  // 2. .NET (.csproj / .sln)
  let csprojFiles = [];
  try {
    for (const ent of fs.readdirSync(candidateDir, { withFileTypes: true })) {
      if (ent.isFile() && ent.name.toLowerCase().endsWith(".csproj")) {
        csprojFiles.push(path.join(candidateDir, ent.name));
      }
    }
  } catch {}

  if (csprojFiles.length > 0 || hasFileWithSuffix(candidateDir, [".sln"])) {
    markers.push("dotnet");
    let isDesktop = false;
    let isWeb = false;
    for (const c of csprojFiles) {
      try {
        const text = fs.readFileSync(c, "utf8");
        if (
          /<UseWindowsForms>true<\/UseWindowsForms>/i.test(text) ||
          /<UseWPF>true<\/UseWPF>/i.test(text) ||
          /<OutputType>WinExe<\/OutputType>/i.test(text) ||
          /net[0-9.]+-windows/i.test(text)
        ) {
          isDesktop = true;
        }
        if (/Microsoft\.NET\.Sdk\.Web/i.test(text)) {
          isWeb = true;
        }
      } catch {}
    }
    if (isDesktop && !isWeb) {
      role = "desktop";
      kind = "dotnet-desktop";
    } else {
      role = "backend";
      kind = "dotnet-server";
    }
    return { dir: relDir, fullPath: candidateDir, name, role, kind, markers };
  }

  // 3. Python
  const pyMarkers = ["requirements.txt", "pyproject.toml", "manage.py", "app.py", "main.py", "gui.py"];
  const hasPy = pyMarkers.some((f) => fs.existsSync(path.join(candidateDir, f)));
  if (hasPy) {
    markers.push("python");
    let isGui = false;
    try {
      const files = fs.readdirSync(candidateDir, { withFileTypes: true });
      for (const f of files) {
        if (f.isFile() && f.name.endsWith(".py")) {
          const content = fs.readFileSync(path.join(candidateDir, f.name), "utf8");
          if (/\b(?:import\s+tkinter|from\s+tkinter|import\s+PyQt[56]|from\s+PyQt[56]|import\s+PySide[26]|from\s+PySide[26]|import\s+wx|from\s+wx)\b/.test(content)) {
            isGui = true;
            break;
          }
        }
      }
    } catch {}

    if (isGui) {
      role = "desktop";
      kind = "python-desktop";
    } else {
      role = "backend";
      kind = "python-server";
    }
    return { dir: relDir, fullPath: candidateDir, name, role, kind, markers };
  }

  // 4. Go
  if (fs.existsSync(path.join(candidateDir, "go.mod")) || fs.existsSync(path.join(candidateDir, "main.go"))) {
    markers.push("go");
    return { dir: relDir, fullPath: candidateDir, name, role: "backend", kind: "go-server", markers };
  }

  // 5. Rust
  if (fs.existsSync(path.join(candidateDir, "Cargo.toml"))) {
    markers.push("rust");
    return { dir: relDir, fullPath: candidateDir, name, role: "backend", kind: "rust-server", markers };
  }

  // 6. C/C++
  if (fs.existsSync(path.join(candidateDir, "CMakeLists.txt")) || fs.existsSync(path.join(candidateDir, "Makefile"))) {
    markers.push("cpp");
    let isGui = false;
    try {
      const cmakeText = fs.readFileSync(path.join(candidateDir, "CMakeLists.txt"), "utf8");
      if (/find_package\s*\(\s*(?:Qt|wxWidgets)/i.test(cmakeText)) {
        isGui = true;
      }
    } catch {}
    return { dir: relDir, fullPath: candidateDir, name, role: isGui ? "desktop" : "backend", kind: isGui ? "cpp-desktop" : "cpp-server", markers };
  }

  // 7. Game
  if (fs.existsSync(path.join(candidateDir, "project.godot"))) {
    return { dir: relDir, fullPath: candidateDir, name, role: "game", kind: "godot-game", markers: ["godot"] };
  }
  if (fs.existsSync(path.join(candidateDir, "ProjectSettings", "ProjectVersion.txt"))) {
    return { dir: relDir, fullPath: candidateDir, name, role: "game", kind: "unity-game", markers: ["unity"] };
  }
  if (hasFileWithSuffix(candidateDir, [".uproject"])) {
    return { dir: relDir, fullPath: candidateDir, name, role: "game", kind: "unreal-game", markers: ["unreal"] };
  }

  // 8. Static HTML
  if (fs.existsSync(path.join(candidateDir, "index.html"))) {
    return { dir: relDir, fullPath: candidateDir, name, role: "frontend", kind: "static-web", markers: ["index.html"] };
  }

  return null;
}

export function findProjectCandidates(root, maxDepth = 3) {
  const candidates = [];

  function scan(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    if (dir !== root) {
      const relDir = path.relative(root, dir).replaceAll(path.sep, "/");
      const classified = classifyCandidate(dir, relDir);
      if (classified) {
        candidates.push(classified);
        return;
      }
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        const name = entry.name.toLowerCase();
        if (!CANDIDATE_IGNORED_DIRS.has(name) && !name.startsWith(".")) {
          const sub = path.join(dir, entry.name);
          scan(sub, depth + 1);
        }
      }
    }
  }

  scan(root, 0);
  return candidates;
}

export function detectScenarioProfile(kind, stack = {}, workspaces = {}) {
  if (
    kind === "electron-desktop" ||
    kind === "tauri-desktop" ||
    kind === "dotnet-desktop" ||
    kind === "python-desktop" ||
    kind === "cpp-desktop" ||
    kind === "unity-game" ||
    kind === "unreal-game" ||
    kind === "godot-game" ||
    stack.electron ||
    stack.tauri ||
    stack.unity ||
    stack.unreal ||
    stack.godot
  ) {
    return {
      id: "scenario-5-desktop",
      number: 5,
      label: "Senaryo 5: Masaüstü ve Oyun Uygulaması (.NET Desktop / Python GUI / Electron / Tauri / C++ GUI / Unity / Unreal / Godot)",
      summary: "Masaüstü veya yerel uygulama ortamı, yerel veri dizini ve süreç yaşam döngüsü.",
      requiresDependencies: true,
      requiresDatabase: Boolean(stack.prisma || stack.hasServerSubdir),
      usesLocalDatabase: Boolean(stack.prisma || stack.hasServerSubdir),
      usesNodeEnv: false,
      requiresAdmin: false,
      isStaticOnly: false,
      isDesktop: true,
    };
  }
  if (
    ["python-server", "go-server", "dotnet-server", "rust-server", "cpp-server"].includes(kind) ||
    stack.cpp ||
    stack.fastify ||
    stack.koa ||
    stack.hono
  ) {
    return {
      id: "scenario-4-polyglot",
      number: 4,
      label: "Senaryo 4: Çoklu Dil / Özel Sunucu Uygulaması (Python / Go / .NET / Rust / Fastify / Koa / Hono)",
      summary: "Dile özgü bağımlılık kurulumu, .env ve yönetici yapılandırması ve servis başlatma.",
      requiresDependencies: true,
      requiresDatabase: true,
      usesLocalDatabase: false,
      usesNodeEnv: false,
      requiresAdmin: true,
      isStaticOnly: false,
      isDesktop: false,
    };
  }
  if (
    ["workspace-fullstack", "node-fullstack", "ssr-fullstack"].includes(kind) ||
    stack.ssrFramework ||
    (workspaces?.isWorkspace && stack.nodeServer)
  ) {
    return {
      id: "scenario-3-fullstack",
      number: 3,
      label: "Senaryo 3: Full-Stack / SSR veya Monorepo Uygulaması (Next.js / Nuxt / SvelteKit / Astro / Workspace)",
      summary: "Bağımlılık kurulumu, veritabanı migration, istemci/sunucu üretim derlemesi ve tam yığın başlatma.",
      requiresDependencies: true,
      requiresDatabase: true,
      usesLocalDatabase: Boolean(stack.prisma),
      usesNodeEnv: true,
      requiresAdmin: true,
      isStaticOnly: false,
      isDesktop: false,
    };
  }
  if (
    kind === "static-web" ||
    kind === "node-client" ||
    (!stack.nodeServer && (stack.client || stack.vite || stack.staticHtml))
  ) {
    return {
      id: "scenario-2-spa-static",
      number: 2,
      label: "Senaryo 2: Tek Sayfalık (SPA) ve Statik Web Uygulaması (React / Vue / Vite / HTML)",
      summary: "Tarayıcıda çalışan statik/SPA uygulama; gizli anahtar sızdırmadan runtime-config.json üretimi ve önizleme sunucusu.",
      requiresDependencies: kind !== "static-web",
      requiresDatabase: false,
      usesLocalDatabase: false,
      usesNodeEnv: false,
      requiresAdmin: false,
      isStaticOnly: true,
      isDesktop: false,
    };
  }
  return {
    id: "scenario-1-node-server",
    number: 1,
    label: "Senaryo 1: Express.js / Node.js Sunucu Uygulaması",
    summary: "Node.js sunucu bağımlılıkları, .env ve veritabanı hazırlığı, ilk yönetici hesabı ve sunucu başlatma.",
    requiresDependencies: true,
    requiresDatabase: true,
    usesLocalDatabase: Boolean(stack.prisma),
    usesNodeEnv: true,
    requiresAdmin: true,
    isStaticOnly: false,
    isDesktop: false,
  };
}

/**
 * Kurulum eklentisinin çalıştığı kök dizini ve içeriğini analiz eder.
 * @param {string} root - hedef uygulama kök dizini (varsayılan: process.cwd())
 */
export function detectProject(root = process.cwd(), options = {}) {
  const resolved = path.resolve(root);

  // Belirli bir alt proje adayı istendiyse doğrudan o alt dizini hedefle
  if (options?.candidate && !options?._internal) {
    const candidateAbs = path.resolve(resolved, String(options.candidate).trim());
    if (fs.existsSync(candidateAbs)) {
      const relCandidate = path.relative(resolved, candidateAbs).replaceAll(path.sep, "/");
      const candDet = detectProject(candidateAbs, { _internal: true });
      return {
        ...candDet,
        root: resolved,
        candidateRoot: relCandidate,
        projectName: candDet.projectName || path.basename(candidateAbs),
      };
    }
  }

  const validPkg = hasValidPackageJson(resolved);
  const setupConfig = loadSetupConfig(resolved);
  const workspaces = detectWorkspaces(resolved);
  const candidatePkgs = [
    readJsonSafe(path.join(resolved, "package.json")),
    readJsonSafe(path.join(resolved, "server", "package.json")),
    readJsonSafe(path.join(resolved, "client", "package.json")),
  ];
  if (Array.isArray(workspaces.packageDirs)) {
    for (const relDir of workspaces.packageDirs) {
      const p = readJsonSafe(path.join(resolved, relDir, "package.json"));
      if (p) candidatePkgs.push(p);
    }
  }
  const dependencyUsage = detectDependencyUsage(resolved, candidatePkgs.filter(Boolean));
  const stack = detectStack(resolved, dependencyUsage, workspaces);
  const install = detectInstallEvidence(resolved);
  const runtime = detectRuntimeArtifacts(resolved);

  let kind = "unknown";
  if (stack.electron) kind = "electron-desktop";
  else if (stack.tauri) kind = "tauri-desktop";
  else if (stack.unity) kind = "unity-game";
  else if (stack.unreal) kind = "unreal-game";
  else if (stack.godot) kind = "godot-game";
  else if (workspaces.isWorkspace && stack.nodeServer) kind = "workspace-fullstack";
  else if (workspaces.isWorkspace) kind = "workspace";
  else if (stack.hasServerSubdir && stack.client) kind = "node-fullstack";
  else if (stack.ssrFramework) kind = "ssr-fullstack";
  else if (stack.nodeServer && stack.client) kind = "node-webapp";
  else if (stack.nodeServer) kind = "node-server";
  else if (stack.client && validPkg) kind = "node-client";
  else if (isPythonDesktopProject(resolved)) kind = "python-desktop";
  else if (stack.python) kind = "python-server";
  else if (stack.go) kind = "go-server";
  else if (isDotnetDesktopProject(resolved)) kind = "dotnet-desktop";
  else if (stack.dotnet) kind = "dotnet-server";
  else if (stack.rust) kind = "rust-server";
  else if (isCppDesktopProject(resolved)) kind = "cpp-desktop";
  else if (stack.cpp) kind = "cpp-server";
  else if (validPkg) kind = "node-package";
  else if (stack.staticHtml) kind = "static-web";
  else if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) kind = "directory";

  const cfgPorts = setupConfig?.ports || {};

  const hasRootServerEntry =
    exists(resolved, "index.js") ||
    exists(resolved, "index.mjs") ||
    exists(resolved, "index.ts") ||
    exists(resolved, "server.js") ||
    exists(resolved, "app.js") ||
    exists(resolved, "src", "index.ts") ||
    exists(resolved, "src", "index.js") ||
    exists(resolved, "src", "server.ts");

  const hasDirectRootProject =
    validPkg ||
    workspaces.isWorkspace ||
    setupConfig !== null ||
    hasRootServerEntry ||
    exists(resolved, "go.mod") ||
    exists(resolved, "Cargo.toml") ||
    exists(resolved, "CMakeLists.txt") ||
    exists(resolved, "project.godot") ||
    exists(resolved, "ProjectSettings", "ProjectVersion.txt");

  // Kök dizinde doğrudan tanımlı proje bulunamadıysa veya dizinse alt klasörleri derinlemesine tara
  if (!options?._internal && (!hasDirectRootProject || kind === "directory" || kind === "unknown")) {
    const candidates = findProjectCandidates(resolved, 3);
    if (candidates.length === 1) {
      const c = candidates[0];
      const candDet = detectProject(c.fullPath, { _internal: true });
      return {
        ...candDet,
        root: resolved,
        candidateRoot: c.dir,
        projectName: c.name || candDet.projectName,
        confidence: 0.85,
      };
    } else if (candidates.length > 1) {
      const backends = candidates.filter((c) => c.role === "backend");
      const frontends = candidates.filter((c) => c.role === "frontend");
      if (backends.length === 1 && frontends.length === 1) {
        const subprojects = { backend: backends[0], frontend: frontends[0] };
        kind = "node-fullstack";
        const scenario = detectScenarioProfile(kind, { nodeServer: true, client: true });
        const projectName = `${backends[0].name}-${frontends[0].name}`;
        const pm = backends[0].pkg?.packageManager ? detectPackageManager(backends[0].fullPath, backends[0].pkg) : "npm";
        return {
          root: resolved,
          projectName,
          kind,
          scenario,
          packageManager: pm,
          hasPackageJson: validPkg,
          packageJsonExists: validPkg,
          workspaces,
          stack: { ...stack, nodeServer: true, client: true },
          dependencyUsage,
          install,
          runtime,
          setupConfig,
          routes: detectAppRoutes(resolved, scenario, setupConfig),
          ports: {
            bootstrap: Number(process.env.SETUP_BOOTSTRAP_PORT) || cfgPorts.bootstrap || DEFAULT_PORTS.bootstrap,
            wizard: Number(process.env.SETUP_WIZARD_PORT) || cfgPorts.wizard || DEFAULT_PORTS.wizard,
            app: Number(process.env.SETUP_APP_PORT) || cfgPorts.app || detectEnvExamplePort(runtime) || DEFAULT_PORTS.app,
          },
          subprojects,
          candidates,
          confidence: 0.85,
        };
      } else {
        return {
          root: resolved,
          projectName: candidates[0]?.name || path.basename(resolved),
          kind: candidates[0]?.kind || "unknown",
          scenario: detectScenarioProfile(candidates[0]?.kind || "unknown", stack, workspaces),
          packageManager: "npm",
          hasPackageJson: false,
          packageJsonExists: false,
          workspaces,
          stack,
          dependencyUsage,
          install,
          runtime,
          setupConfig,
          routes: detectAppRoutes(resolved, {}, setupConfig),
          ports: {
            bootstrap: DEFAULT_PORTS.bootstrap,
            wizard: DEFAULT_PORTS.wizard,
            app: DEFAULT_PORTS.app,
          },
          candidates,
          hasAmbiguity: true,
          confidence: 0.5,
        };
      }
    }
  }

  const projectName =
    workspaces.name ||
    setupConfig?.name ||
    path.basename(resolved).toLowerCase().replace(/[^a-z0-9._-]+/g, "-") ||
    "app";

  const scenario = detectScenarioProfile(kind, stack, workspaces);
  return {
    root: resolved,
    projectName,
    kind,
    scenario,
    packageManager: workspaces.packageManager,
    hasPackageJson: validPkg,
    packageJsonExists: exists(resolved, "package.json"),
    workspaces,
    stack,
    dependencyUsage,
    install,
    runtime,
    setupConfig,
    routes: detectAppRoutes(resolved, scenario, setupConfig),
    ports: {
      bootstrap: Number(process.env.SETUP_BOOTSTRAP_PORT) || Number(cfgPorts.bootstrap) || DEFAULT_PORTS.bootstrap,
      wizard: Number(process.env.SETUP_WIZARD_PORT) || Number(cfgPorts.wizard) || DEFAULT_PORTS.wizard,
      app: Number(process.env.SETUP_APP_PORT) || Number(cfgPorts.app) || detectEnvExamplePort(runtime) || detectSourcePort(resolved, stack) || DEFAULT_PORTS.app,
    },
    confidence: kind === "unknown" || kind === "directory" ? 0 : workspaces.isWorkspace ? 1 : 0.85,
  };
}

export function buildInstallCommandLabel(detection) {
  const pm = detection.packageManager || "npm";
  if (pm === "pnpm") return "pnpm install";
  if (pm === "yarn") return "yarn install";
  if (pm === "bun") return "bun install";
  return "npm install";
}

/**
 * Algılamaya göre kurulum planı üretir.
 */
export function buildInstallPlan(detection) {
  const steps = [];
  const pmLabel = detection.packageManager || "npm";
  steps.push({ id: "precheck", label: `Ortam ön kontrolü (Node.js / ${pmLabel})` });
  steps.push({ id: "ports", label: "Kurulum portlarının denetimi" });

  const installable =
    detection.hasPackageJson ||
    Boolean(detection.candidateRoot) ||
    Boolean(detection.subprojects) ||
    detection.stack?.nodeServer ||
    detection.stack?.client ||
    detection.workspaces?.isWorkspace ||
    detection.stack?.python ||
    detection.stack?.go ||
    detection.stack?.dotnet ||
    detection.stack?.rust ||
    detection.stack?.cpp ||
    detection.stack?.unity ||
    detection.stack?.unreal ||
    detection.stack?.godot ||
    detection.stack?.staticHtml ||
    Boolean(detection.setupConfig?.install?.command);

  if (!installable) {
    const reason = detection.packageJsonExists
      ? "package.json bozuk veya okunamadı"
      : "Tanımlı proje bulunamadı (package.json / server / client yok)";
    steps.push({ id: "abort", label: reason, required: true });
    return {
      projectName: detection.projectName,
      kind: detection.kind,
      packageManager: pmLabel,
      steps,
      canInstall: false,
    };
  }

  if (detection.subprojects) {
    const backendDir = detection.subprojects.backend?.dir;
    const frontendDir = detection.subprojects.frontend?.dir;
    const parts = [backendDir, frontendDir].filter(Boolean).join(" + ");
    steps.push({
      id: "dependencies",
      label: `Bağımlılık kurulumu (${parts || buildInstallCommandLabel(detection)})`,
      required: true,
    });
  } else if (detection.candidateRoot && detection.hasPackageJson) {
    steps.push({
      id: "dependencies",
      label: `Bağımlılık kurulumu (${detection.candidateRoot} - ${buildInstallCommandLabel(detection)})`,
      required: true,
    });
  } else if (detection.hasPackageJson) {
    steps.push({
      id: "dependencies",
      label: `Bağımlılık kurulumu (${buildInstallCommandLabel(detection)})`,
      required: true,
    });
  } else if (detection.stack?.python || detection.kind === "python-desktop") {
    steps.push({ id: "dependencies", label: "Bağımlılık kurulumu (Python venv + pip) + pip check", required: true });
  } else if (detection.stack?.go) {
    steps.push({ id: "dependencies", label: "Bağımlılık kurulumu (go mod download) + go build doğrulaması", required: true });
  } else if (detection.stack?.dotnet || detection.kind === "dotnet-desktop") {
    steps.push({ id: "dependencies", label: "Bağımlılık kurulumu (dotnet restore) + dotnet build doğrulaması", required: true });
  } else if (detection.stack?.rust) {
    steps.push({ id: "dependencies", label: "Bağımlılık kurulumu (cargo fetch) + derleme doğrulaması (cargo check)", required: true });
  } else if (detection.stack?.cpp || detection.kind === "cpp-desktop") {
    steps.push({ id: "dependencies", label: "CMake yapılandırması (cmake -B build) + derleme doğrulaması (cmake --build build)", required: true });
  } else if (detection.stack?.godot) {
    steps.push({ id: "dependencies", label: "Godot oyun projesi doğrulaması", required: false });
  } else if (detection.stack?.unity) {
    steps.push({ id: "dependencies", label: "Unity oyun projesi doğrulaması", required: false });
  } else if (detection.stack?.unreal) {
    steps.push({ id: "dependencies", label: "Unreal Engine oyun projesi doğrulaması", required: false });
  }

  steps.push({ id: "wizard", label: `Web kurulum sihirbazı (${detection.ports?.wizard || 5050})`, optional: false });
  steps.push({ id: "apply", label: "Yapılandırma (.env) + veri hazırlığı" });
  steps.push({ id: "start", label: "Uygulamayı başlat ve aç" });

  return {
    projectName: detection.projectName,
    kind: detection.kind,
    packageManager: pmLabel,
    ports: detection.ports,
    steps,
    canInstall: true,
  };
}

export { DEFAULT_PORTS };
