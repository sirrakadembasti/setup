import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "./project-paths.mjs";
import { getSetupPaths } from "../scripts/setup-bootstrap-lib.mjs";

export function normalizeBasePath(input = "/") {
  const raw = String(input ?? "/").trim();
  if (!raw || raw === "/") return "/";
  const cleaned = raw.replace(/\/+/g, "/").replace(/\/$/, "");
  const withLeading = cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
  if (/\.\.|[\r\n\0\s\\]/.test(withLeading)) {
    throw new Error("Geçersiz alt yol (basePath) formatı.");
  }
  return withLeading;
}

export function validateUrl(value, fieldLabel = "URL") {
  const str = String(value ?? "").trim();
  if (!str || /[\r\n\0]/.test(str)) {
    throw new Error(`${fieldLabel} geçerli bir adres olmalıdır.`);
  }
  let parsed;
  try {
    parsed = new URL(str);
  } catch {
    throw new Error(`${fieldLabel} geçerli bir URL olmalıdır.`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${fieldLabel} yalnız http:// veya https:// protokolü kullanabilir.`);
  }
  return str.replace(/\/+$/, "");
}

export function parseDeploymentConfig(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Dağıtım yapılandırması eksik.");
  }
  const mode = raw.mode;
  if (!["localhost", "subdomain", "subpath"].includes(mode)) {
    throw new Error("Geçersiz kurulum biçimi (mode).");
  }
  const publicUrl = validateUrl(raw.publicUrl, "Herkese açık adres (publicUrl)");
  const basePath = normalizeBasePath(raw.basePath ?? "/");
  if (!Array.isArray(raw.allowedOrigins) || raw.allowedOrigins.length === 0) {
    throw new Error("En az bir izinli origin girilmelidir.");
  }
  const allowedOrigins = raw.allowedOrigins.map((o) => validateUrl(o, "İzinli origin"));
  const trustProxyHops = Number(raw.trustProxyHops ?? 0);
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 5) {
    throw new Error("Güvenilir proxy sayısı 0 ile 5 arasında bir tam sayı olmalıdır.");
  }
  const ret = raw.retention ?? {};
  const retention = {
    enabled: Boolean(ret.enabled),
    actionLogDays: Number(ret.actionLogDays ?? 365),
    readNotificationDays: Number(ret.readNotificationDays ?? 180),
    emailLogDays: Number(ret.emailLogDays ?? 90),
    passwordResetDays: Number(ret.passwordResetDays ?? 90),
  };
  if (!Number.isInteger(retention.actionLogDays) || retention.actionLogDays < 30 || retention.actionLogDays > 3650) {
    throw new Error("İşlem logu saklama süresi en az 30 gün olmalıdır.");
  }
  for (const [k, v] of [
    ["Okunmuş bildirim", retention.readNotificationDays],
    ["E-posta logu", retention.emailLogDays],
    ["Parola talebi", retention.passwordResetDays],
  ]) {
    if (!Number.isInteger(v) || v < 7 || v > 3650) {
      throw new Error(`${k} saklama süresi en az 7 gün olmalıdır.`);
    }
  }
  return { mode, publicUrl, basePath, allowedOrigins, trustProxyHops, retention };
}

export function saveDeploymentConfig(config, updatedBy = "setup-wizard", projectRoot = getProjectRoot()) {
  const paths = getSetupPaths(projectRoot);
  fs.mkdirSync(paths.dataRoot, { recursive: true });
  const target = paths.deploymentConfig;
  const temp = paths.deploymentConfigTemp;
  const record = {
    ...config,
    basePath: normalizeBasePath(config.basePath),
    updatedBy,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temp, target);
  return record;
}

export function buildDeploymentArtifacts(config) {
  const basePath = normalizeBasePath(config.basePath);
  const parsedUrl = new URL(config.publicUrl);
  const serverName = parsedUrl.hostname || "localhost";
  const locationPath = basePath === "/" ? "/" : `${basePath}/`;
  const nginxText = [
    "# Otomatik üretilen örnek Nginx yapılandırması",
    "server {",
    "    listen 80;",
    `    server_name ${serverName};`,
    "",
    `    location ${locationPath} {`,
    "        proxy_pass http://127.0.0.1:5000;",
    "        proxy_http_version 1.1;",
    "        proxy_set_header Host $host;",
    "        proxy_set_header X-Real-IP $remote_addr;",
    "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
    "        proxy_set_header X-Forwarded-Proto $scheme;",
    "    }",
    "}",
  ].join("\n");

  const envText = [
    `DEPLOYMENT_MODE=${JSON.stringify(config.mode)}`,
    `FRONTEND_URL=${JSON.stringify(config.publicUrl)}`,
    `APP_BASE_PATH=${JSON.stringify(basePath)}`,
    `ALLOWED_ORIGINS=${JSON.stringify(config.allowedOrigins.join(","))}`,
    `TRUST_PROXY_HOPS=${config.trustProxyHops}`,
  ].join("\n");

  return { nginxText, envText };
}
