// Gerçek araç zincirleriyle uçtan uca denetim: küçük örnek projeler üretir, aracın kendi terminal akışını
// (menü 1 = paketleri kur, menü 6 = uygulamayı başlat) sürer ve uygulamanın gerçekten yanıt verdiğini ölçer.
//
// Kullanım: node scripts/e2e/real-projects.mjs <vaka1,vaka2,...|all> [--out sonuc.json]
// Çıkış kodu: 0 = tüm vakalar çalıştı, 1 = en az bir vaka başarısız.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SETUP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const isWin = process.platform === "win32";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const json = (value) => JSON.stringify(value, null, 2);
const nodeServer = (message) => `require('http').createServer((q,r)=>r.end(${JSON.stringify(message)})).listen(process.env.PORT||3000,'127.0.0.1');\n`;

const dotnetNew = (template, extra = []) => (dir) => {
  const result = spawnSync("dotnet", ["new", template, "-n", "app", "-o", dir, "--no-restore", "--force", ...extra], { encoding: "utf8", shell: isWin });
  if (result.status !== 0) throw new Error(`dotnet new ${template} başarısız: ${result.stdout}${result.stderr}`);
};

const SPRING_POM = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.3.5</version>
  </parent>
  <groupId>demo</groupId>
  <artifactId>demo</artifactId>
  <version>1.0.0</version>
  <properties><java.version>17</java.version></properties>
  <dependencies>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>
  </dependencies>
  <build><plugins><plugin><groupId>org.springframework.boot</groupId><artifactId>spring-boot-maven-plugin</artifactId></plugin></plugins></build>
</project>
`;

// port: uygulamanın dinleyeceği adres (.env.example ile aynı). mode "process": HTTP yok, süreç/çıktı denetlenir.
export const CASES = {
  "node-express": { title: "Node + Express (gerçek npm bağımlılığı)", port: 4101, files: {
    "package.json": json({ name: "demo-express", version: "1.0.0", scripts: { start: "node server.js" }, dependencies: { express: "^4.19.2" } }),
    "server.js": "const e=require('express');const a=e();a.get('/',(q,r)=>r.send('express ok'));a.listen(process.env.PORT||3000,'127.0.0.1');\n",
    ".env.example": "PORT=4101\nSESSION_SECRET=change-me\n" } },
  "node-zero": { title: "Node, bağımlılıksız", port: 4102, files: {
    "package.json": json({ name: "demo-zero", scripts: { start: "node s.js" } }), "s.js": nodeServer("zero ok"), ".env.example": "PORT=4102\n" } },
  "static-html": { title: "Saf statik HTML", port: null, files: { "index.html": "<h1>statik ok</h1>" } },
  "python-flask": { title: "Python + Flask (venv + pip)", port: 4106, files: {
    "requirements.txt": "flask\n", ".env.example": "PORT=4106\n",
    "app.py": "from flask import Flask\napp = Flask(__name__)\n@app.get('/')\ndef i():\n    return 'flask ok'\n" } },
  fullstack: { title: "Full-stack: Express backend + Vite frontend", port: 4109, frontendPort: 4110, files: {
    ".env.example": "PORT=4109\nFRONTEND_PORT=4110\nJWT_SECRET=change-me\n",
    "backend/package.json": json({ name: "be", scripts: { start: "node server.js" }, dependencies: { express: "^4.19.2" } }),
    "backend/server.js": "const e=require('express');const a=e();a.get('/',(q,r)=>r.send('api ok'));a.listen(process.env.PORT||3000,'127.0.0.1');\n",
    "frontend/package.json": json({ name: "fe", scripts: { dev: "vite" }, devDependencies: { vite: "^5.4.0" } }),
    "frontend/index.html": "<!doctype html><title>fe</title><h1>vite ok</h1>" } },
  "dotnet-web": { title: ".NET minimal web (dotnet new web)", port: 4108, prepare: dotnetNew("web"), files: { ".env.example": "PORT=4108\n" } },
  "dotnet-mvc": { title: "ASP.NET Core MVC (dotnet new mvc)", port: 4201, prepare: dotnetNew("mvc"), files: { ".env.example": "PORT=4201\n" } },
  "dotnet-console": { title: ".NET konsol (dotnet new console)", mode: "process", marker: "Hello, World!", waitMs: 40000, prepare: dotnetNew("console"), files: {} },
  "php-plain": { title: "PHP (composer.json + index.php, yerleşik sunucu)", port: 4301, files: {
    "composer.json": json({ name: "demo/php", require: {} }), "index.php": "<?php echo 'php ok';\n", ".env.example": "PORT=4301\n" } },
  "ruby-rack": { title: "Ruby Rack (bundle + rackup)", port: 4302, files: {
    Gemfile: "source 'https://rubygems.org'\ngem 'rackup'\ngem 'webrick'\n",
    "config.ru": "run ->(env) { [200, { 'content-type' => 'text/plain' }, ['ruby ok']] }\n", ".env.example": "PORT=4302\n" } },
  "java-spring": { title: "Java Spring Boot (Maven)", port: 4303, startTimeoutMs: 240000, files: {
    "pom.xml": SPRING_POM, ".env.example": "PORT=4303\n",
    "src/main/java/demo/App.java": "package demo;\nimport org.springframework.boot.SpringApplication;\nimport org.springframework.boot.autoconfigure.SpringBootApplication;\nimport org.springframework.web.bind.annotation.GetMapping;\nimport org.springframework.web.bind.annotation.RestController;\n@SpringBootApplication\n@RestController\npublic class App {\n  public static void main(String[] a) { SpringApplication.run(App.class, a); }\n  @GetMapping(\"/\") String home() { return \"spring ok\"; }\n}\n" } },
  "docker-compose": { title: "Docker Compose (nginx)", port: 4312, startTimeoutMs: 180000, files: {
    "docker-compose.yml": "services:\n  web:\n    image: nginx:alpine\n    ports: ['4312:80']\n", ".env.example": "PORT=4312\n" } },
};

function probe(url, timeout = 1500) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout }, (response) => {
      response.resume();
      response.on("end", () => resolve({ ok: true, status: response.statusCode }));
    });
    request.on("timeout", () => { request.destroy(); resolve({ ok: false }); });
    request.on("error", () => resolve({ ok: false }));
  });
}

function killTree(child) {
  if (!child.pid) return;
  if (isWin) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else { try { child.kill("SIGINT"); } catch { /* süreç zaten bitmiş */ } }
}

async function runCase(id, testCase) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `e2e-${id}-`));
  const result = { id, title: testCase.title, platform: process.platform, dir };
  testCase.prepare?.(dir);
  for (const [name, content] of Object.entries(testCase.files || {})) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  const child = spawn(process.execPath, [path.join(SETUP_ROOT, "bin", "setup.mjs"), "--root", dir, "--no-open"], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, FORCE_COLOR: "0" } });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { out += d; });
  const t0 = Date.now();
  const prompts = () => (out.match(/Seçiminiz \(1-6 veya 0\):/g) || []).length;
  const waitPrompt = async (n, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (prompts() >= n) return true; if (child.exitCode !== null) return false; await sleep(200); }
    return false;
  };
  const errorsSince = (from) => [...out.slice(from).matchAll(/\[HATA\][^\n]*/g)].map((m) => m[0].slice(0, 240));
  try {
    if (!(await waitPrompt(1, 30000))) { result.verdict = "MENU-YOK"; result.tail = out.slice(-800); return result; }
    result.detected = (out.match(/Algılanan: [^\n]*/) || [])[0] || null;
    result.startCommand = (out.match(/Başlatma komutu: [^\n]*/) || [])[0] || null;
    if (!/Paketler: hazır/.test(out.slice(-3500))) {
      const from = out.length;
      child.stdin.write("1\n");
      const done = await waitPrompt(2, 600000);
      result.installOk = done && /\[BAŞARILI\]/.test(out.slice(from));
      result.installErrors = errorsSince(from).slice(-3);
      if (!result.installOk) { result.verdict = "KURULUM-BASARISIZ"; result.tail = out.slice(-1200); return result; }
    } else result.installOk = true;

    const from = out.length;
    child.stdin.write("6\n");
    if (testCase.mode === "process") {
      await sleep(testCase.waitMs || 20000);
      const tail = out.slice(from);
      result.startErrors = errorsSince(from);
      result.marker = testCase.marker ? tail.includes(testCase.marker) : null;
      result.verdict = result.startErrors.length ? "BASLATMA-BASARISIZ" : (result.marker || child.exitCode === null ? "CALISTI" : "SUREC-ERKEN-KAPANDI");
      if (result.verdict !== "CALISTI") result.tail = tail.slice(-1200);
      return result;
    }
    const findTarget = () => (testCase.port ? `http://127.0.0.1:${testCase.port}/` : (out.slice(from).match(/(http:\/\/127\.0\.0\.1:\d+)/) || [])[1]);
    const deadline = Date.now() + (testCase.startTimeoutMs || 120000);
    let reply = null;
    let target = null;
    while (Date.now() < deadline) {
      target = findTarget();
      if (!target) { await sleep(500); continue; }
      reply = await probe(target);
      if (reply.ok && reply.status < 500) break;
      reply = null;
      if (errorsSince(from).length) break;
      await sleep(1000);
    }
    result.url = target || null;
    result.http = reply;
    result.startErrors = errorsSince(from);
    if (reply && testCase.frontendPort) {
      while (Date.now() < deadline) {
        result.frontend = await probe(`http://127.0.0.1:${testCase.frontendPort}/`);
        if (result.frontend.ok && result.frontend.status < 500) break;
        await sleep(1000);
      }
    }
    const frontendOk = !testCase.frontendPort || result.frontend?.ok;
    result.verdict = reply && frontendOk ? "CALISTI" : "YANIT-YOK";
    if (result.verdict !== "CALISTI") result.tail = out.slice(from).slice(-1500);
    return result;
  } finally {
    killTree(child);
    await sleep(2000);
    result.seconds = Math.round((Date.now() - t0) / 100) / 10;
    if (result.verdict !== "CALISTI") result.log = out.slice(-4000);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf("--out");
  const outFile = outIndex >= 0 ? args.splice(outIndex, 2)[1] : null;
  const wanted = (args[0] || "all").split(",").filter(Boolean);
  const ids = wanted.includes("all") ? Object.keys(CASES) : wanted;
  const unknown = ids.filter((id) => !CASES[id]);
  if (unknown.length) { console.error(`Bilinmeyen vaka: ${unknown.join(", ")}. Geçerliler: ${Object.keys(CASES).join(", ")}`); process.exit(2); }
  const results = [];
  for (const id of ids) {
    console.log(`\n>>> ${id}: ${CASES[id].title}`);
    let result;
    try { result = await runCase(id, CASES[id]); } catch (error) { result = { id, verdict: "HARNESS-HATASI", error: String(error?.stack || error) }; }
    results.push(result);
    console.log(`<<< ${id}: ${result.verdict} (${result.seconds ?? "?"} sn)${result.detected ? ` | ${result.detected}` : ""}`);
    if (result.verdict !== "CALISTI") console.log((result.log || result.tail || result.error || "").split("\n").slice(-25).join("\n"));
    if (outFile) fs.writeFileSync(outFile, json(results));
  }
  console.log("\n=== ÖZET ===");
  for (const r of results) console.log(`${r.verdict === "CALISTI" ? "OK  " : "FAIL"} ${r.id} — ${r.verdict}`);
  process.exit(results.every((r) => r.verdict === "CALISTI") ? 0 : 1);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) await main();
