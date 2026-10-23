import crypto, { timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import { parseDeploymentConfig, buildDeploymentArtifacts, saveDeploymentConfig } from "../utils/deployment-config.mjs";
import { getSetupPaths, isCommandAvailable } from "../scripts/setup-bootstrap-lib.mjs";
import { buildLoginUrl, detectPackageManager, parseEnvExample } from "../scripts/detect-project.mjs";
import { resolvePolyglotMigration } from "../scripts/polyglot.mjs";
import { buildDatabaseUrl, buildServerEnv, hashAdminPassword, publicAppUrl, setupPayloadSchema, toDeploymentConfig, ValidationError } from "./config.mjs";
import { normalizeProcessEnv, pmRunInvocation, readJsonFileSafe, resolveEffectivePackageManager } from "./app-process.mjs";

export { normalizeProcessEnv };

/**
 * Hassas parolaları ve bağlantı dizesi sırlarını maskeler.
 */
export function redactSecrets(text, secrets = []) {
  let result = String(text || "");
  for (const s of secrets) {
    if (s && typeof s === "string" && s.length >= 3) {
      result = result.split(s).join("******");
    }
  }
  // URL içindeki parolaları maskele (örn: postgres://user:pass@host)
  result = result.replace(/([a-zA-Z]+:\/\/[^:]+:)([^@]+)(@)/g, "$1******$3");
  return result;
}

/**
 * Belirtilen host ve port için TCP bağlantısını sınar.
 */
export function testTcpConnection(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    let settled = false;
    const p = Number(port);
    const h = String(host || "127.0.0.1").trim();

    const finish = (ok, error = null) => {
      if (settled) return;
      settled = true;
      try { socket?.destroy(); } catch {}
      resolve({ ok, reachable: ok, host: h, port: p, error: error ? error.message : null });
    };

    if (isNaN(p) || p < 1 || p > 65535) {
      return finish(false, new Error(`Geçersiz port: ${port}`));
    }

    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false, new Error(`Zaman aşımı (${timeoutMs}ms)`)));
    socket.once("error", (err) => finish(false, err));

    try {
      socket.connect(p, h);
    } catch (err) {
      finish(false, err);
    }
  });
}

/**
 * SMTP sunucusuna bağlanır ve ilk 220 selamlama (greeting) yanıtını okur.
 */
export function testSmtpConnection(host, port = 587, secure = false, timeoutMs = 3000) {
  return new Promise((resolve) => {
    let settled = false;
    let banner = "";
    const p = Number(port) || 587;
    const h = String(host || "127.0.0.1").trim();

    let socket;
    const finish = (ok, message = "", err = null) => {
      if (settled) return;
      settled = true;
      try { socket?.destroy(); } catch {}
      resolve({
        ok,
        reachable: ok,
        host: h,
        port: p,
        banner: banner.trim(),
        message: message || (ok ? "SMTP sunucusu yanıt verdi." : "SMTP sunucusuna bağlanılamadı."),
        error: err ? err.message : null,
      });
    };

    if (isNaN(p) || p < 1 || p > 65535) {
      return finish(false, `Geçersiz port: ${port}`, new Error(`Geçersiz port: ${port}`));
    }

    const isSecure = Boolean(secure || p === 465);
    try {
      if (isSecure) {
        socket = tls.connect(p, h, { timeout: timeoutMs, rejectUnauthorized: false });
      } else {
        socket = new net.Socket();
        socket.connect(p, h);
      }
    } catch (err) {
      return finish(false, `Soket hatası: ${err.message}`, err);
    }

    socket.setTimeout(timeoutMs);
    socket.once("timeout", () => finish(false, `Zaman aşımı (${timeoutMs}ms)`, new Error("Timeout")));
    socket.once("error", (err) => finish(false, `Bağlantı hatası: ${err.message}`, err));
    socket.once("close", () => {
      if (!settled) finish(false, "Bağlantı sunucu tarafından kapatıldı.");
    });

    socket.on("data", (chunk) => {
      banner += chunk.toString("utf8");
      if (banner.includes("\n")) {
        const line = banner.trim();
        if (line.startsWith("220")) {
          finish(true, `SMTP sunucusu hazır (${line.slice(0, 100)})`);
        } else {
          finish(false, `Beklenmeyen SMTP yanıtı: ${line.slice(0, 100)}`);
        }
      }
    });
  });
}

/**
 * Veritabanı bağlantısını önceden test eder (SQLite dizin izni, Postgres/MySQL TCP port denetimi).
 */
export async function testDatabaseConnection(dbConfig = {}, projectRoot = process.cwd()) {
  const provider = String(dbConfig?.provider || "sqlite").toLowerCase();
  if (provider === "sqlite") {
    const rawUrl = dbConfig?.url || "";
    let dbFile = rawUrl.replace(/^file:/i, "").trim();
    if (!dbFile) dbFile = "data/app.db";
    const resolvedPath = path.isAbsolute(dbFile) ? dbFile : path.resolve(projectRoot, dbFile);
    const dir = path.dirname(resolvedPath);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return {
        ok: true,
        reachable: true,
        provider: "sqlite",
        message: `SQLite veritabanı dizini erişilebilir ve yazılabilir (${dir}).`,
      };
    } catch (err) {
      return {
        ok: false,
        reachable: false,
        provider: "sqlite",
        message: `SQLite dizinine yazılamıyor: ${err.message}`,
        error: err.message,
      };
    }
  }

  if (provider === "postgres" || provider === "postgresql") {
    const host = String(dbConfig.host || "127.0.0.1").trim();
    const port = Number(dbConfig.port) || 5432;
    const tcp = await testTcpConnection(host, port);
    return {
      ok: tcp.ok,
      reachable: tcp.reachable,
      provider: "postgres",
      host,
      port,
      message: tcp.ok
        ? `PostgreSQL sunucusuna erişildi (${host}:${port}).`
        : `PostgreSQL sunucusuna bağlanılamadı (${host}:${port}): ${tcp.error || "Bağlantı reddedildi"}`,
      error: tcp.error,
    };
  }

  if (provider === "mysql") {
    const host = String(dbConfig.host || "127.0.0.1").trim();
    const port = Number(dbConfig.port) || 3306;
    const tcp = await testTcpConnection(host, port);
    return {
      ok: tcp.ok,
      reachable: tcp.reachable,
      provider: "mysql",
      host,
      port,
      message: tcp.ok
        ? `MySQL sunucusuna erişildi (${host}:${port}).`
        : `MySQL sunucusuna bağlanılamadı (${host}:${port}): ${tcp.error || "Bağlantı reddedildi"}`,
      error: tcp.error,
    };
  }

  if (provider === "custom") {
    const urlStr = String(dbConfig.url || "").trim();
    if (!urlStr) {
      return { ok: false, reachable: false, provider: "custom", message: "Bağlantı dizesi (URL) boş bırakılamaz." };
    }
    if (urlStr.startsWith("file:") || urlStr.endsWith(".db") || urlStr.endsWith(".sqlite")) {
      return testDatabaseConnection({ provider: "sqlite", url: urlStr }, projectRoot);
    }
    try {
      const parsed = new URL(urlStr);
      const host = parsed.hostname;
      let port = Number(parsed.port);
      if (!port) {
        if (parsed.protocol.startsWith("postgres")) port = 5432;
        else if (parsed.protocol.startsWith("mysql")) port = 3306;
        else if (parsed.protocol.startsWith("http")) port = parsed.protocol === "https:" ? 443 : 80;
        else port = 5432;
      }
      if (!host) {
        return { ok: false, reachable: false, provider: "custom", message: "URL geçerli bir host içermiyor." };
      }
      const tcp = await testTcpConnection(host, port);
      return {
        ok: tcp.ok,
        reachable: tcp.reachable,
        provider: "custom",
        host,
        port,
        message: tcp.ok
          ? `Veritabanı sunucusuna erişildi (${host}:${port}).`
          : `Veritabanı sunucusuna bağlanılamadı (${host}:${port}): ${tcp.error || "Bağlantı reddedildi"}`,
        error: tcp.error,
      };
    } catch (err) {
      return { ok: false, reachable: false, provider: "custom", message: `Geçersiz veritabanı URL'si: ${err.message}`, error: err.message };
    }
  }

  return { ok: false, reachable: false, message: `Bilinmeyen sağlayıcı: ${provider}` };
}

/**
 * E-posta / SMTP yapılandırmasını önceden test eder.
 */
export async function testEmailConfiguration(emailConfig = {}) {
  const enabled = Boolean(emailConfig.enabled);
  if (!enabled) {
    return {
      ok: true,
      reachable: false,
      enabled: false,
      connectionTested: false,
      message: "E-posta gönderimi devre dışı bırakılmış.",
    };
  }
  const provider = String(emailConfig.provider || "gmail").toLowerCase();
  let host = "";
  let port = 587;
  let secure = Boolean(emailConfig.secure);

  if (provider === "gmail") {
    host = "smtp.gmail.com";
    port = secure ? 465 : (Number(emailConfig.port) || 587);
  } else {
    host = String(emailConfig.host || "").trim();
    port = Number(emailConfig.port) || (secure ? 465 : 587);
  }

  if (!host) {
    return {
      ok: false,
      reachable: false,
      enabled: true,
      message: "SMTP sunucu adresi (host) belirtilmedi.",
    };
  }

  const probe = await testSmtpConnection(host, port, secure);
  return {
    ok: probe.ok,
    reachable: probe.reachable,
    enabled: true,
    provider,
    host,
    port,
    secure,
    banner: probe.banner,
    message: probe.ok
      ? `SMTP sunucusu (${host}:${port}) yanıt verdi ve hazır.`
      : `SMTP sunucusuna (${host}:${port}) bağlanılamadı: ${probe.message || probe.error}`,
    error: probe.error,
  };
}

/**
 * Projenin mimarisine göre gerekli araç zincirini (compiler/runtime) denetler.
 */
export function detectRequiredToolchain(detection) {
  const kind = String(detection?.kind || "node-fullstack").toLowerCase();
  const toolchains = {
    node: { name: "Node.js", required: true, available: true, version: process.version },
    python: {
      name: "Python 3",
      required: kind.includes("python"),
      available: isCommandAvailable("python") || isCommandAvailable("py") || isCommandAvailable("python3"),
    },
    go: {
      name: "Go",
      required: kind.includes("go"),
      available: isCommandAvailable("go"),
    },
    dotnet: {
      name: ".NET SDK",
      required: kind.includes("dotnet"),
      available: isCommandAvailable("dotnet"),
    },
    cargo: {
      name: "Rust (Cargo)",
      required: kind.includes("rust"),
      available: isCommandAvailable("cargo"),
    },
  };

  let allRequiredAvailable = true;
  for (const item of Object.values(toolchains)) {
    if (item.required && !item.available) {
      allRequiredAvailable = false;
    }
  }

  return {
    available: allRequiredAvailable,
    details: toolchains,
  };
}

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

const wizardDir = path.dirname(fileURLToPath(import.meta.url));
const shimsDir = path.resolve(wizardDir, "..", "bin", "shims");

/** Alt süreç çalıştırır ve çıktısını döndürür. */
export function runCommand(command, args, cwd, extraEnv = {}, onLog = null) {
  return new Promise((resolve, reject) => {
    const prepend = fs.existsSync(shimsDir) ? [shimsDir] : [];
    const env = normalizeProcessEnv(process.env, extraEnv, prepend);
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (typeof onLog === "function") onLog(text);
    });
    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (typeof onLog === "function") onLog(text);
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
    logs: [],
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
      const provider = String(raw.provider || (raw.host ? "custom" : "gmail")).toLowerCase().trim();
      const isCustom = provider === "custom" || Boolean(raw.host && raw.host !== "smtp.gmail.com");
      const user = String(raw.user ?? "").trim();
      const fromEmail = String(raw.fromEmail ?? "").trim();
      const fromName = String(raw.fromName ?? "").trim();
      const password = String(raw.password ?? "").replace(/\s/g, "");

      if (isCustom) {
        const host = String(raw.host ?? "").trim();
        if (!host || host.length > 253 || /[\s\r\n\0]/.test(host)) {
          issues.push({ code: "invalid_host", message: "Geçerli bir SMTP sunucu adresi (host) girin.", path: ["email.host"] });
        }
        const port = Number(raw.port || 587);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          issues.push({ code: "invalid_port", message: "Geçerli bir SMTP portu (1-65535) girin.", path: ["email.port"] });
        }
        if (!user || user.length > 254 || /[\r\n\0]/.test(user)) {
          issues.push({ code: "invalid_string", message: "Geçerli bir SMTP kullanıcı adı girin.", path: ["email.user"] });
        }
        if (!fromEmail || fromEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail) || /[\r\n\0]/.test(fromEmail)) {
          issues.push({ code: "invalid_email", message: "Geçerli bir gönderen e-posta adresi girin.", path: ["email.fromEmail"] });
        }
        if (password.length < 1 || password.length > 128) {
          issues.push({ code: "custom", message: "Geçerli bir SMTP parolası girin.", path: ["email", "password"] });
        }
      } else {
        const NON_GOOGLE_DOMAINS = /@(yahoo|hotmail|outlook|live|icloud|yandex|mail\.ru)\.[a-z.]+$/i;
        if (!user || user.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user) || /[\r\n\0]/.test(user)) {
          issues.push({ code: "invalid_email", message: "Geçerli bir e-posta adresi girin.", path: ["email.user"] });
        } else if (NON_GOOGLE_DOMAINS.test(user)) {
          issues.push({ code: "invalid_gmail", message: "Gmail veya Google Workspace ile uyumlu bir e-posta adresi girin.", path: ["email.user"] });
        }
        if (!fromEmail || fromEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail) || /[\r\n\0]/.test(fromEmail)) {
          issues.push({ code: "invalid_email", message: "Geçerli bir gönderen e-posta adresi girin.", path: ["email.fromEmail"] });
        } else if (NON_GOOGLE_DOMAINS.test(fromEmail)) {
          issues.push({ code: "invalid_gmail", message: "Gmail veya Google Workspace ile uyumlu bir e-posta adresi girin.", path: ["email.fromEmail"] });
        }
        if (password.length < 16 || password.length > 128) {
          issues.push({ code: "custom", message: "Geçerli Gmail / Google Workspace uygulama parolası (16 karakter) girin.", path: ["email", "password"] });
        }
      }

      if (!fromName || fromName.length > 100 || /[\r\n\0]/.test(fromName)) {
        issues.push({ code: "invalid_string", message: "email.fromName 1-100 karakter aralığında olmalıdır.", path: ["email.fromName"] });
      }
    }
  } else if (step === "database") {
    const provider = String(raw.provider || "sqlite").toLowerCase().trim();
    if (["postgres", "postgresql"].includes(provider)) {
      const host = String(raw.host ?? "").trim();
      if (!host || host.length > 253 || /[\s\r\n\0]/.test(host)) {
        issues.push({ code: "invalid_host", message: "Geçerli bir veritabanı sunucu adresi (host) girin.", path: ["database.host"] });
      }
      const port = Number(raw.port || 5432);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        issues.push({ code: "invalid_port", message: "Geçerli bir PostgreSQL portu (1-65535) girin.", path: ["database.port"] });
      }
      const name = String(raw.name ?? "").trim();
      if (!name || name.length > 100 || /[\s\r\n\0]/.test(name)) {
        issues.push({ code: "invalid_string", message: "Geçerli bir veritabanı adı girin.", path: ["database.name"] });
      }
      const user = String(raw.user ?? "").trim();
      if (!user || user.length > 100 || /[\r\n\0]/.test(user)) {
        issues.push({ code: "invalid_string", message: "Geçerli bir veritabanı kullanıcı adı girin.", path: ["database.user"] });
      }
      const password = String(raw.password ?? "");
      if (password.length > 512 || /[\r\n\0]/.test(password)) {
        issues.push({ code: "invalid_string", message: "Veritabanı parolasında geçersiz karakter var.", path: ["database.password"] });
      }
    } else if (provider === "mysql") {
      const host = String(raw.host ?? "").trim();
      if (!host || host.length > 253 || /[\s\r\n\0]/.test(host)) {
        issues.push({ code: "invalid_host", message: "Geçerli bir veritabanı sunucu adresi (host) girin.", path: ["database.host"] });
      }
      const port = Number(raw.port || 3306);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        issues.push({ code: "invalid_port", message: "Geçerli bir MySQL portu (1-65535) girin.", path: ["database.port"] });
      }
      const name = String(raw.name ?? "").trim();
      if (!name || name.length > 100 || /[\s\r\n\0]/.test(name)) {
        issues.push({ code: "invalid_string", message: "Geçerli bir veritabanı adı girin.", path: ["database.name"] });
      }
      const user = String(raw.user ?? "").trim();
      if (!user || user.length > 100 || /[\r\n\0]/.test(user)) {
        issues.push({ code: "invalid_string", message: "Geçerli bir veritabanı kullanıcı adı girin.", path: ["database.user"] });
      }
      const password = String(raw.password ?? "");
      if (password.length > 512 || /[\r\n\0]/.test(password)) {
        issues.push({ code: "invalid_string", message: "Veritabanı parolasında geçersiz karakter var.", path: ["database.password"] });
      }
    } else if (provider === "custom") {
      const url = String(raw.url ?? "").trim();
      if (!url || url.length > 2048 || /[\r\n\0]/.test(url)) {
        issues.push({ code: "invalid_url", message: "Geçerli bir bağlantı dizesi (connection string) girin.", path: ["database.url"] });
      }
    } else if (provider === "sqlite") {
      const url = String(raw.url ?? "").trim();
      if (url && (url.length > 2048 || /[\r\n\0]/.test(url))) {
        issues.push({ code: "invalid_string", message: "SQLite dosya yolunda geçersiz karakterler var.", path: ["database.url"] });
      }
    } else {
      issues.push({ code: "invalid_provider", message: "Desteklenmeyen veritabanı sağlayıcısı.", path: ["database.provider"] });
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
  const effectiveDatabaseUrl = (payload.database?.url && payload.database.url.trim())
    ? payload.database.url.trim()
    : (payload.database?.provider && payload.database.provider !== "sqlite"
      ? buildDatabaseUrl(payload.database, currentPaths.databaseUrl)
      : currentPaths.databaseUrl);

  fs.mkdirSync(dataRoot, { recursive: true });
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const isReconfigure = Boolean(options.reconfigure || payload.reconfigure);
  if (fs.existsSync(lockPath) && !isReconfigure && !payload.overwriteExistingEnv) {
    throw new Error("Kurulum daha önce tamamlanmış. Sihirbaz yeniden çalıştırılamaz. Yeniden yapılandırmak için .env üzerine yazma onayını seçin.");
  }
  if (fs.existsSync(envPath) && !payload.overwriteExistingEnv && !isReconfigure) {
    throw new Error(".env zaten var. İçeriğini doğrulayın veya yedekleyerek değiştirme onayını seçin.");
  }
  let pendingHandle;
  try {
    pendingHandle = fs.openSync(pendingPath, "wx", 0o600);
  } catch {
    throw new Error("Başka bir kurulum işlemi çalışıyor veya önceki işlem yarım kaldı.");
  }

  const knownSecrets = [
    payload.admin?.password,
    payload.email?.password,
    payload.database?.password,
  ].filter(Boolean);

  const appendLog = (chunk) => {
    if (!applyJob.logs) applyJob.logs = [];
    const text = redactSecrets(String(chunk || ""), knownSecrets);
    const lines = text.split(/\r?\n/).filter(Boolean);
    for (const l of lines) {
      applyJob.logs.push(l);
    }
    if (applyJob.logs.length > 1000) {
      applyJob.logs = applyJob.logs.slice(-1000);
    }
  };

  const passwordHash = payload.admin && payload.admin.password ? (payload.admin.passwordHash || hashAdminPassword(payload.admin.password)) : (payload.admin?.passwordHash || "");
  const envExample = parseEnvExample(projectRoot);
  const envText = buildServerEnv(
    { ...payload, admin: { ...payload.admin, passwordHash } },
    undefined,
    effectiveDatabaseUrl,
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
        await runCommand(inv.command, inv.args, inv.cwd || projectRoot, {}, appendLog);
        markStep("buildServer", "done", "server build");
        summary.push("Sunucu derlemesi tamamlandı.");
      } else if (!serverPkg && !clientPkg && rootPkg?.scripts?.build) {
        markStep("buildServer", "running");
        const inv = pmRunInvocation(pm, "build", projectRoot);
        await runCommand(inv.command, inv.args, inv.cwd || projectRoot, {}, appendLog);
        markStep("buildServer", "done", "root build");
        summary.push("Proje derlemesi tamamlandı.");
      } else if (Array.isArray(detection?.workspaces?.packageDirs)) {
        const serverPackageDir = detection.workspaces.packageDirs.find((dir) => {
          if (!/api|server|backend/i.test(dir)) return false;
          const pkg = readJsonFileSafe(path.join(projectRoot, dir, "package.json"));
          return Boolean(pkg?.scripts?.build);
        });
        if (serverPackageDir) {
          markStep("buildServer", "running");
          const inv = pmRunInvocation(pm, "build", path.join(projectRoot, serverPackageDir));
          await runCommand(inv.command, inv.args, inv.cwd || projectRoot, {}, appendLog);
          markStep("buildServer", "done", `${serverPackageDir} build`);
          summary.push("Sunucu derlemesi tamamlandı.");
        } else {
          markStep("buildServer", "skipped", "Derleme betiği yok.");
        }
      } else {
        markStep("buildServer", "skipped", "Derleme betiği yok.");
      }

      if (clientPkg?.scripts?.build) {
        markStep("buildClient", "running");
        const inv = pmRunInvocation(pm, "build", path.join(projectRoot, "client"));
        await runCommand(inv.command, inv.args, inv.cwd || projectRoot, {}, appendLog);
        markStep("buildClient", "done", "client build");
        summary.push("İstemci derlemesi tamamlandı.");
      } else if (rootPkg?.scripts?.["build:client"]) {
        markStep("buildClient", "running");
        const inv = pmRunInvocation(pm, "build:client", projectRoot);
        await runCommand(inv.command, inv.args, inv.cwd || projectRoot, {}, appendLog);
        markStep("buildClient", "done", "build:client");
        summary.push("İstemci derlemesi tamamlandı.");
      } else if (Array.isArray(detection?.workspaces?.packageDirs)) {
        const clientPackageDir = detection.workspaces.packageDirs.find((dir) => {
          if (!/web|client|frontend|ui/i.test(dir)) return false;
          const pkg = readJsonFileSafe(path.join(projectRoot, dir, "package.json"));
          return Boolean(pkg?.scripts?.build);
        });
        if (clientPackageDir) {
          markStep("buildClient", "running");
          const inv = pmRunInvocation(pm, "build", path.join(projectRoot, clientPackageDir));
          await runCommand(inv.command, inv.args, inv.cwd || projectRoot, {}, appendLog);
          markStep("buildClient", "done", `${clientPackageDir} build`);
          summary.push("İstemci derlemesi tamamlandı.");
        } else {
          markStep("buildClient", "skipped", "İstemci derleme betiği yok.");
        }
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
      let migrateScript = serverMigrateScript || rootMigrateScript;
      let migrateDir = serverMigrateScript ? path.join(projectRoot, "server") : projectRoot;

      if (!migrateScript && Array.isArray(detection?.workspaces?.packageDirs)) {
        for (const relDir of detection.workspaces.packageDirs) {
          const pkg = readJsonFileSafe(path.join(projectRoot, relDir, "package.json"));
          const found = MIGRATE_SCRIPT_CANDIDATES.find((name) => Boolean(pkg?.scripts?.[name]));
          if (found) {
            migrateScript = found;
            migrateDir = path.join(projectRoot, relDir);
            break;
          }
        }
      }

      if (migrateScript) {
        markStep("migrate", "running", migrateScript);
        const inv = pmRunInvocation(pm, migrateScript, migrateDir);
        await runCommand(inv.command, inv.args, inv.cwd || projectRoot, { DATABASE_URL: effectiveDatabaseUrl }, appendLog);
        markStep("migrate", "done", migrateScript);
        summary.push("Veritabanı migration'ları uygulandı.");
      } else {
        const polyglotMigrate = resolvePolyglotMigration(projectRoot, detection?.kind, setupConfig);
        if (polyglotMigrate) {
          markStep("migrate", "running", polyglotMigrate.label);
          await runCommand(polyglotMigrate.command, polyglotMigrate.args, polyglotMigrate.cwd || projectRoot, { DATABASE_URL: effectiveDatabaseUrl }, appendLog);
          markStep("migrate", "done", polyglotMigrate.label);
          summary.push(`${polyglotMigrate.label} uygulandı.`);
        } else {
          markStep("migrate", "skipped", "Migration betiği bulunamadı.");
        }
      }
    }

    markStep("admin", "running");
    if (payload.admin && payload.admin.email) {
      fs.writeFileSync(
        path.join(dataRoot, "admin.json"),
        `${JSON.stringify({ name: payload.admin.name, email: payload.admin.email, passwordHash, createdAt: new Date().toISOString() }, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      let seedInv = null;
      let seedLabel = "";
      if (setupConfig?.seed) {
        if (typeof setupConfig.seed === "string") {
          seedInv = { command: setupConfig.seed, args: [], cwd: projectRoot };
          seedLabel = setupConfig.seed;
        } else if (typeof setupConfig.seed === "object" && setupConfig.seed.command) {
          seedInv = {
            command: setupConfig.seed.command,
            args: Array.isArray(setupConfig.seed.args) ? setupConfig.seed.args : [],
            cwd: setupConfig.seed.cwd ? path.resolve(projectRoot, setupConfig.seed.cwd) : projectRoot,
          };
          seedLabel = `${setupConfig.seed.command} ${(setupConfig.seed.args || []).join(" ")}`.trim();
        }
      }
      if (!seedInv) {
        const seedScript = ["prisma:seed", "db:seed", "seed"].find((name) => Boolean(rootPkg?.scripts?.[name] || serverPkg?.scripts?.[name]));
        if (seedScript) {
          const seedDir = serverPkg?.scripts?.[seedScript] ? path.join(projectRoot, "server") : projectRoot;
          seedInv = pmRunInvocation(pm, seedScript, seedDir);
          seedLabel = seedScript;
        }
      }
      if (seedInv) {
        try {
          await runCommand(seedInv.command, seedInv.args, seedInv.cwd || projectRoot, { DATABASE_URL: effectiveDatabaseUrl }, appendLog);
          summary.push(`Veritabanı tohumlama (${seedLabel}) uygulandı.`);
        } catch (seedErr) {
          summary.push(`Veritabanı tohumlama atlandı veya başarısız oldu (${seedLabel}): ${seedErr.message}`);
        }
      }
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
    return summary;
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

export function createRateLimiter(options = {}) {
  const maxBuckets = Number(options.maxBuckets ?? 1000);
  const buckets = new Map();

  function prune(now) {
    for (const [key, entry] of buckets.entries()) {
      if (now >= entry.resetAt) {
        buckets.delete(key);
      }
    }
    if (buckets.size > maxBuckets) {
      const excess = buckets.size - maxBuckets;
      let count = 0;
      for (const key of buckets.keys()) {
        buckets.delete(key);
        count++;
        if (count >= excess) break;
      }
    }
  }

  function checkRateLimit(key, limit, windowMs) {
    const now = Date.now();
    if (buckets.size >= Math.max(10, Math.floor(maxBuckets / 2))) {
      prune(now);
    }
    const entry = buckets.get(key);
    if (!entry || now >= entry.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  }

  return {
    checkRateLimit,
    get size() {
      return buckets.size;
    },
    clear() {
      buckets.clear();
    },
  };
}

