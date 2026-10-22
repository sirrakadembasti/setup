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
| **Senaryo 3** | **Full-Stack (SSR)** | Next.js (App Router), Nuxt, SvelteKit, Astro |
| **Senaryo 4** | **Çok Dilli Backend** | Python (FastAPI, Django, Flask), Go, C# .NET, Rust |
| **Senaryo 5** | **Masaüstü** | Electron (gömülü IPC), Tauri (Sidecar) |

---

## 🌟 Temel Avantajlar

- **Sıfır Bağımlılık:** Yalnızca Node.js (>=18) veya Bun yerleşik modüllerini kullanır; `npm install` gerektirmez.
- **Dual npm / bunx Desteği:** İş ortamlarında `npm` çalışmasa dahi sistemdeki `bun` algılanarak kurulumdan derlemeye tüm süreç sorunsuz tamamlanır.
- **Dinamik Paket Yöneticisi Fallback'i:** Proje `pnpm` veya `yarn` istese bile sistemde o araç yoksa ve yalnızca `bun` varsa, kurulum ve derleme otomatik olarak `bun`'a yönlendirilir; alt script çağrıları (`bin/shims`) çökmeden çalışır.
- **Güvenli:** Tarayıcı uygulamalarına gizli anahtarları sızdırmaz, CSRF ve timing-safe korumalıdır.
- **Esnek:** Doğrudan CLI ile kullanılabileceği gibi Express middleware'i, Next.js API Route'u veya Electron IPC içine gömülebilir.

---

## 📚 Kapsamlı Dokümantasyon

Tüm mimarilere özel kopyala-yapıştır kod şablonları, framework middleware entegrasyonları, programatik ESM API referansı ve detaylı parametreler için:

👉 **[ENTEGRASYON.md](ENTEGRASYON.md) — 5 Mimari Senaryo ve Geliştirici Kılavuzu**
