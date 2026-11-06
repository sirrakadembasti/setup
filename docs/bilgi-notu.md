# Hızlı Başvuru: Komutlar, Entegrasyon Yöntemleri ve Karar Rehberi

Bu sayfa, `setup` aracının hangi komutla ne yaptığını ve hedef projeye ne bıraktığını tek bakışta gösterir. Ayrıntılı kod şablonları için [ENTEGRASYON.md](ENTEGRASYON.md) dosyasına bakın.

## 1. İki taraflı çalışma

1. **Geliştirici (siz):** Hedef projede `setup init` çalıştırırsınız. Projeye `kurulum.bat`, `kurulum.sh` ve `setup.config.json` eklenir.
2. **Son kullanıcı:** `kurulum.bat` / `kurulum.sh` dosyasını çalıştırır. Sırasıyla terminal menüsü (paket kurulumu), tarayıcıda yapılandırma ekranı (`127.0.0.1:5050`) ve uygulamanın otomatik başlatılması gelir.

## 2. Komutlar

| Komut | Ne yapar? | Dosya değiştirir mi? |
|---|---|---|
| `init` | Hedef projeyi tarar, başlatıcıları ve `setup.config.json` dosyasını ekler | Evet |
| `setup` (varsayılan) | Terminal menüsü, ardından web ekranı | Evet (kurulum sırasında) |
| `wizard` | Doğrudan web ekranını açar | Evet (kurulum sırasında) |
| `detect` / `plan` | Algılama raporunu JSON olarak verir | Hayır |
| `version` | Sürümü gösterir | Hayır |

## 3. Seçenekler

| Seçenek | Hangi komutla? | Açıklama |
|---|---|---|
| `--root <yol>` | Hepsi | Hedef proje klasörü. Proje klasöründeyseniz gerekmez. |
| `--candidate <yol>` | init, setup, wizard, detect | Çok parçalı repoda tek bir alt projeyi seçer. |
| `--port <1024-65535>` | setup, wizard | Web ekranı portu (varsayılan 5050). |
| `--data-dir <yol>` | Hepsi | `.env` ve kilit dosyasını harici bir klasöre yazar (masaüstü uygulamaları, Docker volume). |
| `--reconfigure` | setup, wizard | Kurulu uygulamayı verileri silmeden yeniden yapılandırır. |
| `--check-only` | setup, wizard, detect | Hiçbir şey yazmadan durum JSON'u verir. |
| `--no-open` | setup, wizard | Tarayıcıyı açmaz; bağlantıyı terminale yazar (SSH / sunucu ortamları). |
| `--copy-tools` (`--offline`, `--tools`) | init | Setup çekirdeğini projeye `tools/setup/` olarak kopyalar; internetsiz çalışır. |
| `--refresh-launchers` | init | Başlatıcıları `.bak` olarak yedekleyip yeniler; `setup.config.json` korunur. |
| `--no-launchers` | init | Başlatıcı üretmez, yalnızca config yazar. |
| `--update-package-json` | init | `package.json` içine `setup` betiği ekler. |
| `--force`, `-f` | init | Mevcut config ve başlatıcıların üzerine yazar. |

Ortam değişkenleri: `SETUP_LAUNCHER_REF` (başlatıcı sürümü; `none` = sabitleme yok), `SETUP_APP_START_TIMEOUT_MS` (terminalden başlatmada bekleme süresi, varsayılan 60000), `SETUP_JOB_TIMEOUT_MS` (paket kurulumu zaman aşımı, varsayılan 15 dk), `SETUP_ALLOWED_ORIGINS` (izin verilen dış kökenler).

## 4. Üç entegrasyon yöntemi

| Yöntem | Ne zaman? | Nasıl? |
|---|---|---|
| **1. Çevrimdışı / taşınabilir** | Kurumsal, kısıtlı veya internetsiz ağlar | `setup init --copy-tools` → projeye `tools/setup/` + başlatıcılar eklenir, dış kaynağa ihtiyaç kalmaz. |
| **2. Hafif** | Açık kaynak projeler, repoyu temiz tutmak istediğinizde | `setup init` → yalnızca başlatıcılar ve config eklenir; başlatıcı setup'ı GitHub'dan çeker (sabit bir commit'e bağlı). |
| **3. Koda gömülü** | Sihirbazın uygulamanın kendi portunda (`/setup`) açılması istendiğinde | `mountSetupGuard` ile Express/Fastify/Next.js içine eklenir. |

Yöntem 3 örneği (Express):

```js
import express from "express";
import { mountSetupGuard } from "setup/core";

const app = express();
// Kurulum tamamlanana kadar tüm rotaları /setup'a yönlendirir:
await mountSetupGuard(app, { projectRoot: process.cwd(), apiBase: "/api/setup" });
app.listen(3000);
```

## 5. Senaryoya göre ne algılanır?

| Senaryo | Örnekler | Algılananlar |
|---|---|---|
| 1. Node.js sunucu | Express, Fastify, Koa, Hono | Port, `.env.example`, paket yöneticisi |
| 2. SPA / statik web | React, Vue, Vite, saf HTML | Derleme klasörü (`dist/`, `build/`), Vite portu; yerleşik statik sunucu |
| 3. Full-stack / monorepo | Next.js, Nuxt, `backend/` + `frontend/`, workspaces | Çift süreç, migration yolları (Prisma, Drizzle), alt projeler, iki port |
| 4. Çok dilli sunucu | Python, Go, .NET, Rust, C/C++ | Sanal ortam, bağımlılık dosyaları, araç zinciri (python, cargo, cmake) |
| 5. Masaüstü / oyun | Electron, Tauri, WinForms, PyQt, Unity | Port dinlemez; süreç denetimi, kullanıcı veri dizini |

## 6. "Hangi durumda ne yapmalıyım?"

| Durum | Komut |
|---|---|
| Yeni projeye kurulum eklemek (kapalı ağ) | `setup init --copy-tools` |
| Yeni projeye kurulum eklemek (açık ağ) | `setup init` |
| Setup'ta düzeltme yaptım, projedeki başlatıcıyı güncellemek istiyorum | `setup init --copy-tools --refresh-launchers` (ayarlar bozulmaz) |
| `apps/api` ve `apps/web` var, yalnızca `apps/web` kurulacak | `setup init --candidate apps/web` |
| Dosya yazmadan algılamayı görmek istiyorum | `setup detect` |
| Kurulu uygulamanın ayarlarını değiştirmek istiyorum | `setup --reconfigure` (menüde `3`) |
| Sıfırdan temiz kurulum istiyorum | Menüde `5` (önce otomatik yedek alınır) |
| 5050 portu dolu | `setup --port 5060` |
