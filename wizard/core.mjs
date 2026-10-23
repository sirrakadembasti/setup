import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getProjectRoot } from "../utils/project-paths.mjs";
import { getSetupPaths, readConfiguredPort } from "../scripts/setup-bootstrap-lib.mjs";
import { detectProject, loadSetupConfig, parseEnvExample } from "../scripts/detect-project.mjs";
import { verifyAdminPassword, ValidationError, setupPayloadSchema } from "./config.mjs";
import { renderSetupPage } from "./ui.mjs";
import { createDesktopAppController, parseDotEnvFile, readJsonFileSafe, resolveDesktopDataDir } from "./app-process.mjs";
import {
  createApplyState,
  detectRequiredToolchain,
  equalSecret,
  executeSetupApply,
  testDatabaseConnection,
  testEmailConfiguration,
  validateStepData,
  writable,
} from "./shared.mjs";

export const parseEnvFile = parseDotEnvFile;

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
  const { projectRoot, dataDir: rawDataDir } = normalizeRootAndOptions(rootOrOptions);
  let dataDir = rawDataDir;
  if (!dataDir && !process.env.SETUP_DATA_DIR) {
    const detection = detectProject(projectRoot);
    const setupConfig = loadSetupConfig(projectRoot);
    dataDir = resolveDesktopDataDir({ detection, setupConfig, explicit: null });
  }
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

export function createSetupWizardCore(options = {}) {
  const projectRoot = options.projectRoot ? path.resolve(options.projectRoot) : getProjectRoot();
  // Tahmin edilebilir sabit anahtar yok: verilmezse işlem başına rastgele üretilir.
  // Sunucusuz (serverless) ortamlarda örnekler arası tutarlılık için `token` seçeneğini verin.
  const token = options.token || crypto.randomBytes(24).toString("base64url");
  const requireAuth = Boolean(options.requireAuth && !options.ipcMode && options.auth !== false);
  // IPC (Electron) dışındaki her kullanım HTTP üzerinden erişilebilir kabul edilir; CSRF + Origin zorunludur.
  const enforceCsrf = !options.ipcMode && options.enforceCsrf !== false;
  const allowedOrigins = [].concat(options.allowedOrigins || []).map((o) => String(o).trim()).filter(Boolean);
  const setupConfig = loadSetupConfig(projectRoot);
  const detection = detectProject(projectRoot);
  // Masaüstü senaryosunda açık bir veri dizini yoksa kullanıcı veri dizini (AppData vb.) kullanılır.
  const dataDir = resolveDesktopDataDir({ detection, setupConfig, explicit: options.dataDir });
  const paths = getSetupPaths(projectRoot, { dataDir });
  const isDesktop = Boolean(detection.scenario.isDesktop);
  const desktopApp = createDesktopAppController({
    projectRoot,
    setupConfig,
    getEnvPath: () => getSetupPaths(projectRoot, { dataDir }).env,
    dataDir,
    graceMs: Number(options.desktopGraceMs ?? 3000),
    startInvocation: options.startAppInvocation || null,
  });

  const csrfToken = crypto.createHmac("sha256", token).update("setup-wizard-csrf").digest("hex");
  const isReconfigure = Boolean(
    options.reconfigure ||
    process.env.SETUP_RECONFIGURE === "true" ||
    process.env.SETUP_RECONFIGURE === "1"
  );
  const applyJob = createApplyState();
  let activeApplyPromise = null;

  function markStep(id, status, detail) {
    applyJob.steps = applyJob.steps.map((step) =>
      step.id === id ? { ...step, status, detail: detail ?? step.detail } : step,
    );
  }

  async function executeApply(payload) {
    return executeSetupApply({
      projectRoot,
      dataDir,
      detection,
      setupConfig,
      options: { ...options, reconfigure: isReconfigure || options.reconfigure },
      applyJob,
      payload,
      markStep,
    });
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
    const isDesktopAppRoute = isDesktop && ((method === "GET" && pathname === "/api/app-health") || (method === "POST" && pathname === "/api/start-app"));
    if (!isDesktopAppRoute && fs.existsSync(getSetupPaths(projectRoot, { dataDir }).lock) && !isReconfigure) {
      if (method === "GET" && pathname === "/api/status") {
        return { status: 200, headers: jsonHeaders, body: { installed: true, title, apply: applyJob } };
      }
      return { status: 404, headers: jsonHeaders, body: { ok: false, installed: true, message: "Kurulum tamamlandı; sihirbaz kapalı." } };
    }

    if (enforceCsrf && method !== "GET" && method !== "HEAD") {
      const origin = String(headers.origin || "").trim();
      const referer = String(headers.referer || "").trim();
      const host = String(headers.host || "").trim().toLowerCase();
      let effectiveOrigin = origin;
      if (!effectiveOrigin && referer) {
        try {
          effectiveOrigin = new URL(referer).origin;
        } catch {}
      }

      let originOk = false;
      if (effectiveOrigin) {
        try {
          const parsed = new URL(effectiveOrigin);
          const isLocalhost =
            ["http:", "https:"].includes(parsed.protocol) &&
            ["127.0.0.1", "localhost"].includes(parsed.hostname);
          const matchesHost = Boolean(host) && parsed.host.toLowerCase() === host;
          originOk = allowedOrigins.includes(effectiveOrigin) || matchesHost || (isLocalhost && !host);
        } catch {
          originOk = false;
        }
      } else if (!host && !options.requireOrigin) {
        originOk = true;
      }

      const csrf = String(headers["x-setup-csrf"] || "");
      if (!originOk || !equalSecret(csrf, csrfToken)) {
        return { status: 403, headers: jsonHeaders, body: { ok: false, message: "Kurulum isteği güvenlik doğrulamasından geçmedi." } };
      }
    }

    // Masaüstü (Electron/Tauri): port yerine süreç denetlenir. Kurulum kilidi sonrası da erişilebilir.
    if (isDesktop && method === "GET" && pathname === "/api/app-health") {
      const result = desktopApp.health();
      return { status: result.status, headers: jsonHeaders, body: result.body };
    }

    if (isDesktop && method === "POST" && pathname === "/api/start-app") {
      if (applyJob.status !== "success" && !fs.existsSync(getSetupPaths(projectRoot, { dataDir }).lock)) {
        return { status: 409, headers: jsonHeaders, body: { message: "Uygulamayı başlatmadan önce kurulum adımlarını tamamlayın." } };
      }
      const result = await desktopApp.start();
      return { status: result.status, headers: jsonHeaders, body: result.body };
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
      const rootPkg = readJsonFileSafe(path.join(projectRoot, "package.json"));
      const serverPkg = readJsonFileSafe(path.join(projectRoot, "server", "package.json"));
      const detectedSeed = setupConfig?.seed
        ? (typeof setupConfig.seed === "string" ? setupConfig.seed : setupConfig.seed.command)
        : (["prisma:seed", "db:seed", "seed"].find((name) => Boolean(rootPkg?.scripts?.[name] || serverPkg?.scripts?.[name])) || null);
      const toolchain = detectRequiredToolchain(detection);
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
            seedScript: detectedSeed,
            toolchain: toolchain.details,
          },
          checks: {
            nodeSupported: Number(process.versions.node.split(".")[0]) >= 18,
            dataWritable: writable(currentPaths.dataRoot),
            uploadsWritable: writable(currentPaths.uploadsRoot),
            notInstalled: isReconfigure ? true : !installed,
            envAbsent: isReconfigure ? true : !fs.existsSync(currentPaths.env),
            toolchainAvailable: toolchain.available,
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

    if (method === "POST" && pathname === "/api/test-database") {
      const dbConfig = body?.database ?? body ?? {};
      const result = await testDatabaseConnection(dbConfig, projectRoot);
      return {
        status: result.ok ? 200 : 400,
        headers: jsonHeaders,
        body: result,
      };
    }

    if (method === "POST" && pathname === "/api/validate-email-format") {
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
            ? "E-posta ayarlarının biçimi doğrulandı (SMTP bağlantısı denenmedi)."
            : "E-posta gönderimi devre dışı olarak doğrulandı.",
        },
      };
    }

    if (method === "POST" && (pathname === "/api/test-email" || pathname === "/api/test-smtp")) {
      const emailConfig = body?.email ?? body ?? {};
      if (emailConfig.enabled === false) {
        return {
          status: 200,
          headers: jsonHeaders,
          body: {
            ok: true,
            reachable: false,
            connectionTested: false,
            message: "E-posta gönderimi devre dışı olarak doğrulandı.",
          },
        };
      }
      const issues = validateStepData("email", emailConfig);
      if (issues.length > 0) {
        return {
          status: 400,
          headers: jsonHeaders,
          body: {
            ok: false,
            reachable: false,
            message: issues[0].message,
            errors: issues.map((i) => i.message),
          },
        };
      }
      const result = await testEmailConfiguration(emailConfig);
      return {
        status: result.ok ? 200 : 400,
        headers: jsonHeaders,
        body: result,
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
        applyJob.logs = [];
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
    stopApp: () => desktopApp.stop(),
    dataDir,
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
