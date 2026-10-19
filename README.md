# setup (v1.0) — Bağımsız GitHub Uygulama Kurulum Eklentisi

Herhangi bir GitHub reposundaki Node.js uygulamasının, karmaşık terminal adımlarıyla uğraşılmadan **kullanıcı dostu bir web arayüzü ve otomatik proje algılama** ile kolayca kurulup çalıştırılmasını sağlayan, projeden bağımsız kurulum eklentisidir.

- **GitHub Deposu:** `https://github.com/sirrakadembasti/setup.git`

## Temel Hedef ve Özellikler

- **Tamamen Projeden Bağımsız:** Tek dizinli (`package.json`) uygulamaları, `server/` + `client/` full-stack projeleri ve workspace/monorepo yapılarını otomatik tanır.
- **Çoklu Paket Yöneticisi Desteği:** Hedef repodaki kilit dosyalarına bakarak `npm`, `pnpm`, `yarn` veya `bun` paket yöneticisini otomatik seçer.
- **Tek Komutla Entegrasyon (`setup init`):** Herhangi bir GitHub reposuna `setup.config.json` yapılandırmasını ve kurulum komutunu saniyeler içinde ekler.
- **İki Aşamalı Güvenli Web Kurulumu:**
  - **Kurulum Başlatıcısı (`127.0.0.1:5049`):** Ortam ön kontrolü, bağımlılık kurulumu, port çakışması çözümü ve SHA-256 doğrulamalı yedekleme/temiz kurulum.
  - **Web Kurulum Sihirbazı (`127.0.0.1:5050`):** 5 adımlı görsel yapılandırma (Sunucu kontrolü, Adres/Proxy, Veri/Saklama, İlk Yönetici/E-posta, `.env` ve Nginx üretimi).
- **Yerleşik Sürümleme (`scripts/version.mjs`):** `VERSION`, `package.json`, `CHANGELOG.md` ve Git etiketlerini (`v1.0`, `v1.0.0`) tek komutla yönetir.

## Hızlı Başlangıç

```bash
# 1. Herhangi bir GitHub reposuna setup yapılandırmasını entegre edin
node /path/to/setup/bin/setup.mjs init --root /path/to/github-repo

# 2. Hedef repoyu analiz edin ve kurulum planını görün
node /path/to/setup/bin/setup.mjs detect --root /path/to/github-repo

# 3. Web kurulum başlatıcısını (5049) açın
node /path/to/setup/bin/setup.mjs --root /path/to/github-repo

# 4. Doğrudan 5 adımlı kurulum sihirbazını (5050) açın
node /path/to/setup/bin/setup.mjs wizard --root /path/to/github-repo
```

## Dizin Yapısı

```text
setup/
├── VERSION                   # Aktif sürüm (1.0.0)
├── CHANGELOG.md              # Sürüm değişiklik günlüğü
├── package.json
├── bin/
│   ├── setup.mjs             # Ana CLI (setup, wizard, init, detect, plan, version)
│   ├── kurulum.sh            # Linux/macOS başlatıcı betiği
│   └── kurulum.bat           # Windows başlatıcı betiği (UTF-8)
├── scripts/
│   ├── detect-project.mjs    # Otomatik proje, paket yöneticisi ve .env.example algılama
│   ├── setup-bootstrap.mjs   # 5049 Web Kurulum Başlatıcısı
│   ├── setup-bootstrap-lib.mjs
│   ├── find-port-holder.mjs  # 4 katmanlı port/PID tespit aracı
│   ├── version.mjs           # SemVer sürümleme ve Git etiketleme aracı
│   ├── setup-api.mjs         # Programatik ESM API
│   └── *.test.mjs            # Birim, Güvenlik ve E2E test paketi
├── wizard/
│   ├── server.mjs / .ts      # 5050 Web Kurulum Sihirbazı sunucusu
│   ├── ui.mjs / .ts          # 5 adımlı sihirbaz arayüzü
│   └── config.mjs / .ts      # Doğrulama şemaları ve .env üreticisi
├── utils/
│   ├── project-paths.mjs / .ts
│   └── deployment-config.mjs / .ts
├── templates/
│   └── setup.config.json     # Örnek eklenti yapılandırma şablonu
└── docs/
    └── entegrasyon.md        # GitHub repo entegrasyon ve özelleştirme rehberi
```

## Programatik API Kullanımı

```js
import { inspect, initProject, detectProject, buildInstallPlan } from "setup";

// Hedef GitHub reposunu incele
const { version, detection, plan } = await inspect("/path/to/repo");

// Hedef repoya setup.config.json entegre et
initProject("/path/to/repo", { overwrite: false, updatePackageJson: true });
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
