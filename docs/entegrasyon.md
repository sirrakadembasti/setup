# setup — 5 Mimari Senaryo Entegrasyon ve Uygulama Kılavuzu (v1.0)

`setup` (`https://github.com/sirrakadembasti/setup.git`), herhangi bir GitHub reposundaki Node.js, SPA/statik web, full-stack, çoklu dil (Python, Go, C# .NET, Rust) veya masaüstü (Electron, Tauri) uygulamasını son kullanıcıların ve sistem yöneticilerinin terminal komutlarıyla boğuşmadan tarayıcı veya masaüstü penceresi üzerinden kurabilmesi için tasarlanmış sıfır bağımlılıklı kurulum eklentisidir.

---

## Masaüstü Uygulamaları: Başlatma ve Durum

- **Başlatma ve durum (CLI/Sidecar):** Masaüstü uygulamaları port açmadığından sihirbaz bitişte "Masaüstü uygulamasını başlat" düğmesi gösterir. `/api/start-app` uygulamayı ayrı bir süreç olarak açar ve **portu değil süreci** denetler: 3 sn içinde kapanırsa 409 ve çıkış koduyla hata döner, ayaktaysa PID bildirir; `/api/app-health` aynı süreç durumunu verir. Başlatma komutu `setup.config.json` içindeki `start` alanından gelir (`init` bunu Electron için `scripts.start` veya `npx electron .`, Tauri için `scripts.tauri` → `<pm> run tauri dev` olarak yazar).
- **Veri dizini:** Kurulum verileri varsayılan olarak proje dizinine yazılır. Paketlenmiş uygulamada kullanıcı verisi dizinini (`app.getPath('userData')`) `dataDir` ile (IPC) veya `--data-dir` ile (Sidecar) verin; `setup` bu dizini tahmin etmez.

## `setup init` Seçenekleri

- Varsayılan: `setup.config.json` + `kurulum.bat` / `kurulum.sh` yazılır; `package.json` değiştirilmez.
- `--no-launchers`: başlatıcı üretilmez. `--update-package-json`: `package.json` içine `setup` (ve gömülü kurulumlarda `wizard`) script'i eklenir. `--force`: mevcut dosyaların üzerine yazar.
- Yapılandırma zaten varsa `init` yalnız eksik başlatıcıları ekler; hiçbir şey yazılmadıysa çıkış kodu 1'dir.
- `bin/kurulum.sh|bat` (eklentinin kendi ön kontrol betiği) çağrıldığı dizindeki projeyi kurar: `cd /proje && /yol/setup/bin/kurulum.sh`.

## Güvenlik Notları (Gömülü Kullanım)

- **CSRF + Origin:** `ipcMode: true` olmayan her çekirdek (`mountSetupGuard`, Next/Fastify/Hono route'ları) mutasyon isteklerinde `x-setup-csrf` başlığı ister; değer sihirbaz sayfasına gömülür (`core.csrfToken`). `Origin` başlığı varsa `Host` ile veya `allowedOrigins` seçeneğiyle eşleşmelidir.
- **Anahtar:** `token` verilmezse her çekirdek örneği rastgele bir anahtar üretir. Sunucusuz veya birden çok süreçli dağıtımlarda `token: process.env.SETUP_TOKEN` verin.
- **Arayüz tabanı:** Gömülü sayfa API'ye `apiBase` altından gider (`mountSetupGuard` için `/api/setup`; kendi route'unuzda `apiBase: "/api/setup", embedded: true` verin).
- **Kurulum sonrası:** `/setup` ve sihirbaz uçları 404 döner; `/api/status` yalnız sade durum verir. `runtime-config` ucu `.env` değerlerini veya parola özetini döndürmez; bunlara yalnız `readSetupRuntimeConfig()` ile sunucu tarafında erişin.

## İçindekiler

1. [Tek Komutla Entegrasyon (`setup init`) ve Teknoloji Algılama](#1-tek-komutla-entegrasyon-setup-init-ve-teknoloji-algılama)
2. [Senaryo 1: Express.js ve Node.js Sunucu Uygulamaları](#senaryo-1-expressjs-ve-nodejs-sunucu-uygulamaları)
3. [Senaryo 2: Tek Sayfalık (SPA) ve Statik Web Uygulamaları (React, Vue, Vite, Saf HTML/JS)](#senaryo-2-tek-sayfalık-spa-ve-statik-web-uygulamaları-react-vue-vite-saf-htmljs)
4. [Senaryo 3: Full-Stack Uygulamalar (Next.js App Router, Nuxt, SvelteKit, Astro, Monorepo)](#senaryo-3-full-stack-uygulamalar-nextjs-app-router-nuxt-sveltekit-astro-monorepo)
5. [Senaryo 4: Diğer Sunucu Uygulamaları (Fastify/Koa/Hono, Python FastAPI/Django, Go, C# .NET, Rust)](#senaryo-4-diğer-sunucu-uygulamaları-fastifykoahono-python-fastapidjango-go-c-net-rust)
6. [Senaryo 5: Masaüstü Uygulamaları (Electron, Tauri, C# WPF/MAUI, PyQt)](#senaryo-5-masaüstü-uygulamaları-electron-tauri-c-wpfmaui-pyqt)
7. [Alt Klasör veya Git Submodule Olarak Ekleme](#2-alt-klasör-veya-git-submodule-olarak-ekleme)
8. [`setup.config.json` ile Özelleştirme](#3-setupconfigjson-ile-özelleştirme)
9. [Güvenlik Standartları](#4-güvenlik-standartları)

---

## 1. Tek Komutla Entegrasyon (`setup init`) ve Teknoloji Algılama

Eklentiyi hedef GitHub reponuza bağlamanın en hızlı yolu `init` komutudur:

```bash
node /path/to/setup/bin/setup.mjs init --root /path/to/hedef-repo
# Mevcut setup.config.json üzerine yazmak için:
node /path/to/setup/bin/setup.mjs init --root /path/to/hedef-repo --force
```

Bu komut hedef repoyu tarar ve:
- Paket yöneticisini (`npm`, `pnpm`, `yarn`, `bun`),
- Proje yapısını (`node-package`, `node-webapp`, `node-fullstack`, `workspace-fullstack`, `desktop-app`, `static-web`, `python-server`, `go-server`, `dotnet-server`, `rust-server`),
- Varsa `.env.example` değişkenlerini ve dizin yollarını (`.env` veya `server/.env`) algılayarak hedef dizinde **`setup.config.json`** dosyasını oluşturur ve `package.json` içine `"setup": "setup"` betiğini ekler.

### Teknoloji algılama nasıl çalışır?

`detect` komutu `express`, `fastify`, `koa`, `hono`, `react`, `vue`, `next`, `nuxt`, `sveltekit`, `astro`, `vite`, `electron` ve `tauri` için iki kanıtı birlikte değerlendirir ve sonucu `dependencyUsage` alanında raporlar:

| Alan | Anlamı |
|---|---|
| `declared` | Paket kök, `server/`, `client/` veya workspace alt paketlerindeki `package.json` dosyasında bildirilmiş |
| `used` | Kaynakta `import` / `export from` / `require()` / `import()` ile (alt yollar dahil) kullanılıyor veya bir `package.json` script'inde CLI olarak çağrılıyor |
| `sourceScanned` | En az bir kaynak dosya (`.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.tsx`, `.vue`, `.svelte` …) tarandı |

Paket, `used` ise **veya** kaynak dosya hiç bulunamadığı için doğrulama yapılamıyor ve `declared` ise kullanılıyor kabul edilir. `node_modules`, `dist`/`build`/`.next` gibi çıktı dizinleri, `data`/`uploads`, test dizinleri ile `*.test.*` / `*.spec.*` dosyaları ve yorum satırları taramaya dahil edilmez.

---

## Senaryo 1: Express.js ve Node.js Sunucu Uygulamaları

Express.js veya yerleşik `node:http` tabanlı sunucu uygulamalarında iki farklı entegrasyon yöntemi kullanabilirsiniz: **Doğrudan Gömülü Middleware (`mountSetupGuard`)** veya **Sıfır Kod Değişikliği ile CLI (`setup init`)**.

### Yöntem A: Express.js İçine Gömülü Kurulum Koruması (`mountSetupGuard`)

1. Paketi yükleyin:
```bash
npm install github:sirrakadembasti/setup
```

2. `server.mjs` (veya `app.mjs`) dosyanıza `mountSetupGuard`, `readSetupRuntimeConfig` ve `verifyAdminCredentials` fonksiyonlarını bağlayın:

```js
import express from "express";
import {
  mountSetupGuard,
  readSetupRuntimeConfig,
  verifyAdminCredentials,
} from "setup";

const app = express();
app.use(express.json());

// 1. Kurulum tamamlanana kadar (data/installation.lock oluşana kadar)
//    HTML isteklerini (302) /setup sihirbazına yönlendirir,
//    API isteklerine (503) { setupRequired: true, redirectUrl: "/setup" } döner.
//    embedWizard: true ile 5 adımlı sihirbaz doğrudan /setup ve /api/setup/* altında sunulur.
mountSetupGuard(app, {
  projectRoot: process.cwd(),
  embedWizard: true,
  allowPaths: ["/healthz"],
});

app.get("/healthz", (_req, res) => {
  const runtime = readSetupRuntimeConfig(process.cwd());
  res.json({ ok: true, installed: runtime.installed });
});

// 2. Kurulum sırasında oluşturulan ilk yönetici hesabını (scrypt) doğrulama
app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body ?? {};
  const isValid = verifyAdminCredentials(process.cwd(), email, password);

  if (!isValid) {
    return res.status(401).json({ ok: false, message: "E-posta veya parola hatalı." });
  }

  const runtime = readSetupRuntimeConfig(process.cwd());
  return res.json({
    ok: true,
    admin: {
      name: runtime.admin?.name,
      email: runtime.admin?.email,
    },
    publicUrl: runtime.deployment?.publicUrl,
  });
});

app.get("/", (_req, res) => {
  const runtime = readSetupRuntimeConfig(process.cwd());
  res.send(`Uygulama aktif! Ortam: ${runtime.env.NODE_ENV || "development"}`);
});

const port = Number(process.env.PORT || 5000);
app.listen(port, "127.0.0.1", () => {
  console.log(`Sunucu çalışıyor: http://127.0.0.1:${port}`);
});
```

### Yöntem B: Kod Değiştirmeden CLI ile Kurulum ve Başlatma

Uygulama koduna hiç dokunmadan kurulum başlatıcısını (port `5049`) ve sihirbazı (port `5050`) çalıştırabilirsiniz:

```bash
# 1. Hedef repoya setup.config.json ve npm run setup betiğini ekleyin
npx github:sirrakadembasti/setup init --root .

# 2. Kurulum başlatıcısını açın (bağımlılıkları kurar, ardından 5050 sihirbazına geçirir)
npm run setup
```

---

## Senaryo 2: Tek Sayfalık (SPA) ve Statik Web Uygulamaları (React, Vue, Vite, Saf HTML/JS)

Tarayıcıda çalışan SPA ve statik web uygulamalarında `SESSION_SECRET`, `ADMIN_PASSWORD_HASH` veya `EMAIL_PASS` gibi gizli anahtarlar istemciye **asla** sızdırılmaz. `setup`, derleme (`npm run build`) sonrasında çıktı dizinine (`dist/`, `build/`, `public/` veya `.`) yalnızca güvenli genel ayarları (`VITE_*`, `PUBLIC_*`, `NEXT_PUBLIC_*`, `REACT_APP_*` ve `deployment` bilgileri) içeren `runtime-config.json` ve `env-config.js` (`window.__SETUP_CONFIG__`) dosyalarını yazar.

### 1. Kurulum ve Yerleşik Statik Sunucu ile Başlatma

```bash
# Projeyi algılar, varsa npm run build çalıştırır, runtime-config.json/env-config.js üretir
# ve preview script'i yoksa yerleşik createStaticAppServer ile hedef portta sunar:
npx github:sirrakadembasti/setup --root .

# Veya geliştirme sırasında Vite/React dev sunucusuna (5173) BFF/Sidecar olarak bağlamak için:
SETUP_ALLOWED_ORIGINS=http://localhost:5173 npx github:sirrakadembasti/setup wizard --root . --port 5050
```

### 2. Saf HTML / Vite `index.html` İçinden Senkron Okuma (`env-config.js`)

`index.html` dosyanıza `/env-config.js` betiğini ekleyerek yeniden derleme (`rebuild`) gerekmeden kurulum ayarlarını okuyabilirsiniz:

```html
<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <title>SPA Uygulaması</title>
    <!-- setup sihirbazının ürettiği genel çalışma anı yapılandırması -->
    <script src="/env-config.js"></script>
  </head>
  <body>
    <div id="app"></div>
    <script type="module">
      const config = window.__SETUP_CONFIG__ || {};
      console.log("Uygulama Genel Adresi:", config.deployment?.publicUrl);
      console.log("API Adresi:", config.env?.VITE_API_URL);
    </script>
  </body>
</html>
```

### 3. React / Vue / Vite İçinden Asenkron Okuma (`/runtime-config.json`)

```js
// src/config/runtime.js
let cachedConfig = null;

export async function loadAppRuntimeConfig() {
  if (cachedConfig) return cachedConfig;

  if (typeof window !== "undefined" && window.__SETUP_CONFIG__) {
    cachedConfig = window.__SETUP_CONFIG__;
    return cachedConfig;
  }

  const response = await fetch("/runtime-config.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Kurulum yapılandırması (/runtime-config.json) henüz oluşturulmamış.");
  }
  cachedConfig = await response.json();
  return cachedConfig;
}
```

### 4. Programatik Olarak Yerleşik SPA Sunucusunu Kullanma (`createStaticAppServer`)

```js
import { createStaticAppServer } from "setup/wizard";

// Dizin geçiş (path traversal) korumalı ve SPA History API fallback destekli sunucu
const server = createStaticAppServer("./dist");
server.listen(5000, "127.0.0.1", () => {
  console.log("Statik SPA sunucusu hazır: http://127.0.0.1:5000");
});
```

---

## Senaryo 3: Full-Stack Uygulamalar (Next.js App Router, Nuxt, SvelteKit, Astro, Monorepo)

Express kullanmayan modern full-stack framework'lerde `setup/core` altındaki HTTP-bağımsız `createSetupWizardCore` çekirdeğini doğrudan Route Handler içine gömebilir veya CLI üzerinden çalıştırabilirsiniz.

### 1. Kurulum Çekirdeği Singleton (`lib/setup.js`)

```js
// lib/setup.js
import {
  createSetupWizardCore,
  readSetupRuntimeConfig,
  verifyAdminCredentials,
} from "setup/core";

const globalForSetup = globalThis;

export const setupCore =
  globalForSetup.__setupWizardCore ||
  createSetupWizardCore({
    projectRoot: process.cwd(),
    syncApply: true,
    title: "Next.js Kurulum Sihirbazı",
    // Serverless/çoklu örnekte CSRF anahtarının tutarlı kalması için sabit ve gizli bir değer verin.
    token: process.env.SETUP_TOKEN,
    apiBase: "/api/setup",
    embedded: true,
  });

if (process.env.NODE_ENV !== "production") {
  globalForSetup.__setupWizardCore = setupCore;
}

export function getRuntimeConfig() {
  return readSetupRuntimeConfig(process.cwd());
}

export function checkAdminLogin(email, password) {
  return verifyAdminCredentials(process.cwd(), email, password);
}
```

### 2. Next.js App Router Catch-All Route Handler (`app/api/setup/[...slug]/route.js`)

```js
// app/api/setup/[...slug]/route.js
import { NextResponse } from "next/server";
import { setupCore } from "@/lib/setup";

async function delegateToSetup(request, context) {
  const params = await context.params;
  const slug = Array.isArray(params?.slug) ? params.slug.join("/") : "";
  const mappedPath = slug === "" || slug === "ui" ? "/setup" : `/api/${slug}`;

  const headers = Object.fromEntries(request.headers.entries());
  const body =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.text();

  const result = await setupCore.handle({
    method: request.method,
    path: mappedPath,
    headers,
    body,
  });

  return new NextResponse(
    typeof result.body === "string" ? result.body : JSON.stringify(result.body),
    {
      status: result.status,
      headers: result.headers,
    },
  );
}

export const GET = delegateToSetup;
export const POST = delegateToSetup;
```

### 3. Server Action veya Sayfa Yönlendirme Koruması (`app/page.js`)

```js
// app/page.js
import { redirect } from "next/navigation";
import { getRuntimeConfig } from "@/lib/setup";

export default function HomePage() {
  const runtime = getRuntimeConfig();

  if (!runtime.installed) {
    redirect("/api/setup/ui");
  }

  return (
    <main>
      <h1>{runtime.deployment?.publicUrl} — Kurulum Tamamlandı</h1>
      <p>Yönetici: {runtime.admin?.email}</p>
    </main>
  );
}
```

---

## Senaryo 4: Diğer Sunucu Uygulamaları (Fastify/Koa/Hono, Python FastAPI/Django, Go, C# .NET, Rust)

### Bölüm A: Node.js Alternatif Çatılar (Fastify & Hono)

#### Fastify Örneği

```js
import Fastify from "fastify";
import {
  createSetupWizardCore,
  readSetupRuntimeConfig,
  verifyAdminCredentials,
} from "setup/core";

const fastify = Fastify({ logger: true });
const setupCore = createSetupWizardCore({
  projectRoot: process.cwd(),
  syncApply: true,
  apiBase: "/api/setup",
  embedded: true,
});

// Kurulum tamamlanmadıysa tüm istekleri /setup sayfasına yönlendir
fastify.addHook("onRequest", async (req, reply) => {
  const url = req.url.split("?")[0];
  if (url === "/setup" || url.startsWith("/api/setup/")) return;
  if (!readSetupRuntimeConfig(process.cwd()).installed) {
    return reply.redirect("/setup");
  }
});

fastify.get("/setup", async (req, reply) => {
  const res = await setupCore.handle({ method: "GET", path: "/setup", headers: req.headers });
  reply.code(res.status).headers(res.headers).send(res.body);
});

fastify.all("/api/setup/*", async (req, reply) => {
  const subPath = req.params["*"];
  const res = await setupCore.handle({
    method: req.method,
    path: `/api/${subPath}`,
    headers: req.headers,
    body: req.body,
  });
  reply.code(res.status).headers(res.headers).send(res.body);
});

fastify.post("/api/login", async (req, reply) => {
  const { email, password } = req.body ?? {};
  if (!verifyAdminCredentials(process.cwd(), email, password)) {
    return reply.code(401).send({ ok: false });
  }
  return { ok: true };
});

await fastify.listen({ port: 5000, host: "127.0.0.1" });
```

#### Hono Örneği

```js
import { Hono } from "hono";
import { createSetupWizardCore, readSetupRuntimeConfig } from "setup/core";

const app = new Hono();
const setupCore = createSetupWizardCore({ projectRoot: process.cwd(), syncApply: true });

app.get("/setup", async (c) => {
  const res = await setupCore.handle({ method: "GET", path: "/setup" });
  return c.html(res.body, res.status);
});

app.all("/api/setup/:action", async (c) => {
  const action = c.req.param("action");
  const body = c.req.method === "GET" ? undefined : await c.req.text();
  const res = await setupCore.handle({
    method: c.req.method,
    path: `/api/${action}`,
    headers: Object.fromEntries(c.req.raw.headers.entries()),
    body,
  });
  return c.json(res.body, res.status);
});

app.get("/", (c) => {
  const runtime = readSetupRuntimeConfig(process.cwd());
  if (!runtime.installed) return c.redirect("/setup");
  return c.json({ ok: true, publicUrl: runtime.deployment?.publicUrl });
});

export default app;
```

### Bölüm B: Node.js Dışı Diller (Python FastAPI/Django, Go, C# .NET, Rust)

`setup init` komutu hedef dizindeki `pyproject.toml` / `requirements.txt` / `manage.py`, `go.mod`, `*.csproj` / `*.sln` veya `Cargo.toml` dosyalarını otomatik algılar ve `setup.config.json` içine ilgili dilin paket kurulum (`install`) ve sunucu başlatma (`start`) komutlarını yazar.

```bash
# 1. Python / Go / C# / Rust projesinde setup.config.json üretin
npx github:sirrakadembasti/setup init --root .

# 2. Yerel Sidecar olarak sihirbazı başlatın (.env, data/admin.json ve nginx.conf.example üretir ve sunucuyu başlatır)
npx github:sirrakadembasti/setup wizard --root . --port 5050
```

#### Dil Profilleri (Python / Go / C# .NET / Rust)

`setup init` ve kurulum başlatıcısı (5049) aşağıdaki profilleri kullanır. Kurulum adımları sırayla çalışır (`scripts/run-steps.mjs`); son adım gerçek bir **doğrulamadır** ve başarısız olursa kurulum "başarılı" sayılmaz. Gerekli araç (`python`, `go`, `dotnet`, `cargo`) kurulu değilse indirme bağlantısıyla birlikte okunur bir hata verilir.

| Dil | Algılama | Kurulum adımları | Başlatma |
| --- | --- | --- | --- |
| Python | `requirements.txt`, `pyproject.toml`, `manage.py`, `main.py`/`app.py` | proje içi `.venv` oluştur → `pip install -r requirements.txt` (yoksa `-e .`) → `pip check` | Django: `manage.py runserver`; FastAPI/Starlette: `python -m uvicorn modül:app` (uvicorn yoksa kurulur); Flask: `python -m flask --app modül:nesne run`; aksi halde `main.py`/`app.py`. Hepsi `.venv` yorumlayıcısıyla |
| Go | `go.mod`, `main.go` | `go mod download` → `go build ./...` | `go run .` (kökte `main.go` yoksa `./cmd/<ad>`) |
| C# .NET | `*.csproj`, `*.sln` | `dotnet restore` → `dotnet build --no-restore` | `dotnet run --urls http://127.0.0.1:<port>` (çözümde `--project <web projesi>`) |
| Rust | `Cargo.toml` (Tauri hariç) | `cargo fetch` → `cargo check` | `cargo run` (çalışma alanında ilk ikili üye için `-p <ad>`) |

Uygulamanız portu `PORT` ortam değişkeninden okumalıdır (sihirbaz `PORT`'u `.env` ve başlatma ortamına yazar). PHP desteği kaldırılmıştır.

#### Python (FastAPI) `.env` ve `data/admin.json` (`scrypt`) Doğrulama Şablonu

```python
# app.py
import hashlib
import hmac
import json
import os
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

app = FastAPI(title="FastAPI + setup Sidecar")


def verify_setup_admin(email: str, password: str) -> bool:
    admin_file = BASE_DIR / "data" / "admin.json"
    if not admin_file.exists():
        return False
    admin_data = json.loads(admin_file.read_text(encoding="utf-8"))
    expected_email = (admin_data.get("email") or "").strip().lower()
    if not expected_email or expected_email != email.strip().lower():
        return False

    stored_hash = admin_data.get("passwordHash") or ""
    parts = stored_hash.split("$")
    if len(parts) != 3 or parts[0] != "scrypt":
        return False

    _, salt, expected_hex = parts
    # Node.js crypto.scryptSync(password, salt, 64) varsayılan parametreleri: N=16384, r=8, p=1
    derived = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt.encode("utf-8"),
        n=16384,
        r=8,
        p=1,
        dklen=len(expected_hex) // 2,
    ).hex()
    return hmac.compare_digest(derived, expected_hex.lower())


class LoginRequest(BaseModel):
    email: str
    password: str


@app.get("/health")
def health():
    lock_exists = (BASE_DIR / "data" / "installation.lock").exists()
    return {
        "installed": lock_exists,
        "publicUrl": os.getenv("FRONTEND_URL"),
        "port": int(os.getenv("PORT", "8000")),
    }


@app.post("/api/login")
def login(payload: LoginRequest):
    if not verify_setup_admin(payload.email, payload.password):
        raise HTTPException(status_code=401, detail="Geçersiz yönetici bilgileri")
    return {"ok": True, "email": payload.email}
```

#### Go ve C# .NET İçin Otomatik Üretilen `setup.config.json` Örnekleri

Go projesi (`go.mod`):
```json
{
  "name": "ornek-go-servisi",
  "version": "1.0.0",
  "packageManager": "npm",
  "ports": { "bootstrap": 5049, "wizard": 5050, "app": 8080 },
  "install": { "command": "go", "args": ["mod", "download"], "requireWorkspaces": false },
  "start": { "command": "go", "args": ["run", "."] },
  "wizard": { "enabled": true, "title": "ornek-go-servisi Kurulum Sihirbazı" },
  "paths": { "env": ".env", "dataDir": "data", "lockFile": "data/installation.lock" }
}
```

C# .NET projesi (`*.csproj`):
```json
{
  "name": "OrnekDotnetApi",
  "version": "1.0.0",
  "packageManager": "npm",
  "ports": { "bootstrap": 5049, "wizard": 5050, "app": 5000 },
  "install": { "command": "dotnet", "args": ["restore"], "requireWorkspaces": false },
  "start": { "command": "dotnet", "args": ["run", "--urls", "http://127.0.0.1:5000"] },
  "wizard": { "enabled": true, "title": "OrnekDotnetApi Kurulum Sihirbazı" },
  "paths": { "env": ".env", "dataDir": "data", "lockFile": "data/installation.lock" }
}
```

---

## Senaryo 5: Masaüstü Uygulamaları (Electron, Tauri, C# WPF/MAUI, PyQt)

Paketlenmiş masaüstü uygulamalarında uygulama dizini (`app.getAppPath()` veya `Program Files`) salt okunur (read-only) olduğundan, `.env`, `admin.json` ve `installation.lock` dosyaları işletim sisteminin kullanıcı veri dizinine (`AppData` / `~/.config` / `Application Support`) yazılmalıdır. `setup` bunun için `dataDir` seçeneğini, `--data-dir` CLI bayrağını ve `SETUP_DATA_DIR` ortam değişkenini destekler.

### Yöntem A: Electron (HTTP Portu Açmadan Doğrudan IPC Köprüsü)

#### 1. Electron Main Süreci (`electron/main.mjs`)

```js
import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import {
  createSetupWizardCore,
  readSetupRuntimeConfig,
  verifyAdminCredentials,
} from "setup/core";

let setupCore;

app.whenReady().then(() => {
  const userDataDir = app.getPath("userData");

  setupCore = createSetupWizardCore({
    projectRoot: app.getAppPath(),
    dataDir: userDataDir,
    syncApply: true,
    ipcMode: true,
    title: "Masaüstü Kurulum Sihirbazı",
  });

  // Renderer sürecinden gelen kurulum isteklerini HTTP soketi açmadan işle
  ipcMain.handle("setup:handle", async (_event, request) => {
    return setupCore.handle(request);
  });

  ipcMain.handle("setup:runtime", () => {
    return readSetupRuntimeConfig({
      projectRoot: app.getAppPath(),
      dataDir: userDataDir,
    });
  });

  ipcMain.handle("setup:verify-admin", (_event, { email, password }) => {
    return verifyAdminCredentials(
      { projectRoot: app.getAppPath(), dataDir: userDataDir },
      email,
      password,
    );
  });

  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    webPreferences: {
      preload: path.join(app.getAppPath(), "electron/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile("index.html");
});
```

#### 2. Electron Preload Köprüsü (`electron/preload.cjs`)

```js
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("setupBridge", {
  request: (req) => ipcRenderer.invoke("setup:handle", req),
  getRuntimeConfig: () => ipcRenderer.invoke("setup:runtime"),
  verifyAdmin: (email, password) =>
    ipcRenderer.invoke("setup:verify-admin", { email, password }),
});
```

#### 3. Electron Renderer Kullanımı (`renderer.js`)

```js
const runtime = await window.setupBridge.getRuntimeConfig();

if (!runtime.installed) {
  // Kurulum durumunu sorgula veya doğrudan kurulum uygula
  const statusRes = await window.setupBridge.request({
    method: "GET",
    path: "/api/status",
  });
  console.log("Sistem kontrolleri:", statusRes.body.checks);
}
```

### Yöntem B: Tauri (Rust) / C# WPF / PyQt (Yerel Sidecar Süreci)

Tauri, C# veya PyQt uygulamalarında `setup` yerel bir alt süreç (sidecar) olarak başlatılır ve WebView kökenine (`tauri://localhost` veya `http://localhost:1420`) `SETUP_ALLOWED_ORIGINS` ile güvenli CORS izni verilir.

#### 1. Komut Satırından Sidecar Başlatma

```bash
SETUP_ALLOWED_ORIGINS=tauri://localhost,http://localhost:1420 \
  node bin/setup.mjs wizard --root . --port 5050 --data-dir "/Users/kullanici/Library/Application Support/OrnekMasaustu" --no-open
```

#### 2. Tauri (`src-tauri/src/main.rs`) Alt Süreç Başlatma Örneği

```rust
use std::process::Command;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("AppData dizini alınamadı");

            std::fs::create_dir_all(&app_data_dir).ok();

            Command::new("node")
                .args([
                    "tools/setup/bin/setup.mjs",
                    "wizard",
                    "--port",
                    "5050",
                    "--data-dir",
                    app_data_dir.to_str().unwrap(),
                    "--no-open",
                ])
                .env("SETUP_ALLOWED_ORIGINS", "tauri://localhost,http://localhost:1420")
                .spawn()
                .expect("setup sidecar başlatılamadı");

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Tauri uygulaması çalışırken hata oluştu");
}
```

---

## 2. Alt Klasör veya Git Submodule Olarak Ekleme

Hedef GitHub reponuzun içine `tools/setup` olarak ekleyebilirsiniz:

```bash
git submodule add https://github.com/sirrakadembasti/setup.git tools/setup
```

Ardından hedef reponun `package.json` dosyasına şu betikleri ekleyin:

```json
{
  "scripts": {
    "setup": "node tools/setup/bin/setup.mjs setup",
    "wizard": "node tools/setup/bin/setup.mjs wizard",
    "detect": "node tools/setup/bin/setup.mjs detect"
  }
}
```

---

## 3. `setup.config.json` ile Özelleştirme

Hedef reponun kök dizinindeki `setup.config.json` üzerinden portları, kurulum/başlatma komutlarını ve dosya yollarını özelleştirebilirsiniz:

```json
{
  "name": "ornek-uygulama",
  "version": "1.0.0",
  "packageManager": "npm",
  "ports": {
    "bootstrap": 5049,
    "wizard": 5050,
    "app": 5000
  },
  "install": {
    "command": "npm",
    "args": ["install"],
    "requireWorkspaces": false
  },
  "start": {
    "command": "npm",
    "args": ["run", "start"]
  },
  "wizard": {
    "enabled": true,
    "title": "Örnek Uygulama Kurulum Sihirbazı"
  },
  "paths": {
    "env": ".env",
    "dataDir": "data",
    "lockFile": "data/installation.lock"
  }
}
```

---

## 4. Güvenlik Standartları

- **Yerel Dinleme:** Kurulum sunucuları (`5049` ve `5050`) yalnızca `127.0.0.1` arayüzünü dinler; uzak sunucularda SSH tüneli (`ssh -L 5049:127.0.0.1:5049 -L 5050:127.0.0.1:5050 user@sunucu`) ile güvenle erişilir.
- **Kriptografik Oturum, CSRF ve Beyaz Liste CORS:** Her oturumda 24 baytlık tek kullanımlık token üretilir, `HttpOnly` + `SameSite=Strict` çerezleri (`setup.bootstrap`, `setup.wizard`) ve `crypto.timingSafeEqual` doğrulaması kullanılır. Yalnızca `SETUP_ALLOWED_ORIGINS` ile açıkça izin verilen masaüstü/SPA kökenlerine CORS yanıtı dönülür.
- **SPA Gizli Bilgi İzolasyonu:** Statik ve SPA projelerinde üretilen `runtime-config.json` ve `env-config.js` dosyalarına yalnız `VITE_`, `PUBLIC_`, `NEXT_PUBLIC_` ve `REACT_APP_` önekli değişkenler dahil edilir; `SESSION_SECRET`, `ADMIN_PASSWORD_HASH`, `EMAIL_PASS` ve `DATABASE_URL` kesinlikle dışarıda bırakılır.
- **Doğrulanmış Yedekleme:** Temiz kurulum öncesinde mevcut `.env`, veritabanı ve yüklenen dosyalar SHA-256 özetleriyle `backups/reinstall-<tarih>/manifest.json` altına yedeklenir.


## Giriş yolu, dev portu ve `.env` kapsamı

Sihirbaz sabit adres varsaymaz. İsteğe bağlı ayarlar (`setup.config.json`):

```json
{
  "app": { "loginPath": "/login" },
  "ports": { "app": 3000, "dev": 5173 }
}
```

- `app.loginPath` (veya `SETUP_LOGIN_PATH`): kurulum sonrası açılacak giriş yolu. Verilmezse uygulama köküdür. Statik ve masaüstü senaryolarında yok sayılır.
- `ports.dev` (veya `SETUP_DEV_PORT`): ayrı bir ön yüz dev sunucusu varsa portu. Verilmezse client `--port` script'inden veya `vite.config` `server.port` değerinden algılanır; bulunamazsa yalnız uygulama portu denetlenir.
- Üretilen `.env` senaryoya göre sadedir: çekirdek ayarlar + `.env.example` değişkenleri. `TRUST_PROXY_HOPS`, `RETENTION_*`, `EMAIL_*` yalnızca etkinleştirilirse veya `.env.example` içinde varsa yazılır.


## Masaüstü (Electron/Tauri): IPC, veri dizini ve süreç denetimi

- `createSetupWizardCore({ ipcMode: true })` masaüstü projesini algılar. `dataDir` vermezseniz (ve `SETUP_DATA_DIR` / `paths.dataDir` yoksa) veri **kullanıcı veri dizinine** yazılır: Windows `%APPDATA%\<proje>`, macOS `~/Library/Application Support/<proje>`, Linux `$XDG_CONFIG_HOME|~/.config/<proje>`. Proje dizinine veri yazılmaz.
- `core.handle({ method: "POST", path: "/api/start-app" })` uygulamayı ayrı süreç olarak başlatır ve **portu değil süreci** denetler; `GET /api/app-health` PID ve çıkış kodunu verir. `await core.stopApp()` süreci kapatır. Başlatılan uygulamaya `SETUP_DATA_DIR` ve `.env` değişkenleri iletilir; uygulamanız yapılandırmayı `readSetupRuntimeConfig({ projectRoot, dataDir: core.dataDir })` ile okuyabilir.
