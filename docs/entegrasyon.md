# setup — GitHub Repo Entegrasyon Kılavuzu (v1.0)

`setup` (`https://github.com/sirrakadembasti/setup.git`), herhangi bir GitHub reposundaki Node.js uygulamasını son kullanıcıların veya sistem yöneticilerinin terminal komutlarıyla boğuşmadan tarayıcı üzerinden kurabilmesi için tasarlanmış bağımsız bir eklentidir.

## 1. Tek Komutla Entegrasyon (`setup init`)

Eklentiyi hedef GitHub reponuza bağlamanın en hızlı yolu `init` komutudur:

```bash
node /path/to/setup/bin/setup.mjs init --root /path/to/hedef-repo
```

Bu komut hedef repoyu tarar ve:
- Paket yöneticisini (`npm`, `pnpm`, `yarn`, `bun`),
- Proje yapısını (`node-package`, `node-webapp`, `node-fullstack`, `workspace-fullstack`),
- Varsa `.env.example` değişkenlerini ve dizin yollarını (`.env` veya `server/.env`) algılayarak hedef dizinde **`setup.config.json`** dosyasını oluşturur ve `package.json` içine `"setup": "setup"` betiğini ekler.

### Teknoloji algılama nasıl çalışır?

`detect` komutu `express`, `react`, `vue`, `next` ve `vite` için iki kanıtı birlikte değerlendirir ve sonucu `dependencyUsage` alanında raporlar:

| Alan | Anlamı |
|---|---|
| `declared` | Paket kök, `server/` veya `client/` `package.json` dosyasında bildirilmiş |
| `used` | Kaynakta `import` / `export from` / `require()` / `import()` ile (alt yollar dahil) kullanılıyor veya bir `package.json` script'inde CLI olarak çağrılıyor |
| `sourceScanned` | En az bir kaynak dosya (`.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.tsx`, `.vue`, `.svelte` …) tarandı |

Paket, `used` ise **veya** kaynak dosya hiç bulunamadığı için doğrulama yapılamıyor ve `declared` ise kullanılıyor kabul edilir. `node_modules`, `dist`/`build`/`.next` gibi çıktı dizinleri, `data`/`uploads`, test dizinleri ile `*.test.*` / `*.spec.*` dosyaları ve yorum satırları taramaya dahil edilmez.

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

## 3. `setup.config.json` ile Özelleştirme

Hedef reponun kök dizinindeki `setup.config.json` üzerinden portları, kurulum komutlarını ve dosya yollarını özelleştirebilirsiniz:

```json
{
  "name": "ornek-uygulama",
  "version": "1.0.0",
  "packageManager": "npm",
  "ports": {
    "bootstrap": 5049,
    "wizard": 5050,
    "app": 5000
  },
  "install": {
    "command": "npm",
    "args": ["install"],
    "requireWorkspaces": false
  },
  "wizard": {
    "enabled": true,
    "title": "Örnek Uygulama Kurulum Sihirbazı"
  },
  "paths": {
    "env": ".env",
    "dataDir": "data",
    "lockFile": "data/installation.lock"
  }
}
```

## 4. Güvenlik Standartları

- **Yerel Dinleme:** Kurulum sunucuları (`5049` ve `5050`) yalnızca `127.0.0.1` arayüzünü dinler; uzak sunucularda SSH tüneli (`ssh -L 5049:127.0.0.1:5049 -L 5050:127.0.0.1:5050 user@sunucu`) ile güvenle erişilir.
- **Kriptografik Oturum ve CSRF:** Her oturumda 24 baytlık tek kullanımlık token üretilir, `HttpOnly` + `SameSite=Strict` çerezleri (`setup.bootstrap`, `setup.wizard`) ve `crypto.timingSafeEqual` doğrulaması kullanılır.
- **Doğrulanmış Yedekleme:** Temiz kurulum öncesinde mevcut `.env`, veritabanı ve yüklenen dosyalar SHA-256 özetleriyle `backups/reinstall-<tarih>/manifest.json` altına yedeklenir.
