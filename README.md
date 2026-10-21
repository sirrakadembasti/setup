# setup (v1.0) — Bağımsız GitHub Uygulama Kurulum Eklentisi

Herhangi bir GitHub reposundaki Node.js, SPA/statik web, full-stack, çoklu dil (Python, Go, C# .NET, Rust) veya masaüstü (Electron, Tauri) uygulamasının, karmaşık terminal adımlarıyla uğraşılmadan **kullanıcı dostu bir web arayüzü ve otomatik proje algılama** ile kolayca kurulup çalıştırılmasını sağlayan, projeden bağımsız kurulum eklentisidir.

- **GitHub Deposu:** `https://github.com/sirrakadembasti/setup.git`

## Temel Hedef ve Özellikler

- **Tamamen Projeden Bağımsız & Çoklu Mimari:** Tek dizinli (`package.json`) uygulamaları, `server/` + `client/` full-stack projeleri, workspace/monorepo yapılarını, saf statik web (`index.html`), Python (`pyproject.toml`/`requirements.txt`), Go (`go.mod`), C# .NET (`*.csproj`), Rust (`Cargo.toml`) ve masaüstü (`electron`, `tauri`) projelerini otomatik tanır.
- **Sıfır Bağımlılık:** Yalnız Node.js (>=18) yerleşik modüllerini kullanır; eklentinin kendisi için `npm install` gerekmez.
- **Kaynak Doğrulamalı Teknoloji Algılama:** `express`, `fastify`, `koa`, `hono`, `react`, `vue`, `next`, `nuxt`, `sveltekit`, `astro`, `vite`, `electron` ve `tauri` kullanımı yalnız `package.json` bildirimine göre değil, kaynak koddaki `import`/`require` ifadelerine ve script'lerdeki CLI çağrılarına göre doğrulanır (`dependencyUsage` çıktısı).
- **Framework-Agnostik Kurulum Çekirdeği (`setup/core`):** HTTP soketi açmadan doğrudan Express/Fastify/Hono middleware'i, Next.js Route Handler'ı veya Electron IPC kanalı içinden çağrılabilen `createSetupWizardCore`, `mountSetupGuard`, `readSetupRuntimeConfig` ve `verifyAdminCredentials` API'leri sunar.
- **SPA Güvenli Yapılandırma & Statik Sunucu:** Tarayıcı uygulamalarında gizli anahtarları sızdırmadan yalnız güvenli genel ayarları (`VITE_*`, `PUBLIC_*`, `NEXT_PUBLIC_*`, `REACT_APP_*`) içeren `runtime-config.json` ve `env-config.js` (`window.__SETUP_CONFIG__`) üretir; yerleşik `createStaticAppServer` ile sıfır bağımlılıklı SPA sunumu yapar.
- **Çoklu Paket Yöneticisi Desteği:** Hedef repodaki kilit dosyalarına bakarak `npm`, `pnpm`, `yarn` veya `bun` paket yöneticisini otomatik seçer.
- **Tek Komutla Entegrasyon (`setup init`):** Herhangi bir GitHub reposuna `setup.config.json` yapılandırmasını ve çift tıklanabilir `kurulum.bat` / `kurulum.sh` başlatıcılarını saniyeler içinde ekler. Hedef projenin `package.json` dosyasına varsayılan olarak dokunmaz.
- **İki Aşamalı Güvenli Web Kurulumu:**
  - **Kurulum Başlatıcısı (`127.0.0.1:5049`):** Projenin 5 senaryosuna göre dinamik başlık ve rozet gösterir. Node.js (`npm`/`pnpm`/`yarn`/`bun`), Python (`venv` + `pip`), Go (`go mod`), C# (`dotnet restore`) ve Rust (`cargo fetch`) bağımlılıklarını tek tıkla kurar ve derleme/tutarlılık doğrulaması yapar; saf statik web (Senaryo 2) projelerinde bağımlılık adımını otomatik tamamlanmış sayarak sihirbaza aktarır.
  - **Web Kurulum Sihirbazı (`127.0.0.1:5050`):** Algılanan mimari kartı (`#scenarioInfo`) gösterir. Hedef repodaki `.env.example` içinde bulunan özel değişkenleri dinamik form alanları (`#customEnvSection`) olarak kullanıcıya sunar; Senaryo 2 (SPA/Statik Web) ve Senaryo 5 (Masaüstü) mimarilerinde yerel yönetici hesabı oluşturmayı isteğe bağlı yapar ve kurulum tamamlandığında doğrudan uygulamanın kendi portuna yönlendirir.
- **Yerleşik Sürümleme (`scripts/version.mjs`):** `VERSION`, `package.json`, `CHANGELOG.md` ve Git etiketlerini (`v1.0`, `v1.0.0`) tek komutla yönetir.

## Hızlı Başlangıç

### 1. Son Kullanıcı Deneyimi (İndirilen Herhangi Bir GitHub Reposunda Tek Komutla Kurulum)

GitHub'dan indirdiğiniz veya klonladığınız herhangi bir projenin kök dizininde sadece aşağıdaki komutu çalıştırın (ayrı bir `init` komutuna veya `setup.config.json` hazırlamaya gerek yoktur):

```bash
# Herhangi bir projenin ana klasöründe:
npx github:sirrakadembasti/setup
```

Eğer repoya daha önce başlatıcı entegre edilmişse (`setup init` bunları varsayılan olarak ekler) doğrudan çift tıklayabilirsiniz:
- **Windows:** `kurulum.bat`
- **Linux / macOS:** `./kurulum.sh`

`setup` projenin hangi senaryoya (1: Node/Express Sunucu, 2: SPA/Statik Web, 3: Next/Nuxt Full-Stack, 4: Python/Go/C#/Rust Sunucu, 5: Electron/Tauri Masaüstü) ait olduğunu otomatik algılar, bellekte/diskte yapılandırır ve tarayıcınızda Web Kurulum Arayüzünü açar.

---

### 2. Geliştirici ve Entegratör Kullanımı

```bash
# 1. Hedef repoya çift tıklanabilir başlatıcıları (kurulum.bat / kurulum.sh) ve setup.config.json'ı ekleyin
npx github:sirrakadembasti/setup init --root /path/to/github-repo
#    --no-launchers          kurulum.bat / kurulum.sh üretme
#    --update-package-json   package.json'a "setup" script'i ekle (varsayılan: dokunma)
#    --force                 mevcut setup.config.json ve başlatıcıların üzerine yaz

# 2. Hedef repoyu analiz edin ve 5 senaryolu algılama profilini görün
node bin/setup.mjs detect --root /path/to/github-repo

# 3. Web kurulum başlatıcısını (5049) açın
node bin/setup.mjs --root /path/to/github-repo

# 4. Doğrudan 5 adımlı kurulum sihirbazını (5050) özelleştirilmiş port ve veri diziniyle açın
node bin/setup.mjs wizard --root /path/to/github-repo --port 5050 --data-dir /path/to/data
```

## Entegrasyon Senaryoları (5 Mimari)

### Senaryo 1: Express.js ve Node.js Sunucu Uygulamaları (Doğrudan Gömülü veya CLI)

1. **Kurulum:** `npm install github:sirrakadembasti/setup` veya `npx github:sirrakadembasti/setup init`
2. **Bağlama:** `mountSetupGuard(app, { embedWizard: true })` ile kurulum tamamlanana kadar istekleri `/setup` sihirbazına yönlendirme; çalışma anında `readSetupRuntimeConfig()` ve `verifyAdminCredentials(root, email, password)` kullanımı.
3. **Kullanım:** Yöneticiler `/setup` sayfasından 5 adımlı kurulumu tamamlar; `.env`, `data/admin.json` (`scrypt` hash) ve `data/installation.lock` üretilir.

### Senaryo 2: Tek Sayfalık (SPA) ve Statik Web Uygulamaları (React, Vue, Vite, Saf HTML/JS)

Tarayıcıda çalışan statik uygulamalarda gizli anahtarlar (`SESSION_SECRET`, `ADMIN_PASSWORD_HASH`, `SMTP_PASS`) istemciye çıkarılmaz; `setup` yerel kurulum/önizleme servisi olarak çalışır:

1. **Servisi Başlatma:** `npx github:sirrakadembasti/setup --root .` (veya BFF/Sidecar olarak `SETUP_ALLOWED_ORIGINS=http://localhost:5173 npx github:sirrakadembasti/setup wizard --port 5050`).
2. **Yapılandırma & Derleme:** Sihirbaz `npm run build` çalıştırır ve çıktı klasörüne (`dist/` veya `public/`) yalnız güvenli genel ayarları içeren `runtime-config.json` ve `env-config.js` (`window.__SETUP_CONFIG__`) yazar.
3. **Sunum:** `preview` betiği varsa onu, yoksa `setup`'ın yerleşik sıfır-bağımlılıklı statik dosya sunucusunu (`createStaticAppServer`) hedef portta başlatır.

### Senaryo 3: Full-Stack Uygulamalar (Next.js App Router, Nuxt, SvelteKit, Astro, Monorepo)

Express kullanmayan full-stack projelerde doğrudan framework-agnostik çekirdek (`setup/core`) veya otomatik CLI kullanılır:

1. **Singleton (`lib/setup.js`):** `createSetupWizardCore({ projectRoot: process.cwd(), syncApply: true })` örneğini oluşturun.
2. **API Route (`app/api/setup/[...slug]/route.js`):** `await setupCore.handle({ method, path, headers, body })` çağırın ve dönen `{ status, headers, body }` nesnesini `NextResponse` ile yanıtlayın.
3. **Kullanım:** Server Action veya Route Handler içinden `readSetupRuntimeConfig()` ve `verifyAdminCredentials()` çağırın ya da CLI ile migration + build (`next build`) zincirini otomatik çalıştırın.

### Senaryo 4: Diğer Sunucu Uygulamaları (Fastify/Koa/Hono veya Python FastAPI/Django, Go, C# .NET, Rust)

- **Node.js (Fastify / Koa / Hono):** `setup/core` içindeki `setupCore.handle({ method, path, headers, body })` metodunu kendi route handler'ınıza sarın.
- **Node.js Dışı Diller (Python FastAPI/Django, Go, C# .NET, Rust):**
  1. `npx github:sirrakadembasti/setup init` komutu `pyproject.toml`/`requirements.txt`, `go.mod`, `*.csproj` veya `Cargo.toml` dosyasını otomatik algılar ve `setup.config.json` içine ilgili dilin `install` ve `start` komutlarını yazar.
  2. `npx github:sirrakadembasti/setup wizard --port 5050` yerel Sidecar olarak `.env`, `data/admin.json`, `data/deployment-config.json` ve `nginx.conf.example` üretip Python/Go/C#/Rust sunucusunu başlatır. Dil profilleri (venv, uvicorn/flask/django, `cmd/`, çözüm dosyası, Cargo çalışma alanı, doğrulama adımları) için [ENTEGRASYON.md](ENTEGRASYON.md#dil-profilleri-python--go--c-net--rust) bölümüne bakın.

### Senaryo 5: Masaüstü Uygulamaları (Electron, Tauri, C# WPF/MAUI, PyQt)

- **Başlatma ve durum (CLI/Sidecar):** Masaüstü uygulamaları port açmadığından sihirbaz bitişte "Masaüstü uygulamasını başlat" düğmesi gösterir. `/api/start-app` uygulamayı ayrı bir süreç olarak açar ve **portu değil süreci** denetler: 3 sn içinde kapanırsa 409 ve çıkış koduyla hata döner, ayaktaysa PID bildirir; `/api/app-health` aynı süreç durumunu verir. Başlatma komutu `setup.config.json` içindeki `start` alanından gelir (`init` bunu Electron için `scripts.start` veya `npx electron .`, Tauri için `scripts.tauri` → `<pm> run tauri dev` olarak yazar).
- **Veri dizini:** Kurulum verileri varsayılan olarak proje dizinine yazılır. Paketlenmiş uygulamada kullanıcı verisi dizinini (`app.getPath('userData')`) `dataDir` ile (IPC) veya `--data-dir` ile (Sidecar) verin; `setup` bu dizini tahmin etmez.
- **Electron (HTTP Portu Açmadan Doğrudan IPC):**
  1. Electron Main sürecinde `app.getPath('userData')` dizinini `createSetupWizardCore({ projectRoot: app.getAppPath(), dataDir: app.getPath('userData'), syncApply: true, ipcMode: true })` içine verin.
  2. `ipcMain.handle('setup:handle', (_, req) => setupCore.handle(req))` ve `ipcMain.handle('setup:runtime', () => readSetupRuntimeConfig({ dataDir: app.getPath('userData') }))` ile Renderer sürecine bağlayın.
- **Tauri (Rust) / PyQt / C# Masaüstü (Yerel Sidecar):**
  1. Masaüstü uygulaması açılırken arka planda `SETUP_ALLOWED_ORIGINS=tauri://localhost node bin/setup.mjs wizard --port 5050 --data-dir <AppData>` alt sürecini başlatın.
  2. WebView içinden `http://127.0.0.1:5050` kurulum arayüzünü gösterin veya API uç noktalarını çağırın.

Tüm senaryoların kopyala-yapıştır kod şablonları [ENTEGRASYON.md](ENTEGRASYON.md) dosyasında yer almaktadır.

**Gömülü kullanım güvenliği:** IPC dışındaki çekirdek kullanımı `x-setup-csrf` başlığı ve Origin eşleşmesi ister (`core.csrfToken`); serverless ortamda `token: process.env.SETUP_TOKEN` verin. Kurulumdan sonra sihirbaz uçları 404 döner ve `runtime-config` ucu gizli değer döndürmez. Ayrıntı: [ENTEGRASYON.md](ENTEGRASYON.md#güvenlik-notları-gömülü-kullanım).

## Dizin Yapısı

```text
setup/
├── VERSION                   # Aktif sürüm (1.0.0)
├── CHANGELOG.md              # Sürüm değişiklik günlüğü
├── ENTEGRASYON.md            # 5 mimari senaryo için kopyala-yapıştır entegrasyon şablonları
├── package.json
├── bin/
│   ├── setup.mjs             # Ana CLI (setup, wizard, init, detect, plan, version)
│   ├── kurulum.sh            # Ön kontrol + başlatıcı (çağrıldığı dizindeki projeyi kurar; package.json zorunlu değil)
│   └── kurulum.bat           # Aynısı, Windows (UTF-8)
├── scripts/
│   ├── detect-project.mjs    # Otomatik proje, teknoloji, paket yöneticisi ve .env.example algılama
│   ├── polyglot.mjs          # Python/Go/.NET/Rust kurulum, doğrulama ve başlatma profilleri
│   ├── run-steps.mjs         # Çok adımlı kurulumu sırayla çalıştıran yardımcı
│   ├── setup-bootstrap.mjs   # 5049 Web Kurulum Başlatıcısı
│   ├── setup-bootstrap-lib.mjs
│   ├── find-port-holder.mjs  # 4 katmanlı port/PID tespit aracı
│   ├── version.mjs           # SemVer sürümleme ve Git etiketleme aracı
│   ├── setup-api.mjs         # Programatik ESM API
│   └── *.test.mjs            # Birim, Güvenlik ve E2E test paketi
├── wizard/
│   ├── core.mjs              # Framework-agnostik kurulum çekirdeği, Express guard ve çalışma anı okuyucusu
│   ├── server.mjs            # 5050 Web Kurulum Sihirbazı sunucusu ve yerleşik statik dosya sunucusu
│   ├── ui.mjs                # 5 adımlı sihirbaz arayüzü
│   ├── ui.ts                 # Sihirbaz HTML şablonu (ui.mjs çalışma anında okur)
│   └── config.mjs            # Doğrulama şemaları, scrypt parola doğrulama ve .env üreticisi
├── utils/
│   ├── project-paths.mjs
│   └── deployment-config.mjs
├── templates/
│   └── setup.config.json     # Örnek eklenti yapılandırma şablonu
└── docs/
    └── entegrasyon.md        # GitHub repo entegrasyon ve özelleştirme rehberi (ENTEGRASYON.md ile senkronize)
```

## Programatik API Kullanımı

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

// Hedef GitHub reposunu incele
const { version, detection, plan } = await inspect("/path/to/repo");

// Hedef repoya setup.config.json entegre et
initProject("/path/to/repo", { overwrite: false, updatePackageJson: true });

// Çalışma anında kurulum durumunu oku ve yönetici kimliğini doğrula
const runtime = readSetupRuntimeConfig("/path/to/repo");
const isValidAdmin = verifyAdminCredentials("/path/to/repo", "admin@ornek.com", "Guc1uParola123");
```

## Sürümleme Mekanizması

```bash
npm run version:get      # Mevcut sürümü yazdırır: v1.0.0 (v1.0)
npm run version:patch    # 1.0.0 -> 1.0.1 yükseltir ve git tag oluşturur
npm run version:minor    # 1.0.0 -> 1.1.0 yükseltir ve git tag oluşturur
npm run version:major    # 1.0.0 -> 2.0.0 yükseltir ve git tag oluşturur
```

## Testleri Çalıştırma

```bash
npm test
```
