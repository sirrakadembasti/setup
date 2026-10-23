import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { normalizeBasePath, parseDeploymentConfig } from "../utils/deployment-config.mjs";

export class ValidationError extends Error {
  constructor(issues) {
    super("Girilen bilgiler doğrulanamadı.");
    this.name = "ValidationError";
    this.issues = issues;
  }
}

function validateCleanText(value, fieldPath, max, min = 1) {
  const str = String(value ?? "").trim();
  if (str.length < min || str.length > max) {
    throw new ValidationError([{ code: "invalid_string", message: `${fieldPath} ${min}-${max} karakter aralığında olmalıdır.`, path: [fieldPath] }]);
  }
  if (/[\r\n\0]/.test(str)) {
    throw new ValidationError([{ code: "invalid_string", message: "Satır sonu veya kontrol karakteri kullanılamaz.", path: [fieldPath] }]);
  }
  return str;
}

function validateEmail(value, fieldPath, requireGmail = false) {
  const str = String(value ?? "").trim();
  if (!str || str.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str) || /[\r\n\0]/.test(str)) {
    throw new ValidationError([{ code: "invalid_email", message: "Geçerli bir e-posta adresi girin.", path: [fieldPath] }]);
  }
  if (requireGmail && !/@gmail\.com$/i.test(str)) {
    throw new ValidationError([{ code: "invalid_gmail", message: "Yalnız Gmail adresi kullanılabilir.", path: [fieldPath] }]);
  }
  return str;
}

export function buildDatabaseUrl(db, defaultSqliteUrl = "file:../data/app.db") {
  if (!db || typeof db !== "object") return defaultSqliteUrl;
  const provider = String(db.provider || "sqlite").toLowerCase().trim();
  if (["postgres", "postgresql"].includes(provider)) {
    const host = db.host || "localhost";
    const port = Number(db.port) || 5432;
    const name = db.name || "app";
    const user = db.user ? encodeURIComponent(db.user) : "";
    const pass = db.password ? `:${encodeURIComponent(db.password)}` : "";
    const auth = (user || pass) ? `${user}${pass}@` : "";
    return `postgresql://${auth}${host}:${port}/${encodeURIComponent(name)}`;
  }
  if (provider === "mysql") {
    const host = db.host || "localhost";
    const port = Number(db.port) || 3306;
    const name = db.name || "app";
    const user = db.user ? encodeURIComponent(db.user) : "";
    const pass = db.password ? `:${encodeURIComponent(db.password)}` : "";
    const auth = (user || pass) ? `${user}${pass}@` : "";
    return `mysql://${auth}${host}:${port}/${encodeURIComponent(name)}`;
  }
  if (provider === "custom") {
    return String(db.url || "").trim();
  }
  // sqlite
  return String(db.url || "").trim() || defaultSqliteUrl;
}

export function parseSetupPayload(raw, options = {}) {
  const issues = [];
  if (!raw || typeof raw !== "object") {
    throw new ValidationError([{ code: "invalid_type", message: "Geçersiz kurulum verisi.", path: [] }]);
  }

  let deployment;
  try {
    deployment = parseDeploymentConfig(raw.deployment);
  } catch (err) {
    issues.push({ code: "custom", message: err.message, path: ["deployment"] });
  }

  const host = raw.server?.host;
  const port = Number(raw.server?.port);
  if (!["127.0.0.1", "0.0.0.0"].includes(host)) {
    issues.push({ code: "invalid_enum_value", message: "Sunucu adresi 127.0.0.1 veya 0.0.0.0 olmalıdır.", path: ["server", "host"] });
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    issues.push({ code: "invalid_port", message: "Sunucu portu 1024-65535 aralığında olmalıdır.", path: ["server", "port"] });
  }

  const rawAdminName = String(raw.admin?.name ?? "").trim();
  const rawAdminEmail = String(raw.admin?.email ?? "").trim();
  const adminPassword = String(raw.admin?.password ?? "");
  const isAdminBlank = !raw.admin || (!rawAdminName && !rawAdminEmail && !adminPassword);
  let admin = null;

  if (!(options.allowOptionalAdmin && isAdminBlank)) {
    let adminName = "";
    let adminEmail = "";
    try {
      adminName = validateCleanText(raw.admin?.name, "admin.name", 100, 2);
    } catch (err) {
      issues.push(...err.issues);
    }
    try {
      adminEmail = validateEmail(raw.admin?.email, "admin.email", false);
    } catch (err) {
      issues.push(...err.issues);
    }
    if (adminPassword.length < 12 || adminPassword.length > 128) {
      issues.push({ code: "too_small", message: "Parola en az 12, en fazla 128 karakter olmalıdır.", path: ["admin", "password"] });
    } else {
      if (!(/[a-z]/.test(adminPassword) && /[A-Z]/.test(adminPassword) && /\d/.test(adminPassword))) {
        issues.push({ code: "custom", message: "Parola büyük/küçük harf ve rakam içermelidir.", path: ["admin", "password"] });
      }
      if (/password|123456|qwerty|admin123/i.test(adminPassword)) {
        issues.push({ code: "custom", message: "Kolay tahmin edilen parola kullanılamaz.", path: ["admin", "password"] });
      }
    }
    admin = { name: adminName, email: adminEmail, password: adminPassword };
  }

  let email = { enabled: false };
  if (raw.email?.enabled === true) {
    try {
      const provider = String(raw.email.provider || (raw.email.host ? "custom" : "gmail")).toLowerCase().trim();
      const isCustom = provider === "custom" || Boolean(raw.email.host && raw.email.host !== "smtp.gmail.com");
      const requireGmail = !isCustom;

      let host = "smtp.gmail.com";
      let port = 587;
      let secure = false;

      if (isCustom) {
        host = validateCleanText(raw.email.host, "email.host", 253, 1);
        if (/[\s\r\n\0]/.test(host)) {
          throw new ValidationError([{ code: "invalid_host", message: "Geçerli bir SMTP sunucu adresi (host) girin.", path: ["email", "host"] }]);
        }
        const portNum = Number(raw.email.port || 587);
        if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
          throw new ValidationError([{ code: "invalid_port", message: "SMTP portu 1-65535 aralığında olmalıdır.", path: ["email", "port"] }]);
        }
        port = portNum;
        secure = Boolean(raw.email.secure);
      } else {
        const portNum = Number(raw.email.port || 587);
        port = Number.isInteger(portNum) && portNum >= 1 && portNum <= 65535 ? portNum : 587;
        secure = Boolean(raw.email.secure ?? (port === 465));
      }

      const user = validateEmail(raw.email.user, "email.user", requireGmail);
      const fromEmail = validateEmail(raw.email.fromEmail, "email.fromEmail", requireGmail);
      const fromName = validateCleanText(raw.email.fromName, "email.fromName", 100, 1);
      const password = String(raw.email.password ?? "").replace(/\s/g, "");

      const minPassLen = isCustom ? 1 : 16;
      if (password.length < minPassLen || password.length > 128) {
        issues.push({
          code: "custom",
          message: isCustom ? "Geçerli bir SMTP parolası girin." : "Geçerli Gmail uygulama parolası girin.",
          path: ["email", "password"],
        });
      }
      email = { enabled: true, provider: isCustom ? "custom" : "gmail", host, port, secure, user, password, fromEmail, fromName };
    } catch (err) {
      if (err.issues) issues.push(...err.issues);
      else issues.push({ code: "custom", message: err.message, path: ["email"] });
    }
  }

  let database = { provider: "sqlite" };
  if (raw.database && typeof raw.database === "object") {
    const rawProvider = String(raw.database.provider || "sqlite").toLowerCase().trim();
    if (["postgres", "postgresql"].includes(rawProvider)) {
      try {
        const dbHost = validateCleanText(raw.database.host || "localhost", "database.host", 253, 1);
        if (/[\s\r\n\0]/.test(dbHost)) {
          throw new ValidationError([{ code: "invalid_host", message: "Geçerli bir veritabanı host adresi girin.", path: ["database", "host"] }]);
        }
        const dbPort = Number(raw.database.port || 5432);
        if (!Number.isInteger(dbPort) || dbPort < 1 || dbPort > 65535) {
          throw new ValidationError([{ code: "invalid_port", message: "Veritabanı portu 1-65535 aralığında olmalıdır.", path: ["database", "port"] }]);
        }
        const dbName = validateCleanText(raw.database.name || "app", "database.name", 100, 1);
        const dbUser = String(raw.database.user ?? "postgres").trim();
        if (dbUser.length > 100 || /[\r\n\0]/.test(dbUser)) {
          throw new ValidationError([{ code: "invalid_string", message: "Veritabanı kullanıcı adı geçersiz.", path: ["database", "user"] }]);
        }
        const dbPassword = String(raw.database.password ?? "");
        if (dbPassword.length > 512 || /[\r\n\0]/.test(dbPassword)) {
          throw new ValidationError([{ code: "invalid_string", message: "Veritabanı parolası geçersiz karakter içeriyor.", path: ["database", "password"] }]);
        }
        const builtUrl = buildDatabaseUrl({
          provider: "postgres",
          host: dbHost,
          port: dbPort,
          name: dbName,
          user: dbUser,
          password: dbPassword,
        });
        database = {
          provider: "postgres",
          host: dbHost,
          port: dbPort,
          name: dbName,
          user: dbUser,
          password: dbPassword,
          url: builtUrl,
        };
      } catch (err) {
        if (err.issues) issues.push(...err.issues);
        else issues.push({ code: "custom", message: err.message, path: ["database"] });
      }
    } else if (rawProvider === "mysql") {
      try {
        const dbHost = validateCleanText(raw.database.host || "localhost", "database.host", 253, 1);
        if (/[\s\r\n\0]/.test(dbHost)) {
          throw new ValidationError([{ code: "invalid_host", message: "Geçerli bir veritabanı host adresi girin.", path: ["database", "host"] }]);
        }
        const dbPort = Number(raw.database.port || 3306);
        if (!Number.isInteger(dbPort) || dbPort < 1 || dbPort > 65535) {
          throw new ValidationError([{ code: "invalid_port", message: "Veritabanı portu 1-65535 aralığında olmalıdır.", path: ["database", "port"] }]);
        }
        const dbName = validateCleanText(raw.database.name || "app", "database.name", 100, 1);
        const dbUser = String(raw.database.user ?? "root").trim();
        if (dbUser.length > 100 || /[\r\n\0]/.test(dbUser)) {
          throw new ValidationError([{ code: "invalid_string", message: "Veritabanı kullanıcı adı geçersiz.", path: ["database", "user"] }]);
        }
        const dbPassword = String(raw.database.password ?? "");
        if (dbPassword.length > 512 || /[\r\n\0]/.test(dbPassword)) {
          throw new ValidationError([{ code: "invalid_string", message: "Veritabanı parolası geçersiz karakter içeriyor.", path: ["database", "password"] }]);
        }
        const builtUrl = buildDatabaseUrl({
          provider: "mysql",
          host: dbHost,
          port: dbPort,
          name: dbName,
          user: dbUser,
          password: dbPassword,
        });
        database = {
          provider: "mysql",
          host: dbHost,
          port: dbPort,
          name: dbName,
          user: dbUser,
          password: dbPassword,
          url: builtUrl,
        };
      } catch (err) {
        if (err.issues) issues.push(...err.issues);
        else issues.push({ code: "custom", message: err.message, path: ["database"] });
      }
    } else if (rawProvider === "custom") {
      const url = String(raw.database.url ?? "").trim();
      if (!url || url.length > 2048 || /[\r\n\0]/.test(url)) {
        issues.push({ code: "invalid_url", message: "Geçerli bir veritabanı bağlantı dizesi girin.", path: ["database", "url"] });
      }
      database = {
        provider: "custom",
        url,
      };
    } else if (rawProvider === "sqlite") {
      const url = String(raw.database.url ?? "").trim();
      if (url && (url.length > 2048 || /[\r\n\0]/.test(url))) {
        issues.push({ code: "invalid_string", message: "SQLite dosya yolunda geçersiz karakterler var.", path: ["database", "url"] });
      }
      database = {
        provider: "sqlite",
        url: url || undefined,
      };
    } else {
      issues.push({ code: "invalid_provider", message: "Desteklenmeyen veritabanı sağlayıcısı.", path: ["database", "provider"] });
    }
  }

  const customEnv = {};
  if (raw.customEnv !== undefined && raw.customEnv !== null) {
    if (typeof raw.customEnv !== "object" || Array.isArray(raw.customEnv)) {
      issues.push({ code: "invalid_type", message: "customEnv nesne olmalıdır.", path: ["customEnv"] });
    } else {
      for (const [key, val] of Object.entries(raw.customEnv)) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
          issues.push({ code: "invalid_key", message: `Geçersiz ortam değişkeni adı: ${key}`, path: ["customEnv", key] });
          continue;
        }
        const strVal = String(val ?? "");
        if (strVal.length > 2048 || /[\r\n\0]/.test(strVal)) {
          issues.push({ code: "invalid_string", message: `${key} geçersiz karakter veya uzunluk içeriyor.`, path: ["customEnv", key] });
          continue;
        }
        customEnv[key] = strVal;
      }
    }
  }

  if (issues.length > 0) {
    throw new ValidationError(issues);
  }

  return {
    deployment,
    server: { host, port },
    admin,
    email,
    database,
    customEnv,
    buildClient: raw.buildClient !== undefined ? Boolean(raw.buildClient) : true,
    overwriteExistingEnv: Boolean(raw.overwriteExistingEnv),
  };
}

export const setupPayloadSchema = {
  parse: (raw, options = {}) => parseSetupPayload(raw, options),
  safeParse: (raw, options = {}) => {
    try {
      return { success: true, data: parseSetupPayload(raw, options) };
    } catch (error) {
      return { success: false, error };
    }
  },
};

function envValue(value) {
  return JSON.stringify(String(value));
}

export function createSessionSecret() {
  return randomBytes(64).toString("hex");
}

export function hashAdminPassword(password, salt = randomBytes(16).toString("hex")) {
  const derivedHex = scryptSync(String(password), salt, 64).toString("hex");
  return `scrypt$${salt}$${derivedHex}`;
}

export function verifyAdminPassword(password, storedHash) {
  if (typeof storedHash !== "string") return false;
  const parts = storedHash.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, expectedHex] = parts;
  if (!salt || !expectedHex || !/^[0-9a-f]+$/i.test(expectedHex) || expectedHex.length % 2 !== 0) return false;
  const actualBuf = scryptSync(String(password ?? ""), salt, expectedHex.length / 2);
  const expectedBuf = Buffer.from(expectedHex, "hex");
  if (actualBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(actualBuf, expectedBuf);
}

/**
 * Senaryoya göre sade `.env` üretir. Her zaman yazılanlar: algılanan senaryonun gerektirdiği
 * çekirdek ayarlar (`SESSION_SECRET` yalnızca yönetici hesabı varsa/bildirilmişse, `DATABASE_URL`
 * yalnızca yerel veritabanı algılanırsa/bildirilirse, `NODE_ENV` yalnızca Node senaryolarında). İsteğe bağlı gruplar (TRUST_PROXY_HOPS, RETENTION_*, EMAIL_*,
 * ALLOW_RUNTIME_DEPLOYMENT_CHANGES) yalnızca kullanıcı etkinleştirdiyse veya
 * `.env.example` içinde bildirildiyse yazılır. `.env.example` değişkenleri ve
 * `customEnv` değerleri her senaryoda eklenir.
 * @param {object} [scenario] detectProject().scenario (verilmezse eski tam sunucu şablonu).
 */
export function buildServerEnv(payload, sessionSecret = createSessionSecret(), databaseUrl = "file:../data/app.db", extraEnvVars = [], scenario = null) {
  const deployment = payload.deployment;
  const basePath = normalizeBasePath(deployment.basePath);
  const publicAppUrl = `${deployment.publicUrl}${basePath === "/" ? "" : basePath}`;
  const retention = deployment.retention ?? {
    enabled: false,
    actionLogDays: 365,
    readNotificationDays: 180,
    emailLogDays: 90,
    passwordResetDays: 90,
  };
  const declared = new Set(
    (Array.isArray(extraEnvVars) ? extraEnvVars : [])
      .map((item) => (item && typeof item.key === "string" ? item.key : null))
      .filter(Boolean),
  );
  const declaredAny = (prefix) => [...declared].some((key) => key === prefix || key.startsWith(prefix));

  const isStatic = Boolean(scenario?.isStaticOnly);
  const isDesktop = Boolean(scenario?.isDesktop);
  // Tarayıcıda çalışan statik uygulamada sunucu sırrı/oturum anahtarı yoktur; masaüstünde sunucu ayarları gerekmez.
  const needsServerCore = !isStatic && !isDesktop;
  // Yerel (SQLite/Prisma) veritabanı yolu yalnızca algılanırsa veya .env.example bildirirse ya da kullanıcı açıkça SQLite dışı/özel bir veritabanı seçtiyse yazılır;
  // Python/Go/.NET/Rust gibi projelere varsayılan SQLite yolu dayatılmaz.
  const isExplicitDb = Boolean(
    payload.database &&
    (payload.database.provider !== "sqlite" || payload.database.url)
  );
  const needsDatabase = scenario ? Boolean(scenario.usesLocalDatabase) || declared.has("DATABASE_URL") || isExplicitDb : true;
  const needsNodeEnv = scenario ? Boolean(scenario.usesNodeEnv) || declared.has("NODE_ENV") : true;
  const needsSessionSecret = scenario ? Boolean(payload.admin?.email) || declared.has("SESSION_SECRET") : true;

  const effectiveDatabaseUrl = payload.database?.url
    ? payload.database.url
    : (payload.database?.provider && payload.database.provider !== "sqlite"
      ? buildDatabaseUrl(payload.database, databaseUrl)
      : (payload.databaseUrl || databaseUrl));

  const writtenKeys = new Set();
  const lines = [
    "# setup kurulum sihirbazı tarafından oluşturuldu.",
    "# Gizli değerleri Git'e eklemeyin.",
  ];
  const put = (key, value) => {
    lines.push(`${key}=${value}`);
    writtenKeys.add(key);
  };

  if (needsDatabase) put("DATABASE_URL", envValue(effectiveDatabaseUrl));
  if (needsServerCore) {
    if (needsSessionSecret) put("SESSION_SECRET", envValue(sessionSecret));
    if (needsNodeEnv) put("NODE_ENV", "production");
    put("HOST", envValue(payload.server.host));
    put("PORT", String(payload.server.port));
    put("FRONTEND_URL", envValue(deployment.publicUrl));
    put("APP_BASE_PATH", envValue(basePath));
    put("ALLOWED_ORIGINS", envValue(deployment.allowedOrigins.join(",")));
    if (deployment.trustProxyHops > 0 || declared.has("TRUST_PROXY_HOPS")) {
      put("TRUST_PROXY_HOPS", String(deployment.trustProxyHops));
    }
    if (declared.has("ALLOW_RUNTIME_DEPLOYMENT_CHANGES")) put("ALLOW_RUNTIME_DEPLOYMENT_CHANGES", "false");
    if (retention.enabled || declaredAny("RETENTION_")) {
      put("RETENTION_ENABLED", retention.enabled ? "true" : "false");
      put("RETENTION_ACTION_LOG_DAYS", String(retention.actionLogDays));
      put("RETENTION_READ_NOTIFICATION_DAYS", String(retention.readNotificationDays));
      put("RETENTION_EMAIL_LOG_DAYS", String(retention.emailLogDays));
      put("RETENTION_PASSWORD_RESET_DAYS", String(retention.passwordResetDays));
    }
  } else if (isDesktop && declared.has("PORT")) {
    put("PORT", String(payload.server.port));
  }

  if (payload.admin && payload.admin.email) {
    const passwordHash = payload.admin.passwordHash || hashAdminPassword(payload.admin.password);
    put("ADMIN_NAME", envValue(payload.admin.name));
    put("ADMIN_EMAIL", envValue(payload.admin.email));
    put("ADMIN_PASSWORD_HASH", envValue(passwordHash));
  }

  if (needsServerCore && (payload.email?.enabled || declaredAny("EMAIL_"))) {
    if (payload.email?.enabled) {
      const emailHost = payload.email.host || (payload.email.provider === "custom" ? "localhost" : "smtp.gmail.com");
      const emailPort = String(payload.email.port || 587);
      put("EMAIL_HOST", envValue(emailHost));
      put("EMAIL_PORT", emailPort);
      put("EMAIL_SECURE", payload.email.secure ? "true" : "false");
      put("EMAIL_USER", envValue(payload.email.user));
      put("EMAIL_PASS", envValue(payload.email.password));
      put("EMAIL_FROM", envValue(payload.email.fromEmail));
      put("EMAIL_FROM_NAME", envValue(payload.email.fromName));
      put("EMAIL_CONNECTION_TIMEOUT", "10000");
      put("EMAIL_GREETING_TIMEOUT", "10000");
      put("EMAIL_SOCKET_TIMEOUT", "20000");
    } else {
      put("EMAIL_PORT", "587");
      lines.push("# E-posta (SMTP) gönderimi kurulum sırasında etkinleştirilmedi.");
    }
  }

  const customEnv = payload.customEnv && typeof payload.customEnv === "object" ? payload.customEnv : {};

  if (Array.isArray(extraEnvVars)) {
    for (const item of extraEnvVars) {
      if (!item || typeof item !== "object") continue;
      const { key, defaultValue, description } = item;
      if (typeof key !== "string" || writtenKeys.has(key) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        continue;
      }
      if (description) {
        lines.push(`# ${String(description).replace(/[\r\n]+/g, " ")}`);
      }
      const effectiveValue = Object.prototype.hasOwnProperty.call(customEnv, key)
        ? customEnv[key]
        : (defaultValue ?? "");
      lines.push(`${key}=${envValue(effectiveValue)}`);
      writtenKeys.add(key);
    }
  }

  for (const [key, val] of Object.entries(customEnv)) {
    if (writtenKeys.has(key) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    lines.push(`${key}=${envValue(val ?? "")}`);
    writtenKeys.add(key);
  }

  lines.push(
    `# Uygulama adresi: ${publicAppUrl}`,
    "",
  );
  return lines.join("\n");
}

export function toDeploymentConfig(payload) {
  return {
    ...payload.deployment,
    basePath: normalizeBasePath(payload.deployment.basePath),
  };
}

export function publicAppUrl(payload) {
  const basePath = normalizeBasePath(payload.deployment.basePath);
  return `${payload.deployment.publicUrl}${basePath === "/" ? "" : basePath}`;
}
