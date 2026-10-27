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
:root{color-scheme:light;--p:#5138ee;--bg:#f4f6fb;--card:#fff;--line:#dbe1ec;--muted:#64748b;--danger:#b91c1c;--ok:#047857;--run:#2563eb;--tip:#0f172a}*{box-sizing:border-box}body{margin:0;background:var(--bg);font:15px/1.5 system-ui;color:#111827}.wrap{max-width:980px;margin:32px auto;padding:0 16px}.hero,.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:24px;margin-bottom:16px;box-shadow:0 8px 24px #1725540d}.hero h1{margin:0}.muted{color:var(--muted)}.steps{display:none}.step{padding:10px;border:1px solid var(--line);border-radius:10px;text-align:center;font-size:12px}.step.on{background:var(--p);color:#fff}.pane{display:block;padding:18px 0;border-bottom:1px solid var(--line)}.pane:first-of-type{padding-top:0}.pane:last-of-type{border-bottom:0;padding-bottom:0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.full{grid-column:1/-1}label{display:block;font-weight:650;margin:8px 0 5px}input,select{width:100%;padding:11px;border:1px solid #cbd5e1;border-radius:9px;background:#fff}input[type=checkbox]{width:auto}.actions{display:flex;justify-content:flex-end;gap:10px;margin-top:22px}button{border:0;border-radius:9px;padding:11px 17px;font-weight:770;cursor:pointer}button.primary{background:var(--p);color:#fff}button.secondary{background:#e8ecf5}button:disabled{opacity:.55}.check{padding:8px 10px;border-bottom:1px solid var(--line);font-size:14px}pre{white-space:pre-wrap;background:#0f172a;color:#e2e8f0;padding:15px;border-radius:10px;max-height:320px;overflow:auto}.warn{padding:12px;background:#fff7ed;border:1px solid #fed7aa;border-radius:10px}.error{color:var(--danger);font-weight:650}.ok{color:var(--ok);font-weight:650}.pwd-wrap{position:relative;display:flex;align-items:center;gap:8px}.pwd-wrap input{flex:1;padding-right:44px}.pwd-toggle{position:absolute;right:8px;border:0;background:transparent;cursor:pointer;font-size:18px;line-height:1;padding:6px;border-radius:8px;color:var(--muted)}.pwd-toggle:hover{background:#eef2ff;color:var(--p)}.pwd-rules{margin:10px 0 0;padding:12px;border:1px solid var(--line);border-radius:10px;background:#f8fafc}.pwd-rules div{padding:3px 0;font-size:14px}.pwd-rules .pass{color:var(--ok);font-weight:650}.pwd-rules .fail{color:var(--danger);font-weight:650}.pwd-rules .running{color:var(--run);font-weight:650}
.mod-badge{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:8px;background:#eef2ff;border:1px solid #c7d2fe;color:#1e1b4b;font-size:12px;font-weight:600;margin:4px 6px 0 0}
details.opt-box{margin-top:12px;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:#f8fafc}
details.opt-box>summary{cursor:pointer;font-weight:650;font-size:14px;color:#1e293b;user-select:none}
.lbl-row{display:flex;align-items:center;gap:6px;margin:8px 0 5px;flex-wrap:wrap}.lbl-row label{margin:0;font-weight:650}.help{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;border:1px solid #c7d2fe;background:#eef2ff;color:var(--p);font-size:11px;font-weight:700;cursor:help;position:relative;line-height:1}.help:hover,.help:focus{background:var(--p);color:#fff;outline:none}.help::after{content:attr(data-tip);position:absolute;left:50%;top:24px;transform:translateX(-50%);width:min(280px,70vw);padding:10px 12px;background:var(--tip);color:#fff;border-radius:8px;font-size:12px;font-weight:400;line-height:1.45;opacity:0;pointer-events:none;transition:opacity .12s;z-index:30;text-align:left;white-space:normal}.help:hover::after,.help:focus::after{opacity:1}.tip-note{margin:6px 0 0;font-size:12px;color:var(--muted)}
.input-error{border-color:var(--danger)!important;background:#fef2f2!important}
.field-error-msg{color:var(--danger);font-size:12px;margin-top:4px;font-weight:600}
.offline-banner{position:sticky;top:0;left:0;right:0;background:#dc2626;color:#fff;text-align:center;padding:10px 16px;font-weight:650;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:center;gap:12px}
.offline-banner.hidden{display:none!important}
@media(max-width:700px){.grid,.steps{grid-template-columns:1fr}.steps{display:flex;overflow:auto}.step{min-width:120px}}
</style></head><body>
<div id="offlineBanner" class="offline-banner hidden"><span>⚠️ Sunucu bağlantısı koptu. Yeniden bağlanılıyor…</span><button type="button" id="btnReconnect" class="secondary" style="padding:4px 12px;font-size:12px;border:0;border-radius:6px;cursor:pointer">Tekrar Dene</button></div>
<main class="wrap">
<section class="hero"><h1>${pageTitle}</h1><p class="muted">Hedef GitHub projesinin çalışma zamanı gereksinimlerini doğrular, port ve ortam değişkenlerini (<code>.env</code>) hazırlar ve uygulamayı tek tıkla başlatır.</p><div id="scenarioInfo" class="warn" style="margin-top:10px">Hedef proje mimarisi algılanıyor…</div></section>
<div class="steps"><div class="step on">1. Proje Özeti</div><div class="step">2. Port &amp; Ortam</div><div class="step">3. Veritabanı</div><div class="step">4. İsteğe Bağlı</div><div class="step">5. Başlat</div></div>
<form id="wizard" class="card">
<section class="pane on">
  <h2>1. Hedef Proje ve Sistem Hazırlık Özeti <span class="help" tabindex="0" data-tip="Hedef projenin gereksinim duyduğu çalışma zamanı, dizin yazma izinleri ve algılanan alt modüller burada listelenir.">?</span></h2>
  <div id="checks">Kontrol ediliyor…</div>
</section>
<section class="pane">
  <h2>2. Hedef Proje Portları ve Ortam Değişkenleri (<code>.env</code>) <span class="help" tabindex="0" data-tip="Hedef uygulamanın çalışacağı yerel portları ve projede tanımlı .env.example değişkenlerini buradan düzenleyebilirsiniz. Varsayılan değerler otomatik doldurulmuştur.">?</span></h2>
  <div class="grid">
    <div>
      <div class="lbl-row"><label for="port" id="lblPort">Uygulama / Backend Portu</label><span class="help" tabindex="0" data-tip="Hedef sunucunun dinleyeceği TCP portu.">?</span></div>
      <input name="port" id="port" type="number" min="1024" max="65535" value="5000" required>
    </div>
    <div id="frontendPortGroup" class="hidden">
      <div class="lbl-row"><label for="frontendPort">Frontend (Arayüz) Portu</label><span class="help" tabindex="0" data-tip="Frontend arayüz veya Vite/Nuxt sunucusunun dinleyeceği TCP portu.">?</span></div>
      <input name="frontendPort" id="frontendPort" type="number" min="1024" max="65535" value="3000">
    </div>
    <div class="full">
      <div class="lbl-row"><label for="publicUrl">Uygulama Erişim Adresi</label><span class="help" tabindex="0" data-tip="Uygulamanın açılacağı yerel veya genel adres.">?</span></div>
      <input name="publicUrl" id="publicUrl" type="url" required placeholder="http://localhost:5000">
      <p class="tip-note" id="modeNote">Yerel çalışma modu: reverse proxy veya ek ağ ayarı gerekmez.</p>
    </div>
    <div id="customEnvSection" class="full hidden" style="margin-top:6px;padding:14px;border:1px solid var(--line);border-radius:12px;background:#f8fafc">
      <h3 style="margin:0 0 6px;font-size:15px">Hedef Proje Ortam Değişkenleri (<code>.env.example</code>)</h3>
      <p class="tip-note" style="margin:0 0 10px">Hedef repoda bulunan özel değişkenler ve varsayılan değerleri aşağıda hazır olarak listelenmiştir:</p>
      <div id="customEnvFields" class="grid"></div>
    </div>
    <details class="opt-box full">
      <summary>⚙️ Gelişmiş Yayın, Ağ ve Reverse Proxy Ayarları (Yerel kullanımda değiştirmenize gerek yoktur)</summary>
      <div class="grid" style="margin-top:12px">
        <div>
          <div class="lbl-row"><label for="mode">Çalışma / Yayın Biçimi</label><span class="help" tabindex="0" data-tip="Yerel: yalnız bu bilgisayarda çalıştırma (http://localhost). Subdomain: https://uygulama.kurum.com. Alt yol: https://kurum.com/app gibi.">?</span></div>
          <select name="mode" id="mode">
            <option value="localhost">Yerel / localhost (Varsayılan)</option>
            <option value="subdomain">Subdomain (Üretim / Alan Adı)</option>
            <option value="subpath">Kurum sitesi altında alt yol</option>
          </select>
        </div>
        <div>
          <div class="lbl-row"><label for="host">Dinlenecek Ağ Arayüzü (Host)</label><span class="help" tabindex="0" data-tip="127.0.0.1: yalnız bu bilgisayar. 0.0.0.0: yerel ağdaki diğer cihazlar da erişebilir.">?</span></div>
          <select name="host" id="host">
            <option value="127.0.0.1">127.0.0.1 (Yalnız bu bilgisayar)</option>
            <option value="0.0.0.0">0.0.0.0 (Ağdan erişim)</option>
          </select>
        </div>
        <div>
          <div class="lbl-row"><label for="basePath">Alt Yol (Base Path)</label><span class="help" tabindex="0" data-tip="Uygulamanın kök altındaki yolu. Yerel kullanımda / kalır.">?</span></div>
          <input name="basePath" id="basePath" value="/" required>
        </div>
        <div>
          <div class="lbl-row"><label for="proxy">Güvenilir Proxy Sayısı</label><span class="help" tabindex="0" data-tip="Önünüzdeki reverse proxy (Nginx/IIS) sayısı. Yerelde 0.">?</span></div>
          <input name="proxy" id="proxy" type="number" min="0" max="5" value="0">
        </div>
        <div class="full">
          <div class="lbl-row"><label for="origins">İzinli CORS Origin Adresleri</label><span class="help" tabindex="0" data-tip="Tarayıcıdan hangi adreslerden API isteği atılabileceğini belirler.">?</span></div>
          <input name="origins" id="origins" required placeholder="http://localhost:5000">
        </div>
      </div>
    </details>
  </div>
</section>
<section class="pane" id="dbPaneSection">
  <h2>3. Veritabanı ve Veri Hazırlığı <span class="help" tabindex="0" data-tip="Hedef proje veritabanı kullanıyorsa bağlantı türünü seçebilirsiniz. Yerel SQLite varsayılan olarak hazırdır.">?</span></h2>
  <div class="grid" style="margin-bottom:8px">
    <div class="full">
      <div class="lbl-row">
        <label for="dbProvider">Veritabanı Sağlayıcısı</label>
        <span class="help" tabindex="0" data-tip="Yerel çalıştırma için SQLite varsayılan olarak seçilidir ve ek kurulum gerektirmez.">?</span>
      </div>
      <select name="dbProvider" id="dbProvider">
        <option value="sqlite">SQLite / Yerel Proje Veritabanı (Ek kurulum gerekmez — Önerilen)</option>
        <option value="postgres">PostgreSQL</option>
        <option value="mysql">MySQL / MariaDB</option>
        <option value="custom">Özel Bağlantı Dizesi (Connection String)</option>
      </select>
    </div>
    <div id="dbSqliteWrap" class="full">
      <div class="tip-note" style="margin:0;padding:10px 12px;background:#f8fafc;border:1px solid var(--line);border-radius:10px">
        <strong>✓ Yerel Veritabanı Hazır:</strong> Hedef projenin kendi yerel veritabanı veya SQLite dosyası otomatik kullanılır; harici veritabanı sunucusu kurmanıza gerek yoktur.
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
  <div class="hidden" aria-hidden="true">
    <input name="retention" type="checkbox">
    <input name="actionDays" id="actionDays" type="number" min="30" value="365">
    <input name="notificationDays" id="notificationDays" type="number" min="7" value="180">
    <input name="emailDays" id="emailDays" type="number" min="7" value="90">
    <input name="passwordDays" id="passwordDays" type="number" min="7" value="90">
  </div>
  <details class="opt-box" id="optionalAdminDetails">
    <summary>👤 İsteğe Bağlı: Başlangıç Yöneticisi (Seed / Admin) ve SMTP E-posta Ayarları (Boş bırakılabilir)</summary>
    <div style="margin-top:12px">
      <div id="adminOptionalNote" class="warn" style="margin-bottom:12px">Bu alanlar isteğe bağlıdır. Hedef projeyi varsayılan kullanıcı/seed ayarlarıyla başlatmak için boş bırakabilirsiniz.</div>
      <div class="grid">
        <div>
          <div class="lbl-row"><label for="adminName">Yönetici adı</label><span class="help" tabindex="0" data-tip="İsteğe bağlı başlangıç yöneticisi adı.">?</span></div>
          <input name="adminName" id="adminName" maxlength="100" placeholder="İsteğe bağlı">
        </div>
        <div>
          <div class="lbl-row"><label for="adminEmail">Yönetici e-postası</label><span class="help" tabindex="0" data-tip="İsteğe bağlı başlangıç yöneticisi e-postası.">?</span></div>
          <input name="adminEmail" id="adminEmail" type="email" placeholder="admin@ornek.com">
        </div>
        <div class="full">
          <div class="lbl-row"><label for="adminPassword">Yönetici parolası</label><span class="help" tabindex="0" data-tip="Girilirse en az 12 karakter; büyük/küçük harf ve rakam içermelidir.">?</span></div>
          <div class="pwd-wrap">
            <input name="adminPassword" id="adminPassword" type="password" autocomplete="new-password" maxlength="128" spellcheck="false" placeholder="Boş bırakılırsa varsayılan proje ayarları kullanılır">
            <button type="button" class="pwd-toggle" data-pwd="adminPassword" aria-label="Parolayı göster/gizle" title="Parolayı göster/gizle">👁️</button>
          </div>
          <div class="pwd-rules hidden" id="pwdRules" aria-live="polite"></div>
          <div id="adminSeedNotice" class="tip-note" style="margin-top:10px;padding:10px 12px;background:#fff;border:1px solid var(--line);border-radius:10px;line-height:1.5">
            <strong>ℹ️ Hesap Saklama Modeli:</strong> Doldurulursa yönetici bilgileri <code>.env</code> ve varsa projenin seed betiğine aktarılır.
          </div>
        </div>
        <div class="full">
          <div class="lbl-row"><label><input name="emailEnabled" id="emailEnabled" type="checkbox"> E-posta bildirimlerini (SMTP) etkinleştir</label></div>
        </div>
        <div id="emailFields" class="grid full hidden" style="gap:14px;padding:14px;border:1px solid var(--line);border-radius:12px;background:#fff;margin-top:6px">
          <div>
            <div class="lbl-row"><label for="emailProvider">E-posta Sağlayıcısı</label></div>
            <select name="emailProvider" id="emailProvider">
              <option value="gmail">Google Gmail (Uygulama Parolası)</option>
              <option value="custom">Kurumsal / Özel SMTP Sunucusu</option>
            </select>
          </div>
          <div id="customSmtpHostWrap" class="hidden">
            <div class="lbl-row"><label for="emailHost">SMTP Sunucu Adresi (Host)</label></div>
            <input name="emailHost" id="emailHost" placeholder="smtp.kurum.com">
          </div>
          <div id="customSmtpPortWrap" class="hidden">
            <div class="lbl-row"><label for="emailPort">SMTP Portu</label></div>
            <input name="emailPort" id="emailPort" type="number" min="1" max="65535" value="587">
          </div>
          <div>
            <div class="lbl-row"><label for="emailUser" id="lblEmailUser">Gmail hesabı</label></div>
            <input name="emailUser" id="emailUser" placeholder="hesap@gmail.com">
          </div>
          <div>
            <div class="lbl-row"><label for="fromEmail">Gönderen e-posta (From)</label></div>
            <input name="fromEmail" id="fromEmail" type="email" placeholder="hesap@gmail.com">
          </div>
          <div>
            <div class="lbl-row"><label for="emailPassword" id="lblEmailPassword">Gmail uygulama parolası</label></div>
            <div class="pwd-wrap">
              <input name="emailPassword" id="emailPassword" type="password" autocomplete="new-password" spellcheck="false">
              <button type="button" class="pwd-toggle" data-pwd="emailPassword" aria-label="Parolayı göster/gizle" title="Parolayı göster/gizle">👁️</button>
            </div>
          </div>
          <div>
            <div class="lbl-row"><label for="fromName">Gönderen adı</label></div>
            <input name="fromName" id="fromName" value="Sistem Bildirimi">
          </div>
          <div id="customSmtpSecureWrap" class="full hidden">
            <div class="lbl-row"><label><input name="emailSecure" id="emailSecure" type="checkbox"> Güvenli Bağlantı (SSL/TLS - Port 465)</label></div>
          </div>
          <div class="full" style="display:flex;align-items:center;gap:12px;margin-top:6px">
            <button type="button" class="secondary" id="btnTestEmail" style="padding:8px 14px;font-size:13px">✉️ SMTP Bağlantısını Sına</button>
            <span id="testEmailResult" style="font-size:12px"></span>
          </div>
        </div>
      </div>
    </div>
  </details>
</section>
<section class="pane">
  <h2>4. Kaydet, Hazırla ve Hedef Uygulamayı Başlat <span class="help" tabindex="0" data-tip="Tek tıkla .env dosyaları hedef projeye ve alt modüllere yazılır, varsa migration/derleme adımları çalıştırılır ve hedef uygulama başlatılarak tarayıcıda açılır.">?</span></h2>
  <div style="display:flex;flex-wrap:wrap;gap:18px;margin-bottom:10px">
    <div class="lbl-row"><label><input name="overwrite" type="checkbox" checked> Var olan <code>.env</code> dosyalarını yedekleyerek güncelle</label></div>
    <div class="lbl-row"><label><input name="buildClient" type="checkbox"> Başlatmadan önce üretim derlemesi (<code>build</code>) çalıştır</label><span class="help" tabindex="0" data-tip="Yerel geliştirme/çalıştırma (dev) modunda kapalı bırakmanız daha hızlı başlatma sağlar.">?</span></div>
    <div class="lbl-row hidden"><label><input name="confirm" type="checkbox" checked required> Onay</label></div>
  </div>
  <div id="applyProgress" class="pwd-rules hidden" aria-live="polite"></div>
  <div id="applyConsoleWrap" class="hidden" style="margin-top:12px;border:1px solid var(--line);border-radius:10px;overflow:hidden">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 12px;background:#1e293b;color:#f8fafc;font-size:12px">
      <span>💻 Canlı İşlem Günlüğü (Terminal)</span>
      <span id="logCount" style="color:var(--muted)">0 satır</span>
    </div>
    <pre id="applyConsole" style="margin:0;border-radius:0;max-height:200px;font-size:11px;line-height:1.45;background:#0f172a;color:#cbd5e1;overflow-y:auto"></pre>
  </div>
  <pre id="result">Hazır. Aşağıdaki düğmeye tıklayarak hedef uygulamayı yapılandırıp başlatabilirsiniz.</pre>
  <div id="doneBox" class="warn hidden">
    <h3 style="margin:0 0 8px">Hedef Uygulama Durumu ve Bağlantılar</h3>
    <ol id="nextSteps" style="margin:0;padding-left:18px;line-height:1.7"></ol>
    <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap">
      <button type="button" class="primary" id="startApp">Uygulamayı başlat</button>
      <button type="button" class="primary" id="goLogin">Giriş sayfasına git</button>
      <button type="button" class="secondary" id="goApp">Uygulamayı aç</button>
    </div>
    <p class="muted" id="redirectNote" style="margin:10px 0 0"></p>
  </div>
</section>
<div class="actions"><button type="button" class="secondary" id="prev" hidden disabled>Geri</button><button type="button" class="primary" id="next" hidden>İleri</button><button type="submit" class="primary" id="apply" style="width:100%;padding:14px 20px;font-size:16px">🚀 Ayarları Kaydet ve Hedef Uygulamayı Başlat</button></div></form></main>
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
function fieldError(input,message){
  if(!input)return;
  input.setCustomValidity(message||'');
  let errBox=input.parentNode?input.parentNode.querySelector('.field-error-msg'):null;
  if(message){
    input.classList.add('input-error');
    if(!errBox&&input.parentNode){
      errBox=document.createElement('div');
      errBox.className='field-error-msg';
      input.parentNode.appendChild(errBox);
    }
    if(errBox)errBox.textContent=message;
  }else{
    input.classList.remove('input-error');
    if(errBox)errBox.remove();
  }
}
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
window.__OPTIONAL_ADMIN__=true;
function show(n){page=n;panes.forEach((x,i)=>x.classList.toggle('on',i===n));steps.forEach((x,i)=>x.classList.toggle('on',i===n));prev.disabled=n===0;next.hidden=true;apply.hidden=false}
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
  adminPwd.addEventListener('input',()=>{
    const hasVal=Boolean(String(adminPwd.value||'').trim());
    if(pwdRules)pwdRules.classList.toggle('hidden',!hasVal);
    renderPasswordRules();
    fieldError(adminPwd,hasVal?adminPasswordError(adminPwd.value):'');
  });
  renderPasswordRules();
}
const API=(window.__SETUP__&&window.__SETUP__.apiBase)||'/api';
const EMBEDDED=Boolean(window.__SETUP__&&window.__SETUP__.embedded);
const offlineBanner=document.getElementById('offlineBanner');
const btnReconnect=document.getElementById('btnReconnect');
if(btnReconnect)btnReconnect.onclick=()=>location.reload();

async function fetchJson(url,options){
  try{
    const r=await fetch(url,options);
    if(offlineBanner)offlineBanner.classList.add('hidden');
    const text=await r.text();
    let data=null;
    try{data=text?JSON.parse(text):null}catch{
      const snippet=(text||'').slice(0,120);
      throw new Error(r.status===429?'Sunucu yoğun; kısa süre sonra yeniden denenecek. ('+r.status+')':'Sunucu geçerli JSON döndürmedi ('+r.status+'): '+snippet);
    }
    return {ok:r.ok,status:r.status,data};
  }catch(netErr){
    if(offlineBanner)offlineBanner.classList.remove('hidden');
    throw netErr;
  }
}
async function chooseCandidate(candDir){
  try{
    const {ok,status,data}=await fetchJson(API+'/select-candidate',{
      method:'POST',
      headers:{'Content-Type':'application/json','X-Setup-CSRF':getCsrfToken()},
      body:JSON.stringify({candidate:candDir})
    });
    if(!ok)throw new Error((data&&data.message)||('HTTP '+status));
    await loadStatus();
  }catch(e){
    alert('Aday proje seçilemedi: '+(e.message||e));
  }
}
window.chooseCandidate=chooseCandidate;

async function loadStatus(){
  checks.textContent='Kontrol ediliyor…';
  try{
    const {ok,status,data:s}=await fetchJson(API+'/status');
    if(!ok)throw new Error(s&&s.message?s.message:('Sunucu ön kontrolü başarısız ('+status+')'));
    const rows=Object.entries(s.checks).map(([k,v])=>{
      const label=CHECK_LABELS[k]||k;
      return '<div class="check '+(v?'ok':'error')+'">'+(v?'✓ ':'✕ ')+escapeHtml(label)+'</div>';
    }).join('');
    checks.innerHTML=rows+'<details class="opt-box" style="margin-top:10px"><summary>🔍 Algılanan Proje ve Sistem Detayları (Geliştirici JSON)</summary><pre style="margin-top:8px">'+escapeHtml(JSON.stringify(s.detected,null,2))+'</pre></details>';
    const sInfo=document.getElementById('scenarioInfo');
    if(sInfo&&s&&s.detected&&s.detected.scenario){
      const repoLabel=s.detected.repositoryName||s.detected.projectName||'Hedef Proje';
      const pkgLabel=(s.detected.projectName&&s.detected.projectName!==repoLabel)?' ('+s.detected.projectName+')':'';
      let text='<div><strong>🎯 Hedef Proje:</strong> '+escapeHtml(repoLabel+pkgLabel)+' &nbsp;|&nbsp; <strong>Mimari:</strong> Senaryo '+escapeHtml(s.detected.scenario.number)+' — '+escapeHtml(s.detected.scenario.label)+'</div><div class="tip-note" style="margin-top:4px">'+escapeHtml(s.detected.scenario.summary||'')+'</div>';
      if(s.detected.candidateRoot){
        text+='<div class="tip-note" style="margin-top:4px;color:var(--run)">📁 <strong>Hedef Alt Proje:</strong> '+escapeHtml(s.detected.candidateRoot)+'</div>';
      }
      if(Array.isArray(s.detected.subprojectList)&&s.detected.subprojectList.length>0){
        text+='<div style="margin-top:8px"><strong style="font-size:13px">Algılanan Proje Alt Modülleri:</strong><div>'+s.detected.subprojectList.map(sp=>'<span class="mod-badge">📦 '+escapeHtml(sp.dir)+(sp.name&&sp.name!==sp.dir?' ('+escapeHtml(sp.name)+')':'')+'</span>').join('')+'</div></div>';
      }else if(s.detected.subprojects){
        text+='<div class="tip-note" style="margin-top:4px;color:var(--run)">🔀 <strong>Çok Parçalı Mimari:</strong> Backend ('+escapeHtml(s.detected.subprojects.backend?.dir||'')+') + Frontend ('+escapeHtml(s.detected.subprojects.frontend?.dir||'')+')</div>';
      }
      if(s.detected.hasAmbiguity&&Array.isArray(s.detected.candidates)){
        text+='<div class="tip-note" style="margin-top:8px;padding:8px;background:var(--card);border:1px solid var(--border);border-radius:6px">';
        text+='<div style="font-weight:600;margin-bottom:6px;color:#d97706">⚠️ Bu repoda birden çok alt proje algılandı. Kurmak istediğiniz projeyi seçin:</div>';
        text+='<div style="display:flex;flex-wrap:wrap;gap:6px">';
        for(const c of s.detected.candidates){
          const isSelected = s.detected.candidateRoot === c.dir;
          text+='<button type="button" class="btn" style="font-size:11px;padding:3px 8px;cursor:pointer;background:'+(isSelected?'var(--run)':'transparent')+';color:'+(isSelected?'#fff':'var(--text)')+';border:1px solid '+(isSelected?'var(--run)':'var(--border)')+';" onclick="chooseCandidate(&quot;'+escapeHtml(c.dir)+'&quot;)">📁 '+escapeHtml(c.name)+' <span style="opacity:0.7">('+escapeHtml(c.dir)+')</span></button>';
        }
        text+='</div></div>';
      }
      sInfo.innerHTML=text;
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
      applyModeDefaults();const isDual=Boolean((s&&s.detected&&s.detected.subprojects&&s.detected.subprojects.backend&&s.detected.subprojects.frontend)||(s&&s.detected&&s.detected.routes&&s.detected.routes.devPort)||(s&&s.detected&&s.detected.scenario&&s.detected.scenario.number===3));if(isDual){const fGroup=document.getElementById('frontendPortGroup');if(fGroup)fGroup.classList.remove('hidden');const lblPort=document.getElementById('lblPort');if(lblPort)lblPort.textContent='Backend (API) Portu';const devPortVal=(s&&s.detected&&s.detected.routes&&s.detected.routes.devPort)||(Number(s&&s.detected&&s.detected.defaultPort||5000)+1);setVal('frontendPort',devPortVal);}
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

function highlightFormIssues(issues){
  if(!Array.isArray(issues))return;
  const pathMap={
    'admin.name':'adminName',
    'admin.email':'adminEmail',
    'admin.password':'adminPassword',
    'server.port':'port',
    'server.host':'host',
    'deployment.publicUrl':'publicUrl',
    'deployment.basePath':'basePath',
    'deployment.allowedOrigins':'origins',
    'database.host':'dbHost',
    'database.port':'dbPort',
    'database.url':'dbUrl',
    'email.host':'emailHost',
    'email.port':'emailPort',
    'email.user':'emailUser',
    'email.password':'emailPassword',
    'email.fromEmail':'fromEmail',
  };
  let firstEl=null;
  for(const issue of issues){
    const key=(issue.path||[]).join('.');
    const fieldName=pathMap[key]||key;
    const el=wizard.elements.namedItem(fieldName);
    if(el){
      fieldError(el,issue.message);
      if(!firstEl)firstEl=el;
    }
  }
  if(firstEl)firstEl.focus();
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
      const optAdm=document.getElementById('optionalAdminDetails');
      if(optAdm)optAdm.open=true;
      if(pwdRules)pwdRules.classList.remove('hidden');
      renderPasswordRules();pwd.focus();
      result.textContent='Yönetici parolası geçerli değil. Yönetici bölümündeki kırmızı maddeleri tamamlayın veya alanı boş bırakın.';
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
  const payload={deployment:{mode:f.get('mode'),publicUrl:f.get('publicUrl'),basePath:f.get('basePath'),allowedOrigins:String(f.get('origins')).split(',').map(x=>x.trim()).filter(Boolean),trustProxyHops:Number(f.get('proxy')),retention:{enabled:f.has('retention'),actionLogDays:Number(f.get('actionDays')),readNotificationDays:Number(f.get('notificationDays')),emailLogDays:Number(f.get('emailDays')),passwordResetDays:Number(f.get('passwordDays'))}},server:{host:f.get('host'),port:Number(f.get('port')),...(f.get('frontendPort')?{frontendPort:Number(f.get('frontendPort'))}:{})},admin:isOptionalEmptyAdmin?{name:'',email:'',password:''}:{name:f.get('adminName'),email:f.get('adminEmail'),password:f.get('adminPassword')},email:emailPayload,database:dbPayload,customEnv,buildClient:f.has('buildClient'),overwriteExistingEnv:f.has('overwrite')};
  try{
    const start=await fetchJson(API+'/apply',{method:'POST',headers:{'content-type':'application/json','x-setup-csrf':window.__SETUP__.csrfToken},body:JSON.stringify(payload)});
    const startData=start.data||{};
    if(start.status===400&&startData.issues){
      highlightFormIssues(startData.issues);
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
      ? 'Uygulama ilk açılan terminalin gözetiminde otomatik başlatılır; HTTP erişimi doğrulanana kadar bekleyin.'
      : 'Uygulama servisi otomatik başlatılır; günlükleri ilk açılan terminalden izleyebilirsiniz.',
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
  const showError=(err)=>{
    note.textContent=err.message||'Uygulama başlatılamadı.';
    note.classList.add('error');
    if(startBtn){startBtn.disabled=false;startBtn.textContent='Uygulamayı yeniden başlat / denetle'}
  };
  let navigating=false;
  const navigateWhenReady=async(event)=>{
    event?.preventDefault?.();
    if(navigating)return;
    navigating=true;
    try{
      const {ok,data}=await fetchJson(API+'/app-health');
      if(!ok||!data?.reachable)throw new Error(data?.hint||'Uygulama henüz erişime hazır değil. Terminal günlüğünü kontrol edin.');
      openLogin(data.loginUrl||loginUrl);
    }catch(err){showError(err)}finally{navigating=false}
  };
  if(goLogin)goLogin.onclick=navigateWhenReady;
  if(goApp)goApp.onclick=navigateWhenReady;
  const loginLink=document.getElementById('loginLink');
  if(loginLink){loginLink.href='#';loginLink.onclick=navigateWhenReady}
  let watching=false;
  const monitor=async()=>{
    if(watching)return;
    watching=true;
    try{await watchAppHealth(loginUrl,note,isLocal)}catch(err){showError(err)}finally{watching=false}
  };
  if(startBtn){
    startBtn.hidden=false;
    startBtn.classList.remove('hidden');
    startBtn.disabled=applyJob.application?.state==='starting';
    startBtn.textContent=startBtn.disabled?'Uygulama başlatılıyor…':'Uygulamayı yeniden başlat / denetle';
    startBtn.onclick=async()=>{
      startBtn.disabled=true;
      note.classList.remove('error');
      note.textContent='Uygulama başlatılıyor; HTTP erişimi denetleniyor…';
      try{
        const {ok,data}=await fetchJson(API+'/start-app',{
          method:'POST',
          headers:{'content-type':'application/json','x-setup-csrf':window.__SETUP__.csrfToken},
          body:JSON.stringify({mode:isLocal?'dev':'production'}),
        });
        if(!ok)throw new Error(data?.message||'Uygulama başlatılamadı.');
        await monitor();
      }catch(err){showError(err)}
    };
  }
  note.textContent=applyJob.application?.message||'Kurulum tamamlandı. Uygulama otomatik başlatılıyor; erişim doğrulaması bekleniyor…';
  if(applyJob.application?.state==='error')showError(new Error(note.textContent));
  else void monitor();
}
async function watchAppHealth(loginUrl,note,isLocal){
  for(let i=0;i<45;i++){
    const {ok,data}=await fetchJson(API+'/app-health');
    if(!ok)throw new Error(data?.message||'Uygulama erişim denetimi başarısız oldu. Yeniden deneyin.');
    if(data?.reachable){
      note.textContent='Uygulama HTTP üzerinden erişime hazır. Sayfa açılıyor…';
      location.href=data.loginUrl||loginUrl;
      return;
    }
    if(data?.application?.state==='error')throw new Error(data.application.message||data.hint||'Uygulama başlatılamadı.');
    note.textContent=data?.hint||'Uygulamanın HTTP erişimine hazır olması bekleniyor…';
    await new Promise(r=>setTimeout(r,2000));
  }
  throw new Error('Uygulama zamanında erişime hazır olmadı. Terminal günlüğünü kontrol edip yeniden deneyin.');
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
      if(failures>8){
        result.innerHTML='<span class="error">Sunucu bağlantısı koptu.</span> <button type="button" class="secondary" id="btnPollRetry" style="padding:4px 10px;margin-left:8px;font-size:12px;border:0;border-radius:6px;cursor:pointer">Yeniden Bağlan</button>';
        const bpr=document.getElementById('btnPollRetry');
        if(bpr)bpr.onclick=()=>pollApplyProgress();
        throw err;
      }
      await new Promise(r=>setTimeout(r,1500));
      continue;
    }
    await new Promise(r=>setTimeout(r,1200));
  }
  throw new Error('Kurulum zaman aşımına uğradı. Sunucu loglarını kontrol edin.');
}
</script></body></html>`;
}
