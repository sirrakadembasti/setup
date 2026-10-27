# setup (v1.0) — Evrensel Uygulama Kurulum Aracı

GitHub'dan indirilen veya şirket içinde paylaşılan projelerde **mimariyi otomatik algılayan**, **bağımlılık kurulumunu terminal menüsünde**, **uygulama yapılandırmasını (`.env`, veritabanı, yönetici hesabı) ise web sihirbazında** yürüten sıfır bağımlılıklı kurulum eklentisidir.

---

## ⚡ Hızlı Başlangıç

### 1. İndirilen Bir Projeyi Kurup Çalıştırmak (Son Kullanıcı)

Projede başlatıcı dosyaları varsa doğrudan çift tıklayın veya terminalden çalıştırın:
- **Windows:** `kurulum.bat`
- **Linux / macOS:** `./kurulum.sh`

Projede başlatıcı yoksa proje kök dizininde tek komut çalıştırın:

```bash
# npm / npx ile:
npx github:sirrakadembasti/setup

# Bun / bunx ile (npm kısıtlı kurumsal bilgisayarlarda):
bunx github:sirrakadembasti/setup
```

### 2. Kendi Reponuza Kurulum Sihirbazı Eklemek (Geliştirici)

Projenizin kök dizininde aşağıdaki komutu çalıştırarak `kurulum.bat`, `kurulum.sh` ve `setup.config.json` dosyalarını otomatik oluşturun:

```bash
# Kurumsal / Çevrimdışı Ağlar İçin (setup çekirdeğini tools/setup altına kopyalar):
node /path/to/setup/bin/setup.mjs init --copy-tools

# veya GitHub üzerinden:
bunx github:sirrakadembasti/setup init --copy-tools
npx github:sirrakadembasti/setup init --copy-tools

# Önceden eklenmiş bir projede başlatıcıları ve tools/setup kopyasını güncellemek için:
node /path/to/setup/bin/setup.mjs init --root /hedef/proje --copy-tools --refresh-launchers
```

---

## 🔄 Uygulama Nasıl Çalışır? (4 Adımda İşleyiş)

```text
[1. Mimari Algılama] ──> [2. Terminalde Paket Kurulumu] ──> [3. Web Sihirbazı (5050)] ──> [4. Doğrulanmış Başlatma]
```

### Adım 1 — Başlatma ve Akıllı Mimari Algılama (`detect-project.mjs`)
`kurulum.bat` veya `kurulum.sh` çalıştırıldığında önce sistemdeki uygun çalışma zamanı (**Node.js >= 18** veya **Bun**) seçilir. Ardından proje klasörü taranarak:
- **Mimari Senaryo (Senaryo 1–5):** Tekil sunucu, SPA/Statik web, Full-Stack/Monorepo, Çok Dilli (Python/Go/.NET/Rust/C++) veya Masaüstü/Oyun olduğu belirlenir.
- **Hibrit ve Çok Parçalı Yapılar:** Kök dizindeki `package.json` ile birlikte `backend/`, `frontend/`, `execution/`, `llm-yonetimi/`, `srv/`, `ui/` gibi alt projeler tespit edilir. (`tools/setup`, `e2e`, `docs`, `scripts`, `tests` gibi araç klasörleri otomatik hariç tutulur.)
- **Ortam Şablonları:** Kök ve alt dizinlerdeki `.env.example` dosyaları tek bir yapılandırma havuzunda birleştirilir.

### Adım 2 — Terminal Kontrol Paneli, Modül Özeti ve Doğrudan Başlatma (`terminal-bootstrap.mjs` & `run-steps.mjs`)
Terminal ekranında kurulum adımlarının anlık ilerleme durumu (`[✓]` Tamamlandı, `[→]` Sıradaki Adım, `[ ]` Bekliyor), hedef projenin alt modül bileşenleri ve sıralı işlem menüsü (`1–6` ve `0`) yapılandırılmış bir panel olarak gösterilir:
- **Hedef Proje ve Alt Modül Bileşen Durumu (`modules`):** Başlıkta hedef projenin gerçek klasör ve paket adı (`Hedef Proje: xfactor-main (xfactor-e2e)`) gösterilir. Çok parçalı projelerde (`backend`, `frontend`, `execution`, `llm-yonetimi` vb.) her bir alt modülün paket ve `.env` hazırlık durumu (`[✓] backend (@xfactor/backend) — Paketler: hazır | .env: şablondan üretilecek`) ayrı ayrı raporlanır.
- **Adım İlerlemesi ve Öneri Kutusu:** Hangi adımların tamamlandığı (`[✓] 3. Bağımlılık kurulumu — Tamamlandı (Tekrar kurulum gerekmez)`) ve hangi adımın sırada olduğu (`[→] 4. Web kurulum sihirbazı (5050) — Sıradaki Adım (Seçenek 2 veya 6)`) açıkça işaretlenir.
- **Sıralı İşlem Menüsü (`1–6, 0`):** Tüm seçenekler (`1) Paketleri Kur / Onar`, `2) Kurulum Sihirbazına Geç`, `3) Yeniden Yapılandır`, `4) Yeniden Denetle`, `5) Yedekle ve Temiz Kuruluma Geç`, `6) Uygulamayı Doğrudan Başlat`, `0) Çıkış`) numara atlamadan sıralı biçimde ve o anki durum rozetleriyle listelenir.
- **Terminalden Doğrudan Uygulama Başlatma (`6) Uygulamayı Doğrudan Başlat`):** Paketler kurulduktan sonra Web Sihirbazına girmeye gerek kalmadan **`6`** seçildiğinde; hedef projede veya alt modüllerinde `.env` yoksa `.env.example` varsayılanlarından otomatik `.env` ve `data/installation.lock` oluşturulur, ardından hedef uygulama başlatılıp tarayıcıda açılır.
- **Tekrar Kurulum Koruması ve Hata Yakalama:**
  - Paketler zaten kurulmuş ve doğrulanmışsa (`Paketler: hazır`), kullanıcı yanlışlıkla tekrar **`1`** seçtiğinde sistem paketlerin zaten kurulu olduğunu bildirir ve açık onay (`[e/H]`) almadan tekrar kurulum yapmaz.
  - Uygulama zaten kuruluysa (`Uygulama zaten kurulu` / `installation.lock` mevcut), **`2`** seçildiğinde sıfırdan kurulum engellenir ve mevcut verileri kaybetmeden **`3) Yeniden Yapılandır`** moduna geçiş önerilir.
- **Otomatik Bun & Shim Köprüsü (`bin/shims/`):** Bilgisayarda `npm`, `pnpm` veya `yarn` kurulu değilse işlemler otomatik olarak **Bun** üzerinden yürütülür. `postinstall` içindeki `npm --prefix ../alt-paket ci` gibi komutlar ve `package-lock.json` + `overrides` içeren projeler çevrimdışı Bun önbelleğiyle (`~/.bun/install/cache`) uyumlu şekilde kurulur.

### Adım 3 — Hedef Proje Odaklı Tek Sayfa Web Yapılandırma ve Başlatma Ekranı (`127.0.0.1:5050` — `wizard/ui.html.mjs`)
Terminalde **`2) Kurulum Sihirbazına Geç`** seçildiğinde tarayıcıda, sıfırdan yabancı bir uygulama kuruyormuş hissi veren eski 5 adımlı sihirbaz yerine **hedef GitHub reposuna hizmet eden Tek Sayfa (4 Kartlı) Yapılandırma ve Başlatma Ekranı** açılır:
1. **1. Hedef Proje ve Sistem Hazırlık Özeti:** Hedef projenin gerçek klasör adı (`repositoryName`), mimari senaryosu, algılanan alt modül rozetleri (`backend`, `frontend`, `execution`, `llm-yonetimi` vb.) ve çalışma zamanı (`Node.js`, `Veri dizini`, `Araç zinciri`) hazırlık durumu gösterilir. Ham geliştirici JSON çıktısı daraltılmış `<details>` çekmecesinde tutulur.
2. **2. Hedef Proje Portları ve `.env.example` Değişkenleri:** Hedef uygulamanın çalışacağı Backend/Uygulama Portu, (Full-Stack projelerde) Frontend (UI) Portu ve hedef projedeki `.env.example` değişkenleri varsayılan değerleriyle doğrudan düzenlenebilir olarak sunulur. Gelişmiş Reverse Proxy / Alt Alan Adı ayarları isteğe bağlı `<details>` çekmecesindedir.
3. **3. Veritabanı ve Veri Hazırlığı:** Varsayılan olarak yerel SQLite (`Ek kurulum gerekmez`) seçilidir; PostgreSQL, MySQL veya Özel Bağlantı Dizesi seçildiğinde **Canlı Bağlantı Sınaması** (`🔍 Veritabanı Bağlantısını Sına`) yapılabilir. Gereksiz saklama politikası (365/180/90 gün) alanları kaldırılmış; İlk Yönetici (Seed) ve SMTP E-posta ayarları isteğe bağlı `<details>` çekmecesine alınmıştır.
4. **4. Tek Tıkla Kaydet, Hazırla ve Hedef Uygulamayı Başlat:** Sayfa açılır açılmaz aktif olan **`🚀 Ayarları Kaydet ve Hedef Uygulamayı Başlat`** düğmesiyle `.env` dosyaları kök ve alt projelere yazılır, varsa `build` / `migrate` / `seed` adımları canlı konsolda (`#applyConsole`) çalıştırılır ve hedef uygulama başlatılarak tarayıcıda açılır.

### Adım 4 — Doğrulanmış Uygulama Başlatma (`app-process.mjs`)
Kurulum tamamlandığında uygulama otomatik olarak başlatılır:
- Hem API sunucusunun hem de (varsa) ayrı Frontend / `devPort` (`5173` vb.) arayüzünün gerçek HTTP yanıtı döndürdüğü doğrulanır.
- Hazır olduğunda tarayıcı otomatik olarak uygulamanın giriş sayfasına yönlendirilir.
- Uygulama günlükleri (parola ve sırlar `******` ile maskelenmiş olarak) ilk açılan terminal ekranından canlı izlenir.

> **İpucu (Başlatma Sorunları):** Kurulum bitti ancak uygulama açılmadıysa kurulumu silmenize gerek yoktur. İlk terminaldeki hata çıktısını kontrol edip son ekrandaki **"Uygulamayı yeniden başlat / denetle"** düğmesini kullanabilirsiniz. Ayrıntılar: [Başlatma sorunlarını giderme](docs/ENTEGRASYON.md#başlatma-sorunlarını-giderme).

---

## 🧩 Uygulama Yapısı (Klasör ve Modül Özeti)

`setup` dört ana katmandan oluşur:

| Klasör / Dosya | Görevi |
|---|---|
| **`bin/`** | **Başlatıcılar ve Paket Yöneticisi Köprüleri** |
| ├─ `bin/setup.mjs` | Ana CLI giriş noktası (`setup`, `wizard`, `init`, `detect`, `version`). |
| ├─ `bin/kurulum.bat` / `kurulum.sh` | Çift tıklanabilir Windows ve Linux/macOS başlatıcı şablonları. |
| └─ `bin/shims/` | `npm`, `pnpm`, `yarn`, `npx` çağrılarını çalışma zamanında Bun'a çeviren uyumluluk katmanı (`npm-shim.mjs`, `pnpm-shim.mjs`). |
| **`scripts/`** | **Mimari Algılama ve Terminal Kurulum Motoru** |
| ├─ `detect-project.mjs` | Proje dili, çerçevesi, alt projeleri (`subprojects`), portları ve `.env.example` dosyalarını tarar. |
| ├─ `terminal-bootstrap.mjs` | İnteraktif terminal menüsünü (Paket kurma, Sihirbaz başlatma, Yeniden yapılandırma, Yedekli sıfırlama) yönetir. |
| ├─ `run-steps.mjs` & `process-runner.mjs` | Kök ve alt dizin kurulum adımlarını (`--prefix`), canlı log akışını, zaman aşımını ve süreç ağacı temizliğini yürütür. |
| ├─ `polyglot.mjs` | Python, Go, C# .NET, Rust ve C/C++ (CMake) projeleri için kurulum ve başlatma profillerini barındırır. |
| └─ `setup-api.mjs` | `initProject`, `inspect` ve programatik ESM API fonksiyonlarını dışa aktarır. |
| **`wizard/`** | **Web Kurulum Sihirbazı (Port 5050) ve Uygulama Yöneticisi** |
| ├─ `server.mjs` & `core.mjs` | Yerel HTTP sihirbaz sunucusu, gömülü Express/Fastify/Next.js middleware çekirdeği ve sağlık kontrolü (`/api/app-health`). |
| ├─ `shared.mjs` & `config.mjs` | `.env` üretimi, `scrypt` parola özetleme, `build` / `migrate` / `seed` adımları ve atomik geri alma (rollback) mantığı. |
| ├─ `app-process.mjs` | Tekil sunucu, çift süreç (Backend + Frontend) ve masaüstü uygulama süreçlerini başlatır ve izler. |
| └─ `ui.html.mjs` | Hedef proje odaklı tek sayfa (4 kartlı) Türkçe web yapılandırma ve başlatma arayüzü. |
| **`docs/`** | **Dokümantasyon ve Değişiklik Günlüğü** |
| ├─ [`docs/ENTEGRASYON.md`](docs/ENTEGRASYON.md) | 5 mimari senaryo için detaylı entegrasyon kılavuzu, kod şablonları ve CLI/API referansı. |
| └─ [`docs/CHANGELOG.md`](docs/CHANGELOG.md) | Sürüm geçmişi ve yapılan tüm geliştirmelerin detaylı kaydı. |

---

## 🏗️ Desteklenen 5 Mimari Senaryo

| Senaryo | Mimari Türü | Desteklenen Teknolojiler |
|---|---|---|
| **Senaryo 1** | **Node.js Sunucu** | Express.js, Fastify, Koa, Hono |
| **Senaryo 2** | **SPA & Statik Web** | React, Vue, Vite, Saf HTML/JS (yerleşik güvenli statik sunucu dahil) |
| **Senaryo 3** | **Full-Stack, Monorepo & Çok Parçalı** | Next.js, Nuxt, SvelteKit, Astro, `backend/` + `frontend/` + alt paketler, `pnpm`/`npm`/`yarn`/`bun` workspaces |
| **Senaryo 4** | **Çok Dilli Backend** | Python (FastAPI, Django, Flask), Go, C# .NET, Rust, C/C++ (CMake, Makefile, Meson) |
| **Senaryo 5** | **Masaüstü ve Oyunlar** | Electron (IPC), Tauri (Sidecar), C# WinForms / WPF, Python GUI (Tkinter, PyQt, PySide), Unity, Unreal, Godot |

---

## 🌟 Öne Çıkan Özellikler

### 1. Akıllı Algılama ve Çok Parçalı Repo Desteği
- **Derin Tarama ve Hibrit Mimari:** Kök dizinde `package.json` olmasa da veya E2E/orkestrasyon amaçlı bir kök `package.json` bulunsa da alt dizinlerdeki tüm bileşenleri (`backend`, `frontend`, `execution`, `llm-yonetimi`, `srv`, `ui`) otomatik algılar ve sırayla kurar.
- **Dağınık `.env.example` Birleştirme:** Alt klasörlerdeki örnek ortam dosyalarını birleştirir; üretilen `.env` dosyasını kök ve alt projelere dağıtır.
- **Etkileşimli Aday Seçimi:** Birden fazla bağımsız uygulama barındıran repolarda terminalden, web arayüzünden veya `--candidate <dizin>` parametresiyle hedef seçimi sunar.

### 2. Kurumsal Ağ, Bun Fallback ve Çevrimdışı Uyumluluk
- **Sıfır Bağımlılık:** Yalnızca yerleşik Node.js (>=18) veya Bun modüllerini kullanır.
- **Gelişmiş `bin/shims` Katmanı:** Sistemde `npm`, `pnpm` veya `yarn` yoksa tüm kurulum ve alt betikleri (`npm --prefix <dir> ci`, `pnpm --filter <pkg>`) şeffaf biçimde Bun'a çevirir.
- **Çevrimdışı `bun.lock` Ön Hazırlığı:** `package-lock.json` ve `overrides` içeren projelerde yerel Bun önbelleğini (`~/.bun/install/cache`) kullanarak ağ engeline takılmadan kurulum yapar.

### 3. Web Sihirbazı ve Çift Süreç Orkestrasyonu
- **Canlı Ön Kontroller:** Veritabanı (TCP) ve SMTP bağlantılarını kurulumdan önce tek tıkla test eder.
- **Çift Süreç (Backend + Frontend) Yönetimi:** Geliştirme veya çift sunucu modunda Backend ve Frontend süreçlerini birlikte başlatır, `API_URL` ve `ALLOWED_ORIGINS` köprülerini kurar; süreçlerden biri çökerse diğerini temizce kapatır.
- **Yeniden Yapılandırma (`--reconfigure`) ve Yedekli Temiz Kurulum:** Mevcut verileri silmeden ayarları güncelleme veya SHA-256 doğrulanmış yedek (`backups/`) alarak sıfırlama imkanı sunar.

### 4. Güvenlik ve Hata Dayanıklılığı
- **Atomik Rollback:** Derleme, migration veya seed adımlarından biri başarısız olursa yarım `.env` ve kilit dosyalarını temizleyip önceki kararlı yedeği geri yükler.
- **Gizli Bilgi Koruması:** SPA projelerinde gizli anahtarları (`SESSION_SECRET`, `DATABASE_URL`, `ADMIN_PASSWORD_HASH`) tarayıcıya sızdırmaz; terminal ve web günlüklerinde parolaları `******` ile maskeler.
- **Kapsamlı Test Paketi:** 215+ birim ve entegrasyon testi (`npm test`) ile tüm senaryolar doğrulanmıştır.

---

## 📚 Kapsamlı Dokümantasyon

- 👉 **[docs/ENTEGRASYON.md](docs/ENTEGRASYON.md) — 5 Mimari Senaryo, Uygulama Yapısı ve Geliştirici Kılavuzu**
- 👉 **[docs/CHANGELOG.md](docs/CHANGELOG.md) — Değişiklik Günlüğü (Changelog)**
