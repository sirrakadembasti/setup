export function renderSetupPage(csrfToken, options = {}) {
  const pageTitle = String(options.title || "Uygulama Kurulum Sihirbazı")
    .replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] || ch));
  const boot = JSON.stringify({
    csrfToken,
    apiBase: String(options.apiBase || "/api"),
    embedded: Boolean(options.embedded),
  }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${pageTitle}</title>
<style>
:root{color-scheme:light;--p:#5138ee;--bg:#f4f6fb;--card:#fff;--line:#dbe1ec;--muted:#64748b;--danger:#b91c1c;--ok:#047857;--run:#2563eb;--tip:#0f172a}*{box-sizing:border-box}body{margin:0;background:var(--bg);font:15px/1.5 system-ui;color:#111827}.wrap{max-width:980px;margin:32px auto;padding:0 16px}.hero,.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:24px;margin-bottom:16px;box-shadow:0 8px 24px #1725540d}.hero h1{margin:0}.muted{color:var(--muted)}.steps{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:18px 0}.step{padding:10px;border:1px solid var(--line);border-radius:10px;text-align:center;font-size:12px}.step.on{background:var(--p);color:#fff}.pane{display:none}.pane.on{display:block}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.full{grid-column:1/-1}label{display:block;font-weight:650;margin:8px 0 5px}input,select{width:100%;padding:11px;border:1px solid #cbd5e1;border-radius:9px;background:#fff}input[type=checkbox]{width:auto}.actions{display:flex;justify-content:space-between;gap:10px;margin-top:22px}button{border:0;border-radius:9px;padding:11px 17px;font-weight:770;cursor:pointer}button.primary{background:var(--p);color:#fff}button.secondary{background:#e8ecf5}button:disabled{opacity:.55}.check{padding:10px;border-bottom:1px solid var(--line)}pre{white-space:pre-wrap;background:#0f172a;color:#e2e8f0;padding:15px;border-radius:10px;max-height:320px;overflow:auto}.warn{padding:12px;background:#fff7ed;border:1px solid #fed7aa;border-radius:10px}.error{color:var(--danger);font-weight:650}.ok{color:var(--ok);font-weight:650}.pwd-wrap{position:relative;display:flex;align-items:center;gap:8px}.pwd-wrap input{flex:1;padding-right:44px}.pwd-toggle{position:absolute;right:8px;border:0;background:transparent;cursor:pointer;font-size:18px;line-height:1;padding:6px;border-radius:8px;color:var(--muted)}.pwd-toggle:hover{background:#eef2ff;color:var(--p)}.pwd-rules{margin:10px 0 0;padding:12px;border:1px solid var(--line);border-radius:10px;background:#f8fafc}.pwd-rules div{padding:3px 0;font-size:14px}.pwd-rules .pass{color:var(--ok);font-weight:650}.pwd-rules .fail{color:var(--danger);font-weight:650}.pwd-rules .running{color:var(--run);font-weight:650}
.lbl-row{display:flex;align-items:center;gap:6px;margin:8px 0 5px;flex-wrap:wrap}.lbl-row label{margin:0;font-weight:650}.help{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;border:1px solid #c7d2fe;background:#eef2ff;color:var(--p);font-size:11px;font-weight:700;cursor:help;position:relative;line-height:1}.help:hover,.help:focus{background:var(--p);color:#fff;outline:none}.help::after{content:attr(data-tip);position:absolute;left:50%;top:24px;transform:translateX(-50%);width:min(280px,70vw);padding:10px 12px;background:var(--tip);color:#fff;border-radius:8px;font-size:12px;font-weight:400;line-height:1.45;opacity:0;pointer-events:none;transition:opacity .12s;z-index:30;text-align:left;white-space:normal}.help:hover::after,.help:focus::after{opacity:1}.tip-note{margin:6px 0 0;font-size:12px;color:var(--muted)}
@media(max-width:700px){.grid,.steps{grid-template-columns:1fr}.steps{display:flex;overflow:auto}.step{min-width:120px}}
</style></head><body><main class="wrap">
<section class="hero"><h1>${pageTitle}</h1><p class="muted">Sunucuyu doğrular, güvenli ayarları kaydeder, veritabanını hazırlar ve ilk yöneticiyi oluşturur.</p><div id="scenarioInfo" class="warn" style="margin-top:10px">Proje mimarisi algılanıyor…</div><div class="warn" style="margin-top:8px"><strong>Kurulum şeması:</strong> 1) Ön kontrol · 2) Adres / kurulum biçimi (yerel veya kurum) · 3) Veri ve saklama · 4) Yönetici ve e-posta · 5) Uygula. Bu araç yalnız ilk kurulum içindir; Nginx, TLS veya güvenlik duvarını kendiliğinden değiştirmez.</div></section>
<div class="steps"><div class="step on">1. Sunucu</div><div class="step">2. Adres</div><div class="step">3. Veri</div><div class="step">4. Güvenlik</div><div class="step">5. Uygula</div></div>
<form id="wizard" class="card">
<section class="pane on">
  <h2>Sunucu ön kontrolü <span class="help" tabindex="0" data-tip="Kuruluma başlamadan önce Node.js sürümü, yazma izinleri ve mevcut kurulum artıkları denetlenir. Kırmızı bir madde varsa önce onu düzeltin.">?</span></h2>
  <div id="checks">Kontrol ediliyor…</div>
  <p class="muted">İşletim sistemi, Node.js, bellek, ağ ve yazma izinleri denetlenir.</p>
</section>
<section class="pane">
  <h2>Yayın adresi ve kurulum biçimi <span class="help" tabindex="0" data-tip="Uygulamanın nerede ve nasıl yayınlanacağını belirler: yerel demo (localhost), alt alan adı (subdomain) veya kurum sitesi alt yolu (subpath).">?</span></h2>
  <div class="grid">
    <div>
      <div class="lbl-row"><label for="mode">Kurulum biçimi</label><span class="help" tabindex="0" data-tip="Yerel: yalnız bu bilgisayarda deneme (http://localhost). Subdomain: https://uygulama.kurum.com. Alt yol: https://kurum.com/app gibi.">?</span></div>
      <select name="mode" id="mode">
        <option value="localhost">Yerel / localhost (deneme)</option>
        <option value="subdomain">Subdomain (üretim önerilen)</option>
        <option value="subpath">Kurum sitesi altında alt yol</option>
      </select>
      <p class="tip-note" id="modeNote">Yerel kurulumda reverse proxy ve TLS gerekmez.</p>
    </div>
    <div>
      <div class="lbl-row"><label for="host">Uygulamanın dinleyeceği adres</label><span class="help" tabindex="0" data-tip="127.0.0.1: yalnız bu makine + reverse proxy. 0.0.0.0: ağdaki diğer bilgisayarlar da bağlanabilir (güvenlik duvarı gerekir).">?</span></div>
      <select name="host" id="host">
        <option value="127.0.0.1">127.0.0.1 (yalnız bu makine / reverse proxy)</option>
        <option value="0.0.0.0">0.0.0.0 (ağdan erişim)</option>
      </select>
    </div>
    <div class="full">
      <div class="lbl-row"><label for="publicUrl">Herkese açık adres</label><span class="help" tabindex="0" data-tip="Kullanıcıların tarayıcıya yazacağı adrestir. Üretimde HTTPS zorunludur. Yerelde http://localhost:5000 yeterlidir.">?</span></div>
      <input name="publicUrl" id="publicUrl" type="url" required placeholder="http://localhost:5000">
    </div>
    <div>
      <div class="lbl-row"><label for="basePath">Alt yol</label><span class="help" tabindex="0" data-tip="Uygulamanın kök altındaki yolu. Yerel ve subdomain kurulumunda / kalır. Subpath örn: /app">?</span></div>
      <input name="basePath" id="basePath" value="/" required>
    </div>
    <div>
      <div class="lbl-row"><label for="port">Uygulama portu</label><span class="help" tabindex="0" data-tip="Node sunucusunun dinleyeceği TCP portu. Üretimde genelde 5000 bırakılır; Nginx bunun önüne geçer.">?</span></div>
      <input name="port" id="port" type="number" min="1024" max="65535" value="5000" required>
    </div>
    <div class="full">
      <div class="lbl-row"><label for="origins">İzinli origin adresleri</label><span class="help" tabindex="0" data-tip="CORS / CSRF için virgülle ayrılmış tam adresler. Tarayıcıdan hangi kaynaktan istek atılabileceğini sınırlar. Yerelde http://localhost:5000 ve http://127.0.0.1:5000 yazın.">?</span></div>
      <input name="origins" id="origins" required placeholder="http://localhost:5000">
    </div>
    <div>
      <div class="lbl-row"><label for="proxy">Güvenilir proxy sayısı</label><span class="help" tabindex="0" data-tip="Önünüzdeki reverse proxy (Nginx/IIS) sayısı. Yerelde 0. Nginx varsa 1. Zincirde 2+ proxy varsa artırın.">?</span></div>
      <input name="proxy" id="proxy" type="number" min="0" max="5" value="1">
    </div>
    <div id="customEnvSection" class="full hidden" style="margin-top:12px;padding:14px;border:1px solid var(--line);border-radius:12px;background:#f8fafc">
      <h3 style="margin:0 0 8px;font-size:15px">Proje Ortam Değişkenleri (.env.example)</h3>
      <p class="tip-note" style="margin:0 0 10px">Repoda bulunan özel değişkenleri buradan düzenleyebilirsiniz.</p>
      <div id="customEnvFields" class="grid"></div>
    </div>
  </div>
</section>
<section class="pane">
  <h2>Veritabanı ve saklama <span class="help" tabindex="0" data-tip="SQLite, PostgreSQL, MySQL veya özel bağlantı dizesi ile veritabanı ayarlanır. Saklama politikası eski operasyon kayıtlarını otomatik temizler.">?</span></h2>
  <div class="grid" style="margin-bottom:16px">
    <div class="full">
      <div class="lbl-row">
        <label for="dbProvider">Veritabanı Sağlayıcısı</label>
        <span class="help" tabindex="0" data-tip="Yerel geliştirme için SQLite uygundur. Kurumsal ve yüksek trafikli ortamlar için PostgreSQL veya MySQL önerilir.">?</span>
      </div>
      <select name="dbProvider" id="dbProvider">
        <option value="sqlite">SQLite (Yerel dosya tabanlı - Önerilen Başlangıç)</option>
        <option value="postgres">PostgreSQL</option>
        <option value="mysql">MySQL / MariaDB</option>
        <option value="custom">Özel Bağlantı Dizesi (Connection String)</option>
      </select>
    </div>
    <div id="dbSqliteWrap" class="full">
      <div class="tip-note" style="margin:0;padding:10px 12px;background:#f8fafc;border:1px solid var(--line);border-radius:10px">
        <strong>SQLite Seçildi:</strong> Veritabanı dosyası proje veri dizininde (<code>data/app.db</code>) otomatik tutulur. Harici veritabanı sunucusu kurulumu gerekmez.
      </div>
    </div>
    <div id="dbServerWrap" class="full hidden grid" style="gap:14px;padding:14px;border:1px solid var(--line);border-radius:12px;background:#f8fafc">
      <div>
        <div class="lbl-row"><label for="dbHost">Veritabanı Sunucu Adresi (Host)</label><span class="help" tabindex="0" data-tip="Örn: localhost, 127.0.0.1 veya uzak DB sunucusu.">?</span></div>
        <input name="dbHost" id="dbHost" value="localhost" placeholder="localhost">
      </div>
      <div>
        <div class="lbl-row"><label for="dbPort" id="lblDbPort">Port</label><span class="help" tabindex="0" data-tip="PostgreSQL için varsayılan 5432, MySQL için 3306.">?</span></div>
        <input name="dbPort" id="dbPort" type="number" min="1" max="65535" value="5432">
      </div>
      <div>
        <div class="lbl-row"><label for="dbName">Veritabanı Adı</label><span class="help" tabindex="0" data-tip="Uygulamanın bağlanacağı veritabanı.">?</span></div>
        <input name="dbName" id="dbName" value="app_db" placeholder="app_db">
      </div>
      <div>
        <div class="lbl-row"><label for="dbUser" id="lblDbUser">Kullanıcı Adı</label><span class="help" tabindex="0" data-tip="Veritabanı yetkili kullanıcısı (örn: postgres veya root).">?</span></div>
        <input name="dbUser" id="dbUser" value="postgres" placeholder="postgres">
      </div>
      <div class="full">
        <div class="lbl-row"><label for="dbPassword">Veritabanı Parolası</label><span class="help" tabindex="0" data-tip="Veritabanı kullanıcısının parolası. Parola yoksa boş bırakılabilir.">?</span></div>
        <div class="pwd-wrap">
          <input name="dbPassword" id="dbPassword" type="password" autocomplete="new-password" spellcheck="false">
          <button type="button" class="pwd-toggle" data-pwd="dbPassword" aria-label="Parolayı göster/gizle" title="Parolayı göster/gizle">👁️</button>
        </div>
      </div>
    </div>
    <div id="dbCustomWrap" class="full hidden" style="padding:14px;border:1px solid var(--line);border-radius:12px;background:#f8fafc">
      <div class="lbl-row"><label for="dbUrl">Bağlantı Dizesi (Connection String / URL)</label><span class="help" tabindex="0" data-tip="Tam veritabanı URL'si, örn: postgresql://kullanici:sifre@localhost:5432/app_db">?</span></div>
      <input name="dbUrl" id="dbUrl" placeholder="postgresql://user:password@localhost:5432/app_db">
    </div>
    <div class="full" style="display:flex;align-items:center;gap:12px;margin-top:6px">
      <button type="button" class="secondary" id="btnTestDb" style="padding:8px 14px;font-size:13px">🔍 Veritabanı Bağlantısını Sına</button>
      <span id="testDbResult" style="font-size:12px"></span>
    </div>
  </div>
  <div class="warn">Operasyon kayıtları için saklama sürelerini aşağıdan yapılandırabilirsiniz.</div>
  <div class="grid">
    <div class="full">
      <div class="lbl-row"><label><input name="retention" type="checkbox"> Operasyon kayıtları için saklama politikasını etkinleştir</label><span class="help" tabindex="0" data-tip="Açıksa eski işlem / bildirim / e-posta logları belirli gün sayısından sonra silinir. Kapatırsanız kayıtlar birikir.">?</span></div>
    </div>
    <div>
      <div class="lbl-row"><label for="actionDays">İşlem logu (gün)</label><span class="help" tabindex="0" data-tip="Denetim amaçlı işlem kayıtlarının saklanacağı gün sayısı (en az 30).">?</span></div>
      <input name="actionDays" id="actionDays" type="number" min="30" value="365">
    </div>
    <div>
      <div class="lbl-row"><label for="notificationDays">Okunmuş bildirim (gün)</label><span class="help" tabindex="0" data-tip="Okunmuş bildirim kayıtlarının saklanma süresi.">?</span></div>
      <input name="notificationDays" id="notificationDays" type="number" min="7" value="180">
    </div>
    <div>
      <div class="lbl-row"><label for="emailDays">E-posta logu (gün)</label><span class="help" tabindex="0" data-tip="Gönderilen sistem e-postalarının loglanma süresi.">?</span></div>
      <input name="emailDays" id="emailDays" type="number" min="7" value="90">
    </div>
    <div>
      <div class="lbl-row"><label for="passwordDays">Parola talebi (gün)</label><span class="help" tabindex="0" data-tip="Parola sıfırlama taleplerinin kayıtlarının saklanma süresi.">?</span></div>
      <input name="passwordDays" id="passwordDays" type="number" min="7" value="90">
    </div>
  </div>
</section>
<section class="pane">
  <h2>İlk yönetici ve e-posta <span class="help" tabindex="0" data-tip="Sistemdeki ilk admin hesabı burada açılır. Gmail ayarı isteğe bağlıdır; parola sıfırlama için kullanılır.">?</span></h2>
  <div id="adminOptionalNote" class="warn hidden" style="margin-bottom:12px">Bu mimaride (SPA / Statik / Masaüstü) yerel yönetici hesabı isteğe bağlıdır; boş bırakıp doğrudan geçebilirsiniz.</div>
  <div class="grid">
    <div>
      <div class="lbl-row"><label for="adminName">Yönetici adı</label><span class="help" tabindex="0" data-tip="Panelde görünecek ad soyad.">?</span></div>
      <input name="adminName" id="adminName" required maxlength="100">
    </div>
    <div>
      <div class="lbl-row"><label for="adminEmail">Yönetici e-postası</label><span class="help" tabindex="0" data-tip="Giriş ve bildirimlerde kullanılacak e-posta. Bu adresle ilk giriş yapılır.">?</span></div>
      <input name="adminEmail" id="adminEmail" type="email" required>
    </div>
    <div class="full">
      <div class="lbl-row"><label for="adminPassword">Yönetici parolası</label><span class="help" tabindex="0" data-tip="En az 12 karakter; büyük/küçük harf ve rakam içermeli; password, 123456, qwerty, admin123 gibi kolay tahmin edilemez.">?</span></div>
      <div class="pwd-wrap">
        <input name="adminPassword" id="adminPassword" type="password" required autocomplete="new-password" maxlength="128" spellcheck="false">
        <button type="button" class="pwd-toggle" data-pwd="adminPassword" aria-label="Parolayı göster/gizle" title="Parolayı göster/gizle">👁️</button>
      </div>
      <div class="pwd-rules" id="pwdRules" aria-live="polite"></div>
      <div id="adminSeedNotice" class="tip-note" style="margin-top:10px;padding:10px 12px;background:#f8fafc;border:1px solid var(--line);border-radius:10px;line-height:1.5">
        <strong>ℹ️ Hesap Saklama Modeli:</strong> İlk yönetici hesabı <code>data/admin.json</code> ve <code>.env</code> dosyalarına scrypt özetiyle kaydedilir.
      </div>
    </div>
    <div class="full">
      <div class="lbl-row"><label><input name="emailEnabled" id="emailEnabled" type="checkbox"> E-posta bildirimlerini (SMTP) etkinleştir</label><span class="help" tabindex="0" data-tip="İsteğe bağlı. Parola sıfırlama ve sistem bildirimleri için Gmail veya kurumsal SMTP sunucusu kullanılır.">?</span></div>
    </div>
    <div id="emailFields" class="grid full hidden" style="gap:14px;padding:14px;border:1px solid var(--line);border-radius:12px;background:#f8fafc;margin-top:6px">
      <div>
        <div class="lbl-row"><label for="emailProvider">E-posta Sağlayıcısı</label><span class="help" tabindex="0" data-tip="Gmail kullanıyorsanız otomatik smtp.gmail.com port 587/465 seçilir. Diğer sağlayıcılar için Kurumsal / Özel SMTP seçin.">?</span></div>
        <select name="emailProvider" id="emailProvider">
          <option value="gmail">Google Gmail (Uygulama Parolası)</option>
          <option value="custom">Kurumsal / Özel SMTP Sunucusu</option>
        </select>
      </div>
      <div id="customSmtpHostWrap" class="hidden">
        <div class="lbl-row"><label for="emailHost">SMTP Sunucu Adresi (Host)</label><span class="help" tabindex="0" data-tip="Örn: smtp.office365.com, mail.kurum.com veya IP adresi.">?</span></div>
        <input name="emailHost" id="emailHost" placeholder="smtp.kurum.com">
      </div>
      <div id="customSmtpPortWrap" class="hidden">
        <div class="lbl-row"><label for="emailPort">SMTP Portu</label><span class="help" tabindex="0" data-tip="Genelde STARTTLS için 587, SSL için 465, düz için 25.">?</span></div>
        <input name="emailPort" id="emailPort" type="number" min="1" max="65535" value="587">
      </div>
      <div>
        <div class="lbl-row"><label for="emailUser" id="lblEmailUser">Gmail hesabı</label><span class="help" tabindex="0" data-tip="Gönderim ve giriş için e-posta adresi veya kullanıcı adı.">?</span></div>
        <input name="emailUser" id="emailUser" placeholder="hesap@gmail.com">
      </div>
      <div>
        <div class="lbl-row"><label for="fromEmail">Gönderen e-posta (From)</label><span class="help" tabindex="0" data-tip="Kullanıcıların göreceği From adresi.">?</span></div>
        <input name="fromEmail" id="fromEmail" type="email" placeholder="hesap@gmail.com">
      </div>
      <div>
        <div class="lbl-row"><label for="emailPassword" id="lblEmailPassword">Gmail uygulama parolası</label><span class="help" tabindex="0" data-tip="Google Hesap > Güvenlik > Uygulama parolaları (16 karakter) veya SMTP parolası.">?</span></div>
        <div class="pwd-wrap">
          <input name="emailPassword" id="emailPassword" type="password" autocomplete="new-password" spellcheck="false">
          <button type="button" class="pwd-toggle" data-pwd="emailPassword" aria-label="Parolayı göster/gizle" title="Parolayı göster/gizle">👁️</button>
        </div>
      </div>
      <div>
        <div class="lbl-row"><label for="fromName">Gönderen adı</label><span class="help" tabindex="0" data-tip="E-postalarda görünen gönderen ismi.">?</span></div>
        <input name="fromName" id="fromName" value="Sistem Bildirimi">
      </div>
      <div id="customSmtpSecureWrap" class="full hidden">
        <div class="lbl-row"><label><input name="emailSecure" id="emailSecure" type="checkbox"> Güvenli Bağlantı (SSL/TLS - Port 465)</label><span class="help" tabindex="0" data-tip="Port 465 (SSL) için işaretleyin; 587 (STARTTLS) için boş bırakın.">?</span></div>
      </div>
      <div class="full" style="display:flex;align-items:center;gap:12px;margin-top:6px">
        <button type="button" class="secondary" id="btnTestEmail" style="padding:8px 14px;font-size:13px">✉️ SMTP Bağlantısını Sına</button>
        <span id="testEmailResult" style="font-size:12px"></span>
      </div>
    </div>
  </div>
</section>
<section class="pane">
  <h2>Doğrula ve uygula <span class="help" tabindex="0" data-tip="Aşağıdaki onayla .env yazılır, veritabanı hazırlanır, ilk yönetici açılır ve istenirse üretim derlemesi alınır. Adımlar canlı izlenir.">?</span></h2>
  <p>Uygulama; <code>.env</code> dosyasını atomik olarak yazar, migration'ları uygular, ilk yöneticiyi oluşturur ve istenirse üretim derlemesini hazırlar.</p>
  <div class="lbl-row"><label><input name="buildClient" type="checkbox" checked> Uygulamayı üretim için derle</label><span class="help" tabindex="0" data-tip="Üretimde açık tutun. Hızlı yerel deneme için kapatabilirsiniz.">?</span></div>
  <div class="lbl-row"><label><input name="overwrite" type="checkbox"> Var olan .env dosyasını yedekleyip değiştir</label><span class="help" tabindex="0" data-tip="Daha önce .env yazılmışsa bu onay olmadan kurulum durur. Eski dosya backups altına kopyalanır.">?</span></div>
  <div class="lbl-row"><label><input name="confirm" type="checkbox" required> Girilen bilgileri kontrol ettim ve kalıcı kurulumu onaylıyorum</label><span class="help" tabindex="0" data-tip="Bu onay olmadan kurulum uygulanmaz. Ayarlar kalıcıdır; sonra yönetici panelinden düzenlenebilir.">?</span></div>
  <div id="applyProgress" class="pwd-rules hidden" aria-live="polite"></div>
  <div id="applyConsoleWrap" class="hidden" style="margin-top:12px;border:1px solid var(--line);border-radius:10px;overflow:hidden">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 12px;background:#1e293b;color:#f8fafc;font-size:12px">
      <span>💻 Canlı İşlem Günlüğü (Terminal)</span>
      <span id="logCount" style="color:var(--muted)">0 satır</span>
    </div>
    <pre id="applyConsole" style="margin:0;border-radius:0;max-height:200px;font-size:11px;line-height:1.45;background:#0f172a;color:#cbd5e1;overflow-y:auto"></pre>
  </div>
  <pre id="result">Henüz uygulanmadı.</pre>
  <div id="doneBox" class="warn hidden">
    <h3 style="margin:0 0 8px">Sonraki adımlar</h3>
    <ol id="nextSteps" style="margin:0;padding-left:18px;line-height:1.7"></ol>
    <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap">
      <button type="button" class="primary" id="startApp">Uygulamayı başlat</button>
      <button type="button" class="primary" id="goLogin">Giriş sayfasına git</button>
      <button type="button" class="secondary" id="goApp">Uygulamayı aç</button>
    </div>
    <p class="muted" id="redirectNote" style="margin:10px 0 0"></p>
  </div>
</section>
<div class="actions"><button type="button" class="secondary" id="prev" disabled>Geri</button><button type="button" class="primary" id="next">İleri</button><button type="submit" class="primary" id="apply" hidden>Kurulumu Uygula</button></div></form></main>
<script>window.__SETUP__=${boot};
const wizard=document.getElementById('wizard'),prev=document.getElementById('prev'),next=document.getElementById('next'),apply=document.getElementById('apply'),checks=document.getElementById('checks'),result=document.getElementById('result'),pwdRules=document.getElementById('pwdRules');
const panes=[...document.querySelectorAll('.pane')],steps=[...document.querySelectorAll('.step')];let page=0;
const CHECK_LABELS={nodeSupported:'Desteklenen Node.js LTS',dataWritable:'Veri dizini yazılabilir',uploadsWritable:'Yükleme dizini yazılabilir',notInstalled:'Kurulum kilidi yok',envAbsent:'.env dosyası yok',toolchainAvailable:'Gerekli derleyici ve araç zinciri hazır'};
function escapeHtml(value){return String(value).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]))}
function passwordRules(value){
  const v=value||'';
  return [
    {key:'len',label:'En az 12 karakter (şu an '+v.length+')',ok:v.length>=12&&v.length<=128},
    {key:'lower',label:'Küçük harf (a-z)',ok:/[a-z]/.test(v)},
    {key:'upper',label:'Büyük harf (A-Z)',ok:/[A-Z]/.test(v)},
    {key:'digit',label:'Rakam (0-9)',ok:/\\d/.test(v)},
    {key:'weak',label:'Kolay tahmin edilemez (password, 123456, qwerty, admin123 yok)',ok:v.length>0&&!/password|123456|qwerty|admin123/i.test(v)},
  ];
}
function adminPasswordError(value){
  const failed=passwordRules(value).filter(r=>!r.ok);
  if(!value)return 'Parola girin.';
  if(failed.length===0)return '';
  return failed.map(r=>'• '+r.label).join('\\n');
}
function renderPasswordRules(){
  const input=wizard.elements.namedItem('adminPassword');
  const value=input?input.value:'';
  pwdRules.innerHTML=passwordRules(value).map(r=>'<div class="'+(r.ok?'pass':'fail')+'">'+(r.ok?'✓ ':'✕ ')+escapeHtml(r.label)+'</div>').join('');
}
function fieldError(input,message){input.setCustomValidity(message||'')}
function syncEmailRequirements(){
  const enabled=Boolean(wizard.elements.namedItem('emailEnabled')?.checked);
  const provider=wizard.elements.namedItem('emailProvider')?.value||'gmail';
  const isCustom=provider==='custom';
  const fieldsBox=document.getElementById('emailFields');
  if(fieldsBox)fieldsBox.classList.toggle('hidden',!enabled);
  const hostWrap=document.getElementById('customSmtpHostWrap');
  const portWrap=document.getElementById('customSmtpPortWrap');
  const secureWrap=document.getElementById('customSmtpSecureWrap');
  if(hostWrap)hostWrap.classList.toggle('hidden',!isCustom);
  if(portWrap)portWrap.classList.toggle('hidden',!isCustom);
  if(secureWrap)secureWrap.classList.toggle('hidden',!isCustom);

  const hostEl=wizard.elements.namedItem('emailHost');
  const portEl=wizard.elements.namedItem('emailPort');
  if(hostEl)hostEl.required=enabled&&isCustom;
  if(portEl)portEl.required=enabled&&isCustom;

  const lblUser=document.getElementById('lblEmailUser');
  const lblPwd=document.getElementById('lblEmailPassword');
  const userEl=wizard.elements.namedItem('emailUser');
  const fromEl=wizard.elements.namedItem('fromEmail');
  if(lblUser)lblUser.textContent=isCustom?'SMTP Kullanıcı Adı / E-posta':'Gmail hesabı';
  if(lblPwd)lblPwd.textContent=isCustom?'SMTP Parolası':'Gmail uygulama parolası';
  if(userEl)userEl.placeholder=isCustom?'bildirim@kurum.com':'hesap@gmail.com';
  if(fromEl)fromEl.placeholder=isCustom?'bildirim@kurum.com':'hesap@gmail.com';

  ['emailUser','fromEmail','emailPassword','fromName'].forEach(name=>{
    const el=wizard.elements.namedItem(name);
    if(!el)return;
    el.required=enabled;
    if(!enabled)fieldError(el,'');
  });
}
function validateEmailFields(){
  const enabled=Boolean(wizard.elements.namedItem('emailEnabled')?.checked);
  syncEmailRequirements();
  if(!enabled)return true;
  const provider=wizard.elements.namedItem('emailProvider')?.value||'gmail';
  const isCustom=provider==='custom';
  const emailUser=wizard.elements.namedItem('emailUser');
  const fromEmail=wizard.elements.namedItem('fromEmail');
  const emailPwd=wizard.elements.namedItem('emailPassword');
  const emailHost=wizard.elements.namedItem('emailHost');
  const emailPort=wizard.elements.namedItem('emailPort');

  if(isCustom){
    if(emailHost){
      const val=String(emailHost.value||'').trim();
      fieldError(emailHost,(val&&val.length<=253&&!/[\\s\\r\\n\\0]/.test(val))?'':'Geçerli bir SMTP host adresi girin.');
    }
    if(emailPort){
      const p=Number(emailPort.value);
      fieldError(emailPort,(Number.isInteger(p)&&p>=1&&p<=65535)?'':'Port 1-65535 aralığında olmalıdır.');
    }
    if(emailUser){
      const val=String(emailUser.value||'').trim();
      fieldError(emailUser,val?'':'SMTP kullanıcı adı girin.');
    }
    if(fromEmail){
      const val=String(fromEmail.value||'').trim();
      fieldError(fromEmail,/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(val)?'':'Geçerli bir gönderen e-posta adresi girin.');
    }
    if(emailPwd){
      const cleaned=String(emailPwd.value||'').replace(/\\s/g,'');
      fieldError(emailPwd,cleaned.length>=1?'':'SMTP parolası girin.');
    }
  }else{
    for(const el of [emailUser,fromEmail]){
      if(el){
        const val=String(el.value||'').trim();
        fieldError(el,/@gmail\\.com$/i.test(val)?'':'Yalnız @gmail.com adresi kullanılabilir.');
      }
    }
    if(emailPwd){
      const cleaned=String(emailPwd.value||'').replace(/\\s/g,'');
      fieldError(emailPwd,(cleaned.length>=16&&cleaned.length<=128)?'':'En az 16 karakterli Gmail uygulama parolası girin.');
    }
  }
  return true;
}
function syncDbRequirements(){
  const prov=wizard.elements.namedItem('dbProvider')?.value||'sqlite';
  const sqliteWrap=document.getElementById('dbSqliteWrap');
  const serverWrap=document.getElementById('dbServerWrap');
  const customWrap=document.getElementById('dbCustomWrap');
  const portEl=wizard.elements.namedItem('dbPort');
  const userEl=wizard.elements.namedItem('dbUser');
  const lblPort=document.getElementById('lblDbPort');
  const lblUser=document.getElementById('lblDbUser');

  if(sqliteWrap)sqliteWrap.classList.toggle('hidden',prov!=='sqlite');
  if(serverWrap)serverWrap.classList.toggle('hidden',prov!=='postgres'&&prov!=='mysql');
  if(customWrap)customWrap.classList.toggle('hidden',prov!=='custom');

  if(prov==='postgres'){
    if(lblPort)lblPort.textContent='PostgreSQL Portu';
    if(lblUser)lblUser.textContent='PostgreSQL Kullanıcısı';
    if(portEl&&(portEl.value==='3306'||!portEl.value))portEl.value='5432';
    if(userEl&&(userEl.value==='root'||!userEl.value))userEl.value='postgres';
  }else if(prov==='mysql'){
    if(lblPort)lblPort.textContent='MySQL Portu';
    if(lblUser)lblUser.textContent='MySQL Kullanıcısı';
    if(portEl&&(portEl.value==='5432'||!portEl.value))portEl.value='3306';
    if(userEl&&(userEl.value==='postgres'||!userEl.value))userEl.value='root';
  }
}
function validateDatabaseFields(){
  const prov=wizard.elements.namedItem('dbProvider')?.value||'sqlite';
  syncDbRequirements();
  if(prov==='sqlite')return true;
  if(prov==='custom'){
    const urlEl=wizard.elements.namedItem('dbUrl');
    if(urlEl){
      const val=String(urlEl.value||'').trim();
      fieldError(urlEl,(val&&!/[\\r\\n\\0]/.test(val))?'':'Geçerli bir veritabanı bağlantı dizesi girin.');
    }
    return true;
  }
  const hostEl=wizard.elements.namedItem('dbHost');
  const portEl=wizard.elements.namedItem('dbPort');
  const nameEl=wizard.elements.namedItem('dbName');
  const userEl=wizard.elements.namedItem('dbUser');
  if(hostEl){
    const val=String(hostEl.value||'').trim();
    fieldError(hostEl,(val&&val.length<=253&&!/[\\s\\r\\n\\0]/.test(val))?'':'Geçerli bir host adresi girin.');
  }
  if(portEl){
    const p=Number(portEl.value);
    fieldError(portEl,(Number.isInteger(p)&&p>=1&&p<=65535)?'':'Port 1-65535 aralığında olmalıdır.');
  }
  if(nameEl){
    const val=String(nameEl.value||'').trim();
    fieldError(nameEl,(val&&val.length<=100&&!/[\\s\\r\\n\\0]/.test(val))?'':'Veritabanı adı girin.');
  }
  if(userEl){
    const val=String(userEl.value||'').trim();
    fieldError(userEl,(val&&val.length<=100&&!/[\\r\\n\\0]/.test(userEl))?'':'Kullanıcı adı girin.');
  }
  return true;
}
function setVal(name,value){const el=wizard.elements.namedItem(name);if(el&&value!==undefined&&value!==null)el.value=value}
function applyModeDefaults(){
  const mode=wizard.elements.namedItem('mode').value;
  const note=document.getElementById('modeNote');
  const port=Number(wizard.elements.namedItem('port').value||5000);
  if(mode==='localhost'){
    setVal('basePath','/');
    setVal('host','127.0.0.1');
    setVal('proxy',0);
    if(!wizard.elements.namedItem('publicUrl').value||wizard.elements.namedItem('publicUrl').dataset.auto!=='0'){
      setVal('publicUrl','http://localhost:'+port);
      wizard.elements.namedItem('publicUrl').dataset.auto='1';
    }
    if(wizard.elements.namedItem('origins').dataset.auto!=='0'){
      setVal('origins','http://localhost:'+port+', http://127.0.0.1:'+port);
      wizard.elements.namedItem('origins').dataset.auto='1';
    }
    if(note)note.textContent='Yerel kurulum: http://localhost:'+port + ' — reverse proxy/TLS gerekmez. Yalnız deneme içindir.';
  }else if(mode==='subdomain'){
    if(wizard.elements.namedItem('basePath').value==='/'||wizard.elements.namedItem('basePath').dataset.auto!=='0'){
      setVal('basePath','/');
      wizard.elements.namedItem('basePath').dataset.auto='1';
    }
    if(wizard.elements.namedItem('proxy').dataset.auto!=='0'){setVal('proxy',1);wizard.elements.namedItem('proxy').dataset.auto='1'}
    if(note)note.textContent='Subdomain: https://uygulama.kurum.com gibi ayrı bir alan adı + Nginx/TLS gerekir.';
  }else{
    if(wizard.elements.namedItem('basePath').dataset.auto!=='0'){
      setVal('basePath','/app');
      wizard.elements.namedItem('basePath').dataset.auto='1';
    }
    if(wizard.elements.namedItem('proxy').dataset.auto!=='0'){setVal('proxy',1);wizard.elements.namedItem('proxy').dataset.auto='1'}
    if(note)note.textContent='Alt yol: https://kurum.com/app gibi mevcut site altına eklenir.';
  }
}
['publicUrl','origins','basePath','proxy','port'].forEach(name=>{
  const el=wizard.elements.namedItem(name);
  if(el)el.addEventListener('input',()=>{el.dataset.auto='0';if(name==='port')applyModeDefaults()});
});
wizard.elements.namedItem('mode').addEventListener('change',()=>{
  ['publicUrl','origins','basePath','proxy'].forEach(n=>{const el=wizard.elements.namedItem(n);if(el)el.dataset.auto='1'});
  applyModeDefaults();
});
const emailToggle=wizard.elements.namedItem('emailEnabled');
if(emailToggle)emailToggle.addEventListener('change',syncEmailRequirements);
const emailProv=wizard.elements.namedItem('emailProvider');
if(emailProv)emailProv.addEventListener('change',()=>{syncEmailRequirements();validateEmailFields();});
['emailUser','fromEmail','emailPassword','emailHost','emailPort'].forEach(n=>{
  const el=wizard.elements.namedItem(n);
  if(el)el.addEventListener('input',()=>fieldError(el,''));
});
const dbProv=wizard.elements.namedItem('dbProvider');
if(dbProv)dbProv.addEventListener('change',()=>{syncDbRequirements();validateDatabaseFields();});
['dbHost','dbPort','dbName','dbUser','dbUrl'].forEach(n=>{
  const el=wizard.elements.namedItem(n);
  if(el)el.addEventListener('input',()=>fieldError(el,''));
});
applyModeDefaults();
syncEmailRequirements();
syncDbRequirements();
function show(n){page=n;panes.forEach((x,i)=>x.classList.toggle('on',i===n));steps.forEach((x,i)=>x.classList.toggle('on',i===n));prev.disabled=n===0;next.hidden=n===panes.length-1;apply.hidden=n!==panes.length-1}
prev.onclick=()=>show(page-1);
next.onclick=()=>{
  const fields=[...panes[page].querySelectorAll('input,select')];
  if(page===2){
    validateDatabaseFields();
  }
  if(page===3){
    const pwd=wizard.elements.namedItem('adminPassword');
    const nameInput=wizard.elements.namedItem('adminName');
    const emailInput=wizard.elements.namedItem('adminEmail');
    const isOptionalEmptyAdmin=Boolean(window.__OPTIONAL_ADMIN__)&&!String(pwd?.value||'').trim()&&!String(nameInput?.value||'').trim()&&!String(emailInput?.value||'').trim();
    if(pwd&&!isOptionalEmptyAdmin){
      renderPasswordRules();
      const message=adminPasswordError(pwd.value);
      fieldError(pwd,message);
      if(message){pwd.focus();return}
    }else if(pwd){
      fieldError(pwd,'');
    }
    validateEmailFields();
  }
  for(const field of fields){
    if(!field.checkValidity()){field.reportValidity();return}
  }
  show(page+1);
};
document.querySelectorAll('.pwd-toggle').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const input=wizard.elements.namedItem(btn.getAttribute('data-pwd'));
    if(!input)return;
    const showing=input.type==='text';
    input.type=showing?'password':'text';
    btn.textContent=showing?'👁️':'🙈';
    btn.setAttribute('aria-label',showing?'Parolayı göster':'Parolayı gizle');
    input.focus();
  });
});
const adminPwd=wizard.elements.namedItem('adminPassword');
if(adminPwd){
  adminPwd.addEventListener('input',()=>{renderPasswordRules();fieldError(adminPwd,adminPasswordError(adminPwd.value))});
  renderPasswordRules();
}
const API=(window.__SETUP__&&window.__SETUP__.apiBase)||'/api';
const EMBEDDED=Boolean(window.__SETUP__&&window.__SETUP__.embedded);
async function fetchJson(url,options){
  const r=await fetch(url,options);
  const text=await r.text();
  let data=null;
  try{data=text?JSON.parse(text):null}catch{
    const snippet=(text||'').slice(0,120);
    throw new Error(r.status===429?'Sunucu yoğun; kısa süre sonra yeniden denenecek. ('+r.status+')':'Sunucu geçerli JSON döndürmedi ('+r.status+'): '+snippet);
  }
  return {ok:r.ok,status:r.status,data};
}
async function loadStatus(){
  checks.textContent='Kontrol ediliyor…';
  try{
    const {ok,status,data:s}=await fetchJson(API+'/status');
    if(!ok)throw new Error(s&&s.message?s.message:('Sunucu ön kontrolü başarısız ('+status+')'));
    const rows=Object.entries(s.checks).map(([k,v])=>{
      const label=CHECK_LABELS[k]||k;
      return '<div class="check '+(v?'ok':'error')+'">'+(v?'✓ ':'✕ ')+escapeHtml(label)+'</div>';
    }).join('');
    checks.innerHTML=rows+'<pre>'+escapeHtml(JSON.stringify(s.detected,null,2))+'</pre>';
    const sInfo=document.getElementById('scenarioInfo');
    if(sInfo&&s&&s.detected&&s.detected.scenario){
      sInfo.innerHTML='<strong>Algılanan Mimari:</strong> Senaryo '+escapeHtml(s.detected.scenario.number)+' — '+escapeHtml(s.detected.scenario.label)+'<div class="tip-note" style="margin-top:4px">'+escapeHtml(s.detected.scenario.summary||'')+'</div>';
    }
    const adminSeedNotice=document.getElementById('adminSeedNotice');
    if(adminSeedNotice&&s&&s.detected){
      if(s.detected.seedScript){
        adminSeedNotice.innerHTML='<strong>🌱 Veritabanı Tohumlama (Seed):</strong> Projede <code>'+escapeHtml(s.detected.seedScript)+'</code> betiği algılandı. İlk yönetici kaydedildikten sonra bu tohumlama adımı otomatik olarak çalıştırılacaktır.';
      }else{
        adminSeedNotice.innerHTML='<strong>ℹ️ Hesap Saklama Modeli:</strong> İlk yönetici hesabı <code>data/admin.json</code> ve <code>.env</code> (ADMIN_EMAIL, ADMIN_PASSWORD_HASH) içerisine scrypt özetiyle kaydedilir. Projede bağımsız bir seed betiği bulunmamaktadır.';
      }
    }
    if(s&&s.detected&&s.detected.defaultPort){
      setVal('port',s.detected.defaultPort);
      applyModeDefaults();
    }
    const CORE_ENV_KEYS=new Set(['PORT','HOST','NODE_ENV','DATABASE_URL','SESSION_SECRET','ADMIN_NAME','ADMIN_EMAIL','ADMIN_PASSWORD','ADMIN_PASSWORD_HASH','EMAIL_ENABLED','EMAIL_HOST','EMAIL_PORT','EMAIL_USER','EMAIL_PASS','EMAIL_PASSWORD','EMAIL_FROM','EMAIL_FROM_EMAIL','EMAIL_FROM_NAME','EMAIL_SECURE','EMAIL_CONNECTION_TIMEOUT','EMAIL_GREETING_TIMEOUT','EMAIL_SOCKET_TIMEOUT','RETENTION_ENABLED','RETENTION_ACTION_DAYS','RETENTION_ACTION_LOG_DAYS','RETENTION_NOTIFICATION_DAYS','RETENTION_READ_NOTIFICATION_DAYS','RETENTION_EMAIL_DAYS','RETENTION_EMAIL_LOG_DAYS','RETENTION_PASSWORD_DAYS','RETENTION_PASSWORD_RESET_DAYS','FRONTEND_URL','APP_BASE_PATH','ALLOWED_ORIGINS','TRUST_PROXY_HOPS','ALLOW_RUNTIME_DEPLOYMENT_CHANGES']);
    const envVars=(s&&s.detected&&Array.isArray(s.detected.envVariables))?s.detected.envVariables.filter(v=>v&&v.key&&!CORE_ENV_KEYS.has(v.key)):[];
    const customEnvSec=document.getElementById('customEnvSection');
    const customEnvFields=document.getElementById('customEnvFields');
    if(customEnvSec&&customEnvFields){
      if(envVars.length>0){
        customEnvSec.classList.remove('hidden');
        customEnvFields.innerHTML=envVars.map(v=>'<div><div class="lbl-row"><label for="env_'+escapeHtml(v.key)+'">'+escapeHtml(v.key)+'</label>'+(v.description?'<span class="help" tabindex="0" data-tip="'+escapeHtml(v.description)+'">?</span>':'')+'</div><input id="env_'+escapeHtml(v.key)+'" data-custom-env-key="' + escapeHtml(v.key)+'" value="'+escapeHtml(v.defaultValue||'')+'"></div>').join('');
      }else{
        customEnvSec.classList.add('hidden');
      }
    }
    if(s&&s.detected&&s.detected.scenario&&s.detected.scenario.requiresAdmin===false){
      window.__OPTIONAL_ADMIN__=true;
      ['adminName','adminEmail','adminPassword'].forEach(id=>{
        const el=wizard.elements.namedItem(id);
        if(el)el.required=false;
      });
      const admNote=document.getElementById('adminOptionalNote');
      if(admNote)admNote.classList.remove('hidden');
    }
  }catch(e){
    checks.innerHTML='<p class="error">Ön kontrol sonucu alınamadı: '+escapeHtml(e&&e.message?e.message:e)+'</p><button type="button" class="secondary" id="retry">Yeniden Dene</button>';
    const retry=document.getElementById('retry');
    if(retry)retry.onclick=loadStatus;
  }
}
loadStatus();
const btnTestDb=document.getElementById('btnTestDb');
const testDbResult=document.getElementById('testDbResult');
if(btnTestDb){
  btnTestDb.addEventListener('click',async()=>{
    const f=new FormData(wizard);
    const dbProvVal=f.get('dbProvider')||'sqlite';
    let dbPayload={provider:dbProvVal};
    if(dbProvVal==='postgres'||dbProvVal==='mysql'){
      dbPayload={
        provider:dbProvVal,
        host:String(f.get('dbHost')||'localhost').trim(),
        port:Number(f.get('dbPort')||(dbProvVal==='postgres'?5432:3306)),
        name:String(f.get('dbName')||'app_db').trim(),
        user:String(f.get('dbUser')||'').trim(),
        password:String(f.get('dbPassword')||''),
      };
    }else if(dbProvVal==='custom'){
      dbPayload={provider:'custom',url:String(f.get('dbUrl')||'').trim()};
    }
    testDbResult.textContent='Bağlantı sınanıyor…';
    testDbResult.style.color='var(--muted)';
    btnTestDb.disabled=true;
    try{
      const {ok,data}=await fetchJson(API+'/test-database',{
        method:'POST',
        headers:{'content-type':'application/json','x-setup-csrf':window.__SETUP__.csrfToken},
        body:JSON.stringify({database:dbPayload})
      });
      if(ok&&data&&data.ok){
        testDbResult.textContent='✓ '+(data.message||'Veritabanı bağlantısı başarılı.');
        testDbResult.style.color='#16a34a';
      }else{
        testDbResult.textContent='✕ '+(data&&data.message?data.message:'Bağlantı kurulamadı.');
        testDbResult.style.color='#dc2626';
      }
    }catch(err){
      testDbResult.textContent='✕ Sınama hatası: '+err.message;
      testDbResult.style.color='#dc2626';
    }finally{
      btnTestDb.disabled=false;
    }
  });
}

const btnTestEmail=document.getElementById('btnTestEmail');
const testEmailResult=document.getElementById('testEmailResult');
if(btnTestEmail){
  btnTestEmail.addEventListener('click',async()=>{
    const f=new FormData(wizard);
    const enabled=f.has('emailEnabled');
    if(!enabled){
      testEmailResult.textContent='ℹ️ E-posta bildirimleri etkinleştirilmemiş.';
      testEmailResult.style.color='var(--muted)';
      return;
    }
    const emailProvVal=f.get('emailProvider')||'gmail';
    const isCustomMail=emailProvVal==='custom';
    const emailPayload={
      enabled:true,
      provider:isCustomMail?'custom':'gmail',
      host:isCustomMail?String(f.get('emailHost')||'').trim():'smtp.gmail.com',
      port:Number(isCustomMail?(f.get('emailPort')||587):(f.has('emailSecure')?465:587)),
      secure:isCustomMail?f.has('emailSecure'):false,
      user:f.get('emailUser'),
      password:f.get('emailPassword'),
      fromEmail:f.get('fromEmail'),
      fromName:f.get('fromName'),
    };
    testEmailResult.textContent='SMTP sunucusuna bağlanılıyor…';
    testEmailResult.style.color='var(--muted)';
    btnTestEmail.disabled=true;
    try{
      const {ok,data}=await fetchJson(API+'/test-email',{
        method:'POST',
        headers:{'content-type':'application/json','x-setup-csrf':window.__SETUP__.csrfToken},
        body:JSON.stringify({email:emailPayload})
      });
      if(ok&&data&&data.ok){
        testEmailResult.textContent='✓ '+(data.message||'SMTP bağlantısı başarılı.');
        testEmailResult.style.color='#16a34a';
      }else{
        testEmailResult.textContent='✕ '+(data&&data.message?data.message:'SMTP bağlantısı başarısız.');
        testEmailResult.style.color='#dc2626';
      }
    }catch(err){
      testEmailResult.textContent='✕ Sınama hatası: '+err.message;
      testEmailResult.style.color='#dc2626';
    }finally{
      btnTestEmail.disabled=false;
    }
  });
}

wizard.onsubmit=async e=>{
  e.preventDefault();
  const pwd=wizard.elements.namedItem('adminPassword');
  const nameInput=wizard.elements.namedItem('adminName');
  const emailInput=wizard.elements.namedItem('adminEmail');
  const isOptionalEmptyAdmin=Boolean(window.__OPTIONAL_ADMIN__)&&!String(pwd?.value||'').trim()&&!String(nameInput?.value||'').trim()&&!String(emailInput?.value||'').trim();
  if(pwd&&!isOptionalEmptyAdmin){
    const message=adminPasswordError(pwd.value);
    fieldError(pwd,message);
    if(message){
      show(3);renderPasswordRules();pwd.focus();
      result.textContent='Yönetici parolası geçerli değil. 4. adımdaki kırmızı maddeleri tamamlayın.';
      result.className='error';
      return;
    }
  }else if(pwd){
    fieldError(pwd,'');
  }
  validateEmailFields();
  apply.disabled=true;next.disabled=true;prev.disabled=true;
  const progressBox=document.getElementById('applyProgress');
  const doneBox=document.getElementById('doneBox');
  const consoleBox=document.getElementById('applyConsole');
  const consoleWrap=document.getElementById('applyConsoleWrap');
  if(consoleBox)consoleBox.textContent='';
  if(consoleWrap)consoleWrap.classList.add('hidden');
  progressBox.classList.remove('hidden');
  doneBox.classList.add('hidden');
  result.textContent='Kurulum uygulanıyor; adımlar ekranda canlı güncellenir. Pencereyi kapatmayın…';
  result.className='';
  progressBox.innerHTML='<div>Adımlar başlatılıyor…</div>';
  const f=new FormData(wizard);
  const enabled=f.has('emailEnabled');
  const customEnv={};
  document.querySelectorAll('[data-custom-env-key]').forEach(el=>{
    const k=el.getAttribute('data-custom-env-key');
    if(k)customEnv[k]=el.value;
  });
  const emailProvVal=f.get('emailProvider')||'gmail';
  const isCustomMail=emailProvVal==='custom';
  const emailPayload=enabled?{
    enabled:true,
    provider:isCustomMail?'custom':'gmail',
    host:isCustomMail?String(f.get('emailHost')||'').trim():'smtp.gmail.com',
    port:Number(isCustomMail?(f.get('emailPort')||587):587),
    secure:isCustomMail?f.has('emailSecure'):false,
    user:f.get('emailUser'),
    password:f.get('emailPassword'),
    fromEmail:f.get('fromEmail'),
    fromName:f.get('fromName')
  }:{enabled:false};
  const dbProvVal=f.get('dbProvider')||'sqlite';
  let dbPayload={provider:dbProvVal};
  if(dbProvVal==='postgres'||dbProvVal==='mysql'){
    dbPayload={
      provider:dbProvVal,
      host:String(f.get('dbHost')||'localhost').trim(),
      port:Number(f.get('dbPort')||(dbProvVal==='postgres'?5432:3306)),
      name:String(f.get('dbName')||'app_db').trim(),
      user:String(f.get('dbUser')||'').trim(),
      password:String(f.get('dbPassword')||''),
    };
  }else if(dbProvVal==='custom'){
    dbPayload={
      provider:'custom',
      url:String(f.get('dbUrl')||'').trim(),
    };
  }
  const payload={deployment:{mode:f.get('mode'),publicUrl:f.get('publicUrl'),basePath:f.get('basePath'),allowedOrigins:String(f.get('origins')).split(',').map(x=>x.trim()).filter(Boolean),trustProxyHops:Number(f.get('proxy')),retention:{enabled:f.has('retention'),actionLogDays:Number(f.get('actionDays')),readNotificationDays:Number(f.get('notificationDays')),emailLogDays:Number(f.get('emailDays')),passwordResetDays:Number(f.get('passwordDays'))}},server:{host:f.get('host'),port:Number(f.get('port'))},admin:isOptionalEmptyAdmin?{name:'',email:'',password:''}:{name:f.get('adminName'),email:f.get('adminEmail'),password:f.get('adminPassword')},email:emailPayload,database:dbPayload,customEnv,buildClient:f.has('buildClient'),overwriteExistingEnv:f.has('overwrite')};
  try{
    const start=await fetchJson(API+'/apply',{method:'POST',headers:{'content-type':'application/json','x-setup-csrf':window.__SETUP__.csrfToken},body:JSON.stringify(payload)});
    const startData=start.data||{};
    if(start.status===400&&startData.issues){
      const issueText='\\n'+startData.issues.map(i=>'• '+((i.message)||i.code)+((i.path&&i.path.length)?' ('+i.path.join('.')+')':'')).join('\\n');
      throw new Error((startData.message||'Girilen bilgiler doğrulanamadı.')+issueText);
    }
    if(!start.ok&&start.status!==202)throw new Error(startData.message||('Kurulum başlatılamadı ('+start.status+').'));
    await pollApplyProgress();
  }catch(err){
    result.textContent=err.message;
    result.className='error';
    apply.disabled=false;next.disabled=false;prev.disabled=false;
  }
};
function stepIcon(status){return status==='done'?'✓':status==='running'?'…':status==='error'?'✕':status==='skipped'?'○':'·'}
function renderApplySteps(applyJob){
  const box=document.getElementById('applyProgress');
  if(!applyJob||!applyJob.steps)return;
  box.innerHTML=applyJob.steps.map(s=>{
    const cls=s.status==='done'?'pass':s.status==='error'?'fail':s.status==='running'?'running':'';
    const detail=s.detail?' — '+escapeHtml(s.detail):'';
    return '<div class="'+cls+'">'+stepIcon(s.status)+' '+escapeHtml(s.label)+detail+'</div>';
  }).join('');
}
function renderApplyLogs(applyJob){
  const wrap=document.getElementById('applyConsoleWrap');
  const consoleBox=document.getElementById('applyConsole');
  const countEl=document.getElementById('logCount');
  if(!wrap||!consoleBox)return;
  const logs=applyJob&&Array.isArray(applyJob.logs)?applyJob.logs:[];
  if(logs.length>0){
    wrap.classList.remove('hidden');
    consoleBox.textContent=logs.join('\\n');
    consoleBox.scrollTop=consoleBox.scrollHeight;
    if(countEl)countEl.textContent=logs.length+' satır';
  }
}
function safeHref(url){
  const str=String(url||'').trim();
  return /^https?:\\/\\//i.test(str)?escapeHtml(str):'#';
}
function finishApplySuccess(applyJob){
  const doneBox=document.getElementById('doneBox');
  const list=document.getElementById('nextSteps');
  const summary=(applyJob.summary||[]);
  const isLocal=(applyJob.mode==='localhost')||/localhost|127\\.0\\.0\\.1/i.test(applyJob.publicUrl||'');
  let loginUrl=applyJob.loginUrl||applyJob.publicUrl||('http://127.0.0.1:'+(wizard.elements.namedItem('port')?.value||5000));
  const publicUrl=applyJob.publicUrl||'';
  const escapedLogin=escapeHtml(loginUrl);
  const escapedHref=safeHref(loginUrl);
  const escapedPublic=escapeHtml(publicUrl);
  result.textContent=(applyJob.message||'Kurulum tamamlandı.')+(summary.length?'\\n\\n'+summary.join('\\n'):'');
  result.className='ok';
  list.innerHTML=[
    isLocal
      ? 'Aşağıdaki <strong>Uygulamayı başlat</strong> ile geliştirme sunucusu arka planda açılır (terminal penceresi açılmaz).'
      : 'Aşağıdaki <strong>Uygulamayı başlat</strong> ile uygulama servisi ayağa kaldırılır.',
    isLocal
      ? 'Tarayıcıdan giriş: <a href="'+escapedHref+'" id="loginLink">'+escapedLogin+'</a>'
      : 'Nginx + DNS: <code>setup-artifacts/nginx.conf.example</code> — sonra giriş: <a href="'+escapedHref+'" id="loginLink">'+escapedLogin+'</a>',
    isLocal?'Reverse proxy gerekmez.':'Uygulama yalnızca doğru domain/proxy ile açılır.',
    'Gizli değerler yalnız <code>.env</code> içindedir; Git’e eklemeyin.',
    publicUrl?'Yapılandırılan adres: <code>'+escapedPublic+'</code>':'',
  ].filter(Boolean).map(x=>'<li>'+x+'</li>').join('');
  doneBox.classList.remove('hidden');
  const goLogin=document.getElementById('goLogin');
  const goApp=document.getElementById('goApp');
  const note=document.getElementById('redirectNote');
  const startBtn=document.getElementById('startApp');
  const openLogin=(url)=>{
    note.textContent='Giriş sayfası açılıyor…';
    location.href=url||loginUrl;
  };
  if(applyJob.isDesktop&&!EMBEDDED){
    // Masaüstü (Electron/Tauri): port/adres yok; uygulama ayrı bir pencerede açılır, durum süreçten okunur.
    list.innerHTML=[
      'Aşağıdaki <strong>Masaüstü uygulamasını başlat</strong> düğmesi uygulamayı ayrı bir pencerede açar; tarayıcı adresi yoktur.',
      'Gizli değerler yalnız <code>.env</code> içindedir; Git’e eklemeyin.',
    ].map(x=>'<li>'+x+'</li>').join('');
    if(goApp){goApp.hidden=true;goApp.classList.add('hidden')}
    if(goLogin){goLogin.textContent='Uygulama durumunu denetle'}
    const checkDesktop=async()=>{
      const {data}=await fetchJson(API+'/app-health');
      note.textContent=(data&&data.hint)||'Durum okunamadı.';
      return Boolean(data&&data.reachable);
    };
    if(goLogin)goLogin.onclick=async()=>{goLogin.disabled=true;try{await checkDesktop()}catch(err){note.textContent=err.message||'Denetim başarısız.'}goLogin.disabled=false};
    if(startBtn){
      startBtn.hidden=false;
      startBtn.classList.remove('hidden');
      startBtn.disabled=false;
      startBtn.textContent='Masaüstü uygulamasını başlat';
      startBtn.onclick=async()=>{
        startBtn.disabled=true;
        note.textContent='Masaüstü uygulaması başlatılıyor…';
        try{
          const {data}=await fetchJson(API+'/start-app',{
            method:'POST',
            headers:{'content-type':'application/json','x-setup-csrf':window.__SETUP__.csrfToken},
            body:JSON.stringify({mode:'desktop'}),
          });
          note.textContent=(data&&data.message)||'Başlatma isteği gönderildi.';
          if(data&&data.reachable){startBtn.textContent='Masaüstü uygulaması çalışıyor';return}
        }catch(err){
          note.textContent=err.message||'Uygulama başlatılamadı.';
        }
        startBtn.disabled=false;
      };
    }
    note.textContent='Kurulum tamam. Masaüstü uygulamasını başlatabilirsiniz.';
    return;
  }
  if(EMBEDDED){
    // Gömülü kurulum: uygulama zaten bu sunucudur; ayrı başlatma/sağlık uçları yoktur.
    if(startBtn){startBtn.hidden=true;startBtn.classList.add("hidden")}
    if(goLogin)goLogin.onclick=()=>openLogin(loginUrl);
    if(goApp)goApp.onclick=()=>{note.textContent="Adres açılıyor…";location.href=publicUrl||loginUrl};
    note.textContent="Kurulum tamam. Uygulama bu sunucu üzerinde hazır; devam etmek için düğmeyi kullanın.";
    return;
  }
  if(startBtn){
    startBtn.hidden=false;
    startBtn.classList.remove('hidden');
    startBtn.disabled=false;
    startBtn.textContent=isLocal?'Uygulamayı başlat (dev)':'Uygulamayı başlat';
    startBtn.onclick=async()=>{
      startBtn.disabled=true;
      startBtn.textContent='Başlatılıyor…';
      note.classList.remove('error');
      note.textContent=isLocal
        ? 'Geliştirme sunucusu arka planda başlatılıyor; terminal penceresi açılmaz…'
        : 'Uygulama servisi başlatılıyor…';
      try{
        const {ok,status,data}=await fetchJson(API+'/start-app',{
          method:'POST',
          headers:{'content-type':'application/json','x-setup-csrf':window.__SETUP__.csrfToken},
          body:JSON.stringify(isLocal?{mode:'dev'}:{mode:'production'}),
        });
        if(!ok||status===409){
          throw new Error((data&&data.message)||'Uygulama başlatılamadı.');
        }
        const url=(data&&data.loginUrl)||loginUrl;
        if(data&&data.reachable){
          note.textContent='Uygulama ayakta. Giriş sayfasına gidiliyor…';
          setTimeout(()=>openLogin(url),800);
          return;
        }
        note.textContent=(data&&data.message)||'Başlatıldı; port bekleniyor…';
        await watchAppHealth(url,note,isLocal);
      }catch(err){
        note.textContent=err.message||'Uygulama başlatılamadı.';
        note.classList.add('error');
        startBtn.disabled=false;
        startBtn.textContent=isLocal?'Uygulamayı başlat (dev)':'Uygulamayı başlat';
      }
    };
  }
  if(goLogin)goLogin.onclick=async()=>{
    goLogin.disabled=true;
    note.textContent='Uygulama denetleniyor…';
    try{
      const {data}=await fetchJson(API+'/app-health');
      if(data&&data.reachable){
        openLogin(data.loginUrl||loginUrl);
        return;
      }
      note.textContent=(data&&data.hint)||'Uygulama ayakta değil. “Uygulamayı başlat” ile devam edin.';
      if(startBtn){
        startBtn.hidden=false;
        startBtn.classList.remove('hidden');
      }
    }catch(err){
      note.textContent=err.message||'Denetim başarısız.';
    }
    goLogin.disabled=false;
  };
  if(goApp)goApp.onclick=()=>{
    note.textContent='Adres açılıyor…';
    const lp=applyJob.loginPath||'';location.href=isLocal?((lp&&loginUrl.endsWith(lp))?loginUrl.slice(0,-lp.length):loginUrl):(publicUrl||loginUrl);
  };
  note.textContent=isLocal
    ? 'Kurulum tamam. “Uygulamayı başlat (dev)” ile uygulamayı arka planda açın; ardından giriş yapılabilir.'
    : 'Kurulum tamam. Nginx/DNS hazır değilse “sayfaya ulaşılamıyor” alırsınız. Önce servisi başlatın, sonra domain’i açın.';
}
async function watchAppHealth(loginUrl,note,isLocal){
  for(let i=0;i<30;i++){
    try{
      const {data}=await fetchJson(API+'/app-health');
      if(data&&data.reachable){
        note.textContent='Uygulama ayakta. Giriş sayfasına yönlendiriliyorsunuz…';
        setTimeout(()=>{location.href=loginUrl},1200);
        return;
      }
    }catch{/* yoksay */}
    await new Promise(r=>setTimeout(r,2000));
  }
}
async function pollApplyProgress(){
  let failures=0;
  for(let i=0;i<240;i++){
    try{
      const {ok,status,data:s}=await fetchJson(API+'/status');
      if(!ok&&status===429){
        failures+=1;
        if(failures>8)throw new Error('Sunucu istek limiti aşıldı. Birkaç dakika sonra tekrar deneyin.');
        await new Promise(r=>setTimeout(r,1500));
        continue;
      }
      const job=(s&&s.apply)||{status:'idle'};
      renderApplySteps(job);
      renderApplyLogs(job);
      failures=0;
      if(job.status==='success'){finishApplySuccess(job);return}
      if(job.status==='error')throw new Error(job.message||'Kurulum tamamlanamadı.');
      result.textContent=job.message||'Kurulum uygulanıyor; pencereyi kapatmayın…';
    }catch(err){
      failures+=1;
      if(failures>8)throw err;
      await new Promise(r=>setTimeout(r,1500));
      continue;
    }
    await new Promise(r=>setTimeout(r,1200));
  }
  throw new Error('Kurulum zaman aşımına uğradı. Sunucu loglarını kontrol edin.');
}
</script></body></html>`;
}
