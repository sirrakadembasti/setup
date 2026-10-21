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

export function parseEnvExample(root) {
  const candidates = [
    path.join(root, ".env.example"),
    path.join(root, ".env.sample"),
    path.join(root, ".env.template"),
    path.join(root, "server", ".env.example"),
    path.join(root, "server", ".env.sample"),
  ];
  const found = candidates.find((file) => fs.existsSync(file));
  if (!found) return { file: null, variables: [] };

  const content = fs.readFileSync(found, "utf8");
  const variables = [];
  let lastComment = "";
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      lastComment = "";
      continue;
    }
    if (line.startsWith("#")) {
      lastComment = line.replace(/^#+\s*/, "").trim();
      continue;
    }
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (match) {
      const key = match[1];
      const rawVal = match[2].trim().replace(/^["']|["']$/g, "");
      variables.push({
        key,
        defaultValue: rawVal,
        description: lastComment || null,
      });
      lastComment = "";
    }
  }
  return {
    file: path.relative(root, found).replaceAll(path.sep, "/"),
    variables,
  };
}

function detectWorkspaces(root) {
  const pkg = readJsonSafe(path.join(root, "package.json"));
  const pm = detectPackageManager(root, pkg);
  if (!pkg) return { isWorkspace: false, packages: [], packageManager: pm, name: null, scripts: {} };
  const workspaces = pkg.workspaces || pkg.packages;
  const packages = Array.isArray(workspaces)
    ? workspaces
    : workspaces && Array.isArray(workspaces.packages)
      ? workspaces.packages
      : [];
  const hasPnpmWorkspaceYaml = exists(root, "pnpm-workspace.yaml");
  return {
    isWorkspace: packages.length > 0 || hasPnpmWorkspaceYaml,
    packages,
    packageManager: pm,
    declaredPackageManager: pkg.packageManager || null,
    name: pkg.name || null,
    scripts: pkg.scripts || {},
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

function detectStack(root, usage) {
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

  const nextjs = isPackageInUse(usage.next) || exists(root, "next.config.js") || exists(root, "next.config.mjs");
  const nuxt = isPackageInUse(usage.nuxt) || exists(root, "nuxt.config.ts") || exists(root, "nuxt.config.js");
  const sveltekit = isPackageInUse(usage["@sveltejs/kit"]) || exists(root, "svelte.config.js");
  const astro = isPackageInUse(usage.astro) || exists(root, "astro.config.mjs") || exists(root, "astro.config.ts");
  const ssrFramework = Boolean(nextjs || nuxt || sveltekit || astro);
  const staticHtml =
    exists(root, "index.html") || exists(root, "public", "index.html") || exists(root, "dist", "index.html");

  return {
    nodeServer: hasServerSubdir || hasRootServerEntry,
    hasServerSubdir,
    client:
      exists(root, "client", "package.json") ||
      exists(root, "client", "src") ||
      isPackageInUse(usage.react) ||
      isPackageInUse(usage.vue) ||
      isPackageInUse(usage.next) ||
      nuxt ||
      sveltekit ||
      astro ||
      staticHtml,
    prisma: exists(root, "server", "prisma", "schema.prisma") || exists(root, "prisma", "schema.prisma"),
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

export function detectScenarioProfile(kind, stack = {}, workspaces = {}) {
  if (kind === "electron-desktop" || kind === "tauri-desktop" || stack.electron || stack.tauri) {
    return {
      id: "scenario-5-desktop",
      number: 5,
      label: "Senaryo 5: Masaüstü Uygulaması (Electron / Tauri)",
      summary: "Masaüstü uygulama ortamı, yerel veri dizini ve IPC/Sidecar kurulumu.",
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
    ["python-server", "go-server", "dotnet-server", "rust-server"].includes(kind) ||
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
export function detectProject(root = process.cwd()) {
  const resolved = path.resolve(root);
  const validPkg = hasValidPackageJson(resolved);
  const setupConfig = loadSetupConfig(resolved);
  const workspaces = detectWorkspaces(resolved);
  const dependencyUsage = detectDependencyUsage(resolved, [
    readJsonSafe(path.join(resolved, "package.json")),
    readJsonSafe(path.join(resolved, "server", "package.json")),
    readJsonSafe(path.join(resolved, "client", "package.json")),
  ].filter(Boolean));
  const stack = detectStack(resolved, dependencyUsage);
  const install = detectInstallEvidence(resolved);
  const runtime = detectRuntimeArtifacts(resolved);

  let kind = "unknown";
  if (stack.electron) kind = "electron-desktop";
  else if (stack.tauri) kind = "tauri-desktop";
  else if (workspaces.isWorkspace && stack.nodeServer) kind = "workspace-fullstack";
  else if (workspaces.isWorkspace) kind = "workspace";
  else if (stack.hasServerSubdir && stack.client) kind = "node-fullstack";
  else if (stack.ssrFramework) kind = "ssr-fullstack";
  else if (stack.nodeServer && stack.client) kind = "node-webapp";
  else if (stack.nodeServer) kind = "node-server";
  else if (stack.client && validPkg) kind = "node-client";
  else if (stack.python) kind = "python-server";
  else if (stack.go) kind = "go-server";
  else if (stack.dotnet) kind = "dotnet-server";
  else if (stack.rust) kind = "rust-server";
  else if (validPkg) kind = "node-package";
  else if (stack.staticHtml) kind = "static-web";
  else if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) kind = "directory";

  const projectName =
    workspaces.name ||
    setupConfig?.name ||
    path.basename(resolved).toLowerCase().replace(/[^a-z0-9._-]+/g, "-") ||
    "app";

  const scenario = detectScenarioProfile(kind, stack, workspaces);
  const cfgPorts = setupConfig?.ports || {};
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
      app: Number(process.env.SETUP_APP_PORT) || Number(cfgPorts.app) || detectEnvExamplePort(runtime) || DEFAULT_PORTS.app,
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
    detection.stack.nodeServer ||
    detection.stack.client ||
    detection.workspaces.isWorkspace ||
    detection.stack.python ||
    detection.stack.go ||
    detection.stack.dotnet ||
    detection.stack.rust ||
    detection.stack.staticHtml ||
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

  if (detection.hasPackageJson) {
    steps.push({
      id: "dependencies",
      label: `Bağımlılık kurulumu (${buildInstallCommandLabel(detection)})`,
      required: true,
    });
  } else if (detection.stack.python) {
    steps.push({ id: "dependencies", label: "Bağımlılık kurulumu (Python venv + pip) + pip check", required: true });
  } else if (detection.stack.go) {
    steps.push({ id: "dependencies", label: "Bağımlılık kurulumu (go mod download) + go build doğrulaması", required: true });
  } else if (detection.stack.dotnet) {
    steps.push({ id: "dependencies", label: "Bağımlılık kurulumu (dotnet restore) + dotnet build doğrulaması", required: true });
  } else if (detection.stack.rust) {
    steps.push({ id: "dependencies", label: "Bağımlılık kurulumu (cargo fetch) + derleme doğrulaması (cargo check)", required: true });
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
