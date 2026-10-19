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

function detectStack(root) {
  const rootPkg = readJsonSafe(path.join(root, "package.json"));
  const serverPkg = readJsonSafe(path.join(root, "server", "package.json"));
  const clientPkg = readJsonSafe(path.join(root, "client", "package.json"));
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
    Boolean(rootPkg?.scripts?.start || rootPkg?.scripts?.dev);

  return {
    nodeServer: hasServerSubdir || hasRootServerEntry,
    hasServerSubdir,
    client:
      exists(root, "client", "package.json") ||
      exists(root, "client", "src") ||
      hasDependency(rootPkg, "react") ||
      hasDependency(rootPkg, "vue") ||
      hasDependency(rootPkg, "next") ||
      hasDependency(clientPkg, "react"),
    prisma: exists(root, "server", "prisma", "schema.prisma") || exists(root, "prisma", "schema.prisma"),
    vite:
      exists(root, "client", "vite.config.ts") ||
      exists(root, "client", "vite.config.js") ||
      exists(root, "vite.config.ts") ||
      exists(root, "vite.config.js") ||
      hasDependency(rootPkg, "vite") ||
      hasDependency(clientPkg, "vite"),
    nextjs: hasDependency(rootPkg, "next") || exists(root, "next.config.js") || exists(root, "next.config.mjs"),
    express: hasDependency(rootPkg, "express") || hasDependency(serverPkg, "express"),
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

/**
 * Kurulum eklentisinin çalıştığı kök dizini ve içeriğini analiz eder.
 * @param {string} root - hedef uygulama kök dizini (varsayılan: process.cwd())
 */
export function detectProject(root = process.cwd()) {
  const resolved = path.resolve(root);
  const validPkg = hasValidPackageJson(resolved);
  const setupConfig = loadSetupConfig(resolved);
  const workspaces = detectWorkspaces(resolved);
  const stack = detectStack(resolved);
  const install = detectInstallEvidence(resolved);
  const runtime = detectRuntimeArtifacts(resolved);

  let kind = "unknown";
  if (workspaces.isWorkspace && stack.nodeServer) kind = "workspace-fullstack";
  else if (workspaces.isWorkspace) kind = "workspace";
  else if (stack.hasServerSubdir && stack.client) kind = "node-fullstack";
  else if (stack.nodeServer && stack.client) kind = "node-webapp";
  else if (stack.nodeServer) kind = "node-server";
  else if (stack.client) kind = "node-client";
  else if (validPkg) kind = "node-package";
  else if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) kind = "directory";

  const projectName =
    workspaces.name ||
    setupConfig?.name ||
    path.basename(resolved).toLowerCase().replace(/[^a-z0-9._-]+/g, "-") ||
    "app";

  const cfgPorts = setupConfig?.ports || {};
  return {
    root: resolved,
    projectName,
    kind,
    packageManager: workspaces.packageManager,
    hasPackageJson: validPkg,
    packageJsonExists: exists(resolved, "package.json"),
    workspaces,
    stack,
    install,
    runtime,
    setupConfig,
    ports: {
      bootstrap: Number(process.env.SETUP_BOOTSTRAP_PORT) || Number(cfgPorts.bootstrap) || DEFAULT_PORTS.bootstrap,
      wizard: Number(process.env.SETUP_WIZARD_PORT) || Number(cfgPorts.wizard) || DEFAULT_PORTS.wizard,
      app: Number(process.env.SETUP_APP_PORT) || Number(cfgPorts.app) || DEFAULT_PORTS.app,
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
    detection.workspaces.isWorkspace;

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
  }

  if (detection.stack.nodeServer || detection.stack.client || detection.hasPackageJson) {
    steps.push({ id: "wizard", label: `Web kurulum sihirbazı (${detection.ports?.wizard || 5050})`, optional: false });
    steps.push({ id: "apply", label: "Yapılandırma (.env) + veri hazırlığı" });
    steps.push({ id: "start", label: "Uygulamayı başlat ve aç" });
  }

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
