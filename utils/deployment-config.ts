import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getProjectRoot } from "./project-paths";

export function normalizeBasePath(input?: string | null): string {
  const raw = String(input ?? "/").trim();
  if (!raw || raw === "/") return "/";
  const cleaned = raw.replace(/\/+/g, "/").replace(/\/$/, "");
  const withLeading = cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
  if (/\.\.|[\r\n\0\s\\]/.test(withLeading)) {
    throw new Error("Geçersiz alt yol (basePath) formatı.");
  }
  return withLeading;
}

export const retentionSchema = z.object({
  enabled: z.boolean().default(false),
  actionLogDays: z.number().int().min(30).max(3650).default(365),
  readNotificationDays: z.number().int().min(7).max(3650).default(180),
  emailLogDays: z.number().int().min(7).max(3650).default(90),
  passwordResetDays: z.number().int().min(7).max(3650).default(90),
});

export const deploymentConfigSchema = z.object({
  mode: z.enum(["localhost", "subdomain", "subpath"]),
  publicUrl: z.string().trim().url("Geçerli bir URL girin.").refine(
    (val) => /^https?:\/\//i.test(val) && !/[\r\n\0]/.test(val),
    "Yalnız http:// veya https:// protokolü kullanılabilir.",
  ).transform((val) => val.replace(/\/+$/, "")),
  basePath: z.string().trim().default("/").transform((val) => normalizeBasePath(val)),
  allowedOrigins: z.array(z.string().trim().url("İzinli origin geçerli bir URL olmalıdır.")).min(1, "En az bir izinli origin girilmelidir."),
  trustProxyHops: z.number().int().min(0).max(5).default(0),
  retention: retentionSchema.default({
    enabled: false,
    actionLogDays: 365,
    readNotificationDays: 180,
    emailLogDays: 90,
    passwordResetDays: 90,
  }),
});

export type DeploymentConfig = z.infer<typeof deploymentConfigSchema>;

export function saveDeploymentConfig(config: DeploymentConfig, updatedBy = "setup-wizard"): DeploymentConfig {
  const root = getProjectRoot();
  const dataDir = path.join(root, "server", "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const target = path.join(dataDir, "deployment-config.json");
  const temp = path.join(dataDir, "deployment-config.json.tmp");
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

export function buildDeploymentArtifacts(config: DeploymentConfig) {
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
