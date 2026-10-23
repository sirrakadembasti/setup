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
import { createDesktopAppController, normalizeProcessEnv, parseDotEnvFile, pmRunInvocation, readJsonFileSafe, resolveAppStartInvocation, resolveDesktopDataDir } from "./app-process.mjs";
// Geriye uyumluluk: bu yardımcılar eskiden bu modülden dışa aktarılıyordu.
export { normalizeProcessEnv, parseDotEnvFile, pmRunInvocation, resolveAppStartInvocation, resolvePnpmInvocation, wrapShimCommand } from "./app-process.mjs";

import {
  createApplyState,
  createRateLimiter,
  detectRequiredToolchain,
  digest,
  equalSecret,
  executeSetupApply,
  testDatabaseConnection,
  testEmailConfiguration,
  validateStepData,
  writable,
  buildPublicFrontendConfig,
  writePublicFrontendArtifacts,
} from "./shared.mjs";

export {
  createRateLimiter,
  equalSecret,
  buildPublicFrontendConfig,
  writePublicFrontendArtifacts,
  testDatabaseConnection,
  testEmailConfiguration,
  detectRequiredToolchain,
};

function cookieValue(req, name) {
  const part = String(req.headers.cookie || "").split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : "";
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
    const origin = req.headers.origin || (req.headers.referer ? (() => { try { return new URL(req.headers.referer).origin; } catch { return ""; } })() : "");
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
  let realRootDir;
  try {
    realRootDir = fs.realpathSync(rootDir);
  } catch {
    realRootDir = rootDir;
  }

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

    let realTargetFile;
    try {
      realTargetFile = fs.realpathSync(targetFile);
    } catch {
      res.statusCode = 404;
      return res.end("Not Found");
    }

    const realCheck = path.relative(realRootDir, realTargetFile);
    if (realCheck.startsWith("..") || path.isAbsolute(realCheck)) {
      res.statusCode = 403;
      return res.end("Forbidden");
    }

    const ext = path.extname(realTargetFile).toLowerCase();
    res.setHeader("Content-Type", STATIC_MIME_TYPES[ext] || "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      const stat = fs.statSync(realTargetFile);
      res.setHeader("Content-Length", stat.size);
    } catch {}
    res.statusCode = 200;
    if (req.method === "HEAD") return res.end();
    const stream = fs.createReadStream(realTargetFile);
    stream.on("error", () => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("Internal Server Error");
      } else {
        res.destroy();
      }
    });
    stream.pipe(res);
  });
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
    if (body.length > 524_288) throw new Error("İstek gövdesi çok büyük.");
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
  const isReconfigure = Boolean(options.reconfigure || process.env.SETUP_RECONFIGURE === "true" || process.env.SETUP_RECONFIGURE === "1");
  const applyJob = createApplyState();
  let appChild = null;
  let appChildStderr = "";
  let spawnedStaticServer = null;
  let completeTimer = null;
  const isDesktop = Boolean(detection.scenario.isDesktop);
  const desktopApp = createDesktopAppController({
    projectRoot,
    setupConfig,
    getEnvPath: () => envPath,
    dataDir,
    graceMs: Number(options.desktopGraceMs ?? 3000),
    startInvocation: options.startAppInvocation || null,
  });

  const serverLimiter = createRateLimiter({ maxBuckets: 1000 });
  function checkRateLimit(key, limit, windowMs) {
    return serverLimiter.checkRateLimit(key, limit, windowMs);
  }

  function markStep(id, status, detail) {
    applyJob.steps = applyJob.steps.map((step) =>
      step.id === id ? { ...step, status, detail: detail ?? step.detail } : step,
    );
  }

  async function applySetup(payload) {
    return executeSetupApply({
      projectRoot,
      dataDir,
      paths: {
        serverRoot,
        dataRoot,
        env: envPath,
        lock: lockPath,
        pending: pendingPath,
        setupArtifacts: artifactRoot,
        databaseUrl,
      },
      detection,
      setupConfig,
      options: { ...options, reconfigure: isReconfigure || options.reconfigure },
      applyJob,
      payload,
      markStep,
    });
  }

  function validateStepPayload(step, data) {
    return validateStepData(step, data, { allowOptionalAdmin: !detection.scenario.requiresAdmin });
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

      if (req.method === "POST" && reqUrl.pathname === "/api/test-database") {
        try {
          const rawBody = await readJson(req);
          const dbConfig = rawBody?.database ?? rawBody ?? {};
          const result = await testDatabaseConnection(dbConfig, projectRoot);
          const statusCode = result.ok ? 200 : 400;
          return sendJson(res, statusCode, result);
        } catch (error) {
          return sendJson(res, 400, { ok: false, reachable: false, message: error instanceof Error ? error.message : "Veritabanı sınaması başarısız." });
        }
      }

      if (req.method === "POST" && reqUrl.pathname === "/api/validate-email-format") {
        try {
          const rawBody = await readJson(req);
          const emailConfig = rawBody?.email ?? rawBody ?? {};
          const issues = validateStepPayload("email", emailConfig);
          if (issues.length > 0) {
            return sendJson(res, 400, { ok: false, message: issues[0].message, errors: issues.map((i) => i.message) });
          }
          return sendJson(res, 200, { ok: true, message: "E-posta biçimi doğrulandı." });
        } catch (error) {
          return sendJson(res, 400, { ok: false, message: error instanceof Error ? error.message : "Doğrulama başarısız." });
        }
      }

      if (req.method === "POST" && (reqUrl.pathname === "/api/test-email" || reqUrl.pathname === "/api/test-smtp")) {
        try {
          const rawBody = await readJson(req);
          const emailConfig = rawBody?.email ?? rawBody ?? {};
          if (emailConfig.enabled === false) {
            return sendJson(res, 200, {
              ok: true,
              reachable: false,
              connectionTested: false,
              message: "E-posta gönderimi devre dışı olarak doğrulandı.",
            });
          }
          const issues = validateStepPayload("email", emailConfig);
          if (issues.length > 0) {
            return sendJson(res, 400, { ok: false, message: issues[0].message, errors: issues.map((i) => i.message) });
          }
          const result = await testEmailConfiguration(emailConfig);
          const statusCode = result.ok ? 200 : 400;
          return sendJson(res, statusCode, result);
        } catch (error) {
          return sendJson(res, 400, { ok: false, reachable: false, message: error instanceof Error ? error.message : "SMTP sınaması başarısız." });
        }
      }

      if (req.method === "GET" && reqUrl.pathname === "/api/status") {
        const networks = Object.values(os.networkInterfaces()).flat().filter((item) => item && !item.internal).map((item) => item.address);
        const envExample = parseEnvExample(projectRoot);
        const defaultPort = detection.ports.app || readConfiguredPort(projectRoot) || Number(setupConfig?.ports?.app) || 5000;
        const rootPkg = readJsonFileSafe(path.join(projectRoot, "package.json"));
        const serverPkg = readJsonFileSafe(path.join(projectRoot, "server", "package.json"));
        const detectedSeed = setupConfig?.seed
          ? (typeof setupConfig.seed === "string" ? setupConfig.seed : setupConfig.seed.command)
          : (["prisma:seed", "db:seed", "seed"].find((name) => Boolean(rootPkg?.scripts?.[name] || serverPkg?.scripts?.[name])) || null);
        const toolchain = detectRequiredToolchain(detection);
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
            seedScript: detectedSeed,
            toolchain: toolchain.details,
          },
          checks: {
            nodeSupported: Number(process.versions.node.split(".")[0]) >= 18,
            dataWritable: writable(dataRoot),
            uploadsWritable: writable(path.join(serverRoot, "uploads")),
            notInstalled: isReconfigure ? true : !fs.existsSync(lockPath),
            envAbsent: isReconfigure ? true : !fs.existsSync(envPath),
            toolchainAvailable: toolchain.available,
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
        const appDied = Boolean(appChild && appChild.exitCode !== null);
        const exitHint = appDied ? ` (Süreç kapandı, çıkış kodu: ${appChild.exitCode})` : "";
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
            : `Uygulama henüz ayakta değil (API: ${appPort})${exitHint}.`,
        });
      }

      if (req.method === "POST" && reqUrl.pathname === "/api/start-app") {
        if (completeTimer) {
          clearTimeout(completeTimer);
          completeTimer = null;
        }
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
          const shimsDir = path.resolve(projectRoot, "bin", "shims");
          const localShims = path.resolve(fileURLToPath(import.meta.url), "..", "..", "bin", "shims");
          const prepend = [];
          if (fs.existsSync(shimsDir)) prepend.push(shimsDir);
          if (fs.existsSync(localShims) && !prepend.includes(localShims)) prepend.push(localShims);
          const childEnv = normalizeProcessEnv(process.env, { ...dotEnvVars, PORT: String(appPort) }, prepend);

          appChildStderr = "";
          appChild = spawn(invocation.command, invocation.args, {
            cwd: invocation.cwd || projectRoot,
            env: childEnv,
            detached: process.platform !== "win32",
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
          });
          appChild.stderr?.on("data", (chunk) => {
            appChildStderr += chunk.toString();
            if (appChildStderr.length > 4000) appChildStderr = appChildStderr.slice(-4000);
          });
          appChild.on("error", () => {});
          appChild.unref();
        }

        for (let i = 0; i < 16; i++) {
          await new Promise((r) => setTimeout(r, 200));
          if (appChild && appChild.exitCode !== null) {
            const errDetail = appChildStderr.trim().split(/\r?\n/).slice(-5).join(" | ");
            const reason = errDetail ? `Hata: ${errDetail}` : `Çıkış kodu: ${appChild.exitCode}`;
            return sendJson(res, 409, {
              message: `Uygulama başlatılırken çöktü veya kapandı (${reason}).`,
              reachable: false,
              pid: appChild?.pid ?? null,
              exitCode: appChild.exitCode,
              errorDetail: errDetail || null,
            });
          }
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
          applyJob.logs = [];
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
              const shouldAutoClose = options.autoClose === true || process.env.SETUP_AUTO_CLOSE === "true" || process.env.SETUP_AUTO_CLOSE === "1";
              if (options.onComplete && shouldAutoClose) {
                const autoCloseDelay = typeof options.autoCloseDelay === "number" ? options.autoCloseDelay : 20_000;
                completeTimer = setTimeout(() => {
                  if (!spawnedStaticServer && (!appChild || appChild.exitCode !== null)) {
                    options.onComplete();
                  }
                }, autoCloseDelay);
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

  server.hasSpawnedApp = () => Boolean(spawnedStaticServer || (appChild && appChild.exitCode === null));

  server.stopSpawnedApp = async () => {
    if (completeTimer) {
      clearTimeout(completeTimer);
      completeTimer = null;
    }
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

export function startSetupWizard(options = {}) {
  const isReconfigure = Boolean(
    options.reconfigure ||
    process.argv.includes("--reconfigure") ||
    process.env.SETUP_RECONFIGURE === "true" ||
    process.env.SETUP_RECONFIGURE === "1"
  );
  const projectRoot = options.projectRoot ? path.resolve(options.projectRoot) : getProjectRoot();
  const setupConfig = loadSetupConfig(projectRoot);
  const detection = detectProject(projectRoot);
  const dataDir = resolveDesktopDataDir({ detection, setupConfig, explicit: options.dataDir });
  const paths = getSetupPaths(projectRoot, { dataDir });
  fs.mkdirSync(paths.dataRoot, { recursive: true });
  if (fs.existsSync(paths.lock) && !isReconfigure) {
    throw new Error("Kurulum kilidi mevcut. Çalışan sistemi yeniden yapılandırmak için --reconfigure parametresini kullanın veya önce temiz kurulum adımını çalıştırın.");
  }
  const token = process.env.SETUP_TOKEN || crypto.randomBytes(24).toString("base64url");
  const host = "127.0.0.1";
  const port = Math.min(65535, Math.max(1024, Number(process.env.SETUP_PORT) || Number(setupConfig?.ports?.wizard) || 5050));
  let server;
  server = createSetupServer(token, {
    projectRoot,
    dataDir,
    reconfigure: isReconfigure,
    ...options,
    onComplete: () => {
      if (!server.hasSpawnedApp?.()) {
        server.close();
      }
    },
  });
  server.listen(port, host, () => {
    console.log(`Kurulum sihirbazı: http://${host}:${port}/setup?token=${token}`);
    console.log("Bu bağlantıyı paylaşmayın. Kurulum tamamlandıktan sonra uygulamayı başlatabilirsiniz.");
  });
  return server;
}

if (import.meta.url && process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  startSetupWizard();
}
