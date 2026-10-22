import crypto, { timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseDeploymentConfig, buildDeploymentArtifacts, saveDeploymentConfig } from "../utils/deployment-config.mjs";
import { getSetupPaths } from "../scripts/setup-bootstrap-lib.mjs";
import { buildLoginUrl, detectPackageManager, parseEnvExample } from "../scripts/detect-project.mjs";
import { buildServerEnv, hashAdminPassword, publicAppUrl, setupPayloadSchema, toDeploymentConfig, ValidationError } from "./config.mjs";
import { pmRunInvocation, readJsonFileSafe, resolveEffectivePackageManager } from "./app-process.mjs";

export function digest(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest();
}

/** Zamanlama saldırılarına dayanıklı sır karşılaştırması. */
export function equalSecret(left, right) {
  if (!left || !right) return false;
  return timingSafeEqual(digest(left), digest(right));
}

/** Belirtilen dizinin yazılabilir olduğunu denetler. */
export function writable(target) {
  try {
    fs.mkdirSync(target, { recursive: true });
    fs.accessSync(target, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Alt süreç çalıştırır ve çıktısını döndürür. */
export function runCommand(command, args, cwd, extraEnv = {}) {
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

export const APPLY_STEPS = Object.freeze([
  { id: "prepare", label: "Kurulum ortamı hazırlanıyor" },
  { id: "buildServer", label: "Sunucu derlemesi" },
  { id: "buildClient", label: "İstemci (web) derlemesi" },
  { id: "migrate", label: "Veritabanı migration'ları" },
  { id: "admin", label: "İlk yönetici hesabı" },
  { id: "artifacts", label: "Dağıtım profili ve Nginx örneği" },
  { id: "env", label: "Gizli ayarların yazılması (.env)" },
  { id: "finish", label: "Kurulum kilidi ve kapanış" },
]);

export function createApplyState() {
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

export const MIGRATE_SCRIPT_CANDIDATES = Object.freeze([
  "prisma:migrate",
  "db:migrate",
  "migrate:deploy",
  "migrate",
  "db:push",
]);

/** Sihirbaz form adımlarının veri geçerliliğini denetler. */
export function validateStepData(step, data, options = {}) {
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

/**
 * Hem HTTP sihirbaz sunucusu (`server.mjs`) hem de gömülü/IPC kurulum çekirdeği (`core.mjs`)
 * tarafından paylaşılan uçtan uca kurulum adımları yürütücüsü.
 */
export async function executeSetupApply({
  projectRoot,
  dataDir,
  paths: customPaths,
  detection,
  setupConfig,
  options = {},
  applyJob,
  payload,
  markStep,
}) {
  const currentPaths = customPaths || getSetupPaths(projectRoot, { dataDir });
  const serverRoot = currentPaths.serverRoot;
  const dataRoot = currentPaths.dataRoot;
  const envPath = currentPaths.env || currentPaths.envPath;
  const lockPath = currentPaths.lock || currentPaths.lockPath;
  const pendingPath = currentPaths.pending || currentPaths.pendingPath;
  const artifactRoot = currentPaths.setupArtifacts || currentPaths.artifactRoot;
  const databaseUrl = currentPaths.databaseUrl;

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

  const passwordHash = payload.admin && payload.admin.password ? (payload.admin.passwordHash || hashAdminPassword(payload.admin.password)) : (payload.admin?.passwordHash || "");
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
    const pm = resolveEffectivePackageManager(setupConfig?.packageManager || detectPackageManager(projectRoot, rootPkg));

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
      `${JSON.stringify({ installedAt: new Date().toISOString(), publicUrl: appUrl, nodeVersion: process.version }, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    markStep("finish", "done", "installation.lock yazıldı");
    summary.push("Kurulum kilidi yazıldı.");

    applyJob.status = "success";
    applyJob.message = "Kurulum başarıyla tamamlandı. Artık uygulamaya gidebilirsiniz.";
    applyJob.summary = summary;
  } catch (err) {
    if (fs.existsSync(temporaryEnv)) {
      try {
        fs.unlinkSync(temporaryEnv);
      } catch {}
    }
    applyJob.status = "error";
    applyJob.message = err.message || "Kurulum adımları başarısız oldu.";
    throw err;
  } finally {
    if (pendingHandle !== undefined) {
      try {
        fs.closeSync(pendingHandle);
      } catch {}
    }
    if (fs.existsSync(pendingPath)) {
      try {
        fs.unlinkSync(pendingPath);
      } catch {}
    }
  }
}
