import { spawn } from "node:child_process";
import crypto, { timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { getProjectRoot } from "../utils/project-paths.mjs";
import { buildDeploymentArtifacts, parseDeploymentConfig, saveDeploymentConfig } from "../utils/deployment-config.mjs";
import { getSetupPaths, readConfiguredPort } from "../scripts/setup-bootstrap-lib.mjs";
import { buildLoginUrl, detectPackageManager, detectProject, loadSetupConfig, parseEnvExample } from "../scripts/detect-project.mjs";
import { resolveStepCommand } from "../scripts/polyglot.mjs";
import { buildServerEnv, hashAdminPassword, publicAppUrl, setupPayloadSchema, toDeploymentConfig, ValidationError } from "./config.mjs";
import { renderSetupPage } from "./ui.mjs";
import { createDesktopAppController, parseDotEnvFile, pmRunInvocation, readJsonFileSafe, resolveAppStartInvocation, resolveDesktopDataDir } from "./app-process.mjs";
// Geriye uyumluluk: bu yardımcılar eskiden bu modülden dışa aktarılıyordu.
export { parseDotEnvFile, pmRunInvocation, resolveAppStartInvocation, resolvePnpmInvocation, wrapShimCommand } from "./app-process.mjs";

function digest(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest();
}

export function equalSecret(left, right) {
  if (!left || !right) return false;
  return timingSafeEqual(digest(left), digest(right));
}

function cookieValue(req, name) {
  const part = String(req.headers.cookie || "").split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : "";
}

function writable(target) {
  try {
    fs.mkdirSync(target, { recursive: true });
    fs.accessSync(target, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function normalizeAllowedOrigins(raw) {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof raw === "string" && raw.trim()) {
    return raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

export function sameOrigin(req, expectedPort, allowedOrigins = []) {
  try {
    const origin = req.headers.origin;
    if (!origin) return false;
    const originStr = String(origin).trim();
    if (Array.isArray(allowedOrigins) && allowedOrigins.includes(originStr)) {
      return true;
    }
    const parsed = new URL(originStr);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) return false;
    if (expectedPort && Number(parsed.port || 80) !== expectedPort) return false;
    return true;
  } catch {
    return false;
  }
}

export function buildPublicFrontendConfig(payload, extraEnvVars = []) {
  const publicEnvObject = {};
  const entries = Array.isArray(extraEnvVars)
    ? extraEnvVars
    : extraEnvVars && typeof extraEnvVars === "object"
      ? Object.entries(extraEnvVars).map(([key, value]) => ({ key, value }))
      : [];
  for (const item of entries) {
    if (!item || typeof item.key !== "string") continue;
    const key = item.key.trim();
    if (!/^(VITE_|PUBLIC_|NEXT_PUBLIC_|REACT_APP_)[A-Za-z0-9_]*$/.test(key)) continue;
    publicEnvObject[key] = String(item.value ?? item.defaultValue ?? "");
  }
  const customEnv = payload?.customEnv && typeof payload.customEnv === "object" ? payload.customEnv : {};
  for (const [key, val] of Object.entries(customEnv)) {
    if (!/^(VITE_|PUBLIC_|NEXT_PUBLIC_|REACT_APP_)[A-Za-z0-9_]*$/.test(key)) continue;
    publicEnvObject[key] = String(val ?? "");
  }
  const dep = payload?.deployment || {};
  const normalizedUrl = dep.publicUrl ? publicAppUrl(payload) : String(dep.publicUrl || "");
  return {
    deployment: {
      mode: dep.mode || "localhost",
      publicUrl: normalizedUrl,
      basePath: dep.basePath || "/",
    },
    env: publicEnvObject,
    generatedAt: new Date().toISOString(),
  };
}

export function writePublicFrontendArtifacts(projectRoot, dataRoot, payload, extraEnvVars = []) {
  const configObj = buildPublicFrontendConfig(payload, extraEnvVars);
  const jsonText = `${JSON.stringify(configObj, null, 2)}\n`;
  const jsText = `window.__SETUP_CONFIG__ = ${JSON.stringify(configObj, null, 2)};\n`;
  const artifactDir = path.join(dataRoot, "setup-artifacts");
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(path.join(artifactDir, "runtime-config.json"), jsonText, "utf8");
  fs.writeFileSync(path.join(artifactDir, "env-config.js"), jsText, "utf8");

  if (projectRoot) {
    const root = path.resolve(projectRoot);
    for (const rel of ["dist", "build", "public", "."]) {
      const candidateDir = path.resolve(root, rel);
      if (fs.existsSync(path.join(candidateDir, "index.html"))) {
        fs.writeFileSync(path.join(candidateDir, "runtime-config.json"), jsonText, "utf8");
        fs.writeFileSync(path.join(candidateDir, "env-config.js"), jsText, "utf8");
      }
    }
  }
  return configObj;
}

const STATIC_MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

export function createStaticAppServer(staticDir) {
  const rootDir = path.resolve(staticDir);
  return http.createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.statusCode = 405;
      return res.end("Method Not Allowed");
    }
    const reqUrl = new URL(req.url || "/", "http://127.0.0.1");
    let relPath = decodeURIComponent(reqUrl.pathname || "/").replace(/^\/+/, "");
    if (!relPath || relPath.endsWith("/")) {
      relPath = path.join(relPath, "index.html");
    }
    const resolvedPath = path.resolve(rootDir, relPath);
    const relCheck = path.relative(rootDir, resolvedPath);
    if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
      res.statusCode = 403;
      return res.end("Forbidden");
    }
    let targetFile = resolvedPath;
    if (!fs.existsSync(targetFile) || !fs.statSync(targetFile).isFile()) {
      const ext = path.extname(relPath);
      const fallbackIndex = path.join(rootDir, "index.html");
      if (!ext && fs.existsSync(fallbackIndex) && fs.statSync(fallbackIndex).isFile()) {
        targetFile = fallbackIndex;
      } else {
        res.statusCode = 404;
        return res.end("Not Found");
      }
    }
    const ext = path.extname(targetFile).toLowerCase();
    res.setHeader("Content-Type", STATIC_MIME_TYPES[ext] || "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.statusCode = 200;
    if (req.method === "HEAD") return res.end();
    res.end(fs.readFileSync(targetFile));
  });
}

function runCommand(command, args, cwd, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...extraEnv },
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", (err) => reject(err));
    child.once("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const combined = `${stderr}\n${stdout}`.trim();
      const tail = combined ? combined.split(/\r?\n/).slice(-8).join(" | ") : `Çıkış kodu: ${code}`;
      reject(new Error(`Komut başarısız oldu (${command} ${args.join(" ")}): ${tail}`));
    });
  });
}

const MIGRATE_SCRIPT_CANDIDATES = ["prisma:migrate", "db:migrate", "migrate:deploy", "migrate", "db:push"];

const APPLY_STEPS = [
  { id: "prepare", label: "Kurulum ortamı hazırlanıyor" },
  { id: "buildServer", label: "Sunucu derlemesi" },
  { id: "buildClient", label: "İstemci (web) derlemesi" },
  { id: "migrate", label: "Veritabanı migration'ları" },
  { id: "admin", label: "İlk yönetici hesabı" },
  { id: "artifacts", label: "Dağıtım profili ve Nginx örneği" },
  { id: "env", label: "Gizli ayarların yazılması (.env)" },
  { id: "finish", label: "Kurulum kilidi ve kapanış" },
];

function createApplyState() {
  return {
    status: "idle",
    message: "Kurulum henüz uygulanmadı.",
    steps: APPLY_STEPS.map((step) => ({ id: step.id, label: step.label, status: "pending" })),
    summary: [],
    loginUrl: null,
    publicUrl: null,
    appPort: null,
    mode: null,
    startedAt: null,
    finishedAt: null,
  };
}

function isPortOpen(port, timeoutMs = 700) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const done = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 65_536) throw new Error("İstek gövdesi çok büyük.");
  }
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("Geçersiz JSON istek gövdesi.");
  }
}

function setSecurityHeaders(res, contentType = "application/json; charset=utf-8") {
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'");
}

function sendJson(res, status, payload) {
  setSecurityHeaders(res);
  res.statusCode = status;
  res.end(JSON.stringify(payload));
}

export function createSetupServer(token, options = {}) {
  if (!token || token.length < 24) throw new Error("SETUP_TOKEN en az 24 karakter olmalıdır.");
  const projectRoot = options.projectRoot ? path.resolve(options.projectRoot) : getProjectRoot();
  const setupConfig = loadSetupConfig(projectRoot);
  const detection = detectProject(projectRoot);

  // Masaüstü senaryosunda açık bir veri dizini yoksa kullanıcı veri dizini (AppData vb.) kullanılır.
  const dataDir = resolveDesktopDataDir({ detection, setupConfig, explicit: options.dataDir });

  let serverRoot;
  let dataRoot;
  let envPath;
  let lockPath;
  let pendingPath;
  let artifactRoot;
  let databaseUrl;

  if (options.forceServerSubdir === true) {
    serverRoot = path.join(projectRoot, "server");
    dataRoot = path.join(serverRoot, "data");
    envPath = path.join(serverRoot, ".env");
    lockPath = path.join(dataRoot, "installation.lock");
    pendingPath = path.join(dataRoot, "installation.pending");
    artifactRoot = path.join(dataRoot, "setup-artifacts");
    databaseUrl = "file:../data/app.db";
  } else if (options.forceServerSubdir === false) {
    serverRoot = projectRoot;
    dataRoot = path.join(projectRoot, "data");
    envPath = path.join(projectRoot, ".env");
    lockPath = path.join(dataRoot, "installation.lock");
    pendingPath = path.join(dataRoot, "installation.pending");
    artifactRoot = path.join(dataRoot, "setup-artifacts");
    databaseUrl = "file:./data/app.db";
  } else {
    const paths = getSetupPaths(projectRoot, { dataDir });
    serverRoot = paths.serverRoot;
    dataRoot = paths.dataRoot;
    envPath = paths.env;
    lockPath = paths.lock;
    pendingPath = paths.pending;
    artifactRoot = paths.setupArtifacts;
    databaseUrl = paths.databaseUrl;
  }

  const sessionValue = crypto.createHmac("sha256", token).update("setup-wizard-session").digest("hex");
  const csrfToken = crypto.createHmac("sha256", token).update("setup-wizard-csrf").digest("hex");
  const allowedOrigins = normalizeAllowedOrigins(options.allowedOrigins ?? process.env.SETUP_ALLOWED_ORIGINS);
  const applyJob = createApplyState();
  let appChild = null;
  let spawnedStaticServer = null;
  const isDesktop = Boolean(detection.scenario.isDesktop);
  const desktopApp = createDesktopAppController({
    projectRoot,
    setupConfig,
    getEnvPath: () => envPath,
    dataDir,
    graceMs: Number(options.desktopGraceMs ?? 3000),
    startInvocation: options.startAppInvocation || null,
  });

  const rateBuckets = new Map();
  function checkRateLimit(key, limit, windowMs) {
    const now = Date.now();
    const entry = rateBuckets.get(key);
    if (!entry || now >= entry.resetAt) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  }

  function markStep(id, status, detail) {
    applyJob.steps = applyJob.steps.map((step) =>
      step.id === id ? { ...step, status, detail: detail ?? step.detail } : step,
    );
  }

  async function applySetup(payload) {
    fs.mkdirSync(dataRoot, { recursive: true });
    fs.mkdirSync(path.dirname(envPath), { recursive: true });
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    if (fs.existsSync(lockPath)) throw new Error("Kurulum daha önce tamamlanmış. Sihirbaz yeniden çalıştırılamaz.");
    if (fs.existsSync(envPath) && !payload.overwriteExistingEnv) {
      throw new Error(".env zaten var. İçeriğini doğrulayın veya yedekleyerek değiştirme onayını seçin.");
    }
    let pendingHandle;
    try {
      pendingHandle = fs.openSync(pendingPath, "wx", 0o600);
    } catch {
      throw new Error("Başka bir kurulum işlemi çalışıyor veya önceki işlem yarım kaldı.");
    }

    const envExample = parseEnvExample(projectRoot);
    const envText = buildServerEnv(
      payload,
      undefined,
      databaseUrl,
      envExample.variables,
      detection.scenario,
    );
    const temporaryEnv = `${envPath}.setup-${process.pid}`;
    const summary = [];
    const appUrl = publicAppUrl(payload);
    applyJob.publicUrl = appUrl;
    const loginPath = detection.scenario.isStaticOnly ? "" : detection.routes.loginPath;
    applyJob.appUrl = appUrl;
    applyJob.loginPath = loginPath;
    applyJob.loginUrl = buildLoginUrl(appUrl, loginPath);
    applyJob.appPort = payload.server.port;
    applyJob.mode = payload.deployment.mode;
    applyJob.isDesktop = isDesktop;

    try {
      markStep("prepare", "running");
      fs.writeFileSync(temporaryEnv, envText, { encoding: "utf8", mode: 0o600 });
      markStep("prepare", "done", "Geçici ortam dosyası hazırlandı.");

      const rootPkg = readJsonFileSafe(path.join(projectRoot, "package.json"));
      const serverPkg = readJsonFileSafe(path.join(projectRoot, "server", "package.json"));
      const clientPkg = readJsonFileSafe(path.join(projectRoot, "client", "package.json"));
      const pm = setupConfig?.packageManager || detectPackageManager(projectRoot, rootPkg);

      if (!payload.buildClient) {
        markStep("buildServer", "skipped", "Üretim derlemesi istenmedi.");
        markStep("buildClient", "skipped", "Üretim derlemesi istenmedi.");
      } else if (typeof options.runBuildCommands === "function") {
        markStep("buildServer", "running");
        markStep("buildClient", "running");
        await options.runBuildCommands(payload);
        markStep("buildServer", "done");
        markStep("buildClient", "done");
        summary.push("Üretim derlemesi tamamlandı.");
      } else {
        if (serverPkg?.scripts?.build) {
          markStep("buildServer", "running");
          const inv = pmRunInvocation(pm, "build", path.join(projectRoot, "server"));
          await runCommand(inv.command, inv.args, inv.cwd || projectRoot);
          markStep("buildServer", "done", "server build");
          summary.push("Sunucu derlemesi tamamlandı.");
        } else if (!serverPkg && !clientPkg && rootPkg?.scripts?.build) {
          markStep("buildServer", "running");
          const inv = pmRunInvocation(pm, "build", projectRoot);
          await runCommand(inv.command, inv.args, inv.cwd || projectRoot);
          markStep("buildServer", "done", "root build");
          summary.push("Proje derlemesi tamamlandı.");
        } else {
          markStep("buildServer", "skipped", "Derleme betiği yok.");
        }

        if (clientPkg?.scripts?.build) {
          markStep("buildClient", "running");
          const inv = pmRunInvocation(pm, "build", path.join(projectRoot, "client"));
          await runCommand(inv.command, inv.args, inv.cwd || projectRoot);
          markStep("buildClient", "done", "client build");
          summary.push("İstemci derlemesi tamamlandı.");
        } else if (rootPkg?.scripts?.["build:client"]) {
          markStep("buildClient", "running");
          const inv = pmRunInvocation(pm, "build:client", projectRoot);
          await runCommand(inv.command, inv.args, inv.cwd || projectRoot);
          markStep("buildClient", "done", "build:client");
          summary.push("İstemci derlemesi tamamlandı.");
        } else {
          markStep("buildClient", "skipped", "İstemci derleme betiği yok.");
        }
      }

      if (typeof options.runMigrateCommands === "function") {
        markStep("migrate", "running");
        await options.runMigrateCommands(payload);
        markStep("migrate", "done");
        summary.push("Veritabanı migration'ları uygulandı.");
      } else {
        const serverMigrateScript = MIGRATE_SCRIPT_CANDIDATES.find((name) => Boolean(serverPkg?.scripts?.[name]));
        const rootMigrateScript = MIGRATE_SCRIPT_CANDIDATES.find((name) => Boolean(rootPkg?.scripts?.[name]));
        const migrateScript = serverMigrateScript || rootMigrateScript;
        const migrateDir = serverMigrateScript ? path.join(projectRoot, "server") : projectRoot;

        if (migrateScript) {
          markStep("migrate", "running", migrateScript);
          const inv = pmRunInvocation(pm, migrateScript, migrateDir);
          await runCommand(inv.command, inv.args, inv.cwd || projectRoot, { DATABASE_URL: databaseUrl });
          markStep("migrate", "done", migrateScript);
          summary.push("Veritabanı migration'ları uygulandı.");
        } else {
          markStep("migrate", "skipped", "Migration betiği bulunamadı.");
        }
      }

      markStep("admin", "running");
      if (payload.admin && payload.admin.email) {
        const passwordHash = payload.admin.passwordHash || hashAdminPassword(payload.admin.password);
        fs.writeFileSync(
          path.join(dataRoot, "admin.json"),
          `${JSON.stringify({ name: payload.admin.name, email: payload.admin.email, passwordHash, createdAt: new Date().toISOString() }, null, 2)}\n`,
          { encoding: "utf8", mode: 0o600 },
        );
        markStep("admin", "done", payload.admin.email);
        summary.push("İlk yönetici hesabı oluşturuldu.");
      } else {
        markStep("admin", "skipped", "Bu senaryoda yönetici hesabı atlandı.");
      }

      markStep("artifacts", "running");
      const savedEnvRoot = process.env.SETUP_PROJECT_ROOT;
      process.env.SETUP_PROJECT_ROOT = projectRoot;
      try {
        const config = saveDeploymentConfig(toDeploymentConfig(payload), "setup-wizard", projectRoot, { dataDir });
        const artifacts = buildDeploymentArtifacts(config, payload.server.port);
        fs.mkdirSync(artifactRoot, { recursive: true });
        fs.writeFileSync(path.join(artifactRoot, "nginx.conf.example"), `${artifacts.nginxText}\n`, "utf8");
        fs.writeFileSync(path.join(artifactRoot, "deployment.env.example"), `${artifacts.envText}\n`, "utf8");
        writePublicFrontendArtifacts(projectRoot, dataRoot, payload, envExample.variables);
      } finally {
        if (savedEnvRoot === undefined) delete process.env.SETUP_PROJECT_ROOT;
        else process.env.SETUP_PROJECT_ROOT = savedEnvRoot;
      }
      markStep("artifacts", "done", "setup-artifacts");
      summary.push("Nginx örneği setup-artifacts altında üretildi.");

      markStep("env", "running");
      if (fs.existsSync(envPath)) {
        const backupRoot = path.join(serverRoot, "backups");
        fs.mkdirSync(backupRoot, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        fs.copyFileSync(envPath, path.join(backupRoot, `.env-${stamp}.bak`));
        summary.push("Eski .env dosyası backups altında yedeklendi.");
      }
      fs.renameSync(temporaryEnv, envPath);
      try { fs.chmodSync(envPath, 0o600); } catch {}
      markStep("env", "done", ".env");
      summary.push("Gizli ayarlar .env dosyasına yazıldı.");

      markStep("finish", "running");
      fs.writeFileSync(lockPath, `${JSON.stringify({ installedAt: new Date().toISOString(), publicUrl: publicAppUrl(payload), nodeVersion: process.version }, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      markStep("finish", "done", "installation.lock yazıldı");
      return summary;
    } finally {
      if (pendingHandle !== undefined) fs.closeSync(pendingHandle);
      if (fs.existsSync(pendingPath)) fs.unlinkSync(pendingPath);
      if (fs.existsSync(temporaryEnv)) fs.unlinkSync(temporaryEnv);
    }
  }

  function validateStepPayload(step, data) {
    const issues = [];
    const raw = data && typeof data === "object" ? data : {};
    if (step === "deployment") {
      try {
        parseDeploymentConfig(raw);
      } catch (err) {
        issues.push({ code: "custom", message: err.message, path: ["deployment"] });
      }
    } else if (step === "server") {
      const host = raw.host;
      const port = Number(raw.port);
      if (!["127.0.0.1", "0.0.0.0"].includes(host)) {
        issues.push({ code: "invalid_enum_value", message: "Sunucu adresi 127.0.0.1 veya 0.0.0.0 olmalıdır.", path: ["server", "host"] });
      }
      if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        issues.push({ code: "invalid_port", message: "Sunucu portu 1024-65535 aralığında olmalıdır.", path: ["server", "port"] });
      }
    } else if (step === "admin") {
      const name = String(raw.name ?? "").trim();
      const email = String(raw.email ?? "").trim();
      const password = String(raw.password ?? "");
      if (!detection.scenario.requiresAdmin && !name && !email && !password) {
        return issues;
      }
      if (name.length < 2 || name.length > 100 || /[\r\n\0]/.test(name)) {
        issues.push({ code: "invalid_string", message: "admin.name 2-100 karakter aralığında olmalıdır.", path: ["admin.name"] });
      }
      if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /[\r\n\0]/.test(email)) {
        issues.push({ code: "invalid_email", message: "Geçerli bir e-posta adresi girin.", path: ["admin.email"] });
      }
      if (password.length < 12 || password.length > 128) {
        issues.push({ code: "too_small", message: "Parola en az 12, en fazla 128 karakter olmalıdır.", path: ["admin", "password"] });
      } else {
        if (!(/[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password))) {
          issues.push({ code: "custom", message: "Parola büyük/küçük harf ve rakam içermelidir.", path: ["admin", "password"] });
        }
        if (/password|123456|qwerty|admin123/i.test(password)) {
          issues.push({ code: "custom", message: "Kolay tahmin edilen parola kullanılamaz.", path: ["admin", "password"] });
        }
      }
    } else if (step === "email") {
      if (raw.enabled === true) {
        const user = String(raw.user ?? "").trim();
        const fromEmail = String(raw.fromEmail ?? "").trim();
        const fromName = String(raw.fromName ?? "").trim();
        const password = String(raw.password ?? "").replace(/\s/g, "");
        if (!/@gmail\.com$/i.test(user)) {
          issues.push({ code: "invalid_gmail", message: "Yalnız Gmail adresi kullanılabilir.", path: ["email.user"] });
        }
        if (!/@gmail\.com$/i.test(fromEmail)) {
          issues.push({ code: "invalid_gmail", message: "Yalnız Gmail adresi kullanılabilir.", path: ["email.fromEmail"] });
        }
        if (!fromName || fromName.length > 100 || /[\r\n\0]/.test(fromName)) {
          issues.push({ code: "invalid_string", message: "email.fromName 1-100 karakter aralığında olmalıdır.", path: ["email.fromName"] });
        }
        if (password.length < 16 || password.length > 128) {
          issues.push({ code: "custom", message: "Geçerli Gmail uygulama parolası girin.", path: ["email", "password"] });
        }
      }
    } else {
      try {
        setupPayloadSchema.parse(raw, { allowOptionalAdmin: !detection.scenario.requiresAdmin });
      } catch (err) {
        if (err instanceof ValidationError) {
          issues.push(...err.issues);
        } else {
          issues.push({ code: "custom", message: err.message, path: [] });
        }
      }
    }
    return issues;
  }

  const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url || "/", "http://127.0.0.1");
    const clientIp = req.socket?.remoteAddress || "127.0.0.1";
    const reqOrigin = req.headers.origin ? String(req.headers.origin).trim() : "";

    if (reqOrigin && allowedOrigins.includes(reqOrigin)) {
      res.setHeader("Access-Control-Allow-Origin", reqOrigin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Setup-CSRF, Authorization");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        return res.end();
      }
    }

    if (req.method === "GET" && reqUrl.pathname === "/setup") {
      if (reqUrl.searchParams.has("token")) {
        if (!checkRateLimit(`setup-auth:${clientIp}`, 15, 15 * 60_000)) {
          setSecurityHeaders(res, "text/plain; charset=utf-8");
          res.statusCode = 429;
          return res.end("Çok fazla kurulum anahtarı denemesi yapıldı.");
        }
        const supplied = reqUrl.searchParams.get("token") || "";
        if (supplied && equalSecret(supplied, token)) {
          setSecurityHeaders(res, "text/plain; charset=utf-8");
          res.statusCode = 303;
          res.setHeader("Set-Cookie", `setup.wizard=${encodeURIComponent(sessionValue)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800`);
          res.setHeader("Location", "/setup");
          return res.end("Yönlendiriliyor...");
        }
      }
      if (!equalSecret(cookieValue(req, "setup.wizard"), sessionValue)) {
        setSecurityHeaders(res, "text/plain; charset=utf-8");
        res.statusCode = 401;
        return res.end("Geçersiz veya eksik kurulum anahtarı.");
      }
      setSecurityHeaders(res, "text/html; charset=utf-8");
      res.statusCode = 200;
      return res.end(renderSetupPage(csrfToken, { title: options.title || setupConfig?.wizard?.title }));
    }

    if (reqUrl.pathname.startsWith("/api/")) {
      const bearerToken = String(req.headers["x-setup-token"] || req.headers.authorization?.replace(/^Bearer\s+/i, "") || "");
      const hasValidSession = equalSecret(cookieValue(req, "setup.wizard"), sessionValue) || equalSecret(bearerToken, token);
      if (!hasValidSession) {
        return sendJson(res, 401, { message: "Kurulum oturumu geçersiz." });
      }
      if (req.method !== "GET") {
        if (!checkRateLimit(`api-mut:${clientIp}`, 30, 15 * 60_000)) {
          return sendJson(res, 429, { message: "İstek sınırı aşıldı." });
        }
        const validCsrf = equalSecret(String(req.headers["x-setup-csrf"] || ""), csrfToken) || equalSecret(bearerToken, token);
        if (!sameOrigin(req, undefined, allowedOrigins) || !validCsrf) {
          return sendJson(res, 403, { message: "Kurulum isteği güvenlik doğrulamasından geçmedi." });
        }
      }

      if (req.method === "POST" && reqUrl.pathname === "/api/validate-step") {
        try {
          const rawBody = await readJson(req);
          const step = rawBody?.step || "all";
          const data = rawBody?.data ?? rawBody;
          const issues = validateStepPayload(step, data);
          if (issues.length > 0) {
            return sendJson(res, 400, { ok: false, errors: issues.map((i) => i.message), issues });
          }
          return sendJson(res, 200, { ok: true });
        } catch (error) {
          return sendJson(res, 400, { ok: false, message: error instanceof Error ? error.message : "Geçersiz istek." });
        }
      }

      if (req.method === "GET" && reqUrl.pathname === "/api/status") {
        const networks = Object.values(os.networkInterfaces()).flat().filter((item) => item && !item.internal).map((item) => item.address);
        const envExample = parseEnvExample(projectRoot);
        const defaultPort = detection.ports.app || readConfiguredPort(projectRoot) || Number(setupConfig?.ports?.app) || 5000;
        return sendJson(res, 200, {
          detected: {
            hostname: os.hostname(),
            platform: `${process.platform}/${process.arch}`,
            node: process.version,
            cpus: os.cpus().length,
            memoryGb: Math.round(os.totalmem() / 1024 ** 3),
            addresses: networks,
            kind: detection.kind,
            scenario: detection.scenario,
            defaultPort,
            envVariables: envExample.variables || [],
          },
          checks: {
            nodeSupported: [18, 20, 22, 24].includes(Number(process.versions.node.split(".")[0])),
            dataWritable: writable(dataRoot),
            uploadsWritable: writable(path.join(serverRoot, "uploads")),
            notInstalled: !fs.existsSync(lockPath),
            envAbsent: !fs.existsSync(envPath),
          },
          apply: applyJob,
        });
      }

      if (req.method === "GET" && reqUrl.pathname === "/api/app-health" && isDesktop) {
        const result = desktopApp.health();
        return sendJson(res, result.status, result.body);
      }

      if (req.method === "GET" && reqUrl.pathname === "/api/app-health") {
        const mode = applyJob.mode ?? "localhost";
        const appPort = applyJob.appPort ?? 5000;
        // Ayrı bir ön yüz dev sunucusu yalnızca algılandıysa/yapılandırıldıysa denetlenir (sabit port yok).
        const devPort = detection.routes.devPort;
        const isLocal = mode === "localhost";
        const hasDevUi = isLocal && Boolean(devPort) && devPort !== appPort;
        const uiPort = hasDevUi ? devPort : appPort;
        const apiReachable = await isPortOpen(appPort);
        const uiReachable = hasDevUi ? await isPortOpen(uiPort) : apiReachable;
        const reachable = hasDevUi ? uiReachable : apiReachable;
        const loginUrl = hasDevUi && uiReachable && !detection.scenario.isStaticOnly ? buildLoginUrl(`http://127.0.0.1:${devPort}`, detection.routes.loginPath) : applyJob.loginUrl;
        return sendJson(res, 200, {
          reachable,
          apiReachable,
          uiReachable,
          port: appPort,
          uiPort,
          mode,
          loginUrl,
          publicUrl: applyJob.publicUrl,
          hint: reachable
            ? "Uygulama ayakta görünüyor; giriş sayfasına gidebilirsiniz."
            : `Uygulama henüz ayakta değil (API: ${appPort}).`,
        });
      }

      if (req.method === "POST" && reqUrl.pathname === "/api/start-app") {
        if (applyJob.status !== "success" && !fs.existsSync(lockPath)) {
          return sendJson(res, 409, { message: "Uygulamayı başlatmadan önce kurulum adımlarını tamamlayın." });
        }
        if (isDesktop) {
          const result = await desktopApp.start();
          return sendJson(res, result.status, result.body);
        }

        const appPort = applyJob.appPort || readConfiguredPort(projectRoot) || Number(setupConfig?.ports?.app) || 5000;
        if (await isPortOpen(appPort)) {
          return sendJson(res, 200, {
            message: "Uygulama zaten çalışıyor.",
            reachable: true,
            pid: appChild?.pid ?? process.pid,
            loginUrl: applyJob.loginUrl,
            publicUrl: applyJob.publicUrl,
          });
        }

        if ((!appChild || appChild.exitCode !== null || appChild.killed) && !spawnedStaticServer) {
          const invocation = options.startAppInvocation || resolveAppStartInvocation(projectRoot, setupConfig);
          if (!invocation) {
            return sendJson(res, 409, {
              message: "Hedef projede başlatma komutu (scripts.start veya giriş dosyası) bulunamadı.",
              reachable: false,
            });
          }
          if (invocation.type === "static") {
            const staticSrv = createStaticAppServer(invocation.staticDir);
            await new Promise((resolve, reject) => {
              staticSrv.once("error", reject);
              staticSrv.listen(appPort, "127.0.0.1", resolve);
            });
            spawnedStaticServer = staticSrv;
            return sendJson(res, 200, {
              message: "Yerleşik statik dosya sunucusu başlatıldı ve bağlantıya hazır.",
              reachable: true,
              pid: process.pid,
              loginUrl: applyJob.loginUrl,
              publicUrl: applyJob.publicUrl,
            });
          }
          const dotEnvVars = parseDotEnvFile(envPath);
          const childEnv = { ...process.env, ...dotEnvVars, PORT: String(appPort) };
          appChild = spawn(invocation.command, invocation.args, {
            cwd: invocation.cwd || projectRoot,
            env: childEnv,
            detached: process.platform !== "win32",
            windowsHide: true,
            stdio: "ignore",
          });
          appChild.on("error", () => {});
          appChild.unref();
        }

        for (let i = 0; i < 16; i++) {
          await new Promise((r) => setTimeout(r, 200));
          if (await isPortOpen(appPort)) {
            return sendJson(res, 200, {
              message: "Uygulama başlatıldı ve bağlantıya hazır.",
              reachable: true,
              pid: appChild?.pid ?? null,
              loginUrl: applyJob.loginUrl,
              publicUrl: applyJob.publicUrl,
            });
          }
        }

        return sendJson(res, 202, {
          message: "Başlatıldı ancak port henüz açılmadı. Birkaç saniye sonra tekrar denetleyin.",
          reachable: false,
          pid: appChild?.pid ?? null,
          loginUrl: applyJob.loginUrl,
          publicUrl: applyJob.publicUrl,
        });
      }

      if (req.method === "POST" && reqUrl.pathname === "/api/apply") {
        if (applyJob.status === "running") {
          return sendJson(res, 409, { message: "Kurulum zaten uygulanıyor; pencereyi kapatmayın." });
        }
        try {
          const rawBody = await readJson(req);
          const payload = setupPayloadSchema.parse(rawBody, { allowOptionalAdmin: !detection.scenario.requiresAdmin });
          applyJob.status = "running";
          applyJob.message = "Kurulum uygulanıyor; adımlar ekranda canlı izleniyor…";
          applyJob.summary = [];
          applyJob.steps = createApplyState().steps;
          applyJob.startedAt = new Date().toISOString();
          applyJob.finishedAt = null;
          sendJson(res, 202, {
            message: "Kurulum başladı. Aşağıdaki adımlar tamamlandıkça güncellenir.",
            steps: applyJob.steps,
          });

          void (async () => {
            try {
              const summary = await applySetup(payload);
              applyJob.summary = summary;
              applyJob.status = "success";
              applyJob.message = "Kurulum tamamlandı. Birazdan giriş sayfasına yönlendirileceksiniz.";
              applyJob.finishedAt = new Date().toISOString();
              if (options.onComplete) setTimeout(() => options.onComplete(), 20_000);
            } catch (error) {
              applyJob.status = "error";
              applyJob.message = error instanceof Error ? error.message : "Kurulum tamamlanamadı.";
              applyJob.finishedAt = new Date().toISOString();
              applyJob.steps = applyJob.steps.map((step) =>
                step.status === "running" ? { ...step, status: "error", detail: applyJob.message } : step,
              );
            }
          })();
          return;
        } catch (error) {
          applyJob.status = "idle";
          if (error instanceof ValidationError) {
            return sendJson(res, 400, {
              message: "Girilen bilgiler doğrulanamadı.",
              issues: error.issues,
            });
          }
          return sendJson(res, 409, { message: error instanceof Error ? error.message : "Kurulum tamamlanamadı." });
        }
      }
    }

    return sendJson(res, 404, { message: "Uç nokta bulunamadı." });
  });

  server.stopSpawnedApp = async () => {
    if (spawnedStaticServer) {
      const srv = spawnedStaticServer;
      spawnedStaticServer = null;
      await new Promise((resolve) => srv.close(() => resolve()));
    }
    await desktopApp.stop();
    if (!appChild) return;
    const child = appChild;
    const pid = child.pid;
    appChild = null;
    const exitPromise =
      child.exitCode !== null
        ? Promise.resolve()
        : new Promise((resolve) => {
            const timer = setTimeout(resolve, 1500);
            child.once("exit", () => {
              clearTimeout(timer);
              resolve();
            });
          });
    try {
      child.kill();
    } catch {}
    if (process.platform !== "win32" && pid) {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {}
    }
    await exitPromise;
  };

  return server;
}

export function startSetupWizard() {
  const projectRoot = getProjectRoot();
  const setupConfig = loadSetupConfig(projectRoot);
  const detection = detectProject(projectRoot);
  const dataDir = resolveDesktopDataDir({ detection, setupConfig, explicit: null });
  const paths = getSetupPaths(projectRoot, { dataDir });
  fs.mkdirSync(paths.dataRoot, { recursive: true });
  if (fs.existsSync(paths.lock)) {
    throw new Error("Kurulum kilidi mevcut. Çalışan sistemi yeniden yapılandırmak için önce temiz kurulum adımını kullanın.");
  }
  const token = process.env.SETUP_TOKEN || crypto.randomBytes(24).toString("base64url");
  const host = "127.0.0.1";
  const port = Math.min(65535, Math.max(1024, Number(process.env.SETUP_PORT) || Number(setupConfig?.ports?.wizard) || 5050));
  let server;
  server = createSetupServer(token, { projectRoot, dataDir, onComplete: () => server.close() });
  server.listen(port, host, () => {
    console.log(`Kurulum sihirbazı: http://${host}:${port}/setup?token=${token}`);
    console.log("Bu bağlantıyı paylaşmayın. Kurulum tamamlandığında sihirbaz otomatik kapanır.");
  });
  return server;
}

if (import.meta.url && process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  startSetupWizard();
}
