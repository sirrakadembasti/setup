import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkDirectoryWritability } from "../bin/setup.mjs";
import { checkToolchain } from "./polyglot.mjs";
import {
  createRateLimiter,
  executeSetupApply,
  formatNetworkErrorMessage,
  testDatabaseConnection,
  testEmailConfiguration,
  testTcpConnection,
} from "../wizard/shared.mjs";
import { createSetupServer } from "../wizard/server.mjs";

function makeTempDir(prefix = "err-resilience-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    dir,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    },
  };
}

async function closeServer(srv) {
  if (!srv) return;
  if (typeof srv.stopSpawnedApp === "function") {
    try {
      await srv.stopSpawnedApp();
    } catch {}
  }
  if (typeof srv.closeAllConnections === "function") {
    srv.closeAllConnections();
  }
  await new Promise((resolve) => srv.close(() => resolve()));
}

test("Hata Dayanıklılığı 1: checkDirectoryWritability yazılabilir dizini ve üst dizini doğru doğrular", () => {
  const { dir, cleanup } = makeTempDir();
  try {
    const res = checkDirectoryWritability(dir);
    assert.equal(res.writable, true);
    assert.equal(res.exists, true);

    const subDir = path.join(dir, "sub", "child");
    const subRes = checkDirectoryWritability(path.join(dir, "sub"));
    assert.equal(subRes.writable, true);
  } finally {
    cleanup();
  }
});

test("Hata Dayanıklılığı 2: formatNetworkErrorMessage sistem soket hatalarını açıklayıcı Türkçe mesaja çevirir", () => {
  const errRefused = new Error("connect ECONNREFUSED 127.0.0.1:5432");
  errRefused.code = "ECONNREFUSED";
  const msgRefused = formatNetworkErrorMessage(errRefused, "127.0.0.1:5432");
  assert.ok(msgRefused.includes("bağlantı reddedildi"), `Beklenen mesaj: ${msgRefused}`);
  assert.ok(msgRefused.includes("çalıştığından emin olun"), `Rehber içermeli: ${msgRefused}`);

  const errTimeout = new Error("Connection timeout");
  errTimeout.code = "ETIMEDOUT";
  const msgTimeout = formatNetworkErrorMessage(errTimeout, "smtp.example.com:587");
  assert.ok(msgTimeout.includes("zaman aşımına uğradı"), `Beklenen mesaj: ${msgTimeout}`);

  const errDns = new Error("getaddrinfo ENOTFOUND invalid.domain.test");
  errDns.code = "ENOTFOUND";
  const msgDns = formatNetworkErrorMessage(errDns, "invalid.domain.test");
  assert.ok(msgDns.includes("çözümlenemedi"), `DNS hatası içermeli: ${msgDns}`);

  const errUnreach = new Error("connect EHOSTUNREACH 192.0.2.1");
  errUnreach.code = "EHOSTUNREACH";
  const msgUnreach = formatNetworkErrorMessage(errUnreach, "192.0.2.1");
  assert.ok(msgUnreach.includes("erişilemiyor"), `Host unreachable içermeli: ${msgUnreach}`);
});

test("Hata Dayanıklılığı 3: testTcpConnection kapalı portta kilitlenmeden friendlyError ile döner", async () => {
  const result = await testTcpConnection("127.0.0.1", 59998, 400);
  assert.equal(result.ok, false);
  assert.equal(result.reachable, false);
  assert.ok(result.error);
  assert.ok(result.friendlyError);
  assert.ok(result.friendlyError.includes("127.0.0.1:59998"));
});

test("Hata Dayanıklılığı 4: testDatabaseConnection kapalı PostgreSQL ve MySQL için Türkçe teşhis üretir", async () => {
  const pgResult = await testDatabaseConnection({ provider: "postgres", host: "127.0.0.1", port: 59997 }, process.cwd());
  assert.equal(pgResult.ok, false);
  assert.equal(pgResult.reachable, false);
  assert.ok(pgResult.message.includes("PostgreSQL sunucusuna bağlanılamadı"));
  assert.ok(pgResult.friendlyError);

  const myResult = await testDatabaseConnection({ provider: "mysql", host: "127.0.0.1", port: 59996 }, process.cwd());
  assert.equal(myResult.ok, false);
  assert.equal(myResult.reachable, false);
  assert.ok(myResult.message.includes("MySQL sunucusuna bağlanılamadı"));
});

test("Hata Dayanıklılığı 5: testEmailConfiguration kapalı SMTP sunucusunda friendlyError sunar", async () => {
  const result = await testEmailConfiguration({
    enabled: true,
    provider: "custom",
    host: "127.0.0.1",
    port: 59995,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reachable, false);
  assert.ok(result.message.includes("SMTP sunucusuna"));
  assert.ok(result.friendlyError);
});

test("Hata Dayanıklılığı 6: checkToolchain sistemde olmayan araç zinciri için resmi indirme linkini verir", () => {
  const res = checkToolchain(process.cwd(), { command: "nonexistent_compiler_xyz" });
  assert.equal(res.ok, true); // toolchainFor bilinmeyen komutlar için zorunlu kılınmaz

  const cargoCheck = checkToolchain(process.cwd(), { command: "cargo" });
  if (!cargoCheck.ok) {
    assert.ok(cargoCheck.message.includes("rustup.rs"));
  }

  const cmakeCheck = checkToolchain(process.cwd(), { command: "cmake" });
  if (!cmakeCheck.ok) {
    assert.ok(cmakeCheck.message.includes("cmake.org"));
  }
});

test("Hata Dayanıklılığı 7: executeSetupApply adımlardan biri çöktüğünde geçici dosyaları temizler ve eski .env'yi geri yükler", async () => {
  const { dir, cleanup } = makeTempDir();
  try {
    const envPath = path.join(dir, ".env");
    const originalSecret = "ORIGINAL_SECRET_KEY=123456789\n";
    fs.writeFileSync(envPath, originalSecret, "utf8");

    const dataRoot = path.join(dir, "data");
    const lockPath = path.join(dataRoot, "installation.lock");
    const pendingPath = path.join(dataRoot, "installation.pending");
    const artifactsRoot = path.join(dataRoot, "setup-artifacts");

    const applyJob = {
      status: "idle",
      steps: [
        { id: "buildServer", status: "pending" },
        { id: "migrate", status: "pending" },
        { id: "env", status: "pending" },
        { id: "finish", status: "pending" },
      ],
      logs: [],
    };

    const payload = {
      deployment: { mode: "localhost", publicUrl: "http://localhost:5000", basePath: "/", allowedOrigins: ["http://localhost:5000"], trustProxyHops: 0 },
      server: { host: "127.0.0.1", port: 5000 },
      admin: { name: "Admin", email: "admin@test.com", password: "Password123456!" },
      database: { provider: "sqlite" },
      email: { enabled: false },
      customEnv: { NEW_KEY: "new-val" },
      overwriteExistingEnv: true,
    };

    await assert.rejects(
      async () => {
        await executeSetupApply({
          projectRoot: dir,
          dataDir: dataRoot,
          paths: {
            serverRoot: dir,
            dataRoot,
            env: envPath,
            lock: lockPath,
            pending: pendingPath,
            setupArtifacts: artifactsRoot,
            databaseUrl: "file:./data/app.db",
          },
          detection: { kind: "node-fullstack", scenario: { label: "Test" } },
          setupConfig: null,
          options: {
            runMigrateCommands: async () => {
              throw new Error("Veritabanı migration scripti çöktü (Simüle edilmiş hata)");
            },
          },
          applyJob,
          payload,
          markStep: (id, st) => {
            const step = applyJob.steps.find((s) => s.id === id);
            if (step) step.status = st;
          },
        });
      },
      /Veritabanı migration scripti çöktü/,
    );

    assert.equal(applyJob.status, "error");
    // Orijinal .env dosyası bozulmamış olmalı (Rollback koruması)
    assert.equal(fs.existsSync(envPath), true);
    assert.equal(fs.readFileSync(envPath, "utf8"), originalSecret);
    // Yarım kalan lock yazılmamış olmalı
    assert.equal(fs.existsSync(lockPath), false);
    // Geçici kurulum dosyası kalmamış olmalı
    const tempEnv = `${envPath}.setup-${process.pid}`;
    assert.equal(fs.existsSync(tempEnv), false);
  } finally {
    cleanup();
  }
});

test("Hata Dayanıklılığı 8: /api/start-app erken çöken uygulamayı yakalar ve APP_CRASHED döner", async () => {
  const { dir, cleanup } = makeTempDir();
  try {
    const token = "a".repeat(24);
    const lockPath = path.join(dir, "data", "installation.lock");
    fs.mkdirSync(path.join(dir, "data"), { recursive: true });
    fs.writeFileSync(lockPath, JSON.stringify({ installedAt: new Date().toISOString() }), "utf8");

    // Hemen çöken bir Node.js betiği oluştur (process.exit(137))
    const crashScript = path.join(dir, "crash.mjs");
    fs.writeFileSync(crashScript, "console.error('Fatal: Bellek yetersizliği (SIGKILL simülasyonu)'); process.exit(137);\n", "utf8");

    const server = createSetupServer(token, {
      projectRoot: dir,
      forceServerSubdir: false,
      startAppInvocation: {
        command: process.execPath,
        args: [crashScript],
        cwd: dir,
      },
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/start-app`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Setup-Token": token,
          Origin: `http://127.0.0.1:${port}`,
          Connection: "close",
        },
      });

      assert.equal(res.status, 409);
      const data = await res.json();
      assert.equal(data.code, "APP_CRASHED");
      assert.equal(data.reachable, false);
      assert.equal(data.exitCode, 137);
      assert.ok(data.errorDetail.includes("Bellek yetersizliği"));
    } finally {
      await closeServer(server);
    }
  } finally {
    cleanup();
  }
});

test("Hata Dayanıklılığı 9: Sahte CSRF / Geçersiz Origin 403, 512KB aşan gövde 400 döner", async () => {
  const { dir, cleanup } = makeTempDir();
  try {
    const token = "b".repeat(24);
    const server = createSetupServer(token, {
      projectRoot: dir,
      forceServerSubdir: false,
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;

    try {
      // 1. Sahte origin ile POST
      const resFakeOrigin = await fetch(`http://127.0.0.1:${port}/api/validate-step`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Setup-Token": token,
          Origin: "http://malicious-site.example.com",
          Connection: "close",
        },
        body: JSON.stringify({ step: "all" }),
      });
      assert.equal(resFakeOrigin.status, 403);

      // 2. 600KB boyutunda devasa payload (512KB limitini aşar)
      const hugeData = "x".repeat(600_000);
      let rejected = false;
      try {
        const resHuge = await fetch(`http://127.0.0.1:${port}/api/validate-step`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Setup-Token": token,
            Origin: `http://127.0.0.1:${port}`,
            Connection: "close",
          },
          body: JSON.stringify({ step: "all", data: hugeData }),
        });
        if (resHuge.status === 400 || resHuge.status === 413) {
          rejected = true;
          const hugeJson = await resHuge.json().catch(() => ({}));
          if (hugeJson.message) assert.ok(hugeJson.message.includes("çok büyük"));
        }
      } catch (err) {
        // TCP sıfırlanması da kabul edilir
        rejected = true;
      }
      assert.equal(rejected, true, "512KB üzerindeki istek sunucu tarafından engellenmeli");
    } finally {
      await closeServer(server);
    }
  } finally {
    cleanup();
  }
});

test("Hata Dayanıklılığı 10: Unauthenticated /setup isteklerinde Accept: text/html HTML kartı döndürür", async () => {
  const { dir, cleanup } = makeTempDir();
  try {
    const token = "c".repeat(24);
    const server = createSetupServer(token, {
      projectRoot: dir,
      forceServerSubdir: false,
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/setup`, {
        headers: {
          Accept: "text/html",
          Connection: "close",
        },
      });
      assert.equal(res.status, 401);
      const html = await res.text();
      assert.ok(html.includes("Yetkisiz veya Süresi Dolmuş"));
      assert.ok(html.includes("/setup?token="));
    } finally {
      await closeServer(server);
    }
  } finally {
    cleanup();
  }
});
