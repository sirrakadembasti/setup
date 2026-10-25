# setup (v1.0) — Evrensel Uygulama Kurulum Aracı

GitHub'dan indirilen projelerde mimariyi algılayan, **tanılama ve bağımlılık kurulumunu terminal menüsünde**, uygulama yapılandırmasını ise **web sihirbazında** yürüten bağımsız kurulum eklentisidir.

---

## ⚡ Hızlı Başlangıç

### 1. İndirilen Bir Projeyi Kurup Çalıştırmak (Son Kullanıcı)
GitHub'dan indirdiğiniz herhangi bir projenin kök dizininde terminalden tek komut çalıştırın:

```bash
# npm / npx ile:
npx github:sirrakadembasti/setup

# veya Bun / bunx ile (iş bilgisayarlarında npm kısıtlıysa):
bunx github:sirrakadembasti/setup
```

> **İpucu:** Projede başlatıcı dosyaları varsa doğrudan çift tıklayabilirsiniz:
> - **Windows:** `kurulum.bat`
> - **Linux / macOS:** `./kurulum.sh`

Depodaki ve `setup init` tarafından üretilen başlatıcılar aynı kaynaktan gelir. Node.js **18 veya üstü** kullanılır; uygun Node yoksa Bun denenir. Proje tanılama, paket yöneticisi seçimi ve kurulum işleri ortak terminal akışında yürütülür.

---

### 2. Kendi Reponuza Kurulum Sihirbazı Eklemek (Geliştirici)
Projenizin kök dizininde aşağıdaki komutu çalıştırarak çift tıklanabilir başlatıcıları (`kurulum.bat`, `kurulum.sh`) ve yapılandırma dosyasını (`setup.config.json`) otomatik oluşturun:

```bash
# Bun / bunx ile:
bunx github:sirrakadembasti/setup init

# veya npm / npx ile:
npx github:sirrakadembasti/setup init

# Çevrimdışı / Yerel klasörden (tools/setup):
node tools/setup/bin/setup.mjs init

# Şirket / Kurumsal Ağlar İçin (setup çekirdeğini yerel kopyadan kullanır):
bun /path/to/setup/bin/setup.mjs init --copy-tools
# veya:
node /path/to/setup/bin/setup.mjs init --offline
```

```bash
# Belirli bir alt projeyi hedeflemek (Çok parçalı veya monorepo repolar için):
bunx github:sirrakadembasti/setup --candidate apps/web
# veya:
npx github:sirrakadembasti/setup --candidate apps/web
```

> **İpucu:** Proje dizinindeyken `--root .` yazmanıza gerek yoktur; komut doğrudan çalıştırıldığı klasörü hedefler. Farklı bir dizini hedeflemek için `--root /hedef/dizin` belirtebilirsiniz. Çoklu alt proje içeren repolarda belirli bir projeyi kurmak için `--candidate <alt-dizin>` parametresini kullanabilirsiniz. `--copy-tools`, setup çekirdeğini `tools/setup` klasörüne yerleştirerek başlatıcının GitHub'dan indirilmesini önler. Hedef projenin paketleri için internet erişimi veya hazır paket önbelleği gerekebilir.

---

## 🔄 Nasıl Çalışır?

Önceden kurulum eklentisi eklenmiş bir projeyi güncellemek için **güncel setup kopyasından** çalıştırın:

```bash
node /guncel/setup/bin/setup.mjs init --root /hedef/proje --copy-tools --refresh-launchers
```

Bu komut `setup.config.json` dosyasını korur, değiştirilecek başlatıcıları tarihli `.bak` dosyalarına yedekler ve yerel `tools/setup` kopyasını yeniler. Başka projelerdeki eski kopyalar kendiliğinden güncellenmez. Başlatıcılar zaten güncelse işlem güvenle tekrar çalıştırılabilir.

`node bin/setup.mjs`, `node scripts/setup-bootstrap.mjs` ve `npm run setup -- ...` aynı seçenekleri işler. Örneğin `npm run setup -- --root /hedef/proje --port 5051 --check-only` yalnız durum JSON çıktısı verir. `wizard --check-only` de dosya oluşturmadan aynı denetimi yapar.

```text
[ Proje Dizini ] ──> 1. Terminalde Tanılama ──> 2. Terminalde Paket Kurulumu ──> 3. Web Sihirbazı (Port 5050) ──> [ Uygulama Hazır ]
```

1. **Akıllı Proje Tespiti:** Kök dizini ve kaynak kodları tarayarak dili, mimariyi, paket yöneticisini (`npm`, `pnpm`, `yarn`, `bun`) ve `.env.example` değişkenlerini otomatik belirler.
2. **Terminal Kurulum Başlatıcısı:** Proje ve çalışma ortamı raporunu gösterir. `1` ile paketleri kurun/onarın, tamamlanınca `2` ile web sihirbazına geçin. Canlı işlem çıktıları terminalde izlenir; gerekli dil araçları eksikse kurulum bilgisi gösterilir. Port 5049 kullanılmaz.
3. **Web Kurulum Sihirbazı (`127.0.0.1:5050`):** `.env` dosyasını, veritabanını ve isteğe bağlı ilk yönetici hesabını oluşturup uygulamanızı başlatır.

Terminal menüsünde ayrıca **yeniden yapılandırma**, **yeniden denetleme** ve **doğrulanmış yedekle temiz kurulum** seçenekleri bulunur. Temiz kurulum açık onay ve doğrulama metni ister. Sihirbaz portu doluysa süreç bilgisi gösterilir; yalnız onayınızla doğrulanmış kurulum süreci durdurulur. Terminali sihirbaz bitene kadar açık tutun.

`--port 5051` sihirbaz portunu değiştirir (1024–65535). Öncelik sırası `--port` → `SETUP_WIZARD_PORT` → eski `SETUP_PORT` → `ports.wizard` → `5050` şeklindedir. `--no-open` tarayıcıyı açmadan bağlantıyı gösterir; `--check-only` dosya oluşturmadan ve port açmadan durum JSON çıktısı verir. Birden fazla bağımsız uygulama bulunduğunda hedef terminalden veya `--candidate <dizin>` ile seçilir. Doğrudan `wizard --candidate <dizin>` komutu da seçilen dizini kurulum kökü olarak kullanır.

---

## 🏗️ Desteklenen Mimariler

| Senaryo | Mimari Türü | Desteklenen Teknolojiler |
|---|---|---|
| **Senaryo 1** | **Node.js Sunucu** | Express.js, Fastify, Koa, Hono |
| **Senaryo 2** | **SPA & Statik Web** | React, Vue, Vite, Saf HTML/JS |
| **Senaryo 3** | **Full-Stack (SSR, Monorepo & Çift Süreç)** | Next.js (App Router), Nuxt, SvelteKit, Astro, bağımsız Backend + Frontend (`srv/` + `ui/`), pnpm/npm/yarn/bun workspaces |
| **Senaryo 4** | **Çok Dilli Backend** | Python (FastAPI, Django, Flask), Go, C# .NET, Rust, C/C++ (CMake, Makefile, Meson) |
| **Senaryo 5** | **Masaüstü ve Oyunlar** | Electron (gömülü IPC), Tauri (Sidecar), C# WinForms / WPF (.NET), Python GUI (Tkinter, PyQt, PySide), Unity, Unreal Engine, Godot |

---

## 🌟 Temel Avantajlar

- **Standart Dışı ve Dağınık Repolar İçin Derin Tarama (Deep Recursive Discovery):** Kök dizinde `package.json` olmasa dahi 3 derinlik seviyesine kadar alt klasörleri tarar, içerik analitiği ile rolleri (Frontend, Backend, Desktop) belirler ve alt dizindeki projeyi tek tıkla kurar.
- **Çok Parçalı (Backend + Frontend) Bağımsız Kurulum ve Çift Süreç Orkestrasyonu (Dual Orchestration):** Kök dizinde `package.json` olmasa bile `backend/`, `frontend/`, `srv/`, `ui/` gibi ayrı klasörlerdeki bileşenlerin bağımlılıklarını `--prefix` adımlarıyla otomatik ve bağımsız kurar, derler ve canlı geliştirme modunda iki süreci `PORT` ve `API_URL` köprüsüyle eşzamanlı ayağa kaldırır; kademeli kapanma (cascading termination) ile süreçlerden biri çöktüğünde diğerini temizce sonlandırır.
- **Dağınık Yapılandırma Birleştirme (Bubble-Up):** `config/`, `deploy/`, `server/` gibi klasörlerdeki dağınık `.env.example` dosyalarını otomatik havuzda birleştirir ve üretilen `.env`'yi tüm alt projelere güvenle dağıtır.
- **Etkileşimli Aday Seçim Paneli:** Repoda birden çok bağımsız mikroservis/uygulama olduğunda terminal menüsünden, Web Sihirbazı üzerinden veya CLI'dan `--candidate <dizin>` ile hedef projeyi seçtirir.
- **Sıfır Bağımlılık ve Genişletilmiş Sürüm Desteği:** Yalnızca Node.js (>=18, Node 20, 22, 24, 25, 26+) veya Bun yerleşik modüllerini kullanır; `npm install` gerektirmez.
- **C/C++ ve Oyun Motorları (Unity/Unreal/Godot) Desteği:** `CMakeLists.txt`, `Makefile` veya oyun motoru yapılandırmaları (`project.godot`, Unity `ProjectVersion.txt`, Unreal `*.uproject`) otomatik tanınır; derleme ve başlatma adımları sıfır ayarla işletilir.
- **Kapsamlı Hata Yönetimi ve Otomatik Geri Alma (Rollback):** Kurulum adımlarında (derleme, veritabanı migration veya seed) hata oluşursa üretilen geçici dosyalar temizlenir, eski `.env` yedeği (`backups/.env-*.bak`) otomatik olarak geri yüklenir ve bozuk lock bırakılmaz.
- **Akıllı Ağ ve Soket Hata Çözümlemesi:** Canlı veritabanı ve SMTP sınamalarında sistem soket kodları (`ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`, `EHOSTUNREACH`) kullanıcı dostu Türkçe hata açıklamalarına dönüştürülür.
- **Sinyal Yakalama ve Zombi Süreç Koruması:** Terminal kapatıldığında veya `Ctrl+C` (`SIGINT`, `SIGTERM`) yapıldığında süreç ağacı temizlenir, yetim süreç kalması önlenir.
- **Dizin İzni ve Port Çakışması Ön Denetimleri:** Kurulum öncesinde dizin yazılabilirliği (`fs.constants.W_OK`) ve port meşguliyeti denetlenir; kullanıcıya alternatif port veya süreç sonlandırma önerilir.
- **Arayüzde Görsel Hata Vurgulama ve Yeniden Bağlanma:** Form doğrulama hatalarında ilgili alanlar kırmızı çerçeveyle işaretlenir; sunucu kesintilerinde tepede beliren bildirim çubuğuyla yeniden bağlanma olanağı sunulur; butonlarda çift tıklama koruması bulunur.
- **Erken Çökme Teşhisi (`APP_CRASHED`):** Uygulama başlatıldıktan sonraki ilk 3.2 saniyede çökerse çıkış kodu, sinyal ve stderr satırlarıyla anında kullanıcıya bildirilir.
- **Dual npm / bunx & Shims Desteği:** İş ortamlarında `npm` çalışmasa dahi sistemdeki `bun` algılanarak kurulumdan derlemeye tüm süreç sorunsuz tamamlanır; `bin/shims` (`pnpm`, `yarn`, `bunx`) sayesinde monorepo alt scriptleri şeffafça Bun'a yönlendirilir.
- **Monorepo (Workspaces) Desteği:** `pnpm-workspace.yaml`, `apps/*` ve `packages/*` mimarisindeki monorepoların bağımlılıkları, derleme adımları (`buildServer`, `buildClient`) ve migration'ları (`packages/db`) otomatik algılanır ve işletilir.
- **Dinamik Paket Yöneticisi Fallback'i:** Proje `pnpm` veya `yarn` istese bile sistemde o araç yoksa ve yalnızca `bun` varsa, kurulum ve derleme otomatik olarak `bun`'a yönlendirilir; alt script çağrıları (`bin/shims`) çökmeden çalışır.
- **Esnek Veritabanı ve Kurumsal SMTP / Google Workspace:** SQLite'ın yanı sıra PostgreSQL, MySQL ve Özel Bağlantı Dizesi (Connection String) desteği; Google Workspace kurumsal alan adları (`@sirket.com`) ve genel SMTP sunucuları ile tam uyumluluk.
- **Gelişmiş .env Ayrıştırması:** Standart POSIX `export ` önekleri, satır içi yorumlar (`# comment`) ve çok satırlı tırnaklı dizgeler bozulmadan ayrıştırılır.
- **Canlı Ağ Sınaması (Active Pre-Apply Probing):** Veritabanı (TCP port) ve SMTP sunucusuna (ESMTP 220 banner okuma) arayüzden tek tıkla canlı bağlantı testi.
- **Canlı İşlem Günlüğü ve Güvenli Sır Maskeleme:** Kurulum adımları esnasında derleme ve migration çıktıları arayüzdeki canlı terminal konsolundan izlenir; parolalar ve bağlantı sırları (`******`) otomatik sansürlenir.
- **Çok Dilli Migration ve Tohumlama (Seeding):** Node.js script'lerinin yanı sıra Django, Alembic, .NET EF, Rust migration'ları, kaynak koddan port tespiti ve otomatik `seed` betiği yürütümü.
- **Yeniden Yapılandırma Modu (`--reconfigure`):** Kurulu sistemi yıkıcı temiz kuruluma zorlamadan ayarları, portları ve `.env` dosyasını güvenle güncelleme imkanı.
- **Güvenli ve Yüksek Performanslı:** Tarayıcı uygulamalarına gizli anahtarları sızdırmaz, CSRF, origin tutarlılığı, bellek sızıntısız rate limiting (`createRateLimiter`), akış tabanlı statik dosya sunumu (`createReadStream`) ve symlink sınır kontrolü (`realpathSync`) içerir.
- **Kapsamlı Test Kapsamı:** Yerleşik otomasyon testleri; mimari senaryoları, terminal başlatıcısını, derin taramayı, çift süreç yönetimini, port çakışmalarını, CSRF korumalarını, çok dilli profilleri ve hata dayanıklılığını kapsar. Testleri `npm test` ile çalıştırabilirsiniz.

---

## 📚 Kapsamlı Dokümantasyon

Tüm mimarilere özel kopyala-yapıştır kod şablonları, framework middleware entegrasyonları, programatik ESM API referansı ve detaylı parametreler için:

👉 **[ENTEGRASYON.md](ENTEGRASYON.md) — 5 Mimari Senaryo ve Geliştirici Kılavuzu**
