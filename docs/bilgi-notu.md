 Uygulamanızın mimarisini, hangi seçeneğin ne işe yaradığını, hedef projelerde ne bıraktığını ve hangi senaryoda hangi komutu kullanmanız gerektiğini
  gösteren tam rehber ve referans tabloları aşağıdadır.
  ──────
  ### 1. Büyük Resim: Bu Sistem Nasıl Çalışır?

  Bu araç iki taraflı çalışır:

  1. Geliştirici Tarafı (Siz): Başka bir projeye gidip init çalıştırırsınız. Bu işlem hedef projeye çift tıklanabilir başlatıcıları (kurulum.bat,
  kurulum.sh) ve mimari ayarını (setup.config.json) bırakır.
  2. Son Kullanıcı Tarafı (Müşteri / Kurulum Yapan): Proje klasöründeki kurulum.bat'a çift tıklar. Sistem sırasıyla:
      • Terminal Menüsü: Node.js/Bun ve paket yöneticisi denetimi yapar, 1 ile bağımlılıkları kurar.
      • Web Sihirbazı (127.0.0.1:5050): .env değişkenlerini, veritabanını ve ilk yöneticiyi ayarlar.
      • Otomatik Başlatma: Kurulum bitince uygulamayı ayağa kaldırır ve tarayıcıda/ekranda açar.

  ──────
  ### 2. CLI Komutları ve Seçenekleri (Master Referans Tablosu)

   Komut / Bayrak             │ Hangi Komutla?             │ Ne Yapar?                  │ Ne Zaman Tercih Edilir?     │ Projede Ne Değiştirir / Bırakır?
  ────────────────────────────┼────────────────────────────┼────────────────────────────┼─────────────────────────────┼──────────────────────────────────
   init                       │ Ana Komut                  │ Hedef projeyi tarar,       │ Başka bir projeyi           │ setup.config.json, kurulum.bat,
                              │                            │ mimarisini belirler ve     │ kurulabilir hale getirmek   │ kurulum.sh oluşturur.
                              │                            │ kurulum altyapısını ekler. │ istediğinizde ilk adım.     │
   --copy-tools(veya --       │ init                       │ Setup çekirdek dosyalarını │ Kurumsal, kısıtlı veya      │ Hedef projeye tools/setup/
   offline, --tools)          │                            │ hedef projenin içine       │ internetsiz ağlarda.        │ klasörünü kopyalar.
                              │                            │ tools/setup/ olarak        │ npx/bunx GitHub'a gitmeden  │
                              │                            │ kopyalar.                  │ tamamen yerelden çalışır.   │
   --root <yol>               │ Tümü                       │ Komutun hedef alacağı      │ Komutu hedef projenin       │ Belirtilen dizini kök kabul
                              │                            │ proje dizinini belirler.   │ klasörü dışından (uzaktan)  │ eder. (Hedef dizindeyseniz
                              │                            │                            │ çalıştırırken.              │ yazmaya gerek yoktur).
   --candidate <yol>          │ init, setup, wizard,       │ Çok parçalı veya monorepo  │ Repoda apps/web, srv/,      │ Sadece seçilen alt dizini
                              │ detect                     │ repolarda belirli bir alt  │ backend/ gibi birden fazla  │ odaklar ve kurar.
                              │                            │ projeyi seçer.             │ bağımsız uygulama varsa.    │
   --refresh-launchers        │ init                       │ Mevcut başlatıcıları .bak  │ Setup motorunda bir         │ setup.config.json korunur,
                              │                            │ olarak yedekler ve en      │ düzeltme yaptığınızda ve    │ kurulum.bat/sh yenilenir,
                              │                            │ güncel kodla yeniler.      │ hedef projedeki             │ eskileri .bak olur.
                              │                            │                            │ kurulum.bat'ı güncellemek   │
                              │                            │                            │ istediğinizde.              │
   --force (-f)               │ init                       │ Mevcut setup.config.json   │ Hedef projedeki             │ Mevcut tüm config ve
                              │                            │ ve başlatıcıların üzerine  │ yapılandırmayı sıfırdan     │ başlatıcıları ezer.
                              │                            │ acımasızca yazar.          │ yeniden oluşturmak          │
                              │                            │                            │ istediğinizde.              │
   --no-launchers             │ init                       │ Başlatıcı (.bat / .sh)     │ Başlatıcıları kendiniz      │ Yalnızca setup.config.json
                              │                            │ dosyalarını üretmez,       │ yazacaksanız veya sadece    │ oluşturur.
                              │                            │ sadece config yazar.       │ config oluşturmak           │
                              │                            │                            │ istediğinizde.              │
   --update-package-json      │ init                       │ Hedef projenin             │ Kullanıcıların npm run      │ package.json içindeki scripts
                              │                            │ package.json dosyasına     │ setup yazabilmesini         │ alanını günceller.
                              │                            │ "setup": "setup" script'i  │ istiyorsanız.               │
                              │                            │ ekler.                     │                             │
   --port <1024-65535>        │ setup, wizard              │ Web sihirbazının açılacağı │ 5050 portu bilgisayarda     │ Sihirbaz sunucusu belirtilen
                              │                            │ portu değiştirir           │ başka bir servis tarafından │ portta açılır.
                              │                            │ (varsayılan: 5050).        │ kullanılıyorsa.             │
   --data-dir <yol>           │ Tümü                       │ Kurulum verilerini, .env   │ Masaüstü uygulamalarında    │ Kurulum çıktıları proje içine
                              │                            │ dosyasını ve lock          │ (örn: %APPDATA%) veya       │ değil, verilen dizine yazılır.
                              │                            │ dosyasını harici bir       │ Docker/Volume               │
                              │                            │ dizine yönlendirir.        │ bağlamalarında.             │
   --reconfigure              │ setup, wizard              │ Kurulumu sıfırlamadan      │ Önceden kurulmuş bir        │ Mevcut .env ve veritabanı
                              │                            │ (verileri silmeden)        │ sistemde port veya          │ silinmez, üzerine güncelleme
                              │                            │ ayarları güncellemek için  │ veritabanı şifresini        │ yapılır.
                              │                            │ sihirbazı açar.            │ değiştirmek gerektiğinde.   │
   --check-only               │ setup, wizard, detect      │ Hiçbir dosya yazmadan ve   │ Otomasyon testlerinde veya  │ Hiçbir dosya oluşturmaz veya
                              │                            │ port açmadan projenin      │ projenin hazır olup         │ değiştirmez.
                              │                            │ durumunu JSON çıktılar.    │ olmadığını komut satırından │
                              │                            │                            │ sorgularken.                │
   --no-open                  │ setup, wizard              │ Sihirbaz başladığında      │ Sunucu (Headless / SSH)     │ Tarayıcı açılmaz, terminale
                              │                            │ varsayılan web             │ ortamlarında çalışırken.    │ bağlantı linki basılır.
                              │                            │ tarayıcısını otomatik      │                             │
                              │                            │ açmaz.                     │                             │
   detect / plan              │ Ana Komut                  │ Hedef projenin mimarisini  │ Kurulum yapmadan önce       │ Değişiklik yapmaz, sadece JSON
                              │                            │ tarar ve tespit raporunu   │ sistemin projeyi doğru      │ rapor döner.
                              │                            │ ekrana basar.              │ algılayıp algılamadığını    │
                              │                            │                            │ görmek için.                │
  ──────
  ### 3. Diğer Uygulamalara Entegrasyon Yöntemleri (3 Farklı Yol)

  Hedef projenin ihtiyacına göre 3 farklı entegrasyon modelinden birini seçersiniz:

                                      [ ENTEGRASYON YÖNTEMLERİ ]
                                                  │
             ┌────────────────────────────────────┼────────────────────────────────────┐
             ▼                                    ▼                                    ▼
       【 YÖNTEM 1 】                       【 YÖNTEM 2 】                       【 YÖNTEM 3 】
    Çevrimdışı / Tam Taşınabilir         Hafif / Sıfır Ayak İzi             Kaynak Koda Gömülü (Embedded)
     (Kurumsal / Güvenli Ağ)             (Açık Kaynak / GitHub)               (Express / Next.js Guard)

  #### Yöntem 1: Çevrimdışı / Tam Taşınabilir (--copy-tools) — En Sağlam Yol

  • Senaryo: Kurumsal şirket bilgisayarları, banka/kamu ağları, SSL sertifika engeli olan ortamlar veya internetsiz sunucular.
  • Nasıl Yapılır?
    # Hedef projenin içine gidin:
    cd D:\dnm\hedef-proje

    # Setup çekirdeğini kopyalayarak entegre edin:
    node D:\dnm\setup-main\setup-main\bin\setup.mjs init --copy-tools

  • Sonuç: Projenin içine tools/setup/, kurulum.bat, kurulum.sh ve setup.config.json gelir. Son kullanıcı kurulum.bat'a bastığında dış dünyadan bağımsız
  çalışır.
  ──────
  #### Yöntem 2: Hafif / Sıfır Ayak İzi (Yalnızca Başlatıcılar)

  • Senaryo: Kod reposunu temiz tutmak istediğiniz, kullanıcıların GitHub'a doğrudan erişebildiği açık kaynak projeler.
  • Nasıl Yapılır?
    cd D:\dnm\hedef-proje
    node D:\dnm\setup-main\setup-main\bin\setup.mjs init

  • Sonuç: Projeye hiçbir kod kopyalanmaz; yalnızca kurulum.bat, kurulum.sh ve setup.config.json eklenir. kurulum.bat çalıştığında paketi GitHub'dan
  anlık olarak çeker.
  ──────
  #### Yöntem 3: Kaynak Koda Gömülü Middleware (Express / Next.js Guard)

  • Senaryo: Kurulum sihirbazının ayrı bir 5050 portundan değil, uygulamanın kendi portu üzerinden (örn. http://localhost:3000/setup) açılmasını
  istediğiniz projeler.
  • Nasıl Yapılır?
  Hedef projeye npm install github:sirrakadembasti/setup eklenir ve Express içine middleware olarak bağlanır:
    import express from "express";
    import { mountSetupGuard } from "setup/wizard";

    const app = express();

    // Kurulum tamamlanana kadar tüm rotaları kilitler ve /setup'a yönlendirir:
    await mountSetupGuard(app, {
      projectRoot: process.cwd(),
      apiBase: "/api/setup"
    });

    app.listen(3000);

  ──────
  ### 4. Proje Mimarinize Göre Hangi Ayarlar Yapılır? (Senaryo Matrisi)

  Hedef projede init çalıştırıldığında detect-project.mjs projeyi otomatik algılar ve setup.config.json içine aşağıdaki gibi yapılandırır:

   Senaryo Türü                     │ Örnek Teknolojiler                   │ Sistem Neyi Otomatik Algılar?        │ setup.config.json İçinde Ne Yazar?
  ──────────────────────────────────┼──────────────────────────────────────┼──────────────────────────────────────┼──────────────────────────────────────
   Senaryo 1: Node.js Sunucu        │ Express, Fastify, Koa, Hono          │ Port dinleyicisi, .env.example,      │ projectType: "node-webapp", start:
                                    │                                      │ npm/pnpm/yarn/bun                    │ "npm run start"
   Senaryo 2: SPA & Statik Web      │ React, Vue, Vite, Saf HTML/JS        │ Derleme dizini (dist/, build/), Vite │ projectType: "static-web", build:
                                    │                                      │ portu                                │ "npm run build", yerleşik statik
                                    │                                      │                                      │ sunucu
   Senaryo 3: Full-Stack / Monorepo │ Next.js, Nuxt, SvelteKit, pnpm-      │ Çift süreç (dual: true), migration   │ packageManager: "pnpm" veya "bun",
                                    │ workspace.yaml, backend/ + frontend/ │ yolları (prisma, drizzle), alt       │ hem frontend hem backend port
                                    │                                      │ workspace'ler                        │ köprüsü
   Senaryo 4: Çok Dilli Backend     │ Python (Django/FastAPI), Go, C#      │ Python sanal ortamı (venv),          │ polyglot: true, dil araç zinciri
                                    │ .NET, Rust                           │ requirements.txt, alembic, cargo,    │ kontrolü (python, cargo), özel
                                    │                                      │ dotnet                               │ migration komutları
   Senaryo 5: Masaüstü              │ Electron, Tauri, WinForms, PyQt      │ Port dinlemediği algılanır; IPC ve   │ projectType: "desktop-app", dataDir:
                                    │                                      │ Süreç Denetimi (process-health)      │ "%APPDATA%"
                                    │                                      │ devreye girer                        │
  ──────
  ### 5. Karar Akışı: "Hangi Durumda Ne Yazmalıyım?" (Cheatsheet)

    Soru 1: Yeni bir projeye kurulum eklemek istiyorum, ne yapmalıyım?
    ├── Proje kapalı ağda / şirket ortamında mı çalışacak?
    │   └── CEVAP: node <setup-yolu>/bin/setup.mjs init --copy-tools
    └── Proje genel GitHub'a açık ve internet kısıtlaması yok mu?
        └── CEVAP: node <setup-yolu>/bin/setup.mjs init

    Soru 2: Setup motorunda bir hata düzelttim, diğer projedeki kurulum.bat'ı nasıl güncellerim?
    └── CEVAP: node <setup-yolu>/bin/setup.mjs init --copy-tools --refresh-launchers
        (Not: Bu komut projedeki ayarları bozmaz, eski başlatıcıyı .bak yapar ve yeniler).

    Soru 3: Repoda 'apps/api' ve 'apps/web' var, sadece 'apps/web'i kurmak istiyorum:
    └── CEVAP: node <setup-yolu>/bin/setup.mjs init --candidate apps/web

    Soru 4: Dosya oluşturmadan projemin durumunu ve algılanan senaryoyu görmek istiyorum:
    └── CEVAP: node <setup-yolu>/bin/setup.mjs detect

  Bu tablo ve akış yapısı, elinizdeki aracın tüm parametrelerinin ve entegrasyon varyasyonlarının eksiksiz özetidir.
