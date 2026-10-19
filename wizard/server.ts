import crypto, { timingSafeEqual } from "crypto";
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { createServer, type Server } from "http";
import { fileURLToPath } from "url";
import express, { type Request } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { ZodError } from "zod";
import { getProjectRoot } from "../utils/project-paths";
import { buildDeploymentArtifacts, saveDeploymentConfig } from "../utils/deployment-config";
import { buildServerEnv, publicAppUrl, setupPayloadSchema, toDeploymentConfig, type SetupPayload } from "./config";
import { renderSetupPage } from "./ui";

const projectRoot = getProjectRoot();
const hasServerSubdir =
  fs.existsSync(path.join(projectRoot, "server", "package.json")) ||
  fs.existsSync(path.join(projectRoot, "server", "data"));
const serverRoot = hasServerSubdir ? path.join(projectRoot, "server") : projectRoot;
const dataRoot = path.join(serverRoot, "data");
const envPath = path.join(serverRoot, ".env");
const lockPath = path.join(dataRoot, "installation.lock");
const pendingPath = path.join(dataRoot, "installation.pending");
const artifactRoot = path.join(dataRoot, "setup-artifacts");

function readPackageName(dir: string, fallback: string) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    return pkg?.name || fallback;
  } catch {
    return fallback;
  }
}

function digest(value: string) {
  return crypto.createHash("sha256").update(value).digest();
}

function equalSecret(left: string, right: string) {
  return timingSafeEqual(digest(left), digest(right));
}

function cookieValue(req: Request, name: string) {
  const part = (req.headers.cookie || "").split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : "";
}

function writable(target: string) {
  try {
    fs.mkdirSync(target, { recursive: true });
    fs.accessSync(target, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function sameOrigin(req: Request, expectedPort?: number) {
  try {
    const origin = req.get("origin");
    if (!origin) return false;
    const parsed = new URL(origin);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) return false;
    if (expectedPort && Number(parsed.port || 80) !== expectedPort) return false;
    return true;
  } catch {
    return false;
  }
}

function resolvePnpmInvocation(args: string[]) {
  const pnpmScript = process.env.npm_execpath;
  if (pnpmScript && /pnpm(?:\.c?js)?$/i.test(pnpmScript)) {
    return { command: process.execPath, args: [pnpmScript, ...args] };
  }
  if (process.platform === "win32") {
    return { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", "pnpm", ...args] };
  }
  return { command: "pnpm", args };
}

async function fixedPnpm(args: string[], extraEnv: NodeJS.ProcessEnv) {
  const invocation = resolvePnpmInvocation(args);
  return new Promise<string>((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: projectRoot,
      env: { ...process.env, ...extraEnv },
      shell: false,
      windowsHide: true,
    });
    let output = "";
    const collect = (chunk: Buffer) => { output = `${output}${chunk.toString("utf8")}`.slice(-20_000); };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(output) : reject(new Error(`Sabit kurulum komutu başarısız oldu (${code}).\n${output}`)));
  });
}

async function createFirstAdmin(payload: SetupPayload, databaseUrl: string) {
  process.env.DATABASE_URL = databaseUrl;
  const prisma = new PrismaClient();
  try {
    const existingAdmin = await prisma.user.findFirst({ where: { role: "admin" }, select: { id: true } });
    if (existingAdmin) throw new Error("Veritabanında zaten bir yönetici var. Mevcut kurulum sihirbazla devralınamaz.");
    const email = payload.admin.email.toLowerCase();
    if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      throw new Error("Yönetici e-postası veritabanında zaten kullanılıyor.");
    }
    await prisma.user.create({
      data: {
        name: payload.admin.name,
        email,
        password: await bcrypt.hash(payload.admin.password, 12),
        role: "admin",
        emailVerified: true,
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

const APPLY_STEPS = [
  { id: "prepare", label: "Kurulum ortamı hazırlanıyor" },
  { id: "buildServer", label: "Sunucu derlemesi" },
  { id: "buildClient", label: "İstemci (web) derlemesi" },
  { id: "migrate", label: "Veritabanı migration'ları" },
  { id: "admin", label: "İlk yönetici hesabı" },
  { id: "artifacts", label: "Dağıtım profili ve Nginx örneği" },
  { id: "env", label: "Gizli ayarların yazılması (.env)" },
  { id: "finish", label: "Kurulum kilidi ve kapanış" },
] as const;

type ApplyStepState = {
  id: string;
  label: string;
  status: "pending" | "running" | "done" | "error" | "skipped";
  detail?: string;
};

type ApplyJobState = {
  status: "idle" | "running" | "success" | "error";
  message: string;
  steps: ApplyStepState[];
  summary: string[];
  loginUrl: string | null;
  publicUrl: string | null;
  appPort: number | null;
  mode: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

function createApplyState(): ApplyJobState {
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

function isPortOpen(port: number, timeoutMs = 700): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const done = (value: boolean) => {
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

async function readJson(req: any): Promise<any> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 16_384) throw new Error("İstek gövdesi çok büyük.");
  }
  return body ? JSON.parse(body) : {};
}

function markStep(applyJob: ApplyJobState, id: string, status: ApplyStepState["status"], detail?: string) {
  applyJob.steps = applyJob.steps.map((step) =>
    step.id === id ? { ...step, status, detail: detail ?? step.detail } : step,
  );
}

async function applySetup(payload: SetupPayload, applyJob: ApplyJobState) {
  fs.mkdirSync(dataRoot, { recursive: true });
  if (fs.existsSync(lockPath)) throw new Error("Kurulum daha önce tamamlanmış. Sihirbaz yeniden çalıştırılamaz.");
  if (fs.existsSync(envPath) && !payload.overwriteExistingEnv) throw new Error(".env zaten var. İçeriğini doğrulayın veya yedekleyerek değiştirme onayını seçin.");
  let pendingHandle: number | undefined;
  try {
    pendingHandle = fs.openSync(pendingPath, "wx", 0o600);
  } catch {
    throw new Error("Başka bir kurulum işlemi çalışıyor veya önceki işlem yarım kaldı.");
  }

  const databaseUrl = "file:../data/app.db";
  const envText = buildServerEnv(payload, undefined, databaseUrl);
  const temporaryEnv = `${envPath}.setup-${process.pid}`;
  const summary: string[] = [];
  const appUrl = publicAppUrl(payload);
  applyJob.publicUrl = appUrl;
  applyJob.loginUrl = `${appUrl.replace(/\/$/, "")}/auth`;
  applyJob.appPort = payload.server.port;
  applyJob.mode = payload.deployment.mode;

  const serverPkgName = readPackageName(serverRoot, "server");
  const clientPkgName = readPackageName(path.join(projectRoot, "client"), "client");

  try {
    markStep(applyJob, "prepare", "running");
    fs.writeFileSync(temporaryEnv, envText, { encoding: "utf8", mode: 0o600 });
    markStep(applyJob, "prepare", "done", "Geçici ortam dosyası hazırlandı.");

    if (payload.buildClient) {
      const configuredBasePath = toDeploymentConfig(payload).basePath;
      const buildEnv = { VITE_BASE_PATH: configuredBasePath === "/" ? "/" : `${configuredBasePath}/` };
      markStep(applyJob, "buildServer", "running");
      await fixedPnpm(["--filter", serverPkgName, "build"], buildEnv);
      markStep(applyJob, "buildServer", "done");
      markStep(applyJob, "buildClient", "running");
      await fixedPnpm(["--filter", clientPkgName, "build"], buildEnv);
      markStep(applyJob, "buildClient", "done");
      summary.push("Üretim derlemesi tamamlandı.");
    } else {
      markStep(applyJob, "buildServer", "skipped", "Üretim derlemesi istenmedi.");
      markStep(applyJob, "buildClient", "skipped", "Üretim derlemesi istenmedi.");
    }

    markStep(applyJob, "migrate", "running");
    await fixedPnpm(["--filter", serverPkgName, "db:deploy"], { DATABASE_URL: databaseUrl });
    markStep(applyJob, "migrate", "done");
    summary.push("Veritabanı migration'ları uygulandı.");

    markStep(applyJob, "admin", "running");
    await createFirstAdmin(payload, databaseUrl);
    markStep(applyJob, "admin", "done", payload.admin.email);
    summary.push("İlk yönetici hesabı oluşturuldu.");

    markStep(applyJob, "artifacts", "running");
    const config = saveDeploymentConfig(toDeploymentConfig(payload), "setup-wizard");
    const artifacts = buildDeploymentArtifacts(config);
    fs.mkdirSync(artifactRoot, { recursive: true });
    fs.writeFileSync(path.join(artifactRoot, "nginx.conf.example"), `${artifacts.nginxText}\n`, "utf8");
    fs.writeFileSync(path.join(artifactRoot, "deployment.env.example"), `${artifacts.envText}\n`, "utf8");
    markStep(applyJob, "artifacts", "done", "setup-artifacts");
    summary.push("Nginx örneği setup-artifacts altında üretildi.");

    markStep(applyJob, "env", "running");
    if (fs.existsSync(envPath)) {
      const backupRoot = path.join(serverRoot, "backups");
      fs.mkdirSync(backupRoot, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      fs.copyFileSync(envPath, path.join(backupRoot, `.env-${stamp}.bak`));
      summary.push("Eski .env dosyası backups altında yedeklendi.");
    }
    fs.renameSync(temporaryEnv, envPath);
    try { fs.chmodSync(envPath, 0o600); } catch {}
    markStep(applyJob, "env", "done", ".env");
    summary.push("Gizli ayarlar .env dosyasına yazıldı.");

    markStep(applyJob, "finish", "running");
    fs.writeFileSync(lockPath, `${JSON.stringify({ installedAt: new Date().toISOString(), publicUrl: publicAppUrl(payload), nodeVersion: process.version }, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    markStep(applyJob, "finish", "done", "installation.lock yazıldı");
    return summary;
  } finally {
    if (pendingHandle !== undefined) fs.closeSync(pendingHandle);
    if (fs.existsSync(pendingPath)) fs.unlinkSync(pendingPath);
    if (fs.existsSync(temporaryEnv)) fs.unlinkSync(temporaryEnv);
  }
}

export function createSetupApp(token: string, onComplete?: () => void) {
  if (token.length < 24) throw new Error("SETUP_TOKEN en az 24 karakter olmalıdır.");
  const sessionValue = crypto.createHmac("sha256", token).update("setup-wizard-session").digest("hex");
  const csrfToken = crypto.createHmac("sha256", token).update("setup-wizard-csrf").digest("hex");
  const applyJob = createApplyState();
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'unsafe-inline'"], styleSrc: ["'unsafe-inline'"], imgSrc: ["'self'", "data:"], frameAncestors: ["'none'"] } } }));
  app.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

  const strictLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });
  const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 15, standardHeaders: true, legacyHeaders: false });
  const statusLimiter = rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: true, legacyHeaders: false });
  app.use("/setup", (req, res, next) => {
    if (typeof req.query.token === "string") return authLimiter(req, res, next);
    return next();
  });
  app.use("/api/status", statusLimiter);
  app.use("/api", (req, res, next) => {
    if (req.path === "/status" || req.method === "GET") return next();
    return strictLimiter(req, res, next);
  });
  app.use(express.json({ limit: "64kb" }));

  app.get("/setup", (req, res) => {
    const supplied = typeof req.query.token === "string" ? req.query.token : "";
    if (supplied && equalSecret(supplied, token)) {
      res.cookie("setup.wizard", sessionValue, { httpOnly: true, sameSite: "strict", secure: false, maxAge: 30 * 60_000, path: "/" });
      return res.redirect(303, "/setup");
    }
    if (!equalSecret(cookieValue(req, "setup.wizard"), sessionValue)) return res.status(401).send("Geçersiz veya eksik kurulum anahtarı.");
    res.type("html").send(renderSetupPage(csrfToken));
  });

  app.use("/api", (req, res, next) => {
    if (!equalSecret(cookieValue(req, "setup.wizard"), sessionValue)) return res.status(401).json({ message: "Kurulum oturumu geçersiz." });
    if (req.method !== "GET" && (!sameOrigin(req) || !equalSecret(String(req.get("x-setup-csrf") || ""), csrfToken))) {
      return res.status(403).json({ message: "Kurulum isteği güvenlik doğrulamasından geçmedi." });
    }
    next();
  });

  app.get("/api/status", (_req, res) => {
    const networks = Object.values(os.networkInterfaces()).flat().filter((item) => item && !item.internal).map((item) => item!.address);
    res.json({
      detected: { hostname: os.hostname(), platform: `${process.platform}/${process.arch}`, node: process.version, cpus: os.cpus().length, memoryGb: Math.round(os.totalmem() / 1024 ** 3), addresses: networks },
      checks: { nodeSupported: [18, 20, 22, 24].includes(Number(process.versions.node.split(".")[0])), dataWritable: writable(dataRoot), uploadsWritable: writable(path.join(serverRoot, "uploads")), notInstalled: !fs.existsSync(lockPath), envAbsent: !fs.existsSync(envPath) },
      apply: applyJob,
    });
  });

  app.get("/api/app-health", async (_req, res) => {
    const mode = applyJob.mode ?? "localhost";
    const appPort = applyJob.appPort ?? 5000;
    const devPort = 5173;
    const isLocal = mode === "localhost";
    const uiPort = isLocal ? devPort : appPort;
    const apiReachable = await isPortOpen(appPort);
    const uiReachable = isLocal ? await isPortOpen(uiPort) : apiReachable;
    const reachable = isLocal ? uiReachable : apiReachable;
    const loginUrl = isLocal && uiReachable
      ? `http://127.0.0.1:${devPort}/auth`
      : applyJob.loginUrl;
    res.json({
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
        : isLocal
          ? `Uygulama henüz ayakta değil (API: ${appPort}, arayüz: ${devPort}).`
          : `Uygulama ${appPort} portunda dinlemiyor veya alan adı çözümlenmiyor. Nginx + DNS'i kontrol edin.`,
    });
  });

  app.post("/api/start-app", async (req, res) => {
    if (applyJob.status !== "success" && !fs.existsSync(lockPath)) {
      return res.status(409).json({ message: "Uygulamayı başlatmadan önce kurulum adımlarını tamamlayın." });
    }
    const body = await readJson(req).catch(() => ({}));
    const mode = applyJob.mode ?? "localhost";
    const isLocal = mode === "localhost";
    const preferDev = isLocal && body?.mode !== "production";
    const appPort = applyJob.appPort ?? 5000;

    const alreadyUp = await isPortOpen(appPort) || (preferDev && await isPortOpen(5173));
    if (alreadyUp) {
      const loginUrl = preferDev
        ? "http://127.0.0.1:5173/auth"
        : applyJob.loginUrl;
      return res.json({
        message: "Uygulama zaten ayakta.",
        reachable: true,
        loginUrl,
        publicUrl: applyJob.publicUrl,
      });
    }

    let command: string;
    let args: string[];
    let cwd = projectRoot;
    if (preferDev) {
      const inv = resolvePnpmInvocation(["run", "dev"]);
      command = inv.command;
      args = inv.args;
    } else {
      const candidates = [
        path.join(serverRoot, "dist", "index.cjs"),
        path.join(projectRoot, "dist", "index.cjs"),
      ];
      const distEntry = candidates.find((p) => fs.existsSync(p));
      if (!distEntry) {
        return res.status(409).json({
          message: "Üretim derlemesi bulunamadı. 'Uygulamayı üretim için derle' seçeneğini kullanın.",
        });
      }
      command = process.execPath;
      args = [distEntry];
      cwd = path.dirname(path.dirname(distEntry));
    }

    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        NODE_ENV: preferDev ? "development" : "production",
        FORCE_COLOR: "0",
      },
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();

    const watchPort = preferDev ? 5173 : appPort;
    let reachable = false;
    for (let i = 0; i < 30; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (await isPortOpen(watchPort)) {
        reachable = true;
        break;
      }
      if (preferDev && await isPortOpen(appPort) && i > 8) {
        if (await isPortOpen(5173)) {
          reachable = true;
          break;
        }
      }
    }

    const loginUrl = preferDev
      ? "http://127.0.0.1:5173/auth"
      : applyJob.loginUrl;

    return res.status(reachable ? 200 : 202).json({
      message: reachable
        ? (preferDev ? "Geliştirme sunucusu arka planda başlatıldı." : "Uygulama başlatıldı.")
        : "Başlatıldı ancak port henüz açılmadı. Birkaç saniye sonra tekrar denetleyin.",
      reachable,
      loginUrl,
      publicUrl: applyJob.publicUrl,
    });
  });

  app.post("/api/apply", async (req, res) => {
    if (applyJob.status === "running") {
      return res.status(409).json({ message: "Kurulum zaten uygulanıyor; pencereyi kapatmayın." });
    }
    try {
      const payload = setupPayloadSchema.parse(req.body);
      applyJob.status = "running";
      applyJob.message = "Kurulum uygulanıyor; adımlar ekranda canlı izleniyor…";
      applyJob.summary = [];
      applyJob.steps = createApplyState().steps;
      applyJob.startedAt = new Date().toISOString();
      applyJob.finishedAt = null;
      applyJob.loginUrl = null;
      applyJob.publicUrl = null;
      applyJob.appPort = null;
      applyJob.mode = null;
      res.status(202).json({
        message: "Kurulum başladı. Aşağıdaki adımlar tamamlandıkça güncellenir.",
        steps: applyJob.steps,
      });

      void (async () => {
        try {
          const summary = await applySetup(payload, applyJob);
          applyJob.summary = summary;
          applyJob.status = "success";
          applyJob.message = "Kurulum tamamlandı. Birazdan giriş sayfasına yönlendirileceksiniz.";
          applyJob.finishedAt = new Date().toISOString();
          setTimeout(() => onComplete?.(), 20_000);
        } catch (error) {
          applyJob.status = "error";
          applyJob.message = error instanceof Error ? error.message : "Kurulum tamamlanamadı.";
          applyJob.finishedAt = new Date().toISOString();
          applyJob.steps = applyJob.steps.map((step) =>
            step.status === "running" ? { ...step, status: "error", detail: applyJob.message } : step,
          );
        }
      })();
    } catch (error) {
      applyJob.status = "idle";
      const status = error instanceof ZodError ? 400 : 409;
      if (error instanceof ZodError) {
        return res.status(status).json({
          message: "Girilen bilgiler doğrulanamadı.",
          issues: error.issues.map((issue) => ({
            code: issue.code,
            message: issue.message,
            path: issue.path,
          })),
        });
      }
      res.status(status).json({ message: error instanceof Error ? error.message : "Kurulum tamamlanamadı." });
    }
  });
  return app;
}

export function startSetupWizard() {
  fs.mkdirSync(dataRoot, { recursive: true });
  if (fs.existsSync(lockPath)) throw new Error("Kurulum kilidi mevcut. Çalışan sistemi yeniden yapılandırmak için önce temiz kurulum adımını kullanın.");
  const token = process.env.SETUP_TOKEN || crypto.randomBytes(24).toString("base64url");
  const host = "127.0.0.1";
  const port = Math.min(65535, Math.max(1024, Number(process.env.SETUP_PORT) || 5050));
  let server: Server;
  const app = createSetupApp(token, () => server.close());

  const onListenError = (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(`Kurulum sihirbazı açılamadı: 127.0.0.1:${port} portu zaten kullanımda.`);
    } else {
      console.error(`Kurulum sihirbazı açılamadı: ${error.message}`);
    }
    process.exitCode = 1;
    setImmediate(() => process.exit(1));
  };

  server = createServer(app);
  server.once("error", onListenError);
  server.listen(port, host, () => {
    console.log(`Kurulum sihirbazı: http://${host}:${port}/setup?token=${token}`);
    console.log("Bu bağlantıyı paylaşmayın. Kurulum tamamlandığında sihirbaz otomatik kapanır.");
  });
}

if (import.meta.url && process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  startSetupWizard();
}
