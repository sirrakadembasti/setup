# Değişiklik Günlüğü (Changelog)

Bu projedeki tüm önemli değişiklikler Semantik Sürümleme (SemVer) kurallarına uygun olarak bu dosyada belgelenir.

## [v1.0.0] - 2026-10-19
- **Bağımsız Eklenti Mimarisi (`setup` v1.0):** Önceki türetilmiş uygulamaya ait tüm sabit bağımlılıklar kaldırılarak `https://github.com/sirrakadembasti/setup.git` deposuyla uyumlu, her GitHub reposuna entegre edilebilen bağımsız kurulum eklentisi (`setup`) mimarisine geçildi.
- **Çoklu Paket Yöneticisi ve Node LTS Desteği:** `npm`, `pnpm`, `yarn` ve `bun` paket yöneticileri ile Node.js 18, 20, 22 ve 24 LTS sürümlerini otomatik algılama özelliği eklendi.
- **Tek Komutla GitHub Repo Entegrasyonu (`setup init`):** Hedef GitHub projesini analiz ederek `setup.config.json` ve `package.json` kurulum betiklerini otomatik üreten `initProject` API ve CLI komutu eklendi.
- **`.env.example` ve Tek Dizin / Monorepo Uyumluluğu:** Hem tek dizinli (root `.env` ve `data/`) hem de `server/` + `client/` yapısındaki projeler ile `.env.example` şablonlarını otomatik algılama desteği eklendi.
- **Güvenlik ve Kararlılık Sıkılaştırması:** Zamanlama saldırılarına karşı `crypto.timingSafeEqual`, `/setup` ve `/api` hız sınırlandırması (Rate Limiting), sembolik bağlantı (symlink) doğrulaması, 4 katmanlı Linux port/PID tespiti (`lsof`, `ss`, `fuser`, `/proc/net/tcp`) ve DOM XSS korumaları eklendi.
- **Otomatik Sürümleme Mekanizması:** `VERSION` dosyası ve `scripts/version.mjs` ile `major`, `minor`, `patch` sürüm yükseltme ve Git etiketleme (`v1.0` / `v1.0.0`) altyapısı oluşturuldu.
