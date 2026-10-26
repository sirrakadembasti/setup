# setup — 5 Mimari Senaryo Entegrasyon ve Uygulama Kılavuzu (v1.0)

`setup` (`https://github.com/sirrakadembasti/setup.git`), herhangi bir GitHub reposundaki Node.js, SPA/statik web, full-stack, çoklu dil (Python, Go, C# .NET, Rust) veya masaüstü (Electron, Tauri) uygulamasını son kullanıcıların ve sistem yöneticilerinin terminal komutlarıyla boğuşmadan tarayıcı veya masaüstü penceresi üzerinden kurabilmesi için tasarlanmış sıfır bağımlılıklı kurulum eklentisidir.

---

## Masaüstü Uygulamaları: Başlatma ve Durum

- **Başlatma ve durum (CLI/Sidecar):** Masaüstü uygulamaları port açmadığından sihirbaz bitişte "Masaüstü uygulamasını başlat" düğmesi gösterir. `/api/start-app` uygulamayı ayrı bir süreç olarak açar ve **portu değil süreci** denetler: 3 sn içinde kapanırsa 409 ve çıkış koduyla hata döner, ayaktaysa PID bildirir; `/api/app-health` aynı süreç durumunu verir. Başlatma komutu `setup.config.json` içindeki `start` alanından gelir (`init` bunu Electron için `scripts.start` veya `npx electron .`, Tauri için `scripts.tauri` → `<pm> run tauri dev` olarak yazar).
- **Veri dizini:** Kurulum verileri varsayılan olarak proje dizinine yazılır. Paketlenmiş uygulamada kullanıcı verisi dizinini (`app.getPath('userData')`) `dataDir` ile (IPC) veya `--data-dir` ile (Sidecar) verin; `setup` bu dizini tahmin etmez.

## `setup init` Seçenekleri

- Varsayılan: `setup.config.json` + `kurulum.bat` / `kurulum.sh` yazılır; `package.json` değiştirilmez.
- `--no-launchers`: başlatıcı üretilmez. `--update-package-json`: `package.json` içine `setup` (ve gömülü kurulumlarda `wizard`) script'i eklenir. `--force`: mevcut dosyaların üzerine yazar.
- `--copy-tools` (`--offline` / `--tools`): `setup` çekirdek klasörünü hedef projenin içine `tools/setup` olarak kopyalar. Başlatıcının setup çekirdeğini GitHub'dan indirmeden çalışmasını sağlar. Hedef projenin bağımlılıkları için internet veya hazır paket önbelleği gerekebilir.
- `--root <yol>`: Hedef proje kökünü belirler. **Komut hedef projenin kendi dizininde çalıştırılıyorsa `--root .` yazılmasına gerek yoktur**, varsayılan olarak bulunulan dizin alınır. Yalnızca farklı bir dizinden çağrılıyorsa `--root /hedef/dizin` verilmelidir.
- Yapılandırma zaten varsa `init` yalnız eksik başlatıcıları ekler; hiçbir şey yazılmadıysa çıkış kodu 1'dir.
- `bin/kurulum.sh|bat` (eklentinin kendi ön kontrol betiği) çağrıldığı dizindeki projeyi kurar: `cd /proje && /yol/setup/bin/kurulum.sh`.
- **Kurumsal ve Kısıtlı Ortamlarda Bun / bunx Desteği:** İş ortamlarında `npx` ve `npm` kısıtlı veya bulunmadığında, `bunx github:sirrakadembasti/setup init` komutu kullanılabilir. Üretilen `kurulum.bat` / `kurulum.sh` başlatıcıları sistemde `npx` yoksa otomatik olarak `bunx`'e geri düşer; sonraki paket kurulumu (`install`), derleme (`build`), migration ve başlatma (`start`) aşamaları da otomatik olarak Bun üzerinden kesintisiz yürütülür.
- **Çalışma Zamanı (Runtime) Paket Yöneticisi Fallback ve Shims Mimarisi:**
  - Proje ister `pnpm-workspace.yaml` monorepo, ister `yarn`, ister `npm` olsun; hedef bilgisayarda ilgili paket yöneticisi yüklü değilse ve `bun` mevcutsa sistem çalışma zamanında otomatik `bun`'a geçer.
  - Arayüzde sahte gösterim (`pnpm 1.3.14 ✓` gibi) yapılmaz; gerçekte çalışan araç ve sürüm (`bun 1.3.14 ✓`) ile kurulum adımı (`bun install`) gösterilir.
  - `bin/shims/` katmanı sayesinde `package.json` içindeki `pnpm --filter ...` gibi monorepo alt script çağrıları da alt süreç PATH'i üzerinden şeffaf şekilde Bun'a yönlendirilir ve `'pnpm is not recognized'` hatası oluşmaz.

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
10. [Programatik API Kullanımı (ESM)](#5-programatik-api-kullanımı-esm)
11. [CLI Seçenekleri ve Parametreleri](#6-cli-seçenekleri-ve-parametreleri)
12. [Dizin ve Dosya Mimarisi](#7-dizin-ve-dosya-mimarisi)
13. [Sürümleme ve Testler](#8-sürümleme-ve-testler)

---

## 1. Tek Komutla Entegrasyon (`setup init`) ve Teknoloji Algılama

Eklentiyi hedef GitHub reponuza bağlamanın en hızlı yolu `init` komutudur:

```bash
# Proje dizinindeyken (--root yazmaya gerek yoktur):
bunx github:sirrakadembasti/setup init
# veya npx (Node.js) ile:
npx github:sirrakadembasti/setup init

# Farklı bir dizini uzaktan hedeflemek için:
bunx github:sirrakadembasti/setup init --root /path/to/hedef-repo

# Yerel kopyadan veya çevrimdışı (offline tools/setup) çalıştırmak için:
node tools/setup/bin/setup.mjs init
# veya:
node /path/to/setup/bin/setup.mjs init --root /path/to/hedef-repo
# Mevcut setup.config.json üzerine yazmak için:
node tools/setup/bin/setup.mjs init --force
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

Uygulama koduna hiç dokunmadan terminal kurulum başlatıcısını ve web sihirbazını (port `5050`) çalıştırabilirsiniz:

```bash
# 1. Hedef repoya setup.config.json ve npm run setup betiğini ekleyin
npx github:sirrakadembasti/setup init --root . --update-package-json

# 2. Kurulum başlatıcısını açın (bağımlılıkları kurar, ardından 5050 sihirbazına geçirir)
npm run setup
```

Başlatıcı tüm ön kontrolleri terminalde gösterir. Menüde `1` paketleri kurar/onarır, `2` mevcut web sihirbazını açar, `4` durumu yeniden denetler. Kurulu uygulamalarda `3` yeniden yapılandırır; mevcut/yarım kurulumlarda `5` doğrulanmış yedek alıp temiz kurulum hazırlar. Temizleme için yedek onayı ve `SETUP VERİLERİNİ SİL` metni gerekir; çalışan uygulama veya harici veritabanı otomatik temizlenmez.

Tarayıcı yalnız sihirbaz hazır olduğunda açılır. `--no-open` bağlantıyı terminalde bırakır; `--port <1024-65535>` sihirbaz portunu belirler. `--check-only` salt okunur durum JSON çıktısı verir. Birden fazla bağımsız aday terminalde seçilir; `--candidate <dizin>` doğrudan hedefler. Port çakışmasında süreç bilgisi gösterilir ve yalnız açık onayla doğrulanmış Node/kurulum süreci durdurulur.

Eski `ports.bootstrap` / `SETUP_BOOTSTRAP_PORT` alanları başlatıcı için kullanılmaz; 5049'da HTTP sunucusu açılmaz. `ports.wizard` / `SETUP_WIZARD_PORT` geçerliliğini korur. Terminali sihirbaz ve başlatılan uygulama çalışırken açık tutun.

`setup`, doğrudan `scripts/setup-bootstrap.mjs`, `npm run setup -- ...` ve `wizard --check-only` ortak seçenek ayrıştırıcısını kullanır. Sihirbaz portu önceliği `--port` → `SETUP_WIZARD_PORT` → eski `SETUP_PORT` → `ports.wizard` → `5050` şeklindedir; izin verilen aralık 1024–65535'tir. Aday dizini, doğrudan `wizard` komutunda da kurulumun gerçek kökü olarak kullanılır.

Önceden entegre edilmiş bir projeyi güncellemek için güncel setup kaynağından `node /guncel/setup/bin/setup.mjs init --root /hedef/proje --copy-tools --refresh-launchers` çalıştırın. Yapılandırma korunur; değiştirilen başlatıcılar `.bak` olarak yedeklenir. Aynı yerel kopya kendi üzerine kopyalanmaz ve güncel başlatıcıları yenileme işlemi tekrar çalıştırılabilir.

Terminal kurulumu ve `scripts/run-steps.mjs`, aynı komut/süreç çalıştırıcısını kullanır. Her adımda `cwd`, `skipIfExists`, paket yöneticisi fallback ve `--prefix` dizinleri aynı biçimde değerlendirilir; canlı çıktı, zaman aşımı ve iptal birlikte yönetilir. Varsayılan iş zaman aşımı 15 dakikadır (`SETUP_JOB_TIMEOUT_MS`); bağımsız çalıştırıcı başarısız adımın çıkış kodunu korur, zaman aşımında `124`, geçersiz adım tanımında `2` ile çıkar.

Web sihirbazındaki kurulum başarılı olduğunda uygulama otomatik başlatılır. Başlatma komutu mevcut `start` yapılandırması veya proje algılamasıyla belirlenir. Uygulama, ilk terminalin gözettiği sihirbaz sürecinin altında çalışır; stdout/stderr sırlar maskelenerek terminale aktarılır. `/api/status` içindeki `apply.application.state`, kurulum sonucundan ayrı olarak `idle`, `starting`, `ready` veya `error` durumunu bildirir. Başlatma hatası kurulum başarısını geri almaz; `/api/start-app` aynı başlatıcı üzerinden yeniden dener ve eşzamanlı istekler ikinci süreç oluşturmaz.

`/api/app-health` yalnız TCP bağlantısını değil HTTP yanıtını ve hedef sayfayı denetler. Backend/frontend yapılarında iki servis de hazır olmalıdır; son ekran doğrulanan güncel frontend adresini kullanır. Tek sunucu tarafından sunulan uygulama için kullanılmayan bir geliştirme portu beklenmez; Vite başlangıcına seçilen port açıkça iletilir. Üretim modunda yapılandırılan dış adres de HTTP üzerinden erişilebilir olmalıdır; DNS/proxy hazır değilse yönlendirme yapılmaz. İlk denetimler dahil başlatma için varsayılan süre sınırı 60 saniyedir (`SETUP_APP_START_TIMEOUT_MS`). Süre dolarsa terminal günlüğü ve yeniden deneme önerisi gösterilir. Terminal açık tutulmalıdır; kapatılınca sihirbaz ve uygulama süreçleri birlikte sonlandırılır. Masaüstü ve gömülü kurulumların mevcut yaşam döngüsü korunur.

---

### Başlatma sorunlarını giderme

Kurulumun başarılı olması ile uygulamanın erişime hazır olması ayrı sonuçlardır. Son ekranda başlatma hatası varsa kurulum verilerini silmeden önce aşağıdaki adımları izleyin:

| Durum | Yapılacak işlem |
| --- | --- |
| Uygulama süreci başlatılamıyor veya kapanıyor | İlk terminaldeki uygulama çıktısını inceleyin. `setup.config.json` içindeki `start.command` / `start.args` veya algılanan proje başlatma komutunun hatasını giderin; **Uygulamayı yeniden başlat / denetle** düğmesini kullanın. |
| Uygulama yavaş açılıyor | Başlatıcıyı çalıştırmadan önce `SETUP_APP_START_TIMEOUT_MS` değerini artırın; değer milisaniyedir (örneğin `120000`: iki dakika). Süre sınırı ilk HTTP denetimlerini de kapsar. |
| Backend hazır, frontend hazır değil | Frontend günlüğünü ve portunu kontrol edin. Çift süreçli yapıda iki servis doğrulanmadan tarayıcıya geçilmez; kullanılan adres sağlık denetiminin döndürdüğü frontend adresidir. |
| Yerel servis hazır, üretim adresi erişilemiyor | Yapılandırılan adresin DNS, TLS ve reverse proxy ayarlarını kontrol edin. Alt yol dağıtımlarında (`/portal` gibi) hem yolu koruyan hem de kaldıran proxy düzenleri desteklenir; dış adres ayrıca doğrulanır. |
| Güncel davranış başka projede görünmüyor | Güncel setup kaynağından `node /guncel/setup/bin/setup.mjs init --root /hedef/proje --copy-tools --refresh-launchers` çalıştırın. Depoyu güncellemek, başka projeye önceden kopyalanan `tools/setup` dosyalarını kendiliğinden yenilemez. |

Terminali kapatmak gözetilen sihirbaz ve uygulama süreçlerini sonlandırır. Başarılı kurulumdan sonra yalnız başlatma sorunu varsa **temiz kurulum gerekmez**; hata giderilip yeniden başlatma denenebilir.

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

### 4. Monorepo / Çok Parçalı Repolarda Çift Port (Backend + Frontend) ve Migration Mimarisi

Alt dizinlerde bağımsız servisler barındıran monorepo veya full-stack projelerde (`backend/` + `frontend/` veya `srv/` + `ui/`):

1. **Ayrı Port Yönetimi:** Web sihirbazı Senaryo 3 algıladığında 2. adımda iki ayrı port sorar:
   - **Backend (API) Portu:** API servisinin dinleyeceği ana port (`PORT`, varsayılan: `3001` vb.).
   - **Frontend Portu:** Ön yüz geliştirme/sunucu portu (`FRONTEND_PORT`, `DEV_PORT`, `VITE_PORT`, `NUXT_PORT`, varsayılan: `3000` vb.).
2. **Çift Süreç (Dual Process Runner):** Kurulum tamamlandığında `createDualProcessController` ile backend ve frontend eşzamanlı başlatılır; ön yüz servisine API adresi (`API_URL`, `VITE_API_URL`, `NUXT_PUBLIC_API_BASE`) dinamik bağlanır.
3. **Migration & Seed Ortam Yayılımı:** `db:migrate` ve `seed` betikleri çalıştırılmadan önce `.env` dosyası disk üzerinde geçici olarak sahnelenir ve tüm ortam değişkenleri (`JWT_REFRESH_SECRET`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` vb.) alt süreçlere eksiksiz aktarılır. Betik başarısız olursa oluşturulan geçici `.env` temizlenir ve sistem önceki durumuna otomatik geri alınır.

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

`setup init` ve terminal kurulum başlatıcısı aşağıdaki profilleri kullanır. Kurulum adımları terminal başlatıcısında sırayla çalışır; son adım gerçek bir **doğrulamadır** ve başarısız olursa kurulum "başarılı" sayılmaz. Gerekli araç (`python`, `go`, `dotnet`, `cargo`) kurulu değilse indirme bağlantısıyla birlikte okunur bir hata verilir.

| Dil | Algılama | Kurulum adımları | Başlatma |
| --- | --- | --- | --- |
| Python | `requirements.txt`, `pyproject.toml`, `manage.py`, `main.py`/`app.py` | proje içi `.venv` oluştur → `pip install -r requirements.txt` (yoksa `-e .`) → `pip check` | Django: `manage.py runserver`; FastAPI/Starlette: `python -m uvicorn modül:app` (uvicorn yoksa kurulur); Flask: `python -m flask --app modül:nesne run`; aksi halde `main.py`/`app.py`. Hepsi `.venv` yorumlayıcısıyla |
| Go | `go.mod`, `main.go` | `go mod download` → `go build ./...` | `go run .` (kökte `main.go` yoksa `./cmd/<ad>`) |
| C# .NET | `*.csproj`, `*.sln` | `dotnet restore` → `dotnet build --no-restore` | `dotnet run --urls http://127.0.0.1:<port>` (çözümde `--project <web projesi>`) |
| Rust | `Cargo.toml` (Tauri hariç) | `cargo fetch` → `cargo check` | `cargo run` (çalışma alanında ilk ikili üye için `-p <ad>`) |
| C / C++ | `CMakeLists.txt`, `Makefile` | `cmake -B build` → `cmake --build build --config Release` | `cmake --build build --target run` (veya `./build/<ad>`) |
| Oyun Motorları | `project.godot`, `ProjectSettings/` (Unity), `*.uproject` (Unreal) | Motor proje dosyaları ve çalışma ortamı doğrulaması | `godot --path .` / Masaüstü oyun süreci |

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
  "ports": { "wizard": 5050, "app": 8080 },
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
  "ports": { "wizard": 5050, "app": 5000 },
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
  "seed": {
    "command": "npm",
    "args": ["run", "db:seed"]
  },
  "paths": {
    "env": ".env",
    "dataDir": "data",
    "lockFile": "data/installation.lock"
  }
}
```

> **İpucu (Veritabanı Tohumlama - Seeding):** Projenizin `package.json` dosyasında `prisma:seed`, `db:seed` veya `seed` script'i varsa veya yukarıdaki gibi `setup.config.json` içinde `seed` nesnesi tanımlanmışsa, kurulum sırasında ilk yönetici oluşturulduktan sonra tohumlama adımı otomatik olarak çalıştırılır.

---

## 4. Güvenlik Standartları

- **Yerel Dinleme:** Web kurulum sihirbazı (`5050`) yalnızca `127.0.0.1` arayüzünü dinler; uzak sunucularda SSH tüneli (`ssh -L 5050:127.0.0.1:5050 user@sunucu`) ile güvenle erişilir.
- **Kriptografik Oturum, CSRF ve Beyaz Liste CORS:** Her oturumda 24 baytlık tek kullanımlık token üretilir, `HttpOnly` + `SameSite=Strict` çerezleri (`setup.wizard`) ve `crypto.timingSafeEqual` doğrulaması kullanılır. Yalnızca `SETUP_ALLOWED_ORIGINS` ile açıkça izin verilen masaüstü/SPA kökenlerine CORS yanıtı dönülür.
- **Origin ve Referer Doğrulama Tutarlılığı:** `wizard/server.mjs` ve `wizard/core.mjs` üzerindeki tüm mutasyon uçları (`POST`, `PUT`, `DELETE`), tarayıcıdan gelen `Origin` veya `Referer` başlığının `allowedOrigins` veya sunucu `Host` başlığı ile tam eşleştiğini doğrular; Origin bilgisi içermeyen web tabanlı mutasyon istekleri reddedilir.
- **Süreç Durdurma Güvenlik Kilidi:** `stopPortProcess` port çakışmalarını çözerken hedef sürecin `node`, `npm`, `pnpm`, `yarn`, `bun`, `setup` veya `wizard` süreci olduğunu açıkça doğrular; süreç tanımlayıcısı okunamayan bilinmeyen sistem veya veritabanı servisleri otomatik sonlandırılmaz.
- **Bellek Sızıntısız İstek Sınırlama (Rate Limiting):** `createRateLimiter` altyapısı, IP bazlı sayaçları TTL süresi dolduğunda otomatik temizler (`prune`) ve maksimum anahtar kotası (`maxBuckets: 1000`) uygulayarak uzun süre açık kalan sunucularda bellek sızıntısını önler.
- **Akış Tabanlı Statik Sunucu ve Symlink İzolasyonu:** `createStaticAppServer`, dosyaları senkron olarak belleğe almak yerine `createReadStream` ile akış halinde sunar; `fs.realpathSync` sınır kontrolü ile statik dizin dışına işaret eden sembolik bağlantılar (symlink traversal) `403 Forbidden` ile engellenir.
- **Güvenli Günlük & Sır Maskeleme:** Kurulum terminal günlüğünde (`applyJob.logs`), yönetici parolası, veritabanı parolası, e-posta parolası ve bağlantı URL'lerindeki (`postgresql://user:pass@host`) kimlik bilgileri `******` ile otomatik olarak sansürlenir.
- **Canlı Ağ Sınaması (Active Pre-Apply Probing):** Veritabanı (`/api/test-database`) ve SMTP sunucusu (`/api/test-email`) için form onaylanmadan önce soket/el sıkışma düzeyinde aktif bağlantı testi yapılır; hatalı bilgiler erken yakalanır.
- **SPA Gizli Bilgi İzolasyonu:** Statik ve SPA projelerinde üretilen `runtime-config.json` ve `env-config.js` dosyalarına yalnız `VITE_`, `PUBLIC_`, `NEXT_PUBLIC_` ve `REACT_APP_` önekli değişkenler dahil edilir; `SESSION_SECRET`, `ADMIN_PASSWORD_HASH`, `EMAIL_PASS` ve `DATABASE_URL` kesinlikle dışarıda bırakılır.
- **Doğrulanmış Yedekleme:** Temiz kurulum öncesinde mevcut `.env`, veritabanı ve yüklenen dosyalar SHA-256 özetleriyle `backups/reinstall-<tarih>/manifest.json` altına yedeklenir. Harici veri dizini (`--data-dir`) kullanımlarında da güvenli alan istisnası ile sorunsuz çalışır.


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

## E-posta Yapılandırması ve Biçim Doğrulama

Sihirbaz arayüzündeki e-posta adımı, sunucu dışına gerçek bir SMTP soketi açmadan Gmail uygulama şifresi (`EMAIL_USER`, `EMAIL_PASS`, 16 karakter boşluksuz), port (465/587) ve SSL kurallarını yerel olarak doğrular:

- **Doğrulama Uç Noktası:** `POST /api/validate-email-format` (eski ad `/api/test-smtp` geriye dönük uyumluluk için korunmuştur).
- **Arayüz Düğmesi:** "Biçim Doğrula" olarak adlandırılmıştır ve kullanıcıya harici SMTP bağlantısı denenmediği açıkça bildirilir (`connectionTested: false`).
- **Ortam Değişkenleri:** E-posta gönderimi etkinleştirilmedikçe veya hedef projedeki `.env.example` içinde açıkça bildirilmedikçe `.env` dosyasına `EMAIL_*` değişkenleri yazılmaz.

## Çekirdek ve Sunucu Mimarisi (`wizard/shared.mjs`)

HTTP sihirbaz sunucusu (`wizard/server.mjs`) ve gömülü/IPC kurulum çekirdeği (`wizard/core.mjs`), kurulum yürütücüsü ve doğrulama mantığını [`wizard/shared.mjs`](wizard/shared.mjs) üzerinden paylaşır. Arayüz şablonu saf ESM olarak [`wizard/ui.html.mjs`](wizard/ui.html.mjs) dosyasında tutulur ve [`wizard/ui.mjs`](wizard/ui.mjs) üzerinden re-export edilir.

---

## 5. Programatik API Kullanımı (ESM)

Eklenti, Node.js veya Bun projeleri içinden doğrudan bir JavaScript kütüphanesi olarak çağrılabilir:

```js
import {
  inspect,
  initProject,
  detectProject,
  buildInstallPlan,
  createSetupWizardCore,
  mountSetupGuard,
  readSetupRuntimeConfig,
  verifyAdminCredentials,
} from "setup";

// 1. Hedef depoyu analiz et ve kurulum planını al
const { version, detection, plan } = await inspect("/path/to/repo");

// 2. Hedef projeye setup.config.json ve başlatıcıları entegre et
initProject("/path/to/repo", {
  overwrite: false,
  updatePackageJson: false,
  createLaunchers: true,
});

// 3. Çalışma anında kurulum durumunu ve ortam ayarlarını oku
const runtime = readSetupRuntimeConfig("/path/to/repo");
if (runtime.installed) {
  console.log("Uygulama portu:", runtime.ports.app);
}

// 4. Kurulumda oluşturulan ilk yöneticinin kimliğini doğrula (scrypt hash)
const isValid = verifyAdminCredentials("/path/to/repo", "admin@ornek.com", "Parola123!");
```

---

## 6. CLI Seçenekleri ve Parametreleri

`bin/setup.mjs` komut satırı arayüzü aşağıdaki komut ve parametreleri destekler:

```bash
# Komutlar:
node bin/setup.mjs          # Terminal menüsünde tanılama ve paket kurulumu, ardından web sihirbazı
node bin/setup.mjs wizard   # Doğrudan kurulum sihirbazını açar (port 5050)
node bin/setup.mjs init     # Hedef repoya yapılandırma ve başlatıcıları ekler
node bin/setup.mjs detect   # Proje analizini yapar ve JSON planı çıktılar
node bin/setup.mjs version  # Sürüm bilgisini gösterir
node bin/setup.mjs help     # Yardım kılavuzunu gösterir

# Seçenekler / Bayraklar:
--root <yol>             # Hedef uygulama kök dizini (varsayılan: aktif dizin)
--candidate <yol>        # Çok parçalı repolarda hedef alt projeyi seçer (örn: apps/web, srv/)
--port <numara>          # Web sihirbazı portunu özelleştirir (1024–65535)
--data-dir <yol>         # Kurulum verileri ve .env için harici dizin belirler
--force, -f              # init sırasında mevcut yapılandırma ve başlatıcıların üzerine yazar
--copy-tools             # init sırasında setup çekirdeğini tools/setup içine kopyalar (--tools, --offline)
--refresh-launchers      # init sırasında başlatıcıları yedekleyip yeniler; mevcut setup.config.json korunur
--no-launchers           # init sırasında kurulum.bat / kurulum.sh üretmez
--update-package-json    # init sırasında package.json içine "setup" script'i ekler
--no-open                # Tarayıcıyı otomatik olarak açmaz
--check-only             # Yalnızca durum JSON çıktısını yazdırıp çıkar
--reconfigure            # Kurulu ve kilitli projede mevcut verileri silmeden sihirbazı ayar güncellemesi için açar
```

---

## 7. Dizin ve Dosya Mimarisi

```text
setup/
├── VERSION                   # Aktif sürüm (1.0.0)
├── CHANGELOG.md              # Sürüm değişiklik günlüğü
├── ENTEGRASYON.md            # Tüm mimariler için kapsamlı entegrasyon ve API kılavuzu
├── README.md                 # Hızlı başlangıç ve son kullanıcı özeti
├── package.json
├── bin/
│   ├── setup.mjs             # Ana CLI aracı (setup, wizard, init, detect, version)
│   ├── kurulum.sh            # Bash/POSIX başlatıcı (npm/npx ve bun/bunx dual fallback)
│   ├── kurulum.bat           # Windows UTF-8 başlatıcı (npm/npx ve bun/bunx dual fallback)
│   └── shims/                # Alt süreçler için şeffaf yönlendiriciler (pnpm, pnpm-shim.mjs, yarn, npm, npx, bunx)
├── scripts/
│   ├── detect-project.mjs    # Otomatik mimari, kaynak doğrulama, paket yöneticisi ve .env tespiti
│   ├── polyglot.mjs          # Python/Go/C#/Rust kurulum, doğrulama ve başlatma profilleri
│   ├── run-steps.mjs         # Çok adımlı polyglot kurulum çalıştırıcısı
│   ├── process-runner.mjs    # Ortak komut çözümleme, günlük, zaman aşımı ve süreç temizliği
│   ├── cli-options.mjs       # Ortak CLI seçenekleri ve güvenli aday proje seçimi
│   ├── setup-bootstrap.mjs   # Terminal başlatıcı giriş noktası
│   ├── terminal-bootstrap.mjs # Terminal menüsü ve kurulum işlemleri
│   ├── setup-bootstrap-lib.mjs # Ön kontrol, port çakışması ve yedekleme mantığı
│   ├── find-port-holder.mjs  # 4 katmanlı port dinleyici PID tespit modülü
│   ├── version.mjs           # SemVer sürüm yönetimi ve Git etiketleme
│   ├── setup-api.mjs         # Programatik ESM API dışa aktarımları
│   └── *.test.mjs            # Birim, güvenlik ve E2E test dosyaları
├── wizard/
│   ├── core.mjs              # Framework-agnostik sihirbaz çekirdeği ve Express guard
│   ├── server.mjs            # 5050 Web Kurulum Sihirbazı sunucusu ve SPA statik dosya sunucusu
│   ├── ui.mjs                # 5 adımlı sihirbaz arayüz bağlayıcısı
│   ├── ui.html.mjs           # Sihirbaz arayüzü HTML/CSS/JS şablonu
│   ├── shared.mjs            # Kurulum adımları ve ortak doğrulama mantığı
│   ├── app-process.mjs       # Uygulama başlatma ve masaüstü süreç denetleyicisi
│   └── config.mjs            # Şema doğrulamaları, scrypt hash ve .env üreticisi
├── utils/
│   ├── project-paths.mjs     # Proje yol çözümleyicisi
│   └── deployment-config.mjs # Nginx ve dağıtım şablon üreticisi
└── templates/
    └── setup.config.json     # Yapılandırma şablonu
```

---

## 8. Sürümleme ve Testler

### Hata Yönetimi, Dayanıklılık ve Otomatik Geri Alma (Rollback)

`setup (v1.0)` terminal, web sihirbazı ve uygulama yürütme aşamalarında oluşabilecek her türlü arıza senaryosuna karşı çok katmanlı savunma mekanizmalarıyla donatılmıştır:

1. **Dizin İzni ve Port Meşguliyeti Ön Denetimleri:**
   - Kurulum başlamadan önce hedef kök dizininin ve harici veri dizininin yazılabilirliği (`fs.constants.W_OK`) doğrulanır. Salt okunur ortamlarda kullanıcıya net Türkçe izin uyarısı verilir.
   - 5050 (sihirbaz) portu meşgulse çakışan sürecin adı ve PID'si gösterilerek `--port <yeni-port>` alternatifi sunulur.
2. **Sinyal Yakalama (Graceful Teardown):**
   - Terminalde `Ctrl+C` veya `SIGTERM` tetiklendiğinde başlatılmış olan alt çocuk süreçler yetim/zombi kalmadan temiz şekilde kapatılır.
3. **Bağımlılık Kurulumunda Canlı Terminal Çıktısı ve Hata Detayı ve Zaman Aşımı:**
   - Paket kurulumu (`npm install`, `cmake`, `pip` vb.) başarısız olduğunda konsol günlüğünün son 15 satırı doğrudan `/api/status` yanıtında sunulur.
   - 15 dakikayı aşan veya askıda kalan kurulum işleri `SETUP_JOB_TIMEOUT_MS` zaman aşımıyla kontrollü sonlandırılır.
4. **Çok Dilli Araç Zinciri Ön Doğrulaması:**
   - Proje C++ (CMake), Rust (Cargo), Python veya Go gerektiriyorsa ve sistemde derleyici yoksa paket kurma adımı başlamadan önce resmi indirme kılavuzu sunulur.
5. **Atomik Geri Alma (Rollback on Failure):**
   - Kurulum uygulanırken (`executeSetupApply`) derleme, veritabanı migration veya seed betiklerinden biri çökerse üretilen geçici `.env.setup-<pid>` silinir, önceki kararlı `.env` yedeği (`backups/.env-*.bak`) otomatik olarak geri yüklenir ve bozuk `installation.lock` bırakılmaz.
6. **Canlı Ağ Sınamalarında Türkçe Hata Kodları (`formatNetworkErrorMessage`):**
   - Veritabanı ve SMTP bağlantı testlerinde `ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND` (DNS) ve `EHOSTUNREACH` sistem hata kodları anlaşılır Türkçe yönlendirmelere dönüştürülür.
7. **Genel İstisna Zırhı ve Güvenlik Filtreleri:**
   - `wizard/server.mjs` kök HTTP işleyicisi global `try/catch` ile korunur; sunucu çökmeleri engellenerek 500 JSON döner.
   - Sahte CSRF token veya geçersiz Origin taşıyan mutasyon istekleri 403 Forbidden ile engellenir; 512KB üzerindeki istek gövdeleri TCP sıfırlanmasına yol açmadan güvenle reddedilir.
8. **Erken Çökme Teşhisi (Early Crash Detection):**
   - Uygulama başlatıldıktan sonra ilk 3.2 saniye içinde kapandığında `/api/start-app` yanıtında `code: "APP_CRASHED"`, çıkış kodu, sinyal (`SIGSEGV`, `SIGKILL`) ve `stderr` satırları raporlanır.
9. **Arayüzde Görsel Alan Vurgulama ve Otomatik Yeniden Bağlanma:**
   - Doğrulama hatalarında hatalı form alanları kırmızı çerçeveyle ve açıklama mesajıyla işaretlenir.
   - Ağ kopmalarında veya sunucu yeniden başlatıldığında arayüzün tepesinde yeniden bağlanma çubuğu belirir; çift tıklamaları önlemek için aksiyon düğmeleri anında kilitlenir (`disabled = true`).

10. **Standart Dışı & Dağınık Repolar İçin Derin Tarama ve Çift Süreç Orkestrasyonu:**
    - Kök dizinde proje dosyası yokken maksimum 3 derinlik seviyesine kadar alt klasörler taranır (`findProjectCandidates`).
    - Kök dizinde `package.json` bulunmayan çok parçalı yapılarda (`subprojects`), başlatıcı motoru (`setup-bootstrap.mjs`) ve `initProject` alt projeleri (`backend/`, `frontend/`, `srv/`, `ui/`) otomatik tespit edip `--prefix <alt-dizin> install` adımlarıyla kurar; Kök `ENOENT` hatası önlenir.
    - Bağımlılık denetleyicisi (`checkDependencies`), `setup.config.json` içerisindeki adımları ve dinamik alt klasörlerdeki `node_modules` dizinlerini doğru şekilde doğrular.
    - Dağınık `.env.example` dosyaları havuzda birleştirilir (`findScatteredEnvExamples`) ve alt projelere (`srv/.env`, `ui/.env`) dağıtılır.
    - Çok parçalı Fullstack yapılarda Backend ana porta, Frontend ikincil porta (`devPort`) bağlanır (`createDualProcessController`), `API_URL` ortam değişkenleri otomatik enjekte edilir ve süreçlerden biri çöktüğünde diğeri kademeli olarak sonlandırılır.
    - Çoklu aday belirsizliğinde Web Sihirbazında interaktif kartlar (`chooseCandidate`, `POST /api/select-candidate`) ve CLI'da `--candidate` bayrağı ile anında hedef değiştirilebilir.

### Sürüm Yönetimi (`scripts/version.mjs`)
`VERSION`, `package.json`, `CHANGELOG.md` ve Git etiketlerini tek komutla yönetir:

```bash
node scripts/version.mjs get            # Mevcut sürümü gösterir
node scripts/version.mjs bump patch     # 1.0.0 -> 1.0.1 artırır
node scripts/version.mjs bump minor     # 1.0.0 -> 1.1.0 artırır
node scripts/version.mjs bump major     # 1.0.0 -> 2.0.0 artırır
# --tag bayrağı ile git tag eklenir:
node scripts/version.mjs bump patch --tag
```

### Testleri Çalıştırma
Sıfır bağımlılıklı yerleşik Node test çalıştırıcısı ile tüm birim, senaryo, dayanıklılık, derin keşif ve E2E testleri:

```bash
# Node ile tüm regresyon paketi:
npm test

# veya Bun ile:
bun test
```
