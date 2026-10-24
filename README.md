# setup (v1.0) — Evrensel Uygulama Kurulum Aracı

Herhangi bir GitHub reposundaki projeyi karmaşık terminal komutlarıyla uğraşmadan **otomatik mimari algılama ve kullanıcı dostu bir web arayüzü** üzerinden tek tıkla kurup çalıştıran bağımsız kurulum eklentisidir.

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

# Şirket / Kurumsal Ağlar İçin (%100 Çevrimdışı - GitHub/SSL engeline takılmaz):
bun /path/to/setup/bin/setup.mjs init --copy-tools
# veya:
node /path/to/setup/bin/setup.mjs init --offline
```

> **İpucu:** Proje dizinindeyken `--root .` yazmanıza gerek yoktur; komut doğrudan çalıştırıldığı klasörü hedefler. Farklı bir dizini hedeflemek için `--root /hedef/dizin` belirtebilirsiniz. Şirket ağında GitHub SSL engeli varsa `--copy-tools` parametresi `tools/setup` klasörünü otomatik olarak projenize yerleştirir ve kurulumun internete hiç çıkmadan çalışmasını sağlar.

---

## 🔄 Nasıl Çalışır?

```text
[ Proje Dizini ] ──> 1. Otomatik Algılama ──> 2. Başlatıcı (Port 5049) ──> 3. Sihirbaz (Port 5050) ──> [ Uygulama Hazır ]
```

1. **Akıllı Proje Tespiti:** Kök dizini ve kaynak kodları tarayarak dili, mimariyi, paket yöneticisini (`npm`, `pnpm`, `yarn`, `bun`) ve `.env.example` değişkenlerini otomatik belirler.
2. **Kurulum Başlatıcısı (`127.0.0.1:5049`):** Bağımlılıkları (Node, Python, Go, .NET, Rust) tek tıkla yükler, port çakışmalarını denetler.
3. **Web Kurulum Sihirbazı (`127.0.0.1:5050`):** `.env` dosyasını, veritabanını ve isteğe bağlı ilk yönetici hesabını oluşturup uygulamanızı başlatır.

---

## 🏗️ Desteklenen Mimariler

| Senaryo | Mimari Türü | Desteklenen Teknolojiler |
|---|---|---|
| **Senaryo 1** | **Node.js Sunucu** | Express.js, Fastify, Koa, Hono |
| **Senaryo 2** | **SPA & Statik Web** | React, Vue, Vite, Saf HTML/JS |
| **Senaryo 3** | **Full-Stack (SSR & Monorepo)** | Next.js (App Router), Nuxt, SvelteKit, Astro, pnpm/npm/yarn/bun workspaces (`apps/*`, `packages/*`) |
| **Senaryo 4** | **Çok Dilli Backend** | Python (FastAPI, Django, Flask), Go, C# .NET, Rust, C/C++ (CMake, Makefile, Meson) |
| **Senaryo 5** | **Masaüstü ve Oyunlar** | Electron (gömülü IPC), Tauri (Sidecar), Unity, Unreal Engine, Godot |

---

## 🌟 Temel Avantajlar

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
- **Kapsamlı Test Kapsamı:** 134 adet yerleşik otomasyon testi ile tüm senaryolar, port çakışmaları, CSRF korumaları, çok dilli profiller ve hata dayanıklılığı %100 oranında doğrulanmıştır.

---

## 📚 Kapsamlı Dokümantasyon

Tüm mimarilere özel kopyala-yapıştır kod şablonları, framework middleware entegrasyonları, programatik ESM API referansı ve detaylı parametreler için:

👉 **[ENTEGRASYON.md](ENTEGRASYON.md) — 5 Mimari Senaryo ve Geliştirici Kılavuzu**
