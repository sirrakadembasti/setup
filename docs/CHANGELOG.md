# Değişiklik Günlüğü (Changelog)

Bu projedeki tüm önemli değişiklikler Semantik Sürümleme (SemVer) kurallarına uygun olarak bu dosyada belgelenir.

## [Yayınlanmamış]

Ayrıntılı geçmiş için `git log` kullanın; burada kullanıcıya görünen değişiklikler konu başlıklarıyla özetlenmiştir.

### Yeni özellikler

- **Terminal kontrol paneli ve menü (`1–6`, `0`):** adım ilerlemesi, alt modül durumu, tekrar kurulum koruması. `6) Uygulamayı Doğrudan Başlat` sihirbazı atlayarak `.env.example` varsayılanlarıyla uygulamayı açar.
- **Tek sayfa web ekranı (4 kart):** eski 5 adımlı sihirbazın yerine hedef projeye odaklı özet, port/`.env`, veritabanı ve "kaydet ve başlat" ekranı.
- **Çok parçalı repolar:** kök `package.json` olmasa da (ya da yalnızca orkestrasyon amaçlıysa) `backend/`, `frontend/`, `srv/`, `ui/` gibi alt projeler algılanır, sırayla kurulur ve ayrı `.env` alır. Çift port (backend + frontend) ve çift süreç yönetimi desteklenir.
- **Derin aday taraması ve aday seçici:** birden fazla bağımsız uygulama içeren repolarda terminalden, web ekranından veya `--candidate` ile hedef seçilir.
- **Bun uyumluluğu:** `npm/pnpm/yarn` yoksa komutlar `bin/shims/` ile Bun'a çevrilir; `package-lock.json` + `overrides` içeren projeler için çevrimdışı `bun.lock` hazırlığı.
- **Doğrulanmış uygulama başlatma:** kurulumdan sonra uygulama (ve varsa frontend) gerçek HTTP yanıtı verene kadar beklenir; erken çökmeler raporlanır.
- **Çok dilli destek:** Python, Go, C# .NET, Rust, C/C++ (CMake, Makefile, Meson) ve oyun motorları (Unity, Unreal, Godot); dile özgü kurulum, doğrulama ve migration adımları.
- **Kurumsal ortam:** genel SMTP, esnek veritabanı sağlayıcıları (SQLite, PostgreSQL, MySQL, özel), `--reconfigure`, yedekli temiz kurulum.
- **Başlatıcı sürüm sabitleme:** `init`, `npx/bunx` çağrısını uzaktaki bir commit'e bağlar (`SETUP_LAUNCHER_REF` ile değiştirilir/kapatılır).

### Düzeltmeler

- Başarısız yeniden yapılandırma artık mevcut kurulum kilidini silmiyor.
- Yeniden yapılandırma mevcut `.env` değerlerini, oturum sırrını ve özel anahtarları koruyor; alt proje `.env` dosyaları yedekleniyor ve hatada geri yükleniyor.
- `.env.example` içindeki yer tutucu sırlar (`change-me`, boş `JWT_SECRET` vb.) rastgele üretiliyor; zayıf varsayılan parolalar uyarıyla bildiriliyor.
- Yerleşik statik sunucu bozuk URL kodlamasında çökmüyor (400 döner).
- `/api/select-candidate` etkin kökü seçilen alt projeye taşıyor ve depo dışı yolları reddediyor.
- Sihirbaz kaynaklı `Origin` denetimi gerçek sihirbaz portuna bağlandı; SQLite sınaması klasör oluşturmuyor; frontend portu backend portuyla aynı olamıyor.
- Terminal günlükleri `.env` sırlarını maskeliyor; seed çalışmadıysa özet hesabın veritabanında oluşturulmadığını söylüyor.
- Seçenek 6'da bekleme süresi 60 sn (`SETUP_APP_START_TIMEOUT_MS`); menü numaralandırması, Windows `PATH` ve dosya kilitleme sorunları giderildi.
- `init --copy-tools` iç geliştirme notlarını hedef repoya kopyalamıyor.

### Güvenlik

- Web ekranı yalnızca `127.0.0.1` üzerinde dinler; oturum çerezi `HttpOnly` + `SameSite=Strict`, değiştirici isteklerde CSRF anahtarı ve Origin denetimi vardır.
- Parolalar `scrypt` ile özetlenir; günlüklerde parola ve bağlantı dizesi sırları maskelenir.
- Gömülü çekirdekte (`mountSetupGuard`) CSRF/Origin zorunludur; kurulum sonrası kurulum uçları kapanır.

### Belgeler

- README, hızlı başvuru ve entegrasyon kılavuzunun başı sadeleştirildi; rollback ve bağlantı sınaması anlatımı gerçek davranışa uyarlandı. Belgeler `docs/` altına taşındı.

## [v1.0.0] - 2026-10-19
- **Bağımsız Eklenti Mimarisi (`setup` v1.0):** Önceki türetilmiş uygulamaya ait tüm sabit bağımlılıklar kaldırılarak `https://github.com/sirrakadembasti/setup.git` deposuyla uyumlu, her GitHub reposuna entegre edilebilen bağımsız kurulum eklentisi (`setup`) mimarisine geçildi.
- **Çoklu Paket Yöneticisi ve Node LTS Desteği:** `npm`, `pnpm`, `yarn` ve `bun` paket yöneticileri ile Node.js 18, 20, 22 ve 24 LTS sürümlerini otomatik algılama özelliği eklendi.
- **Tek Komutla GitHub Repo Entegrasyonu (`setup init`):** Hedef GitHub projesini analiz ederek `setup.config.json` ve `package.json` kurulum betiklerini otomatik üreten `initProject` API ve CLI komutu eklendi.
- **`.env.example` ve Tek Dizin / Monorepo Uyumluluğu:** Hem tek dizinli (root `.env` ve `data/`) hem de `server/` + `client/` yapısındaki projeler ile `.env.example` şablonlarını otomatik algılama desteği eklendi.
- **Güvenlik ve Kararlılık Sıkılaştırması:** Zamanlama saldırılarına karşı `crypto.timingSafeEqual`, `/setup` ve `/api` hız sınırlandırması (Rate Limiting), sembolik bağlantı (symlink) doğrulaması, 4 katmanlı Linux port/PID tespiti (`lsof`, `ss`, `fuser`, `/proc/net/tcp`) ve DOM XSS korumaları eklendi.
- **Otomatik Sürümleme Mekanizması:** `VERSION` dosyası ve `scripts/version.mjs` ile `major`, `minor`, `patch` sürüm yükseltme ve Git etiketleme (`v1.0` / `v1.0.0`) altyapısı oluşturuldu.
