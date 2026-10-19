import { randomBytes } from "node:crypto";
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

export function parseSetupPayload(raw) {
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

  let adminName = "";
  let adminEmail = "";
  const adminPassword = String(raw.admin?.password ?? "");
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

  let email = { enabled: false };
  if (raw.email?.enabled === true) {
    try {
      const user = validateEmail(raw.email.user, "email.user", true);
      const fromEmail = validateEmail(raw.email.fromEmail, "email.fromEmail", true);
      const fromName = validateCleanText(raw.email.fromName, "email.fromName", 100, 1);
      const password = String(raw.email.password ?? "").replace(/\s/g, "");
      if (password.length < 16 || password.length > 128) {
        issues.push({ code: "custom", message: "Geçerli Gmail uygulama parolası girin.", path: ["email", "password"] });
      }
      email = { enabled: true, user, password, fromEmail, fromName };
    } catch (err) {
      if (err.issues) issues.push(...err.issues);
      else issues.push({ code: "custom", message: err.message, path: ["email"] });
    }
  }

  if (issues.length > 0) {
    throw new ValidationError(issues);
  }

  return {
    deployment,
    server: { host, port },
    admin: { name: adminName, email: adminEmail, password: adminPassword },
    email,
    buildClient: raw.buildClient !== undefined ? Boolean(raw.buildClient) : true,
    overwriteExistingEnv: Boolean(raw.overwriteExistingEnv),
  };
}

export const setupPayloadSchema = {
  parse: parseSetupPayload,
};

function envValue(value) {
  return JSON.stringify(String(value));
}

export function createSessionSecret() {
  return randomBytes(64).toString("hex");
}

export function buildServerEnv(payload, sessionSecret = createSessionSecret(), databaseUrl = "file:../data/app.db") {
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
  const lines = [
    "# setup kurulum sihirbazı tarafından oluşturuldu.",
    "# Gizli değerleri Git'e eklemeyin.",
    `DATABASE_URL=${envValue(databaseUrl)}`,
    `SESSION_SECRET=${envValue(sessionSecret)}`,
    "NODE_ENV=production",
    `HOST=${envValue(payload.server.host)}`,
    `PORT=${payload.server.port}`,
    `FRONTEND_URL=${envValue(deployment.publicUrl)}`,
    `APP_BASE_PATH=${envValue(basePath)}`,
    `ALLOWED_ORIGINS=${envValue(deployment.allowedOrigins.join(","))}`,
    `TRUST_PROXY_HOPS=${deployment.trustProxyHops}`,
    "ALLOW_RUNTIME_DEPLOYMENT_CHANGES=false",
    `RETENTION_ENABLED=${retention.enabled ? "true" : "false"}`,
    `RETENTION_ACTION_LOG_DAYS=${retention.actionLogDays}`,
    `RETENTION_READ_NOTIFICATION_DAYS=${retention.readNotificationDays}`,
    `RETENTION_EMAIL_LOG_DAYS=${retention.emailLogDays}`,
    `RETENTION_PASSWORD_RESET_DAYS=${retention.passwordResetDays}`,
    "EMAIL_PORT=587",
  ];

  if (payload.email.enabled) {
    lines.push(
      `EMAIL_USER=${envValue(payload.email.user)}`,
      `EMAIL_PASS=${envValue(payload.email.password)}`,
      `EMAIL_FROM=${envValue(payload.email.fromEmail)}`,
      `EMAIL_FROM_NAME=${envValue(payload.email.fromName)}`,
    );
  } else {
    lines.push("# Gmail gönderimi kurulum sırasında etkinleştirilmedi.");
  }

  lines.push(
    "EMAIL_CONNECTION_TIMEOUT=10000",
    "EMAIL_GREETING_TIMEOUT=10000",
    "EMAIL_SOCKET_TIMEOUT=20000",
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
