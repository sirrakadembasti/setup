# setup — Evrensel Uygulama Kurulum Aracı

İndirdiğiniz bir projeyi (GitHub ya da şirket içi repo) **tek komutla kurup çalıştırır**. Bağımlılık yüklemesini terminaldeki bir menüden, `.env` / veritabanı / port ayarlarını ise tarayıcıdaki tek sayfalık bir ekrandan yapar. Hiçbir ek paket gerektirmez; yalnızca **Node.js 18+** (ya da **Bun**) yeterlidir.

---

## Hızlı Başlangıç

### Projeyi kurup çalıştırmak istiyorsanız

Projede `kurulum.bat` / `kurulum.sh` varsa çalıştırmanız yeterli:

| İşletim sistemi | Komut |
|---|---|
| Windows | `kurulum.bat` (çift tıklayın) |
| Linux / macOS | `./kurulum.sh` |

Başlatıcı yoksa proje klasöründe şunlardan birini çalıştırın:

```bash
npx github:sirrakadembasti/setup      # Node.js ile
bunx github:sirrakadembasti/setup     # Bun ile (npm kısıtlı ortamlar için)
```

### Kendi reponuza kurulum desteği eklemek istiyorsanız

```bash
# Proje klasöründeyken:
npx github:sirrakadembasti/setup init

# Kurumsal / internetsiz ağlar: setup çekirdeğini projeye kopyalar (tools/setup)
npx github:sirrakadembasti/setup init --copy-tools

# Başlatıcıları yeni sürümle yenilemek için (eskileri .bak olarak yedekler):
npx github:sirrakadembasti/setup init --copy-tools --refresh-launchers
```

`init` projeye üç dosya ekler: `kurulum.bat`, `kurulum.sh` ve `setup.config.json`. `package.json` değiştirilmez (isterseniz `--update-package-json`).

> **Sürüm sabitleme:** `init`, başlatıcılardaki `npx/bunx` çağrısını setup'ın uzaktaki belirli bir commit'ine (`#<sha>`) bağlar; böylece `main` dalındaki sonraki değişiklikler müşteri makinelerinde habersiz çalışmaz. Başka bir sürüm için `SETUP_LAUNCHER_REF=<etiket|sha>`, sabitlemeyi kapatmak için `SETUP_LAUNCHER_REF=none` kullanın.
>
> **Güvenlik uyarısı:** Hedef repodaki `setup.config.json` içindeki `install`, `start` ve `seed` komutları çalıştırılır. Güvenmediğiniz bir repoda kurulumu çalıştırmadan önce bu dosyayı inceleyin.

---

## Nasıl Çalışır?

```text
1. Algıla  →  2. Paketleri kur (terminal)  →  3. Ayarla (tarayıcı, port 5050)  →  4. Başlat ve doğrula
```

**1. Algılama.** Proje klasörü taranır: dil, çerçeve, paket yöneticisi, alt projeler (`backend/`, `frontend/` vb.) ve `.env.example` dosyaları bulunur. Proje 5 senaryodan birine yerleştirilir (aşağıdaki tablo).

**2. Terminal menüsü.** Kurulum durumu ve sıradaki adım gösterilir:

| Seçenek | Ne yapar? |
|---|---|
| `1` Paketleri Kur / Onar | Kök ve alt projelerin bağımlılıklarını sırayla kurar. Zaten kuruluysa onay ister. |
| `2` Kurulum Sihirbazına Geç | Tarayıcıda yapılandırma ekranını açar. |
| `3` Yeniden Yapılandır | Kurulu uygulamanın ayarlarını verilerini silmeden günceller. |
| `4` Yeniden Denetle | Proje ve kurulum durumunu yeniden okur. |
| `5` Yedekle ve Temiz Kuruluma Geç | Doğrulanmış yedek alır, sonra kurulumu sıfırlar (onay ister). |
| `6` Uygulamayı Doğrudan Başlat | Sihirbazı atlar; `.env.example` varsayılanlarıyla `.env` üretir ve uygulamayı açar. |
| `0` Çıkış | |

> `npm`, `pnpm` veya `yarn` yüklü değilse ve Bun varsa, komutlar `bin/shims/` üzerinden otomatik olarak Bun'a çevrilir.

**3. Web ekranı** (`http://127.0.0.1:5050`, terminalde yazdırılan bağlantıyla açılır). Dört kart:

1. **Hedef proje özeti:** proje adı, senaryo, alt modüller, çalışma ortamı.
2. **Portlar ve ortam değişkenleri:** uygulama (ve varsa frontend) portu, `.env.example` değişkenleri.
3. **Veritabanı:** varsayılan yerel SQLite; PostgreSQL, MySQL veya özel bağlantı dizesi seçilebilir. İlk yönetici ve SMTP ayarları isteğe bağlıdır.
4. **Kaydet ve başlat:** `.env` yazılır, varsa `build` / `migrate` / `seed` çalışır, uygulama başlatılır ve tarayıcıda açılır.

**4. Doğrulanmış başlatma.** Uygulama (ve ayrı frontend varsa o da) gerçekten HTTP yanıtı verene kadar beklenir; sonra tarayıcı açılır. Günlüklerdeki parolalar `******` ile maskelenir.

> Kurulum bitti ama uygulama açılmadıysa kurulumu silmeyin: terminaldeki hata çıktısına bakın ve ekrandaki **"Uygulamayı yeniden başlat / denetle"** düğmesini kullanın. Ayrıntı: [Başlatma sorunlarını giderme](docs/ENTEGRASYON.md#başlatma-sorunlarını-giderme).

---

## Desteklenen Proje Türleri

| Senaryo | Tür | Örnekler |
|---|---|---|
| 1 | Node.js sunucu | Express, Fastify, Koa, Hono |
| 2 | SPA / statik web | React, Vue, Vite, saf HTML/JS |
| 3 | Full-stack / monorepo / çok parçalı | Next.js, Nuxt, SvelteKit, Astro, `backend/` + `frontend/`, workspaces |
| 4 | Çok dilli sunucu | Python (FastAPI, Django, Flask), Go, Rust, C/C++, **.NET** (ASP.NET Core MVC/Razor/Blazor/Web API, klasik ASP.NET MVC/Web Forms), **Java** (Spring Boot, Quarkus, Micronaut), **PHP** (Laravel, Symfony), **Ruby** (Rails, Sinatra, Rack), Docker Compose |
| 5 | Masaüstü ve oyun | Electron, Tauri, **.NET** (WinForms, WPF, WinUI, MAUI, Avalonia, Uno, konsol, Worker, klasik .NET Framework; C#/VB.NET/F#), Python (Tkinter, Qt, wx, Kivy, pygame), **Java** (JavaFX, Swing, Compose), Qt/C++, **Flutter**, **Swift**, Go (Wails, Fyne), Rust (egui, iced), Lazarus/Delphi, Unity, Unreal, Godot |

Her projenin hangi işletim sisteminde çalışabileceği algılanır; örneğin WinForms/WPF yalnızca Windows'ta, MAUI Windows ve macOS'ta, Avalonia ve ASP.NET Core her yerde çalışır. Çalıştırılamayan bir platformda araç nedenini söyler (ve ne yapılacağını önerir), sessizce başarısız olmaz.

Birden fazla bağımsız uygulama içeren repolarda hedef, menüden, web ekranından ya da `--candidate <dizin>` ile seçilir.

---

## Komut Satırı

```bash
setup [komut] [seçenekler]
```

| Komut | Açıklama |
|---|---|
| `setup` (varsayılan) | Terminal menüsü, ardından web ekranı |
| `wizard` | Doğrudan web ekranını açar |
| `init` | Hedef repoya başlatıcıları ve `setup.config.json` dosyasını ekler |
| `detect` / `plan` | Hiçbir şey yazmadan algılama raporunu JSON olarak verir |
| `version` | Sürümü gösterir |

| Seçenek | Açıklama |
|---|---|
| `--root <yol>` | Hedef proje klasörü (varsayılan: bulunduğunuz klasör) |
| `--candidate <yol>` | Çok parçalı repoda belirli alt projeyi seçer |
| `--port <1024-65535>` | Web ekranı portu (varsayılan 5050) |
| `--data-dir <yol>` | Kurulum verilerini proje dışındaki bir klasöre yazar |
| `--reconfigure` | Kurulu uygulamayı verileri silmeden yeniden yapılandırır |
| `--check-only` | Dosya yazmadan ve port açmadan durum JSON'u verir |
| `--no-open` | Tarayıcıyı otomatik açmaz |
| `--copy-tools`, `--refresh-launchers`, `--no-launchers`, `--update-package-json`, `--force` | Yalnızca `init` için ([ayrıntı](docs/bilgi-notu.md)) |

---

## Güvenlik ve Hata Durumları

- **Rollback (dosya düzeyinde):** Derleme veya migration başarısız olursa yarım `.env` ve kilit dosyası temizlenir, önceki `.env` yedeğinden geri yüklenir; mevcut kurulum kilidine dokunulmaz. **Veritabanı geri alınmaz** (uygulanmış migration'lar kalır). Seed hatası kurulumu durdurmaz, uyarı olarak raporlanır.
- **Sırlar:** `.env.example` içindeki `change-me` gibi yer tutucu sırlar (`JWT_SECRET` vb.) kurulumda rastgele değerlerle değiştirilir. Zayıf varsayılan parolalar (ör. `admin123`) değiştirilmez ama terminalde uyarı verilir.
- **Yeniden yapılandırma:** Mevcut `.env` değerleri, oturum sırrı ve özel anahtarlar korunur; eski dosya `backups/` altına yedeklenir.
- **Ön kontroller:** Veritabanı ve SMTP "sınaması" yalnızca sunucuya TCP erişimini (SMTP için karşılama satırını) denetler; kullanıcı adı/parola doğrulanmaz.
- **Web ekranı erişimi:** Yalnızca `127.0.0.1` üzerinde dinler; terminalde yazdırılan bağlantı (anahtar içerir) dışında açılmaz. Bağlantıyı paylaşmayın.

---

## Proje Yapısı

| Klasör | İçerik |
|---|---|
| `bin/` | CLI girişi (`setup.mjs`), başlatıcı şablonları (`kurulum.bat/sh`), Bun uyumluluk katmanı (`shims/`) |
| `scripts/` | Algılama (`detect-project.mjs`), terminal menüsü (`terminal-bootstrap.mjs`), adım çalıştırıcı, dil profilleri (`polyglot.mjs`), testler |
| `wizard/` | Web ekranı sunucusu (`server.mjs`), `.env` ve kurulum adımları (`config.mjs`, `shared.mjs`), uygulama başlatıcı (`app-process.mjs`), arayüz (`ui.html.mjs`) |
| `docs/` | [Entegrasyon kılavuzu](docs/ENTEGRASYON.md), [hızlı başvuru](docs/bilgi-notu.md), [değişiklik günlüğü](docs/CHANGELOG.md) |

## Testler

```bash
npm test
```

240'tan fazla test; algılama, terminal akışı, web ekranı, rollback ve dil senaryolarını kapsar. Windows'ta çalışmayan birkaç POSIX testi atlanır; Linux/macOS'ta ek olarak çalışır.

## Daha Fazla Bilgi

- [docs/ENTEGRASYON.md](docs/ENTEGRASYON.md) — senaryo bazlı entegrasyon, kod şablonları, API referansı
- [docs/bilgi-notu.md](docs/bilgi-notu.md) — komut/seçenek tablosu ve "hangi durumda ne yapmalı" özeti
- [docs/CHANGELOG.md](docs/CHANGELOG.md) — değişiklik günlüğü
