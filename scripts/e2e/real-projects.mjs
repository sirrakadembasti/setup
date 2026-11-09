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

// Çerçeve iskeleti üreten komut (rails new, composer create-project…); hata verirse vaka başlamadan düşer.
const scaffold = (command, args) => (dir) => {
  const result = spawnSync(command, args, { cwd: dir, encoding: "utf8", shell: isWin, timeout: 900000 });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} başarısız: ${result.stdout}${result.stderr}`);
};

const GO_MAIN = `package main

import (
	"fmt"
	"net/http"
	"os"
)

func main() {
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "go ok") })
	http.ListenAndServe("127.0.0.1:"+os.Getenv("PORT"), nil)
}
`;

const RUST_MAIN = String.raw`use std::io::{Read, Write};
use std::net::TcpListener;

fn main() {
    let port = std::env::var("PORT").unwrap_or_else(|_| "3000".into());
    let listener = TcpListener::bind(format!("127.0.0.1:{}", port)).unwrap();
    for stream in listener.incoming() {
        let mut s = stream.unwrap();
        let mut buf = [0u8; 1024];
        let _ = s.read(&mut buf);
        let _ = s.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\nrust ok");
    }
}
`;

const QT_CMAKE = `cmake_minimum_required(VERSION 3.16)
project(demoqt)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_AUTOMOC ON)
find_package(Qt5 REQUIRED COMPONENTS Widgets)
add_executable(demoqt main.cpp)
target_link_libraries(demoqt Qt5::Widgets)
`;

const GODOT_PROJECT = `config_version=5

[application]
config/name="demo"
run/main_scene="res://main.tscn"
`;
const GODOT_SCENE = `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://main.gd" id="1"]

[node name="Main" type="Node"]
script = ExtResource("1")
`;
const GODOT_SCRIPT = `extends Node

func _ready():
\tprint("godot ok")
\tget_tree().quit()
`;

const LAZARUS_LPI = `<?xml version="1.0" encoding="UTF-8"?>
<CONFIG>
  <ProjectOptions>
    <Version Value="12"/>
    <General>
      <Flags><MainUnitHasCreateFormStatements Value="False"/><MainUnitHasTitleStatement Value="False"/><MainUnitHasScaledStatement Value="False"/></Flags>
      <SessionStorage Value="InProjectDir"/>
      <Title Value="demo"/>
      <UseAppBundle Value="False"/>
      <ResourceType Value="res"/>
    </General>
    <BuildModes Count="1"><Item1 Name="Default" Default="True"/></BuildModes>
    <PublishOptions><Version Value="2"/></PublishOptions>
    <RunParams><FormatVersion Value="2"/></RunParams>
    <Units Count="1"><Unit0><Filename Value="demo.lpr"/><IsPartOfProject Value="True"/></Unit0></Units>
  </ProjectOptions>
  <CompilerOptions>
    <Version Value="11"/>
    <Target><Filename Value="demo"/></Target>
    <SearchPaths><UnitOutputDirectory Value="lib/$(TargetCPU)-$(TargetOS)"/></SearchPaths>
  </CompilerOptions>
</CONFIG>
`;
const LAZARUS_LPR = `program demo;
uses SysUtils;
begin
  WriteLn('lazarus ok');
  Sleep(8000);
end.
`;

const FYNE_MAIN = `package main

import (
	"fmt"
	"time"

	"fyne.io/fyne/v2/app"
	"fyne.io/fyne/v2/widget"
)

func main() {
	a := app.New()
	w := a.NewWindow("demo")
	w.SetContent(widget.NewLabel("hello"))
	go func() {
		time.Sleep(3 * time.Second)
		fmt.Println("fyne ok")
		a.Quit()
	}()
	w.ShowAndRun()
}
`;

const EGUI_MAIN = `use eframe::egui;

struct DemoApp {
    start: std::time::Instant,
    said: bool,
}

impl eframe::App for DemoApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        egui::CentralPanel::default().show(ctx, |ui| {
            ui.label("hello");
        });
        if !self.said {
            println!("egui ok");
            self.said = true;
        }
        if self.start.elapsed().as_secs() > 3 {
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
        }
        ctx.request_repaint();
    }
}

fn main() -> eframe::Result {
    eframe::run_native(
        "demo",
        eframe::NativeOptions::default(),
        Box::new(|_cc| Ok(Box::new(DemoApp { start: std::time::Instant::now(), said: false }))),
    )
}
`;

const LEGACY_CSPROJ = String.raw`<?xml version="1.0" encoding="utf-8"?>
<Project ToolsVersion="4.0" DefaultTargets="Build" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <PropertyGroup>
    <Configuration Condition=" '$(Configuration)' == '' ">Debug</Configuration>
    <Platform Condition=" '$(Platform)' == '' ">AnyCPU</Platform>
    <OutputType>Exe</OutputType>
    <AssemblyName>LegacyApp</AssemblyName>
    <TargetFrameworkVersion>v4.0</TargetFrameworkVersion>
  </PropertyGroup>
  <PropertyGroup Condition=" '$(Configuration)|$(Platform)' == 'Debug|AnyCPU' ">
    <OutputPath>bin\Debug\</OutputPath>
  </PropertyGroup>
  <ItemGroup><Reference Include="System" /><Compile Include="Program.cs" /></ItemGroup>
  <Import Project="$(MSBuildToolsPath)\Microsoft.CSharp.targets" />
</Project>
`;

const TK_MAIN = `import tkinter as tk
root = tk.Tk()
root.after(6000, root.destroy)
print('tk ok', flush=True)
root.mainloop()
`;

const QT_MAIN = `#include <QApplication>
#include <QLabel>
#include <QTimer>
#include <cstdio>

int main(int argc, char** argv) {
  QApplication app(argc, argv);
  QLabel label("qt ok");
  label.show();
  std::puts("qt ok");
  std::fflush(stdout);
  QTimer::singleShot(4000, &app, &QApplication::quit);
  return app.exec();
}
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
  "rails-app": { title: "Ruby on Rails (rails new --minimal)", port: null, startTimeoutMs: 300000, prepare: scaffold("rails", ["new", ".", "--minimal", "--skip-git", "--skip-bundle", "--skip-test", "-d", "sqlite3"]), files: {} },
  "laravel-app": { title: "PHP Laravel (composer create-project)", port: null, startTimeoutMs: 300000, prepare: scaffold("composer", ["create-project", "laravel/laravel", ".", "--no-interaction", "--prefer-dist"]), files: {} },
  "go-http": { title: "Go HTTP sunucusu (go run)", port: 4402, files: { "go.mod": "module demo\n\ngo 1.21\n", ".env.example": "PORT=4402\n", "main.go": GO_MAIN } },
  "rust-http": { title: "Rust HTTP sunucusu (cargo run)", port: 4403, startTimeoutMs: 240000, files: {
    "Cargo.toml": "[package]\nname = \"demo\"\nversion = \"0.1.0\"\nedition = \"2021\"\n", ".env.example": "PORT=4403\n", "src/main.rs": RUST_MAIN } },
  "swift-cli": { title: "Swift paketi (swift run, çalıştırılabilir hedef)", mode: "process", marker: "swift ok", waitMs: 120000, files: {
    "Package.swift": "// swift-tools-version:5.5\nimport PackageDescription\nlet package = Package(name: \"demo\", targets: [.executableTarget(name: \"demo\", path: \"Sources/demo\")])\n",
    "Sources/demo/main.swift": "print(\"swift ok\")\n" } },
  // --- Masaüstü / pencere uygulamaları: HTTP yok; aracın "süreç yaşam döngüsü izlenir" akışı ve sürecin ayakta kalması denetlenir.
  "dotnet-winforms": { title: "Windows Forms (dotnet new winforms)", mode: "process", expect: "Masaüstü/yerel uygulama", waitMs: 30000, prepare: dotnetNew("winforms"), files: {} },
  "dotnet-wpf": { title: "WPF (dotnet new wpf)", mode: "process", expect: "Masaüstü/yerel uygulama", waitMs: 30000, prepare: dotnetNew("wpf"), files: {} },
  "dotnet-legacy": { title: "Klasik .NET Framework konsol (SDK'sız csproj, MSBuild)", mode: "process", marker: "legacy ok", waitMs: 90000, files: {
    "LegacyApp.csproj": LEGACY_CSPROJ, "Program.cs": "using System; class P { static void Main() { Console.WriteLine(\"legacy ok\"); System.Threading.Thread.Sleep(10000); } }\n" } },
  "gradle-app": { title: "Java Gradle (application eklentisi, gradle run)", mode: "process", marker: "gradle ok", waitMs: 240000, files: {
    "settings.gradle": "rootProject.name = 'demo'\n",
    "build.gradle": "plugins { id 'application' }\nrepositories { mavenCentral() }\napplication { mainClass = 'demo.App' }\n",
    "src/main/java/demo/App.java": "package demo;\npublic class App { public static void main(String[] a) { System.out.println(\"gradle ok\"); } }\n" } },
  "py-tkinter": { title: "Python Tkinter penceresi", mode: "process", marker: "tk ok", waitMs: 90000, files: {
    "requirements.txt": "# bağımlılık yok\n", "main.py": TK_MAIN } },
  "qt-qmake": { title: "Qt Widgets (qmake + make)", mode: "process", marker: "qt ok", waitMs: 240000, files: {
    "demo.pro": "QT += widgets\nTARGET = demoapp\nCONFIG += c++17\nSOURCES += main.cpp\n", "main.cpp": QT_MAIN } },
  // --- Linux'ta xvfb altında denenen ek masaüstü türleri
  "qt-cmake": { title: "Qt Widgets (CMake)", mode: "process", marker: "qt ok", waitMs: 300000, files: { "CMakeLists.txt": QT_CMAKE, "main.cpp": QT_MAIN } },
  avalonia: { title: "Avalonia (dotnet new avalonia.app)", mode: "process", expect: "Masaüstü/yerel uygulama", waitMs: 120000, files: {},
    prepare: (dir) => { scaffold("dotnet", ["new", "install", "Avalonia.Templates"])(dir); dotnetNew("avalonia.app")(dir); } },
  godot: { title: "Godot projesi (godot --path .)", mode: "process", marker: "godot ok", waitMs: 120000, files: { "project.godot": GODOT_PROJECT, "main.tscn": GODOT_SCENE, "main.gd": GODOT_SCRIPT } },
  lazarus: { title: "Lazarus / Free Pascal (lazbuild, konsol projesi)", mode: "process", marker: "lazarus ok", waitMs: 180000, files: { "demo.lpi": LAZARUS_LPI, "demo.lpr": LAZARUS_LPR } },
  "flutter-linux": { title: "Flutter masaüstü (flutter run -d linux)", mode: "process", marker: "Dart VM Service", waitMs: 900000, files: {},
    prepare: scaffold("flutter", ["create", ".", "--platforms=linux", "--project-name", "demo"]) },
  "go-fyne": { title: "Go GUI (Fyne)", mode: "process", marker: "fyne ok", waitMs: 600000, files: {},
    prepare: (dir) => { fs.writeFileSync(path.join(dir, "go.mod"), "module demo\n\ngo 1.21\n"); fs.writeFileSync(path.join(dir, "main.go"), FYNE_MAIN); scaffold("go", ["mod", "tidy"])(dir); } },
  "rust-egui": { title: "Rust GUI (egui / eframe)", mode: "process", marker: "egui ok", waitMs: 900000, files: {
    "Cargo.toml": "[package]\nname = \"demo\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[dependencies]\neframe = \"0.29\"\n", "src/main.rs": EGUI_MAIN } },
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

// Başarısız vakada oluşan/oluşmayan dosyaları görmek için dizin ağacı (derinlik sınırlı, gürültülü dizinler atlanır).
function listTree(dir, depth, prefix = "") {
  const lines = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return lines; }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if ([".git", "node_modules", "obj", ".dart_tool"].includes(entry.name)) continue;
    lines.push(`${prefix}${entry.name}${entry.isDirectory() ? "/" : ""}`);
    if (entry.isDirectory() && depth > 0) lines.push(...listTree(path.join(dir, entry.name), depth - 1, `${prefix}  `));
    if (lines.length > 80) break;
  }
  return lines;
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
      result.installOutput = out.slice(from);
      if (!result.installOk) { result.verdict = "KURULUM-BASARISIZ"; result.tail = out.slice(-1200); return result; }
    } else result.installOk = true;

    const from = out.length;
    child.stdin.write("6\n");
    if (testCase.mode === "process") {
      // İşaret (marker) görününce ya da hata çıkınca beklemeyi bırak; pencere uygulamalarında (expect) süre dolana dek bekle.
      const processDeadline = Date.now() + (testCase.waitMs || 20000);
      while (Date.now() < processDeadline) {
        const seen = out.slice(from);
        if (errorsSince(from).length) break;
        if (testCase.marker && seen.includes(testCase.marker)) break;
        if (child.exitCode !== null) break;
        await sleep(500);
      }
      const tail = out.slice(from);
      result.startErrors = errorsSince(from);
      result.marker = testCase.marker ? tail.includes(testCase.marker) : null;
      result.expected = testCase.expect ? tail.includes(testCase.expect) : null;
      const alive = child.exitCode === null;
      const ok = !result.startErrors.length && (testCase.expect ? result.expected && alive : (result.marker || alive));
      result.verdict = result.startErrors.length ? "BASLATMA-BASARISIZ" : (ok ? "CALISTI" : "SUREC-ERKEN-KAPANDI");
      // Menü çıktısı sonda olduğundan uygulamanın kendi hata satırları başta aranır.
      if (result.verdict !== "CALISTI") result.startOutput = tail.slice(0, 4000);
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
    // Menü çıktısı sonda olduğundan uygulamanın kendi hata satırları başta aranır.
    if (result.verdict !== "CALISTI") result.startOutput = out.slice(from, from + 4000);
    return result;
  } finally {
    killTree(child);
    await sleep(2000);
    result.seconds = Math.round((Date.now() - t0) / 100) / 10;
    if (result.verdict !== "CALISTI") result.listing = listTree(dir, 2);
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
    if (result.verdict !== "CALISTI") {
      for (const line of [...(result.installErrors || []), ...(result.startErrors || [])]) console.log(`    ${line}`);
      if (result.installOutput) console.log(`--- kurulum çıktısı (son 40 satır) ---\n${result.installOutput.split("\n").slice(-40).join("\n")}\n--- /kurulum çıktısı ---`);
      if (result.listing) console.log(`--- proje dizini ---\n${result.listing.join("\n")}\n--- /proje dizini ---`);
      if (result.startOutput) console.log(`--- başlatma çıktısı ---\n${result.startOutput.split("\n").slice(0, 40).join("\n")}\n--- /başlatma çıktısı ---`);
      console.log((result.log || result.tail || result.error || "").split("\n").slice(-25).join("\n"));
    }
    if (outFile) fs.writeFileSync(outFile, json(results));
  }
  console.log("\n=== ÖZET ===");
  for (const r of results) console.log(`${r.verdict === "CALISTI" ? "OK  " : "FAIL"} ${r.id} — ${r.verdict}`);
  process.exit(results.every((r) => r.verdict === "CALISTI") ? 0 : 1);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) await main();
