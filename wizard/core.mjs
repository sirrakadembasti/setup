import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getProjectRoot } from "../utils/project-paths.mjs";
import { buildDeploymentArtifacts, parseDeploymentConfig, saveDeploymentConfig } from "../utils/deployment-config.mjs";
import { getSetupPaths, readConfiguredPort } from "../scripts/setup-bootstrap-lib.mjs";
import { buildLoginUrl, detectPackageManager, detectProject, loadSetupConfig, parseEnvExample } from "../scripts/detect-project.mjs";
import {
  buildServerEnv,
  hashAdminPassword,
  publicAppUrl,
  setupPayloadSchema,
  toDeploymentConfig,
  ValidationError,
  verifyAdminPassword,
} from "./config.mjs";
import { renderSetupPage } from "./ui.mjs";
import { equalSecret, pmRunInvocation, writePublicFrontendArtifacts } from "./server.mjs";

function readJsonFileSafe(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
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

export function parseEnvFile(envPath) {
  const vars = {};
  if (!envPath || !fs.existsSync(envPath)) return vars;
  let content = "";
  try {
    content = fs.readFileSync(envPath, "utf8");
  } catch {
    return vars;
  }
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    let val = match[2].trim();
    if (val.startsWith('"') && val.endsWith('"')) {
      try {
        val = JSON.parse(val);
      } catch {
        val = val
          .slice(1, -1)
          .replace(/\\n/g, "\n")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\");
      }
    } else if (val.startsWith("'") && val.endsWith("'")) {
      val = val.slice(1, -1);
    }
    vars[key] = String(val);
  }
  return vars;
}

function normalizeRootAndOptions(rootOrOptions = process.cwd()) {
  if (typeof rootOrOptions === "string") {
    return { projectRoot: path.resolve(rootOrOptions), dataDir: null };
  }
  if (rootOrOptions && typeof rootOrOptions === "object") {
    const projectRoot = rootOrOptions.projectRoot
      ? path.resolve(rootOrOptions.projectRoot)
      : process.cwd();
    const dataDir = rootOrOptions.dataDir || null;
    return { projectRoot, dataDir };
  }
  return { projectRoot: process.cwd(), dataDir: null };
}

export function readSetupRuntimeConfig(rootOrOptions = process.cwd()) {
  const { projectRoot, dataDir } = normalizeRootAndOptions(rootOrOptions);
  const paths = getSetupPaths(projectRoot, { dataDir });
  const installed = fs.existsSync(paths.lock);
  const env = parseEnvFile(paths.env);
  const deployment = readJsonFileSafe(paths.deploymentConfig);
  let admin = readJsonFileSafe(paths.adminConfig);
  if (!admin && (env.ADMIN_EMAIL || env.ADMIN_PASSWORD_HASH || env.ADMIN_NAME)) {
    admin = {
      name: env.ADMIN_NAME || "",
      email: env.ADMIN_EMAIL || "",
      passwordHash: env.ADMIN_PASSWORD_HASH || "",
    };
  }
  return {
    installed,
    paths,
    env,
    deployment,
    admin,
  };
}

/** HTTP üzerinden sunulabilecek, gizli anahtar ve parola özeti içermeyen çalışma anı görünümü. */
export function publicRuntimeConfig(runtime) {
  return {
    installed: runtime.installed,
    deployment: runtime.deployment,
    admin: runtime.admin ? { name: runtime.admin.name || "", email: runtime.admin.email || "" } : null,
  };
}

export function verifyAdminCredentials(rootOrOptions, email, password) {
  const runtime = readSetupRuntimeConfig(rootOrOptions);
  const admin = runtime.admin;
  if (!admin || !admin.email || !admin.passwordHash) return false;
  const expectedEmail = String(admin.email || "").trim().toLowerCase();
  const givenEmail = String(email || "").trim().toLowerCase();
  if (!expectedEmail || expectedEmail !== givenEmail) return false;
  return verifyAdminPassword(String(password || ""), admin.passwordHash);
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

function validateStepData(step, data, options = {}) {
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
    if (options.allowOptionalAdmin && !name && !email && !password) {
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
      setupPayloadSchema.parse(raw, { allowOptionalAdmin: Boolean(options.allowOptionalAdmin) });
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

export function createSetupWizardCore(options = {}) {
  const projectRoot = options.projectRoot ? path.resolve(options.projectRoot) : getProjectRoot();
  const dataDir = options.dataDir || null;
  // Tahmin edilebilir sabit anahtar yok: verilmezse işlem başına rastgele üretilir.
  // Sunucusuz (serverless) ortamlarda örnekler arası tutarlılık için `token` seçeneğini verin.
  const token = options.token || crypto.randomBytes(24).toString("base64url");
  const requireAuth = Boolean(options.requireAuth && !options.ipcMode && options.auth !== false);
  // IPC (Electron) dışındaki her kullanım HTTP üzerinden erişilebilir kabul edilir; CSRF + Origin zorunludur.
  const enforceCsrf = !options.ipcMode && options.enforceCsrf !== false;
  const allowedOrigins = [].concat(options.allowedOrigins || []).map((o) => String(o).trim()).filter(Boolean);
  const setupConfig = loadSetupConfig(projectRoot);
  const paths = getSetupPaths(projectRoot, { dataDir });
  const detection = detectProject(projectRoot);

  const csrfToken = crypto.createHmac("sha256", token).update("setup-wizard-csrf").digest("hex");
  const applyJob = createApplyState();
  let activeApplyPromise = null;

  function markStep(id, status, detail) {
    applyJob.steps = applyJob.steps.map((step) =>
      step.id === id ? { ...step, status, detail: detail ?? step.detail } : step,
    );
  }

  async function executeApply(payload) {
    const currentPaths = getSetupPaths(projectRoot, { dataDir });
    const { serverRoot, dataRoot, env: envPath, lock: lockPath, pending: pendingPath, setupArtifacts: artifactRoot, databaseUrl } = currentPaths;

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

    const passwordHash = payload.admin && payload.admin.password ? (payload.admin.passwordHash || hashAdminPassword(payload.admin.password)) : "";
    const envExample = parseEnvExample(projectRoot);
    const envText = buildServerEnv(
      { ...payload, admin: { ...payload.admin, passwordHash } },
      undefined,
      databaseUrl,
      envExample.variables,
      detection.scenario,
    );
    const temporaryEnv = `${envPath}.setup-${process.pid}`;
    const summary = [];
    const appUrl = publicAppUrl(payload);
    applyJob.publicUrl = appUrl;
    const loginPath = detection.scenario.isStaticOnly || options.embedded ? "" : detection.routes.loginPath;
    applyJob.appUrl = appUrl;
    applyJob.loginPath = loginPath;
    applyJob.loginUrl = buildLoginUrl(appUrl, loginPath);
    applyJob.appPort = payload.server.port;
    applyJob.mode = payload.deployment.mode;
    applyJob.isDesktop = Boolean(detection.scenario.isDesktop);

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
      const config = saveDeploymentConfig(toDeploymentConfig(payload), "setup-wizard", projectRoot, { dataDir });
      const artifacts = buildDeploymentArtifacts(config, payload.server.port);
      fs.mkdirSync(artifactRoot, { recursive: true });
      fs.writeFileSync(path.join(artifactRoot, "nginx.conf.example"), `${artifacts.nginxText}\n`, "utf8");
      fs.writeFileSync(path.join(artifactRoot, "deployment.env.example"), `${artifacts.envText}\n`, "utf8");
      const effectiveExtraEnvVars = [
        ...(envExample.variables || []),
        ...Object.entries(payload.customEnv || {}).map(([key, defaultValue]) => ({ key, defaultValue, description: "Kullanıcı tanımlı ortam değişkeni" })),
      ];
      writePublicFrontendArtifacts(projectRoot, dataRoot, payload, effectiveExtraEnvVars);
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
      try {
        fs.chmodSync(envPath, 0o600);
      } catch {}
      markStep("env", "done", ".env");
      summary.push("Gizli ayarlar .env dosyasına yazıldı.");

      markStep("finish", "running");
      fs.writeFileSync(
        lockPath,
        `${JSON.stringify({ installedAt: new Date().toISOString(), publicUrl: publicAppUrl(payload), nodeVersion: process.version }, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600, flag: "wx" },
      );
      markStep("finish", "done", "installation.lock yazıldı");
      return summary;
    } finally {
      if (pendingHandle !== undefined) fs.closeSync(pendingHandle);
      if (fs.existsSync(pendingPath)) fs.unlinkSync(pendingPath);
      if (fs.existsSync(temporaryEnv)) fs.unlinkSync(temporaryEnv);
    }
  }

  async function waitForApply() {
    if (activeApplyPromise) {
      await activeApplyPromise;
    }
    return applyJob;
  }

  function getRuntimeConfig() {
    return readSetupRuntimeConfig({ projectRoot, dataDir });
  }

  function verifyAdmin(email, password) {
    return verifyAdminCredentials({ projectRoot, dataDir }, email, password);
  }

  async function handle(request = {}) {
    const method = String(request.method || "GET").toUpperCase();
    const rawPath = String(request.path || request.url || "/");
    const pathname = rawPath.split("?")[0] || "/";
    const headers = request.headers && typeof request.headers === "object" ? request.headers : {};
    let body = request.body;
    if (typeof body === "string" && body.trim()) {
      try {
        body = JSON.parse(body);
      } catch {
        return {
          status: 400,
          headers: { "content-type": "application/json; charset=utf-8" },
          body: { ok: false, message: "Geçersiz JSON istek gövdesi." },
        };
      }
    }

    if (requireAuth) {
      const providedToken = headers["x-setup-token"] || headers["authorization"]?.replace(/^Bearer\s+/i, "") || "";
      if (!equalSecret(String(providedToken), token)) {
        return {
          status: 401,
          headers: { "content-type": "application/json; charset=utf-8" },
          body: { ok: false, message: "Geçersiz veya eksik kurulum anahtarı." },
        };
      }
    }

    const title = options.title || setupConfig?.wizard?.title || "Uygulama Kurulum Sihirbazı";
    const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

    // Kurulum tamamlandıktan sonra sihirbaz kapanır: yalnız sade durum bilgisi (sır içermez) sunulur.
    if (fs.existsSync(getSetupPaths(projectRoot, { dataDir }).lock)) {
      if (method === "GET" && pathname === "/api/status") {
        return { status: 200, headers: jsonHeaders, body: { installed: true, title, apply: applyJob } };
      }
      return { status: 404, headers: jsonHeaders, body: { ok: false, installed: true, message: "Kurulum tamamlandı; sihirbaz kapalı." } };
    }

    if (enforceCsrf && method !== "GET" && method !== "HEAD") {
      const origin = String(headers.origin || "").trim();
      const host = String(headers.host || "").trim().toLowerCase();
      let originOk = true;
      if (origin) {
        try {
          originOk = allowedOrigins.includes(origin) || (Boolean(host) && new URL(origin).host.toLowerCase() === host);
        } catch {
          originOk = false;
        }
      }
      const csrf = String(headers["x-setup-csrf"] || "");
      if (!originOk || !equalSecret(csrf, csrfToken)) {
        return { status: 403, headers: jsonHeaders, body: { ok: false, message: "Kurulum isteği güvenlik doğrulamasından geçmedi." } };
      }
    }

    if (method === "GET" && (pathname === "/" || pathname === "/setup")) {
      return {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
        body: renderSetupPage(csrfToken, { title, apiBase: options.apiBase, embedded: options.embedded }),
      };
    }

    if (method === "GET" && pathname === "/api/status") {
      const currentPaths = getSetupPaths(projectRoot, { dataDir });
      const installed = fs.existsSync(currentPaths.lock);
      const networks = Object.values(os.networkInterfaces())
        .flat()
        .filter((item) => item && !item.internal)
        .map((item) => item.address);
      const envExample = parseEnvExample(projectRoot);
      const defaultPort = detection.ports.app || readConfiguredPort(projectRoot) || Number(setupConfig?.ports?.app) || 5000;
      return {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
        body: {
          installed,
          title,
          server: { host: "127.0.0.1", port: defaultPort },
          defaults: {
            port: defaultPort,
            publicUrl: `http://localhost:${defaultPort}`,
            basePath: "/",
          },
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
            dataWritable: writable(currentPaths.dataRoot),
            uploadsWritable: writable(currentPaths.uploadsRoot),
            notInstalled: !installed,
            envAbsent: !fs.existsSync(currentPaths.env),
          },
          apply: applyJob,
        },
      };
    }

    if (method === "GET" && (pathname === "/api/RuntimeConfig" || pathname === "/api/runtime-config")) {
      return {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
        body: publicRuntimeConfig(getRuntimeConfig()),
      };
    }

    if (method === "POST" && pathname === "/api/validate-step") {
      const step = body?.step || "all";
      const data = body?.data ?? body;
      const issues = validateStepData(step, data, { allowOptionalAdmin: !detection.scenario.requiresAdmin });
      if (issues.length > 0) {
        return {
          status: 400,
          headers: { "content-type": "application/json; charset=utf-8" },
          body: {
            ok: false,
            errors: issues.map((i) => i.message),
            issues,
          },
        };
      }
      return {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
        body: { ok: true },
      };
    }

    // Gerçek bir SMTP bağlantısı denenmez; yalnızca e-posta alanlarının biçimi doğrulanır.
    // `/api/test-smtp` eski adı geriye uyumluluk için kabul edilir.
    if (method === "POST" && (pathname === "/api/validate-email-format" || pathname === "/api/test-smtp")) {
      const emailData = body?.email ?? body ?? {};
      const issues = validateStepData("email", emailData);
      if (issues.length > 0) {
        return {
          status: 400,
          headers: { "content-type": "application/json; charset=utf-8" },
          body: {
            ok: false,
            connectionTested: false,
            message: issues[0].message,
            errors: issues.map((i) => i.message),
          },
        };
      }
      return {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
        body: {
          ok: true,
          connectionTested: false,
          message: emailData.enabled
            ? "Gmail ayarlarının biçimi doğrulandı (SMTP bağlantısı denenmedi)."
            : "E-posta gönderimi devre dışı olarak doğrulandı.",
        },
      };
    }

    if (method === "POST" && pathname === "/api/apply") {
      if (applyJob.status === "running") {
        return {
          status: 409,
          headers: { "content-type": "application/json; charset=utf-8" },
          body: { ok: false, message: "Kurulum zaten uygulanıyor; pencereyi kapatmayın." },
        };
      }
      try {
        const rawPayload = body && typeof body === "object" ? body : {};
        const shouldWait = Boolean(rawPayload.wait || options.syncApply);
        const payload = setupPayloadSchema.parse(rawPayload, { allowOptionalAdmin: !detection.scenario.requiresAdmin });

        applyJob.status = "running";
        applyJob.message = "Kurulum uygulanıyor; adımlar ekranda canlı izleniyor…";
        applyJob.summary = [];
        applyJob.steps = createApplyState().steps;
        applyJob.startedAt = new Date().toISOString();
        applyJob.finishedAt = null;

        activeApplyPromise = (async () => {
          try {
            const summary = await executeApply(payload);
            applyJob.summary = summary;
            applyJob.status = "success";
            applyJob.message = "Kurulum tamamlandı. Birazdan giriş sayfasına yönlendirileceksiniz.";
            applyJob.finishedAt = new Date().toISOString();
            if (typeof options.onComplete === "function") {
              options.onComplete();
            }
          } catch (error) {
            applyJob.status = "error";
            applyJob.message = error instanceof Error ? error.message : "Kurulum tamamlanamadı.";
            applyJob.finishedAt = new Date().toISOString();
            applyJob.steps = applyJob.steps.map((step) =>
              step.status === "running" ? { ...step, status: "error", detail: applyJob.message } : step,
            );
          }
        })();

        if (shouldWait) {
          await activeApplyPromise;
          const status = applyJob.status === "error" ? 409 : 200;
          return {
            status,
            headers: { "content-type": "application/json; charset=utf-8" },
            body: {
              ok: applyJob.status === "success",
              message: applyJob.message,
              steps: applyJob.steps,
              state: applyJob,
            },
          };
        }

        return {
          status: 202,
          headers: { "content-type": "application/json; charset=utf-8" },
          body: {
            ok: true,
            message: "Kurulum başladı. Aşağıdaki adımlar tamamlandıkça güncellenir.",
            steps: applyJob.steps,
            state: applyJob,
          },
        };
      } catch (error) {
        applyJob.status = "idle";
        if (error instanceof ValidationError) {
          return {
            status: 400,
            headers: { "content-type": "application/json; charset=utf-8" },
            body: {
              ok: false,
              message: "Girilen bilgiler doğrulanamadı.",
              issues: error.issues,
              errors: error.issues.map((i) => i.message),
            },
          };
        }
        return {
          status: 409,
          headers: { "content-type": "application/json; charset=utf-8" },
          body: {
            ok: false,
            message: error instanceof Error ? error.message : "Kurulum tamamlanamadı.",
          },
        };
      }
    }

    return {
      status: 404,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: { ok: false, message: "Uç nokta bulunamadı." },
    };
  }

  return {
    paths,
    csrfToken,
    handle,
    waitForApply,
    getRuntimeConfig,
    verifyAdmin,
  };
}

async function readExpressBodyIfNeeded(req) {
  if (req.body !== undefined) return req.body;
  if (req.method === "GET" || req.method === "HEAD") return null;
  if (typeof req[Symbol.asyncIterator] !== "function") return {};
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 65_536) throw new Error("İstek gövdesi çok büyük.");
  }
  if (!raw) return {};
  return JSON.parse(raw);
}

function sendCoreResponse(res, status, headers, body) {
  const payload =
    typeof body === "string"
      ? body
      : body !== undefined && body !== null
        ? JSON.stringify(body)
        : "";
  if (typeof res.setHeader === "function" && headers) {
    for (const [k, v] of Object.entries(headers)) {
      res.setHeader(k, v);
    }
  }
  if (typeof res.status === "function") {
    res.status(status);
  } else if (typeof res.writeHead === "function") {
    res.writeHead(status, headers || {});
  } else {
    res.statusCode = status;
  }
  res.end(payload);
}

export function mountSetupGuard(appOrOptions = {}, maybeOptions = {}) {
  const isDirectAppMount = Boolean(appOrOptions && typeof appOrOptions.use === "function");
  const options = isDirectAppMount ? (maybeOptions || {}) : (appOrOptions || {});

  const projectRoot = options.projectRoot ? path.resolve(options.projectRoot) : process.cwd();
  const dataDir = options.dataDir || null;
  const wizardUrl = options.wizardUrl || "/setup";
  const embedWizard = options.embedWizard !== false;
  const allowPaths = Array.isArray(options.allowPaths) ? options.allowPaths : [];

  const core = createSetupWizardCore({
    ...options,
    projectRoot,
    dataDir,
    embedded: embedWizard,
    apiBase: options.apiBase || (embedWizard ? "/api/setup" : "/api"),
  });

  const middleware = async function setupGuardMiddleware(req, res, next) {
    const reqPath = String(req.path || req.url || "/").split("?")[0] || "/";

    if (
      embedWizard &&
      (reqPath === "/setup" || reqPath.startsWith("/setup/") || reqPath.startsWith("/api/setup/"))
    ) {
      let mappedPath = reqPath;
      if (reqPath.startsWith("/api/setup/")) {
        mappedPath = `/api/${reqPath.slice("/api/setup/".length)}`;
      } else if (reqPath.startsWith("/setup/api/")) {
        mappedPath = `/api/${reqPath.slice("/setup/api/".length)}`;
      } else if (reqPath === "/setup" || reqPath === "/setup/") {
        mappedPath = "/setup";
      }

      try {
        const parsedBody = await readExpressBodyIfNeeded(req);
        const result = await core.handle({
          method: req.method,
          path: mappedPath,
          headers: req.headers,
          body: parsedBody,
        });
        return sendCoreResponse(res, result.status, result.headers, result.body);
      } catch (err) {
        return sendCoreResponse(
          res,
          400,
          { "content-type": "application/json; charset=utf-8" },
          { ok: false, message: err instanceof Error ? err.message : "Geçersiz istek." },
        );
      }
    }

    if (readSetupRuntimeConfig({ projectRoot, dataDir }).installed) {
      return next();
    }

    if (allowPaths.some((p) => reqPath === p || reqPath.startsWith(`${p.replace(/\/$/, "")}/`))) {
      return next();
    }

    const accept = String(req.headers?.accept || "").toLowerCase();
    const prefersJson =
      reqPath.startsWith("/api/") ||
      (accept.includes("application/json") && !accept.includes("text/html"));

    if (prefersJson) {
      return sendCoreResponse(
        res,
        503,
        { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
        {
          ok: false,
          installed: false,
          setupRequired: true,
          redirectUrl: wizardUrl,
        },
      );
    }

    return sendCoreResponse(
      res,
      302,
      { location: wizardUrl, "cache-control": "no-store" },
      "",
    );
  };

  middleware.core = core;

  if (isDirectAppMount) {
    appOrOptions.use(middleware);
    return { core, middleware };
  }

  return middleware;
}
