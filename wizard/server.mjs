import { spawn } from "node:child_process";
import crypto, { timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { getProjectRoot } from "../utils/project-paths.mjs";
import { buildDeploymentArtifacts, saveDeploymentConfig } from "../utils/deployment-config.mjs";
import { getSetupPaths } from "../scripts/setup-bootstrap-lib.mjs";
import { detectPackageManager, loadSetupConfig, parseEnvExample } from "../scripts/detect-project.mjs";
import { buildServerEnv, hashAdminPassword, publicAppUrl, setupPayloadSchema, toDeploymentConfig, ValidationError } from "./config.mjs";
import { renderSetupPage } from "./ui.mjs";

function digest(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest();
}

export function equalSecret(left, right) {
  if (!left || !right) return false;
  return timingSafeEqual(digest(left), digest(right));
}

function cookieValue(req, name) {
  const part = String(req.headers.cookie || "").split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : "";
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

export function sameOrigin(req, expectedPort) {
  try {
    const origin = req.headers.origin;
    if (!origin) return false;
    const parsed = new URL(String(origin));
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) return false;
    if (expectedPort && Number(parsed.port || 80) !== expectedPort) return false;
    return true;
  } catch {
    return false;
  }
}

export function resolvePnpmInvocation(args) {
  const pnpmScript = process.env.npm_execpath;
  if (pnpmScript && /pnpm(?:\.c?js)?$/i.test(pnpmScript)) {
    return { command: process.execPath, args: [pnpmScript, ...args] };
  }
  if (process.platform === "win32") {
    return { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", "pnpm", ...args] };
  }
  return { command: "pnpm", args };
}

export function pmRunInvocation(pm, scriptName, prefixDir = null) {
  const safePm = ["pnpm", "yarn", "bun", "npm"].includes(pm) ? pm : "npm";
  if (process.platform === "win32") {
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", safePm, "run", scriptName],
      cwd: prefixDir,
    };
  }
  return {
    command: safePm,
    args: ["run", scriptName],
    cwd: prefixDir,
  };
}

function readJsonFileSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
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
    if (body.length > 65_536) throw new Error("İstek gövdesi çok büyük.");
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
    const paths = getSetupPaths(projectRoot);
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
  const applyJob = createApplyState();

  const rateBuckets = new Map();
  function checkRateLimit(key, limit, windowMs) {
    const now = Date.now();
    const entry = rateBuckets.get(key);
    if (!entry || now >= entry.resetAt) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  }

  function markStep(id, status, detail) {
    applyJob.steps = applyJob.steps.map((step) =>
      step.id === id ? { ...step, status, detail: detail ?? step.detail } : step,
    );
  }

  async function applySetup(payload) {
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

    const passwordHash = hashAdminPassword(payload.admin.password);
    const envExample = parseEnvExample(projectRoot);
    const envText = buildServerEnv(
      { ...payload, admin: { ...payload.admin, passwordHash } },
      undefined,
      databaseUrl,
      envExample.variables,
    );
    const temporaryEnv = `${envPath}.setup-${process.pid}`;
    const summary = [];
    const appUrl = publicAppUrl(payload);
    applyJob.publicUrl = appUrl;
    applyJob.loginUrl = `${appUrl.replace(/\/$/, "")}/auth`;
    applyJob.appPort = payload.server.port;
    applyJob.mode = payload.deployment.mode;

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
      fs.writeFileSync(
        path.join(dataRoot, "admin.json"),
        `${JSON.stringify({ name: payload.admin.name, email: payload.admin.email, passwordHash, createdAt: new Date().toISOString() }, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      markStep("admin", "done", payload.admin.email);
      summary.push("İlk yönetici hesabı oluşturuldu.");

      markStep("artifacts", "running");
      const savedEnvRoot = process.env.SETUP_PROJECT_ROOT;
      process.env.SETUP_PROJECT_ROOT = projectRoot;
      try {
        const config = saveDeploymentConfig(toDeploymentConfig(payload), "setup-wizard", projectRoot);
        const artifacts = buildDeploymentArtifacts(config, payload.server.port);
        fs.mkdirSync(artifactRoot, { recursive: true });
        fs.writeFileSync(path.join(artifactRoot, "nginx.conf.example"), `${artifacts.nginxText}\n`, "utf8");
        fs.writeFileSync(path.join(artifactRoot, "deployment.env.example"), `${artifacts.envText}\n`, "utf8");
      } finally {
        if (savedEnvRoot === undefined) delete process.env.SETUP_PROJECT_ROOT;
        else process.env.SETUP_PROJECT_ROOT = savedEnvRoot;
      }
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
      try { fs.chmodSync(envPath, 0o600); } catch {}
      markStep("env", "done", ".env");
      summary.push("Gizli ayarlar .env dosyasına yazıldı.");

      markStep("finish", "running");
      fs.writeFileSync(lockPath, `${JSON.stringify({ installedAt: new Date().toISOString(), publicUrl: publicAppUrl(payload), nodeVersion: process.version }, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      markStep("finish", "done", "installation.lock yazıldı");
      return summary;
    } finally {
      if (pendingHandle !== undefined) fs.closeSync(pendingHandle);
      if (fs.existsSync(pendingPath)) fs.unlinkSync(pendingPath);
      if (fs.existsSync(temporaryEnv)) fs.unlinkSync(temporaryEnv);
    }
  }

  const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url || "/", "http://127.0.0.1");
    const clientIp = req.socket?.remoteAddress || "127.0.0.1";

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
      if (!equalSecret(cookieValue(req, "setup.wizard"), sessionValue)) {
        return sendJson(res, 401, { message: "Kurulum oturumu geçersiz." });
      }
      if (req.method !== "GET") {
        if (!checkRateLimit(`api-mut:${clientIp}`, 30, 15 * 60_000)) {
          return sendJson(res, 429, { message: "İstek sınırı aşıldı." });
        }
        if (!sameOrigin(req) || !equalSecret(String(req.headers["x-setup-csrf"] || ""), csrfToken)) {
          return sendJson(res, 403, { message: "Kurulum isteği güvenlik doğrulamasından geçmedi." });
        }
      }

      if (req.method === "GET" && reqUrl.pathname === "/api/status") {
        const networks = Object.values(os.networkInterfaces()).flat().filter((item) => item && !item.internal).map((item) => item.address);
        return sendJson(res, 200, {
          detected: { hostname: os.hostname(), platform: `${process.platform}/${process.arch}`, node: process.version, cpus: os.cpus().length, memoryGb: Math.round(os.totalmem() / 1024 ** 3), addresses: networks },
          checks: {
            nodeSupported: [18, 20, 22, 24].includes(Number(process.versions.node.split(".")[0])),
            dataWritable: writable(dataRoot),
            uploadsWritable: writable(path.join(serverRoot, "uploads")),
            notInstalled: !fs.existsSync(lockPath),
            envAbsent: !fs.existsSync(envPath),
          },
          apply: applyJob,
        });
      }

      if (req.method === "GET" && reqUrl.pathname === "/api/app-health") {
        const mode = applyJob.mode ?? "localhost";
        const appPort = applyJob.appPort ?? 5000;
        const devPort = 5173;
        const isLocal = mode === "localhost";
        const uiPort = isLocal ? devPort : appPort;
        const apiReachable = await isPortOpen(appPort);
        const uiReachable = isLocal ? await isPortOpen(uiPort) : apiReachable;
        const reachable = isLocal ? uiReachable : apiReachable;
        const loginUrl = isLocal && uiReachable ? `http://127.0.0.1:${devPort}/auth` : applyJob.loginUrl;
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
            : `Uygulama henüz ayakta değil (API: ${appPort}).`,
        });
      }

      if (req.method === "POST" && reqUrl.pathname === "/api/start-app") {
        if (applyJob.status !== "success" && !fs.existsSync(lockPath)) {
          return sendJson(res, 409, { message: "Uygulamayı başlatmadan önce kurulum adımlarını tamamlayın." });
        }
        return sendJson(res, 202, {
          message: "Başlatıldı ancak port henüz açılmadı. Birkaç saniye sonra tekrar denetleyin.",
          reachable: false,
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
          const payload = setupPayloadSchema.parse(rawBody);
          applyJob.status = "running";
          applyJob.message = "Kurulum uygulanıyor; adımlar ekranda canlı izleniyor…";
          applyJob.summary = [];
          applyJob.steps = createApplyState().steps;
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
              if (options.onComplete) setTimeout(() => options.onComplete(), 20_000);
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

  return server;
}

export function startSetupWizard() {
  const projectRoot = getProjectRoot();
  const paths = getSetupPaths(projectRoot);
  const setupConfig = loadSetupConfig(projectRoot);
  fs.mkdirSync(paths.dataRoot, { recursive: true });
  if (fs.existsSync(paths.lock)) {
    throw new Error("Kurulum kilidi mevcut. Çalışan sistemi yeniden yapılandırmak için önce temiz kurulum adımını kullanın.");
  }
  const token = process.env.SETUP_TOKEN || crypto.randomBytes(24).toString("base64url");
  const host = "127.0.0.1";
  const port = Math.min(65535, Math.max(1024, Number(process.env.SETUP_PORT) || Number(setupConfig?.ports?.wizard) || 5050));
  let server;
  server = createSetupServer(token, { projectRoot, onComplete: () => server.close() });
  server.listen(port, host, () => {
    console.log(`Kurulum sihirbazı: http://${host}:${port}/setup?token=${token}`);
    console.log("Bu bağlantıyı paylaşmayın. Kurulum tamamlandığında sihirbaz otomatik kapanır.");
  });
  return server;
}

if (import.meta.url && process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  startSetupWizard();
}
