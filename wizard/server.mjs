import { spawn, spawnSync } from "node:child_process";
import crypto, { timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { getProjectRoot } from "../utils/project-paths.mjs";
import { probeApplicationUrl } from "./app-readiness.mjs";
import { resolveWizardPort } from "../scripts/cli-options.mjs";
import { buildDeploymentArtifacts, parseDeploymentConfig, saveDeploymentConfig } from "../utils/deployment-config.mjs";
import { findListeningProcess, getSetupPaths, readConfiguredPort } from "../scripts/setup-bootstrap-lib.mjs";
import { buildLoginUrl, detectPackageManager, detectProject, loadSetupConfig, parseEnvExample } from "../scripts/detect-project.mjs";
import { resolveStepCommand } from "../scripts/polyglot.mjs";
import { buildServerEnv, hashAdminPassword, publicAppUrl, setupPayloadSchema, toDeploymentConfig, ValidationError } from "./config.mjs";
import { renderSetupPage } from "./ui.mjs";
import { createDesktopAppController, createDualProcessController, normalizeProcessEnv, parseDotEnvFile, pmRunInvocation, readJsonFileSafe, resolveAppStartInvocation, resolveDesktopDataDir, withApplicationPort } from "./app-process.mjs";
// Geriye uyumluluk: bu yardımcılar eskiden bu modülden dışa aktarılıyordu.
export { normalizeProcessEnv, parseDotEnvFile, pmRunInvocation, resolveAppStartInvocation, resolvePnpmInvocation, wrapShimCommand } from "./app-process.mjs";

import {
  redactSecrets,
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

async function readJson(req) {
  let body = "";
  let tooLarge = false;
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 524_288) {
      tooLarge = true;
      break;
    }
  }
  if (typeof req.resume === "function") req.resume();
  if (tooLarge) throw new Error("İstek gövdesi çok büyük.");
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
  let detection = detectProject(projectRoot, { candidate: options.candidate });

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
  let dualController = null;
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


  let activeInvocation = null;
  let startPromise = null;
  let readinessPromise = null;
  let startupDeadline = Infinity;
  const outputBuffers = new Map();
  const knownApplicationSecrets = new Set();
  let stopping = false;
  applyJob.application = { state: "idle", message: "Uygulama henüz başlatılmadı." };

  function applicationSecrets() {
    for (const [key, value] of Object.entries(parseDotEnvFile(envPath))) {
      if (/password|secret|token|key|database_url/i.test(key) && value.length >= 3) knownApplicationSecrets.add(value);
    }
    return [...knownApplicationSecrets].sort((a, b) => b.length - a.length);
  }

  function maskApplicationText(chunk) {
    return redactSecrets(String(chunk), applicationSecrets());
  }

  function appendApplicationLog(chunk, stream = "application", flush = false) {
    const secrets = applicationSecrets();
    const raw = (outputBuffers.get(stream) || "") + String(chunk);
    const maxLength = Math.max(1, ...secrets.map((value) => value.length));
    let boundary = raw.lastIndexOf("\n") + 1;
    if (!boundary || secrets.some((value) => value.includes("\n"))) boundary = Math.max(0, raw.length - maxLength + 1);
    if (flush) boundary = raw.length;
    for (const secret of secrets) {
      const index = raw.lastIndexOf(secret, boundary - 1);
      if (index >= 0 && index < boundary && index + secret.length > boundary) boundary = index;
    }
    outputBuffers.set(stream, raw.slice(boundary));
    if (!boundary) return;
    const text = `[${stream}] ${redactSecrets(raw.slice(0, boundary), secrets)}`;
    applyJob.logs.push(text);
    if (applyJob.logs.length > 1000) applyJob.logs.shift();
    options.onAppLog?.(text);
  }

  function applicationState(state, message) {
    if (stopping) return;
    applyJob.application = { state, message: maskApplicationText(message) };
    options.onApplicationState?.(applyJob.application);
  }

  async function applicationHealth() {
    const probe = (url, extra = {}) => probeApplicationUrl(url, {
      timeout: applyJob.application.state === "starting" ? Math.max(1, Math.min(1000, startupDeadline - Date.now())) : 1000,
      ...extra,
    });
    const appPort = applyJob.appPort || readConfiguredPort(projectRoot, { dataDir }) || Number(setupConfig?.ports?.app) || 5000;
    const mode = applyJob.mode || "localhost";
    const sub = dualController?.getSubprocesses();
    const invocation = activeInvocation || options.startAppInvocation || resolveAppStartInvocation(projectRoot, setupConfig);
    const paired = invocation?.type === "dual" || invocation?.type === "dual-static";
    const configuredDevPort = applyJob.frontendPort || detection.routes.devPort;
    let uiPort = paired ? (configuredDevPort || appPort + 1) : appPort;
    const loginPath = detection.scenario.isStaticOnly ? "" : (detection.routes.loginPath || "");
    let localUrl = buildLoginUrl(`http://127.0.0.1:${uiPort}`, loginPath);
    const apiReachable = await probe(`http://127.0.0.1:${appPort}/`, { allowNotFound: true });
    let uiReachable = await probe(localUrl);
    if (!uiReachable && !paired && configuredDevPort && configuredDevPort !== appPort) {
      const devUrl = buildLoginUrl(`http://127.0.0.1:${configuredDevPort}`, loginPath);
      if (await probe(devUrl)) {
        uiReachable = true;
        uiPort = configuredDevPort;
        localUrl = devUrl;
      }
    }
    // Some proxies preserve APP_BASE_PATH; others strip it before forwarding.
    if (!uiReachable && mode !== "localhost" && applyJob.loginUrl) {
      const configured = new URL(applyJob.loginUrl);
      const mountedUrl = `http://127.0.0.1:${uiPort}${configured.pathname}${configured.search}`;
      if (mountedUrl !== localUrl) uiReachable = await probe(mountedUrl);
    }
    const alive = sub ? sub.backend.alive && (!sub.frontend || sub.frontend.alive) : (!appChild || (appChild.exitCode === null && !appChild.killed && !appChild.signalCode));
    const requiresApi = paired || !detection.scenario.isStaticOnly;
    const serviceReachable = (!requiresApi || apiReachable) && uiReachable && alive;
    const loginUrl = mode === "localhost" ? localUrl : (applyJob.loginUrl || localUrl);
    const publicReachable = mode === "localhost" ? uiReachable : await probe(loginUrl);
    const reachable = serviceReachable && publicReachable;
    return {
      reachable, apiReachable, uiReachable, serviceReachable, publicReachable, port: appPort, uiPort, mode,
      loginUrl,
      publicUrl: applyJob.publicUrl, subprocesses: sub || null,
      application: applyJob.application,
      hint: reachable ? "Uygulama HTTP üzerinden erişime hazır." : (applyJob.application.state === "error" ? `Süreç kapandı veya erişim doğrulanamadı: ${applyJob.application.message}` : serviceReachable ? "Uygulama yerelde hazır; yapılandırılan adresin DNS/proxy/HTTP erişimi bekleniyor." : "Uygulama başlatılıyor; HTTP erişimi henüz doğrulanmadı."),
    };
  }

  async function listenStaticApplication(directory, port) {
    const listener = createStaticAppServer(directory);
    spawnedStaticServer = listener;
    try {
      await new Promise((resolve, reject) => {
        listener.once("error", reject);
        listener.listen(port, "127.0.0.1", resolve);
      });
    } catch (error) {
      if (spawnedStaticServer === listener) spawnedStaticServer = null;
      throw error;
    }
    if (stopping) { listener.close(); return false; }
    return true;
  }

  async function performStart() {
    const reply = (status, body) => ({ status, body });
    if (completeTimer) {
      clearTimeout(completeTimer);
      completeTimer = null;
    }
    if (applyJob.status !== "success" && !fs.existsSync(lockPath)) {
      return reply(409, { message: "Uygulamayı başlatmadan önce kurulum adımlarını tamamlayın." });
    }
    if (isDesktop) {
      const result = await desktopApp.start();
      return reply(result.status, result.body);
    }

    const appPort = applyJob.appPort || readConfiguredPort(projectRoot, { dataDir }) || Number(setupConfig?.ports?.app) || 5000;
    const invocation = withApplicationPort(options.startAppInvocation || resolveAppStartInvocation(projectRoot, setupConfig), appPort);
    activeInvocation = invocation;
    const existingHealth = await applicationHealth();
    if (stopping) return reply(409, { message: "Kurulum süreci kapatılıyor.", reachable: false });
    if (Date.now() >= startupDeadline && !existingHealth.reachable) return reply(408, { message: "Uygulama HTTP erişimi başlatma süresi içinde doğrulanamadı.", reachable: false });
    if (existingHealth.serviceReachable) {
      const holder = findListeningProcess(appPort);
      return reply(existingHealth.reachable ? 200 : 202, {
        message: existingHealth.reachable ? "Uygulama zaten çalışıyor." : existingHealth.hint,
        reachable: existingHealth.reachable,
        pid: appChild?.pid ?? holder?.pid ?? process.pid,
        loginUrl: existingHealth.loginUrl,
        publicUrl: applyJob.publicUrl,
      });
    }

    if (dualController && !dualController.alive()) {
      await dualController.stop();
      dualController = null;
      appChild = null;
    }
    if (appChild && (appChild.exitCode !== null || appChild.signalCode || appChild.killed) && spawnedStaticServer) {
      await new Promise((resolve) => spawnedStaticServer.close(resolve));
      spawnedStaticServer = null;
    }
    if (stopping) return reply(409, { message: "Kurulum süreci kapatılıyor.", reachable: false });
    if ((!appChild || appChild.exitCode !== null || appChild.signalCode || appChild.killed) && !spawnedStaticServer && (!dualController || !dualController.alive())) {
      if (!invocation) {
        return reply(409, {
          message: "Hedef projede başlatma komutu (scripts.start veya giriş dosyası) bulunamadı.",
          reachable: false,
        });
      }
      if (invocation.type === "static") {
        if (!await listenStaticApplication(invocation.staticDir, appPort)) return reply(409, { message: "Kurulum süreci kapatılıyor.", reachable: false });
        const health = await applicationHealth();
        return reply(health.reachable ? 200 : 202, {
          message: health.hint,
          reachable: health.reachable,
          pid: process.pid,
          loginUrl: health.loginUrl,
          publicUrl: applyJob.publicUrl,
        });
      }
      if (invocation.type === "dual") {
        const dotEnvVars = parseDotEnvFile(envPath);
        const shimsDir = path.resolve(projectRoot, "bin", "shims");
        const localShims = path.resolve(fileURLToPath(import.meta.url), "..", "..", "bin", "shims");
        const prepend = [];
        if (fs.existsSync(shimsDir)) prepend.push(shimsDir);
        if (fs.existsSync(localShims) && !prepend.includes(localShims)) prepend.push(localShims);

        const backendPort = appPort;
        const frontendPort = applyJob.frontendPort || detection.routes?.devPort || (appPort + 1);

        dualController = createDualProcessController({
          projectRoot,
          backendInvocation: invocation.backend,
          frontendInvocation: invocation.frontend,
          backendPort,
          frontendPort,
          envVars: dotEnvVars,
          prependPaths: prepend,
          appendLog: (msg, stream, flush) => {
            appendApplicationLog(msg, stream, flush);
          },
        });

        const pids = await dualController.start();
        appChild = {
          pid: pids.backendPid,
          exitCode: null,
          signalCode: null,
          kill: () => dualController?.stop(),
        };

        for (let i = 0; i < 20 && Date.now() < startupDeadline; i++) {
          await new Promise((r) => setTimeout(r, Math.max(1, Math.min(200, startupDeadline - Date.now()))));
          if (stopping || !dualController) return reply(409, { message: "Kurulum süreci kapatılıyor.", reachable: false });
          const sub = dualController.getSubprocesses();
          if (!sub.backend.alive || (sub.frontend && !sub.frontend.alive)) {
            const crashed = !sub.backend.alive ? sub.backend : sub.frontend;
            const which = !sub.backend.alive ? "Backend" : "Frontend";
            const errDetail = crashed.errorDetail || `Çıkış kodu: ${crashed.exitCode ?? crashed.signal}`;
            return reply(409, {
              code: "APP_CRASHED",
              message: `${which} süreci başlatılırken çöktü veya kapandı (${errDetail}). Kademeli kapanma uygulandı.`,
              reachable: false,
              pid: pids.backendPid,
              subprocesses: sub,
              errorDetail: errDetail,
            });
          }
          const health = await applicationHealth();
          if (health.reachable) {
            return reply(200, {
              message: "Çift süreçli uygulama (Backend + Frontend) başlatıldı ve bağlantıya hazır.",
              reachable: true,
              pid: pids.backendPid,
              subprocesses: sub,
              loginUrl: (await applicationHealth()).loginUrl,
              publicUrl: applyJob.publicUrl,
            });
          }
        }

        return reply(202, {
          message: "Çift süreç başlatıldı ancak portlar henüz hazır değil. Lütfen biraz bekleyin.",
          reachable: false,
          pid: pids.backendPid,
          subprocesses: dualController.getSubprocesses(),
          loginUrl: (await applicationHealth()).loginUrl,
          publicUrl: applyJob.publicUrl,
        });
      }
      if (invocation.type === "dual-static") {
        const staticPort = detection.routes?.devPort || (appPort + 1);
        if (!await listenStaticApplication(invocation.staticDir, staticPort)) return reply(409, { message: "Kurulum süreci kapatılıyor.", reachable: false });

        const dotEnvVars = parseDotEnvFile(envPath);
        const shimsDir = path.resolve(projectRoot, "bin", "shims");
        const localShims = path.resolve(fileURLToPath(import.meta.url), "..", "..", "bin", "shims");
        const prepend = [];
        if (fs.existsSync(shimsDir)) prepend.push(shimsDir);
        if (fs.existsSync(localShims) && !prepend.includes(localShims)) prepend.push(localShims);
        const childEnv = normalizeProcessEnv(process.env, { ...dotEnvVars, PORT: String(appPort) }, prepend);

        appChildStderr = "";
        appChild = spawn(invocation.backend.command, invocation.backend.args, {
          cwd: invocation.backend.cwd || projectRoot,
          env: childEnv,
          detached: process.platform !== "win32",
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
        appChild.stdout?.on("data", (chunk) => appendApplicationLog(chunk, "stdout"));
        appChild.stdout?.on("close", () => appendApplicationLog("", "stdout", true));
        appChild.stderr?.on("close", () => appendApplicationLog("", "stderr", true));
        appChild.stderr?.on("data", (chunk) => {
          appendApplicationLog(chunk, "stderr");
          appChildStderr += chunk.toString();
          if (appChildStderr.length > 4000) appChildStderr = appChildStderr.slice(-4000);
        });
        appChild.on("error", (error) => { appChildStderr = error.message; appendApplicationLog(error.message); });
        appChild.unref();
      } else {
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
        appChild.stdout?.on("data", (chunk) => appendApplicationLog(chunk, "stdout"));
        appChild.stdout?.on("close", () => appendApplicationLog("", "stdout", true));
        appChild.stderr?.on("close", () => appendApplicationLog("", "stderr", true));
        appChild.stderr?.on("data", (chunk) => {
          appendApplicationLog(chunk, "stderr");
          appChildStderr += chunk.toString();
          if (appChildStderr.length > 4000) appChildStderr = appChildStderr.slice(-4000);
        });
        appChild.on("error", (error) => { appChildStderr = error.message; appendApplicationLog(error.message); });
        appChild.unref();
      }
    }

    for (let i = 0; i < 16 && Date.now() < startupDeadline; i++) {
      await new Promise((r) => setTimeout(r, Math.max(1, Math.min(200, startupDeadline - Date.now()))));
      if (stopping) return reply(409, { message: "Kurulum süreci kapatılıyor.", reachable: false });
      if (appChild && (appChild.exitCode !== null || appChild.signalCode)) {
        const errDetail = appChildStderr.trim().split(/\r?\n/).slice(-5).join(" | ");
        const reason = errDetail ? `Hata: ${errDetail}` : `Çıkış kodu: ${appChild.exitCode}`;
        return reply(409, {
          code: "APP_CRASHED",
          message: `Uygulama başlatılırken çöktü veya kapandı (${reason}).`,
          reachable: false,
          pid: appChild?.pid ?? null,
          exitCode: appChild.exitCode,
          signal: appChild.signalCode ?? null,
          errorDetail: errDetail || null,
        });
      }
      if ((await applicationHealth()).reachable) {
        return reply(200, {
          message: "Uygulama başlatıldı ve bağlantıya hazır.",
          reachable: true,
          pid: appChild?.pid ?? null,
          loginUrl: (await applicationHealth()).loginUrl,
          publicUrl: applyJob.publicUrl,
        });
      }
    }

    return reply(202, {
      message: "Başlatıldı ancak port henüz açılmadı. Birkaç saniye sonra tekrar denetleyin.",
      reachable: false,
      pid: appChild?.pid ?? null,
      loginUrl: (await applicationHealth()).loginUrl,
      publicUrl: applyJob.publicUrl,
    });
  }

  function startApplication() {
    if (startPromise) return startPromise;
    if (stopping) return Promise.resolve({ status: 409, body: { message: "Kurulum süreci kapatılıyor.", reachable: false } });
    const timeout = Number(options.appStartTimeoutMs ?? process.env.SETUP_APP_START_TIMEOUT_MS);
    startupDeadline = Date.now() + (Number.isFinite(timeout) && timeout > 0 ? Math.max(100, timeout) : 60000);
    startPromise = (async () => {
      applicationState("starting", "Kurulum tamamlandı; uygulama başlatılıyor ve HTTP erişimi denetleniyor…");
      try {
        const result = await performStart();
        if (result.status === 202 && Date.now() >= startupDeadline) {
          result.status = 408;
          result.body.message = "Uygulama belirtilen sürede HTTP erişimine hazır olmadı. Terminal günlüğünü ve gerekiyorsa DNS/proxy ayarlarını kontrol edip yeniden deneyin.";
        }
        if (result.body.message) result.body.message = maskApplicationText(result.body.message);
        if (result.body.errorDetail) result.body.errorDetail = maskApplicationText(result.body.errorDetail);
        applicationState(result.body.reachable ? "ready" : result.status >= 400 ? "error" : "starting", result.body.message);
        if (!isDesktop && result.status === 202) void monitorApplicationReadiness();
        return result;
      } catch (error) {
        const message = redactSecrets(error.message, Object.values(parseDotEnvFile(envPath)));
        applicationState("error", message);
        return { status: 409, body: { message, reachable: false } };
      } finally { startPromise = null; }
    })();
    return startPromise;
  }

  function monitorApplicationReadiness() {
    if (readinessPromise) return readinessPromise;
    readinessPromise = (async () => {
      while (!stopping && Date.now() < startupDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        const health = await applicationHealth();
        if (health.reachable) { applicationState("ready", "Uygulama başlatıldı ve HTTP erişimi doğrulandı."); return; }
        const sub = health.subprocesses;
        if ((appChild && (appChild.exitCode !== null || appChild.signalCode)) || (sub && (!sub.backend.alive || (sub.frontend && !sub.frontend.alive)))) {
          applicationState("error", redactSecrets(appChildStderr || "Uygulama süreci başlatılırken kapandı.", Object.values(parseDotEnvFile(envPath))));
          return;
        }
      }
      if (!stopping) applicationState("error", "Uygulama belirtilen sürede HTTP erişimine hazır olmadı. Terminal günlüğünü ve gerekiyorsa DNS/proxy ayarlarını kontrol edip yeniden deneyin.");
    })().catch((error) => applicationState("error", error.message)).finally(() => { readinessPromise = null; });
    return readinessPromise;
  }

  const server = http.createServer(async (req, res) => {
    try {
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
          res.statusCode = 401;
          const accept = String(req.headers.accept || "");
          if (accept.includes("text/html")) {
            setSecurityHeaders(res, "text/html; charset=utf-8");
            return res.end(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Yetkisiz Erişim — Kurulum Sihirbazı</title><style>body{margin:0;padding:40px;background:#0f172a;color:#f8fafc;font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;min-height:80vh}.card{background:#1e293b;border:1px solid #334155;border-radius:16px;padding:32px;max-width:520px;text-align:center;box-shadow:0 10px 25px rgba(0,0,0,0.5)}h1{color:#f43f5e;font-size:20px;margin-bottom:12px}p{color:#94a3b8;font-size:14px;line-height:1.6}code{background:#0f172a;color:#38bdf8;padding:3px 6px;border-radius:6px;font-size:13px}</style></head><body><div class="card"><h1>🔒 Yetkisiz veya Süresi Dolmuş Kurulum Bağlantısı</h1><p>Kurulum sihirbazına doğrudan veya süresi dolmuş oturumla erişilemez.<br><br>Lütfen terminal pencerenizde üretilen tek kullanımlık <code>/setup?token=...</code> bağlantısını kullanın.</p></div></body></html>`);
          }
          setSecurityHeaders(res, "text/plain; charset=utf-8");
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
            projectName: detection.projectName || null,
            repositoryName: path.basename(projectRoot),
            kind: detection.kind,
            scenario: detection.scenario,
            defaultPort,
            routes: detection.routes || null,
            envVariables: envExample.variables || [],
            seedScript: detectedSeed,
            toolchain: toolchain.details,
            candidateRoot: detection.candidateRoot || null,
            subprojects: detection.subprojects || null,
            subprojectList: detection.subprojectList || null,
            candidates: detection.candidates || null,
            hasAmbiguity: Boolean(detection.hasAmbiguity),
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

      if (req.method === "POST" && reqUrl.pathname === "/api/select-candidate") {
        try {
          const body = await readJson(req);
          const chosenCandidate = String(body?.candidate || "").trim();
          if (!chosenCandidate) {
            return sendJson(res, 400, { message: "Geçerli bir candidate yolu belirtilmelidir." });
          }
          detection = detectProject(projectRoot, { candidate: chosenCandidate });
          const newPaths = getSetupPaths(projectRoot, { dataDir });
          serverRoot = newPaths.serverRoot;
          dataRoot = newPaths.dataRoot;
          envPath = newPaths.env;
          lockPath = newPaths.lock;
          pendingPath = newPaths.pending;
          artifactRoot = newPaths.setupArtifacts;
          databaseUrl = newPaths.databaseUrl;
          return sendJson(res, 200, {
            message: `Aday alt proje seçildi: ${detection.projectName} (${chosenCandidate})`,
            detected: {
              projectName: detection.projectName,
              candidateRoot: detection.candidateRoot,
              kind: detection.kind,
              scenario: detection.scenario,
            },
          });
        } catch (err) {
          return sendJson(res, 500, { message: `Aday seçilemedi: ${err.message}` });
        }
      }

      if (req.method === "GET" && reqUrl.pathname === "/api/app-health" && isDesktop) {
        const result = desktopApp.health();
        return sendJson(res, result.status, result.body);
      }

      if (req.method === "GET" && reqUrl.pathname === "/api/app-health") {
        return sendJson(res, 200, await applicationHealth());
      }

      if (req.method === "POST" && reqUrl.pathname === "/api/start-app") {
        const result = await startApplication();
        return sendJson(res, result.status, result.body);
      }

      if (req.method === "POST" && reqUrl.pathname === "/api/apply") {
        if (applyJob.status === "running") {
          return sendJson(res, 409, { message: "Kurulum zaten uygulanıyor; pencereyi kapatmayın." });
        }
        try {
          const rawBody = await readJson(req);
          const payload = setupPayloadSchema.parse(rawBody, { allowOptionalAdmin: true });
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
              applyJob.message = "Kurulum tamamlandı. Uygulamanın başlatılması ve erişim denetimi bekleniyor.";
              applyJob.finishedAt = new Date().toISOString();
              if (!isDesktop) void startApplication();
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
    } catch (fatalErr) {
      if (!res.headersSent) {
        sendJson(res, 500, { message: "Sunucu hatası: " + (fatalErr instanceof Error ? fatalErr.message : String(fatalErr)) });
      }
    }
  });

  server.hasSpawnedApp = () => Boolean(spawnedStaticServer || dualController?.alive() || (appChild && appChild.exitCode === null));

  server.stopSpawnedApp = async () => {
    stopping = true;
    if (completeTimer) {
      clearTimeout(completeTimer);
      completeTimer = null;
    }
    if (dualController) {
      const dc = dualController;
      dualController = null;
      await dc.stop();
      appChild = null;
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
    // Stop the tree before its cmd/npm leader exits, otherwise Windows loses the descendants.
    if (process.platform === "win32" && pid && child.exitCode === null) {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    }
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

  server.once("close", () => { void server.stopSpawnedApp(); });
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
  let detection = detectProject(projectRoot, { candidate: options.candidate });
  const dataDir = resolveDesktopDataDir({ detection, setupConfig, explicit: options.dataDir });
  const paths = getSetupPaths(projectRoot, { dataDir });
  fs.mkdirSync(paths.dataRoot, { recursive: true });
  if (fs.existsSync(paths.lock) && !isReconfigure) {
    throw new Error("Kurulum kilidi mevcut. Çalışan sistemi yeniden yapılandırmak için --reconfigure parametresini kullanın veya önce temiz kurulum adımını çalıştırın.");
  }
  const token = process.env.SETUP_TOKEN || crypto.randomBytes(24).toString("base64url");
  const host = "127.0.0.1";
  const port = resolveWizardPort({ port: options.port, config: setupConfig || {} });
  let server;
  server = createSetupServer(token, {
    projectRoot,
    dataDir,
    reconfigure: isReconfigure,
    ...options,
    onAppLog: (text) => { console.log(`[uygulama] ${text}`); options.onAppLog?.(text); },
    onApplicationState: (state) => {
      console.log(`[setup:uygulama:${state.state}] ${state.message}`);
      if (process.connected) process.send({ type: "setup:application", ...state }, () => {});
      options.onApplicationState?.(state);
    },
    onComplete: () => {
      if (!server.hasSpawnedApp?.()) {
        server.close();
      }
    },
  });
  server.listen(port, host, () => {
    console.log(`Kurulum sihirbazı: http://${host}:${port}/setup?token=${token}`);
    console.log("Bu bağlantıyı paylaşmayın. Kurulum tamamlandığında uygulama otomatik başlatılır; bu terminali açık tutun.");
  });
  return server;
}

export function manageSetupWizardLifecycle(server) {
  let shuttingDown = false;
  const shutdown = async (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    await server.stopSpawnedApp();
    server.close();
    server.closeAllConnections?.();
    process.exit(code);
  };
  const onInt = () => void shutdown(130);
  const onTerm = () => void shutdown(143);
  const onHup = () => void shutdown(129);
  const onMessage = (message) => { if (message?.type === "setup:shutdown") void shutdown(); };
  const onDisconnect = () => void shutdown();
  process.once("SIGINT", onInt);
  process.once("SIGTERM", onTerm);
  process.once("SIGHUP", onHup);
  process.on("message", onMessage);
  // Closing the terminal parent also closes its IPC channel.
  if (process.connected) process.once("disconnect", onDisconnect);
  server.once("close", () => {
    process.removeListener("SIGINT", onInt);
    process.removeListener("SIGTERM", onTerm);
    process.removeListener("SIGHUP", onHup);
    process.removeListener("message", onMessage);
    process.removeListener("disconnect", onDisconnect);
    if (process.connected) process.disconnect();
  });
  return server;
}

if (import.meta.url && process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  manageSetupWizardLifecycle(startSetupWizard());
}
