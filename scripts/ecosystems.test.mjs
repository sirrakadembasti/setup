import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildInstallPlan, detectProject } from "./detect-project.mjs";
import { analyzeDotnet, detectEcosystem, ecosystemReadiness, parseDotnetProject } from "./ecosystems.mjs";
import { checkToolchain, resolveLanguageProfile } from "./polyglot.mjs";
import { resolveAppStartInvocation } from "../wizard/app-process.mjs";
import { checkDependencies } from "./setup-bootstrap-lib.mjs";
import { materializeEnvTemplate } from "../wizard/config.mjs";

function tree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "setup-eco-"));
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return dir;
}

const sdkProject = (sdk, body = "", tfm = "net8.0") =>
  `<Project Sdk="${sdk}"><PropertyGroup><TargetFramework>${tfm}</TargetFramework>${body}</PropertyGroup></Project>`;

const legacyProject = (body, refs = "", version = "v4.7.2") =>
  `<?xml version="1.0"?><Project ToolsVersion="15.0"><PropertyGroup><TargetFrameworkVersion>${version}</TargetFrameworkVersion>${body}</PropertyGroup><ItemGroup>${refs}</ItemGroup><Import Project="$(MSBuildToolsPath)\\Microsoft.CSharp.targets" /></Project>`;

// ------------------------------------------------------------------ .NET sınıflandırma

const DOTNET_CASES = [
  ["ASP.NET Core MVC", { "Web.csproj": sdkProject("Microsoft.NET.Sdk.Web"), "Controllers/HomeController.cs": "", "Views/Home/Index.cshtml": "" }, "mvc", "web", "dotnet-server"],
  ["Razor Pages", { "Web.csproj": sdkProject("Microsoft.NET.Sdk.Web"), "Pages/Index.cshtml": "" }, "razor-pages", "web", "dotnet-server"],
  ["Blazor Server", { "Web.csproj": sdkProject("Microsoft.NET.Sdk.Web"), "Components/App.razor": "" }, "blazor-server", "web", "dotnet-server"],
  ["Blazor WebAssembly", { "Wasm.csproj": sdkProject("Microsoft.NET.Sdk.BlazorWebAssembly") }, "blazor-wasm", "web", "dotnet-server"],
  ["Web API", { "Api.csproj": sdkProject("Microsoft.NET.Sdk.Web"), "Controllers/ValuesController.cs": "" }, "webapi", "web", "dotnet-server"],
  ["minimal API", { "Api.csproj": sdkProject("Microsoft.NET.Sdk.Web"), "Program.cs": "var app = WebApplication.Create(); app.MapGet(\"/\", () => 1); app.Run();" }, "minimal-api", "web", "dotnet-server"],
  ["Worker Service", { "Svc.csproj": sdkProject("Microsoft.NET.Sdk.Worker") }, "worker", "service", "dotnet-desktop"],
  ["konsol", { "Cli.csproj": sdkProject("Microsoft.NET.Sdk", "<OutputType>Exe</OutputType>") }, "console", "console", "dotnet-desktop"],
  ["WinForms (SDK)", { "Forms.csproj": sdkProject("Microsoft.NET.Sdk", "<OutputType>WinExe</OutputType><UseWindowsForms>true</UseWindowsForms>", "net8.0-windows") }, "winforms", "desktop", "dotnet-desktop"],
  ["WPF (SDK)", { "Wpf.csproj": sdkProject("Microsoft.NET.Sdk", "<OutputType>WinExe</OutputType><UseWPF>true</UseWPF>", "net8.0-windows") }, "wpf", "desktop", "dotnet-desktop"],
  ["WinUI 3", { "Win.csproj": sdkProject("Microsoft.NET.Sdk", '<UseWinUI>true</UseWinUI>', "net8.0-windows10.0.19041.0") }, "winui", "desktop", "dotnet-desktop"],
  ["MAUI", { "Maui.csproj": `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFrameworks>net8.0-android;net8.0-windows10.0.19041.0;net8.0-maccatalyst</TargetFrameworks><UseMaui>true</UseMaui><OutputType>Exe</OutputType></PropertyGroup></Project>` }, "maui", "desktop", "dotnet-desktop"],
  ["Avalonia", { "Av.csproj": `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>WinExe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup><PackageReference Include="Avalonia" Version="11.0.0"/></ItemGroup></Project>` }, "avalonia", "desktop", "dotnet-desktop"],
  ["Uno Platform", { "Uno.csproj": `<Project Sdk="Uno.Sdk"><PropertyGroup><TargetFrameworks>net8.0-desktop</TargetFrameworks></PropertyGroup></Project>` }, "uno", "desktop", "dotnet-desktop"],
  ["Xamarin.Forms", { "Xam.csproj": legacyProject("<OutputType>Library</OutputType>", '<PackageReference Include="Xamarin.Forms" Version="5.0.0"/>') }, "xamarin", "mobile", "dotnet-desktop"],
  ["WinForms (.NET Framework)", { "Old.csproj": legacyProject("<OutputType>WinExe</OutputType>", '<Reference Include="System.Windows.Forms"/>') }, "winforms", "desktop", "dotnet-desktop"],
  ["WPF (.NET Framework)", { "Old.csproj": legacyProject("<OutputType>WinExe</OutputType>", '<Reference Include="PresentationFramework"/>', "v4.8") }, "wpf", "desktop", "dotnet-desktop"],
  ["ASP.NET MVC 5 (.NET Framework)", { "Mvc.csproj": legacyProject("<ProjectTypeGuids>{349C5851-65DF-11DA-9384-00065B846F21};{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}</ProjectTypeGuids>", '<Reference Include="System.Web.Mvc"/>'), "Web.config": "<configuration/>" }, "aspnet-mvc-framework", "web", "dotnet-server"],
  ["ASP.NET Web Forms", { "Forms.csproj": legacyProject("", '<Reference Include="System.Web"/>'), "Web.config": "<configuration/>", "Default.aspx": "" }, "aspnet-webforms", "web", "dotnet-server"],
  ["VB.NET WinForms", { "Vb.vbproj": sdkProject("Microsoft.NET.Sdk", "<OutputType>WinExe</OutputType><UseWindowsForms>true</UseWindowsForms>", "net8.0-windows") }, "winforms", "desktop", "dotnet-desktop"],
  ["F# konsol", { "Fs.fsproj": sdkProject("Microsoft.NET.Sdk", "<OutputType>Exe</OutputType>") }, "console", "console", "dotnet-desktop"],
];

for (const [title, files, ui, category, kind] of DOTNET_CASES) {
  test(`.NET algılama: ${title}`, () => {
    const root = tree(files);
    const analysis = analyzeDotnet(root);
    assert.ok(analysis, "proje bulunmalı");
    assert.equal(analysis.primary.ui, ui);
    assert.equal(analysis.primary.category, category);
    assert.equal(detectEcosystem(root).kind, kind);
    assert.equal(detectProject(root).kind, kind, "detectProject aynı türü vermeli");
  });
}

test(".NET dil ve sürüm bilgisi: VB, F#, Framework sürümü etikete yansır", () => {
  assert.match(analyzeDotnet(tree({ "A.vbproj": sdkProject("Microsoft.NET.Sdk", "<OutputType>Exe</OutputType>") })).label, /VB\.NET/);
  assert.match(analyzeDotnet(tree({ "A.fsproj": sdkProject("Microsoft.NET.Sdk", "<OutputType>Exe</OutputType>") })).label, /F#/);
  const legacy = analyzeDotnet(tree({ "Old.csproj": legacyProject("<OutputType>WinExe</OutputType>", '<Reference Include="System.Windows.Forms"/>', "v4.6.1") }));
  assert.equal(legacy.legacy, true);
  assert.match(legacy.label, /\.NET Framework 4\.6\.1/);
});

test(".NET çözümünde test ve kitaplık projeleri atlanır, web projesi ana proje olur; iç içe klasörler bulunur", () => {
  const root = tree({
    "App.sln": "",
    "src/Lib/Lib.csproj": sdkProject("Microsoft.NET.Sdk"),
    "src/Web/Web.csproj": sdkProject("Microsoft.NET.Sdk.Web"),
    "tests/Web.Tests/Web.Tests.csproj": `<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="Microsoft.NET.Test.Sdk" Version="17"/><PackageReference Include="xunit" Version="2"/></ItemGroup></Project>`,
  });
  const a = analyzeDotnet(root);
  assert.equal(a.primary.rel, "src/Web/Web.csproj");
  assert.equal(a.projects.find((p) => p.name === "Web.Tests").category, "test");
  assert.equal(a.projects.find((p) => p.name === "Lib").category, "library");
  const profile = resolveLanguageProfile(root, "dotnet-server", 5100, { platform: "linux" });
  assert.equal(profile.steps[0].args.at(-1), "App.sln", "birden çok proje varsa çözüm geri yüklenir");
  assert.deepEqual(profile.start.args.slice(0, 3), ["run", "--project", "src/Web/Web.csproj"]);
  assert.ok(profile.start.args.includes("http://127.0.0.1:5100"));
});

// ------------------------------------------------------------------ .NET platform davranışı

test(".NET profil: Windows'a özgü masaüstü Linux/macOS'ta engellenir, Windows'ta derlenir", () => {
  const root = tree({ "Forms.csproj": sdkProject("Microsoft.NET.Sdk", "<OutputType>WinExe</OutputType><UseWindowsForms>true</UseWindowsForms>", "net8.0-windows") });
  for (const platform of ["linux", "darwin"]) {
    const blocked = resolveLanguageProfile(root, "dotnet-desktop", 5000, { platform });
    assert.match(blocked.blocked, /yalnızca Windows/);
    assert.equal(blocked.steps.length, 0);
  }
  const win = resolveLanguageProfile(root, "dotnet-desktop", 5000, { platform: "win32" });
  assert.equal(win.blocked, undefined);
  assert.deepEqual(win.steps.map((s) => s.args[0]), ["restore", "build"]);
  assert.ok(!win.start.args.includes("--urls"), "masaüstü uygulamasına URL verilmez");
});

test(".NET profil: Avalonia ve ASP.NET Core her platformda çalışır", () => {
  const avalonia = tree({ "Av.csproj": `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>WinExe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup><PackageReference Include="Avalonia" Version="11"/></ItemGroup></Project>` });
  const web = tree({ "Web.csproj": sdkProject("Microsoft.NET.Sdk.Web") });
  for (const platform of ["win32", "linux", "darwin"]) {
    assert.equal(resolveLanguageProfile(avalonia, "dotnet-desktop", 5000, { platform }).blocked, undefined);
    assert.equal(resolveLanguageProfile(web, "dotnet-server", 5000, { platform }).blocked, undefined);
  }
});

test(".NET profil: MAUI hedef çerçeveyi platforma göre seçer, Linux'ta engellenir", () => {
  const root = tree({ "Maui.csproj": `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFrameworks>net8.0-android;net8.0-windows10.0.19041.0;net8.0-maccatalyst</TargetFrameworks><UseMaui>true</UseMaui><OutputType>Exe</OutputType></PropertyGroup></Project>` });
  const win = resolveLanguageProfile(root, "dotnet-desktop", 5000, { platform: "win32" });
  assert.ok(win.start.args.includes("net8.0-windows10.0.19041.0"));
  assert.ok(win.steps.some((s) => s.args[0] === "workload"), "MAUI iş yükleri geri yüklenir");
  const mac = resolveLanguageProfile(root, "dotnet-desktop", 5000, { platform: "darwin" });
  assert.ok(mac.start.args.includes("net8.0-maccatalyst"));
  assert.match(resolveLanguageProfile(root, "dotnet-desktop", 5000, { platform: "linux" }).blocked, /Linux/);
});

test(".NET profil: klasik .NET Framework — Windows'ta MSBuild, Linux'ta Mono, web Windows dışında engelli", () => {
  const forms = tree({ "Old.sln": "", "Old.csproj": legacyProject("<OutputType>WinExe</OutputType><AssemblyName>OldApp</AssemblyName>", '<Reference Include="System.Windows.Forms"/>') });
  const win = resolveLanguageProfile(forms, "dotnet-desktop", 5000, { platform: "win32", msbuildPath: "C:\\VS\\MSBuild.exe" });
  assert.equal(win.steps[0].command, "C:\\VS\\MSBuild.exe");
  assert.equal(win.steps.at(-1).args[0], "Old.sln");
  assert.ok(win.start.command.endsWith(path.join("bin", "Debug", "OldApp.exe")));
  const linux = resolveLanguageProfile(forms, "dotnet-desktop", 5000, { platform: "linux" });
  assert.equal(linux.steps[0].command, "msbuild");
  assert.equal(linux.start.command, "mono");

  const mvc = tree({ "Mvc.csproj": legacyProject("<ProjectTypeGuids>{349C5851-65DF-11DA-9384-00065B846F21}</ProjectTypeGuids>", '<Reference Include="System.Web.Mvc"/>') });
  const iis = resolveLanguageProfile(mvc, "dotnet-server", 5077, { platform: "win32", msbuildPath: "C:\\VS\\MSBuild.exe", iisExpressPath: "C:\\IIS\\iisexpress.exe" });
  assert.equal(iis.start.command, "C:\\IIS\\iisexpress.exe");
  assert.ok(iis.start.args.includes("/port:5077"));
  assert.match(resolveLanguageProfile(mvc, "dotnet-server", 5077, { platform: "linux" }).blocked, /yalnızca Windows/);

  const wpf = tree({ "Wpf.csproj": legacyProject("<OutputType>WinExe</OutputType>", '<Reference Include="PresentationFramework"/>') });
  assert.match(resolveLanguageProfile(wpf, "dotnet-desktop", 5000, { platform: "darwin" }).blocked, /yalnızca Windows/);
});

test(".NET profil: Xamarin için açık bir yönlendirme verilir", () => {
  const root = tree({ "Xam.csproj": legacyProject("<OutputType>Library</OutputType>", '<PackageReference Include="Xamarin.Forms" Version="5"/>') });
  const profile = resolveLanguageProfile(root, "dotnet-desktop", 5000, { platform: "win32", msbuildPath: "C:\\VS\\MSBuild.exe" });
  assert.ok(profile.blocked || profile.steps.length > 0);
});

test("init, .NET gibi platforma bağlı komutları setup.config.json'a yazmaz", async () => {
  const { initProject } = await import("./setup-api.mjs");
  const root = tree({ "Web.csproj": sdkProject("Microsoft.NET.Sdk.Web") });
  initProject(root, { createLaunchers: false });
  const config = JSON.parse(fs.readFileSync(path.join(root, "setup.config.json"), "utf8"));
  assert.equal(config.install.auto, true);
  assert.equal(config.start, undefined, "başlatma komutu dosyaya yazılmaz (makineye özgü olurdu)");
});

// ------------------------------------------------------------------ Java

test("Java: Spring Boot (Maven), JavaFX (Gradle), Swing ve düz Maven sınıflandırılır ve doğru komutu alır", () => {
  const spring = tree({ "pom.xml": "<project><parent><artifactId>spring-boot-starter-parent</artifactId></parent></project>" });
  assert.equal(detectProject(spring).kind, "java-server");
  const sp = resolveLanguageProfile(spring, "java-server", 8085, { platform: "linux" });
  assert.deepEqual(sp.start.args, ["spring-boot:run"]);
  assert.equal(sp.start.env.SERVER_PORT, "8085");

  const fx = tree({ "build.gradle": "plugins { id 'application'; id 'org.openjfx.javafxplugin' version '0.1.0' }" });
  assert.equal(detectProject(fx).kind, "java-desktop");
  assert.deepEqual(resolveLanguageProfile(fx, "java-desktop", 8080, { platform: "linux" }).start.args, ["run"]);

  const swing = tree({
    "pom.xml": "<project/>",
    "src/main/java/app/Main.java": "package app; import javax.swing.JFrame; public class Main { public static void main(String[] a){ new JFrame(); } }",
  });
  assert.equal(detectProject(swing).kind, "java-desktop");

  const plain = tree({
    "pom.xml": "<project/>",
    "src/main/java/demo/Hello.java": "package demo; public class Hello { public static void main(String[] a){ } }",
  });
  const pp = resolveLanguageProfile(plain, "java-server", 8080, { platform: "linux" });
  assert.deepEqual(pp.start.args, ["-cp", "target/classes", "demo.Hello"]);
});

test("Java: wrapper (mvnw/gradlew) varsa PATH'teki mvn/gradle aranmaz; Windows'ta .cmd kullanılır", () => {
  const maven = tree({ "pom.xml": "<project><dependency>spring-boot</dependency></project>", mvnw: "#!/bin/sh", "mvnw.cmd": "@echo off" });
  const linux = resolveLanguageProfile(maven, "java-server", 8080, { platform: "linux" });
  assert.equal(linux.steps[0].command, "sh");
  assert.ok(linux.steps[0].args[0].endsWith("mvnw"));
  const win = resolveLanguageProfile(maven, "java-server", 8080, { platform: "win32" });
  assert.ok(win.steps[0].command.endsWith("mvnw.cmd"));
  assert.equal(checkToolchain(maven, win.steps[0]).ok, true, "mutlak yollu wrapper için PATH denetimi yapılmaz");
});

// ------------------------------------------------------------------ PHP / Ruby

test("PHP: Laravel package.json (Vite) olsa bile Node değil PHP olarak algılanır; artisan serve", () => {
  const laravel = tree({
    "composer.json": JSON.stringify({ require: { "laravel/framework": "^11" } }),
    artisan: "#!/usr/bin/env php",
    "package.json": JSON.stringify({ name: "l", scripts: { dev: "vite" }, devDependencies: { vite: "^5" } }),
    "public/index.php": "<?php",
  });
  assert.equal(detectProject(laravel).kind, "php-server");
  const profile = resolveLanguageProfile(laravel, "php-server", 8123);
  assert.deepEqual(profile.start.args, ["artisan", "serve", "--host=127.0.0.1", "--port=8123"]);
  assert.equal(profile.steps[0].command, "composer");
});

test("PHP: çerçevesiz projede yerleşik sunucu public/ klasörünü kullanır; Node sunucusu olan repo Node kalır", () => {
  const plain = tree({ "composer.json": "{}", "public/index.php": "<?php" });
  assert.deepEqual(resolveLanguageProfile(plain, "php-server", 8000).start.args, ["-S", "127.0.0.1:8000", "-t", "public"]);
  const nodeWithGem = tree({
    "package.json": JSON.stringify({ name: "n", scripts: { start: "node s.js" }, dependencies: { express: "4" } }),
    "s.js": "", Gemfile: "gem 'jekyll'",
  });
  assert.equal(detectProject(nodeWithGem).kind, "node-server");
});

test("Ruby: Rails, Sinatra, Rack ve Jekyll doğru başlatma komutunu alır", () => {
  const rails = tree({ Gemfile: "gem 'rails'", "config/application.rb": "", "package.json": JSON.stringify({ name: "r", scripts: { build: "esbuild" } }) });
  assert.equal(detectProject(rails).kind, "ruby-server");
  assert.deepEqual(resolveLanguageProfile(rails, "ruby-server", 3100).start.args, ["exec", "rails", "server", "-b", "127.0.0.1", "-p", "3100"]);
  const sinatra = tree({ Gemfile: "gem 'sinatra'", "app.rb": "" });
  assert.deepEqual(resolveLanguageProfile(sinatra, "ruby-server", 4567).start.args, ["exec", "ruby", "app.rb", "-o", "127.0.0.1", "-p", "4567"]);
  const rack = tree({ Gemfile: "gem 'rack'", "config.ru": "" });
  assert.equal(resolveLanguageProfile(rack, "ruby-server", 9292).start.args[1], "rackup");
  const jekyll = tree({ Gemfile: "gem 'jekyll'" });
  assert.equal(resolveLanguageProfile(jekyll, "ruby-server", 4000).start.args[1], "jekyll");
});

// ------------------------------------------------------------------ Masaüstü: Flutter, Swift, Go, Rust, Pascal

test("Flutter: masaüstü klasörü olan platformda çalışır, yoksa nasıl ekleneceği söylenir", () => {
  const files = { "pubspec.yaml": "name: demo\ndependencies:\n  flutter:\n    sdk: flutter\n", "windows/runner.txt": "", "linux/runner.txt": "" };
  const root = tree(files);
  assert.equal(detectProject(root).kind, "flutter-desktop");
  assert.deepEqual(resolveLanguageProfile(root, "flutter-desktop", 5000, { platform: "win32" }).start.args, ["run", "-d", "windows"]);
  assert.deepEqual(resolveLanguageProfile(root, "flutter-desktop", 5000, { platform: "linux" }).start.args, ["run", "-d", "linux"]);
  assert.match(resolveLanguageProfile(root, "flutter-desktop", 5000, { platform: "darwin" }).blocked, /flutter create --platforms=macos/);
});

test("Swift: sunucu (Vapor) her yerde, masaüstü yalnızca macOS/Linux; Xcode-only proje engellenir", () => {
  const vapor = tree({ "Package.swift": "// vapor\nlet package = Package(dependencies: [.package(url: \"https://github.com/vapor/vapor\")])" });
  assert.equal(detectProject(vapor).kind, "swift-app");
  assert.equal(resolveLanguageProfile(vapor, "swift-app", 8080, { platform: "win32" }).blocked, undefined);
  const app = tree({ "Package.swift": "let package = Package(name: \"App\")" });
  assert.match(resolveLanguageProfile(app, "swift-app", 8080, { platform: "win32" }).blocked, /Windows'ta desteklenmez/);
  assert.equal(resolveLanguageProfile(app, "swift-app", 8080, { platform: "darwin" }).blocked, undefined);
  const xcode = tree({ "App.xcodeproj/project.pbxproj": "" });
  assert.match(resolveLanguageProfile(xcode, "swift-app", 8080, { platform: "linux" }).blocked, /Xcode/);
});

test("Go (Wails/Fyne) ve Rust (egui/iced) GUI projeleri masaüstü olarak algılanır; sade Go/Rust sunucu kalır", () => {
  const wails = tree({ "wails.json": "{}", "go.mod": "module x\nrequire github.com/wailsapp/wails/v2 v2.0.0" });
  assert.equal(detectProject(wails).kind, "go-desktop");
  assert.deepEqual(resolveLanguageProfile(wails, "go-desktop", 5000).start.args, ["dev"]);
  const fyne = tree({ "go.mod": "module x\nrequire fyne.io/fyne/v2 v2.4.0", "main.go": "package main" });
  assert.equal(detectProject(fyne).kind, "go-desktop");
  assert.equal(detectProject(tree({ "go.mod": "module x", "main.go": "package main" })).kind, "go-server");

  const egui = tree({ "Cargo.toml": '[package]\nname = "x"\n[dependencies]\neframe = "0.27"\n', "src/main.rs": "fn main(){}" });
  assert.equal(detectProject(egui).kind, "rust-desktop");
  assert.equal(detectProject(tree({ "Cargo.toml": '[package]\nname = "x"\n[dependencies]\naxum = "0.7"\n', "src/main.rs": "" })).kind, "rust-server");
});

test("Lazarus ve Delphi projeleri tanınır; Delphi yalnızca Windows'ta derlenir", () => {
  const laz = tree({ "demo.lpi": '<CONFIG><Target><Filename Value="demo"/></Target></CONFIG>' });
  assert.equal(detectProject(laz).kind, "lazarus-desktop");
  const lp = resolveLanguageProfile(laz, "lazarus-desktop", 5000, { platform: "linux" });
  assert.equal(lp.steps[0].command, "lazbuild");
  const delphi = tree({ "App.dproj": "<Project/>", "App.dpr": "program App;" });
  assert.equal(detectProject(delphi).kind, "delphi-desktop");
  assert.match(resolveLanguageProfile(delphi, "delphi-desktop", 5000, { platform: "linux" }).blocked, /yalnızca Windows/);
  assert.equal(resolveLanguageProfile(delphi, "delphi-desktop", 5000, { platform: "win32" }).blocked, undefined);
});

test("Qt qmake (.pro) projesi C++ masaüstü olarak algılanır; Python GUI listesi genişledi", () => {
  const qt = tree({ "app.pro": "QT += core gui widgets\nSOURCES += main.cpp", "Makefile": "all:", "main.cpp": "int main(){}" });
  assert.equal(detectProject(qt).kind, "cpp-desktop");
  for (const lib of ["kivy", "pygame", "customtkinter", "flet"]) {
    const root = tree({ "requirements.txt": `${lib}\n`, "main.py": `import ${lib}\n` });
    assert.equal(detectProject(root).kind, "python-desktop", lib);
  }
});

// ------------------------------------------------------------------ Docker ve öncelik kuralları

test("Docker Compose / Dockerfile: yayınlanan port okunur; başka dili olan proje docker sayılmaz", () => {
  const compose = tree({ "docker-compose.yml": "services:\n  web:\n    image: nginx\n    ports:\n      - \"4112:80\"\n" });
  assert.equal(detectProject(compose).kind, "docker-compose");
  const profile = resolveLanguageProfile(compose, "docker-compose", 5000);
  assert.equal(profile.port, 4112);
  assert.deepEqual(profile.start.args, ["compose", "up", "--build"]);
  assert.deepEqual(profile.start.stop.args, ["compose", "down"]);
  const dockerfile = tree({ Dockerfile: "FROM node\nEXPOSE 3030\n" });
  assert.equal(resolveLanguageProfile(dockerfile, "docker-compose", 5000).port, 3030);
  assert.equal(detectProject(tree({ "requirements.txt": "flask\n", "app.py": "", Dockerfile: "FROM python" })).kind, "python-server");
});

// ------------------------------------------------------------------ Hazırlık, araç zinciri, sırlar

test("kurulum hazırlığı: Java derleme çıktısı, PHP vendor, .NET obj/project.assets.json aranır", () => {
  const java = tree({ "pom.xml": "<project/>" });
  assert.equal(checkDependencies(java).ready, false);
  fs.mkdirSync(path.join(java, "target"));
  assert.equal(checkDependencies(java).ready, true);

  const php = tree({ "composer.json": "{}" });
  assert.equal(checkDependencies(php).ready, false);
  fs.mkdirSync(path.join(php, "vendor"));
  fs.writeFileSync(path.join(php, "vendor", "autoload.php"), "");
  assert.equal(checkDependencies(php).ready, true);

  const dotnet = tree({ "Web.csproj": sdkProject("Microsoft.NET.Sdk.Web") });
  assert.equal(checkDependencies(dotnet).ready, false);
  fs.mkdirSync(path.join(dotnet, "obj"));
  fs.writeFileSync(path.join(dotnet, "obj", "project.assets.json"), "{}");
  assert.equal(checkDependencies(dotnet).ready, true);
  assert.equal(ecosystemReadiness(dotnet).id, "dotnet");
});

test("eksik araç zinciri için kurulum bağlantısı verilir (mvn, composer, bundle, flutter …)", () => {
  for (const tool of ["mvn", "gradle", "composer", "bundle", "flutter", "swift", "lazbuild", "wails", "docker", "mono", "msbuild"]) {
    const result = checkToolchain(os.tmpdir(), { command: tool, args: ["--version"] });
    assert.ok(result.ok || /Kurulum: .+(https?:\/\/|gem install)/.test(result.message), `${tool}: ${result.message}`);
  }
});

test("Laravel APP_KEY ve Rails/Django SECRET_KEY(_BASE) şablondan rastgele üretilir", () => {
  const out = materializeEnvTemplate("APP_KEY=\nSECRET_KEY_BASE=\nSECRET_KEY=change-me\nAPP_NAME=demo\nSTRIPE_SECRET=\n");
  assert.deepEqual(out.generated.sort(), ["APP_KEY", "SECRET_KEY", "SECRET_KEY_BASE"]);
  assert.match(out.text, /APP_KEY="base64:[A-Za-z0-9+/=]{40,}"/);
  assert.match(out.text, /STRIPE_SECRET=$/m, "üçüncü taraf sırları üretilmez");
});

test("parseDotnetProject: çoklu hedef çerçeve ve düz kitaplık", () => {
  const root = tree({ "Multi.csproj": `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFrameworks>net6.0;net8.0</TargetFrameworks></PropertyGroup></Project>` });
  const project = parseDotnetProject(root, path.join(root, "Multi.csproj"));
  assert.deepEqual(project.tfms, ["net6.0", "net8.0"]);
  assert.equal(project.category, "library");
});

test("masaüstü uygulamasında harici veri dizini verilince kurulum kilidi o dizinde oluşur (menü 6 çökmez)", async () => {
  const { createTerminalBootstrap } = await import("./terminal-bootstrap.mjs");
  const { initProject } = await import("./setup-api.mjs");
  const root = tree({ "main.py": "import tkinter\n", "requirements.txt": "# yok\n" });
  initProject(root, { createLaunchers: false }); // setup.config.json içinde paths.lockFile = data/installation.lock
  const external = fs.mkdtempSync(path.join(os.tmpdir(), "setup-userdata-"));
  const t = createTerminalBootstrap({ root, dataDir: external, log: () => {}, noOpen: true });
  const result = t.ensureDefaultEnvironment();
  assert.ok(result.lockPath.startsWith(external), `kilit harici dizinde olmalı: ${result.lockPath}`);
  assert.ok(fs.existsSync(result.lockPath));
  assert.ok(!fs.existsSync(path.join(root, "data")), "projede data/ klasörü oluşturulmamalı");
});

test("yalnızca sınıf kitaplığı/test projesi olan .NET deposu çalıştırılmaya çalışılmaz, nedeni söylenir", () => {
  const lib = tree({ "Lib.csproj": sdkProject("Microsoft.NET.Sdk") });
  assert.match(resolveLanguageProfile(lib, "dotnet-desktop", 5000, { platform: "linux" }).blocked, /çalıştırılabilir bir proje bulunamadı/);
});

test("yalnızca index.php olan basit proje PHP olarak algılanır ve php yoksa kurulum bağlantısı verilir", () => {
  const root = tree({ "index.php": "<?php echo 1;" });
  assert.equal(detectProject(root).kind, "php-server");
  const profile = resolveLanguageProfile(root, "php-server", 8000);
  assert.deepEqual(profile.start.args, ["-S", "127.0.0.1:8000"]);
  assert.equal(profile.steps[0].command, "php");
});

test("Ruby: Gemfile.lock tek başına yetmez, vendor/bundle yoksa `bundle check` sonucu belirler", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eco-ruby-ready-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  fs.writeFileSync(path.join(dir, "Gemfile"), "source 'https://rubygems.org'\ngem 'rackup'\n");
  assert.equal(ecosystemReadiness(dir, { bundleCheck: () => true }).ready, false, "lock yokken hazır sayılmamalı");
  fs.writeFileSync(path.join(dir, "Gemfile.lock"), "GEM\n");
  assert.equal(ecosystemReadiness(dir, { bundleCheck: () => false }).ready, false, "gem'ler kurulu değilse (check başarısız) hazır sayılmamalı");
  assert.equal(ecosystemReadiness(dir, { bundleCheck: () => true }).ready, true, "sistem gem'leriyle kurulmuşsa (check başarılı) hazır sayılmalı");
  fs.mkdirSync(path.join(dir, "vendor", "bundle"), { recursive: true });
  assert.equal(ecosystemReadiness(dir, { bundleCheck: () => false }).ready, true, "vendor/bundle varsa check gerekmez");
});

test("Qt qmake: Makefile yoksa profil qmake + make adımlarını ve platforma uygun ikiliyi üretir", () => {
  const qt = tree({ "demo.pro": "QT += widgets\nTARGET = demoapp\nSOURCES += main.cpp", "main.cpp": "int main(){}" });
  const profile = resolveLanguageProfile(qt, "cpp-desktop", 5000);
  assert.deepEqual(profile.steps[0], { label: "Qt yapılandırması (qmake demo.pro)", command: "qmake", args: ["demo.pro"] });
  assert.equal(profile.steps[1].command, process.platform === "win32" ? "mingw32-make" : "make");
  const expected = process.platform === "darwin" ? "./demoapp.app/Contents/MacOS/demoapp" : process.platform === "win32" ? "./release/demoapp.exe" : "./demoapp";
  assert.equal(profile.start.command, expected);
  const withMakefile = tree({ "demo.pro": "QT += widgets", Makefile: "all:", "main.cpp": "int main(){}" });
  assert.equal(resolveLanguageProfile(withMakefile, "cpp-desktop", 5000).steps[0].command, "make", "hazır Makefile varsa qmake çalıştırılmaz");
});

test("CMake: derlenmiş ikili varsa kayıtlı `--target run` yerine o çalıştırılır (çoğu projede run hedefi yoktur)", () => {
  const root = tree({ "CMakeLists.txt": "project(demoqt)\nadd_executable(demoqt main.cpp)\n", "main.cpp": "int main(){}" });
  const start = { command: "cmake", args: ["--build", "build", "--target", "run"], fallbackCommand: "build/demoqt", fallbackCommands: ["build/alt/demoqt"] };
  assert.match(String(resolveAppStartInvocation(root, { start }).command), /cmake/i, "ikili yokken kayıtlı komut kullanılır");
  fs.mkdirSync(path.join(root, "build", "alt"), { recursive: true });
  fs.writeFileSync(path.join(root, "build", "alt", "demoqt"), "");
  assert.equal(resolveAppStartInvocation(root, { start }).command, path.resolve(root, "build", "alt", "demoqt"), "yedek komutlardan var olan seçilir");
  fs.writeFileSync(path.join(root, "build", "demoqt"), "");
  assert.equal(resolveAppStartInvocation(root, { start }).command, path.resolve(root, "build", "demoqt"), "ana yedek komut önceliklidir");
});

test("Qt qmake: yalnızca .pro içeren proje kurulabilir sayılır; Makefile üretilince hazır olur", () => {
  const qt = tree({ "demo.pro": "QT += widgets\nSOURCES += main.cpp", "main.cpp": "int main(){}" });
  const detection = detectProject(qt);
  assert.equal(detection.kind, "cpp-desktop");
  assert.equal(buildInstallPlan(detection).canInstall, true, "Tanımlı proje bulunamadı hatası vermemeli");
  assert.equal(checkDependencies(qt).ready, false, "qmake çalışmadan hazır sayılmamalı");
  fs.writeFileSync(path.join(qt, "Makefile"), "all:\n");
  assert.equal(checkDependencies(qt).ready, true, "qmake Makefile üretince hazır sayılmalı");
  const notQt = tree({ "notes.pro": "% prolog dosyası\nfoo(bar).\n", "README.md": "x" });
  assert.notEqual(detectProject(notQt).kind, "cpp-desktop", "Qt olmayan .pro dosyası Qt projesi sayılmamalı");
});
