#!/usr/bin/env sh
set -u

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# setup paketinin kökü (bin/ içinden veya doğrudan kökten çalıştırılabilir)
if [ -f "$SCRIPT_DIR/bin/setup.mjs" ]; then
  SETUP_ROOT="$SCRIPT_DIR"
else
  SETUP_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
fi

# Hedef proje: SETUP_PROJECT_ROOT, yoksa betiğin çağrıldığı dizin (eklentinin kendi dizini değil)
PROJECT_ROOT="${SETUP_PROJECT_ROOT:-$(pwd)}"
cd "$PROJECT_ROOT" || exit 1

printf '\n%s\n' '============================================================'
printf '%s\n' '  setup v1.0 — Otomatik Kurulum Ön Kontrolü'
printf '%s\n' '============================================================'
printf 'Proje dizini: %s\n\n' "$PROJECT_ROOT"

# package.json zorunlu değildir (Python, Go, .NET, Rust ve statik projeler); varsa geçerli JSON olmalı
HAS_PACKAGE_JSON=0
[ -f package.json ] && HAS_PACKAGE_JSON=1

JS_RUNNER="node"
has_error=0
if command -v node >/dev/null 2>&1; then
  if [ "$HAS_PACKAGE_JSON" -eq 1 ] && ! node -e 'JSON.parse(require("fs").readFileSync("package.json","utf8"))' >/dev/null 2>&1; then
    printf '%s\n' '[HATA] package.json geçerli bir JSON dosyası değil.' >&2
    exit 1
  fi
  node_version=$(node -p 'process.versions.node' 2>/dev/null || true)
  node_major=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || true)
  case "$node_major" in
    18|20|22|24) printf '[TAMAM] Node.js %s\n' "$node_version" ;;
    *)
      if command -v bun >/dev/null 2>&1; then
        bun_version=$(bun --version 2>/dev/null || true)
        printf '[UYARI] Node.js %s (18/20/22/24 LTS önerilir). Sistemde Bun %s mevcut.\n' "$node_version" "$bun_version"
      else
        printf '[UYUMSUZ] Node.js %s bulundu. Node.js 18, 20, 22 veya 24 LTS gereklidir.\n' "$node_version"
        has_error=1
      fi
      ;;
  esac
elif command -v bun >/dev/null 2>&1; then
  bun_version=$(bun --version 2>/dev/null || true)
  printf '[TAMAM] Bun %s (Node.js yerine Bun çalışma ortamı kullanılacak)\n' "$bun_version"
  JS_RUNNER="bun"
else
  printf '%s\n' '[EKSİK] Node.js veya Bun bulunamadı.'
  has_error=1
fi

PM_NAME="npm"
if [ -f "pnpm-lock.yaml" ] || [ -f "pnpm-workspace.yaml" ]; then
  PM_NAME="pnpm"
elif [ -f "yarn.lock" ]; then
  PM_NAME="yarn"
elif [ -f "bun.lockb" ] || [ -f "bun.lock" ]; then
  PM_NAME="bun"
fi

if [ "$HAS_PACKAGE_JSON" -eq 0 ]; then
  printf '%s\n' '[ATLANDI] package.json yok; Node paket yöneticisi denetimi gerekmiyor.'
elif command -v "$PM_NAME" >/dev/null 2>&1; then
  pm_version=$("$PM_NAME" --version 2>/dev/null || true)
  printf '[TAMAM] %s %s\n' "$PM_NAME" "$pm_version"
elif command -v npm >/dev/null 2>&1; then
  npm_version=$(npm --version 2>/dev/null || true)
  printf '[TAMAM] npm %s (varsayılan paket yöneticisi)\n' "$npm_version"
  PM_NAME="npm"
elif command -v bun >/dev/null 2>&1; then
  bun_version=$(bun --version 2>/dev/null || true)
  printf '[TAMAM] bun %s (!PM_NAME! / npm bulunamadı, bun kullanılacak)\n' "$bun_version"
  PM_NAME="bun"
else
  printf '[EKSİK] Paket yöneticisi (%s / npm / bun) bulunamadı.\n' "$PM_NAME"
  has_error=1
fi

if [ "$has_error" -ne 0 ]; then
  cat <<'EOF'

Kurulması veya düzeltilmesi gereken bileşenler var.

Node.js LTS: https://nodejs.org/en/download
Bun:         https://bun.sh

Proxy, DNS veya sistem PATH ayarları bu betik tarafından değiştirilmez.
Kurulumlardan sonra yeni bir terminal açıp ./bin/kurulum.sh komutunu tekrar çalıştırın.
EOF
  exit 1
fi

CHECK_PORT="${SETUP_BOOTSTRAP_PORT:-5049}"
WIZARD_PORT="${SETUP_WIZARD_PORT:-5050}"
HOLDER_PID=""
if HOLDER_PID=$("$JS_RUNNER" "$SETUP_ROOT/scripts/find-port-holder.mjs" "$CHECK_PORT" 2>/dev/null); then
  :
else
  HOLDER_PID=""
fi

if [ -n "$HOLDER_PID" ]; then
  cat <<EOF

[UYARI] Kurulum başlangıç portu zaten kullanımda: 127.0.0.1:$CHECK_PORT

Portu tutan süreç: PID $HOLDER_PID

Yapılması gerekenler:
  1. Hâlâ açık bir kurulum penceresi varsa onu kullanın veya kapatın.
  2. Kalan kurulum sürecini durdurun: kill $HOLDER_PID
  3. ./bin/kurulum.sh dosyasını yeniden çalıştırın.

Not: Kurulum verileri bu uyarı nedeniyle değiştirilmez.
EOF
  printf '%s' "Kalan kurulum süreci şimdi durdurulsun mu? [E/H]: "
  read -r answer || answer="H"
  case "$answer" in
    [EeYy]*)
      kill "$HOLDER_PID" 2>/dev/null || true
      sleep 1
      ;;
    *)
      echo "Kurulum iptal edildi; mevcut dosya ve veriler değiştirilmedi."
      exit 1
      ;;
  esac
fi

WIZARD_HOLDER=""
if WIZARD_HOLDER=$("$JS_RUNNER" "$SETUP_ROOT/scripts/find-port-holder.mjs" "$WIZARD_PORT" 2>/dev/null); then
  :
else
  WIZARD_HOLDER=""
fi

if [ -n "$WIZARD_HOLDER" ]; then
  cat <<EOF

[UYARI] Sihirbaz portu zaten kullanımda: 127.0.0.1:$WIZARD_PORT
Portu tutan süreç: PID $WIZARD_HOLDER
EOF
  printf '%s' "Sihirbaz portunu tutan süreç şimdi durdurulsun mu? [E/H]: "
  read -r answer || answer="H"
  case "$answer" in
    [EeYy]*)
      kill "$WIZARD_HOLDER" 2>/dev/null || true
      sleep 1
      ;;
    *)
      echo "Devam edildi; sihirbaza geçince yeniden uyarılırsınız."
      ;;
  esac
fi

printf '\n%s\n\n' '[TAMAM] Gerekli çalışma ortamı hazır. Web kurulum başlangıcı açılıyor...'
printf '%s\n' 'Bu terminali sihirbaz bitene kadar KAPATMAYIN; sihirbaz bu sürecin altındadır.'
printf '%s\n' 'Portlar: başlatıcı '"$CHECK_PORT"' · sihirbaz '"$WIZARD_PORT"
printf '\n'
export SETUP_PROJECT_ROOT="$PROJECT_ROOT"
# setup.mjs: proje algılama + setup.config.json otomatik oluşturma + başlatıcı
"$JS_RUNNER" "$SETUP_ROOT/bin/setup.mjs" --root "$PROJECT_ROOT" "$@"
setup_exit=$?
if [ "$setup_exit" -ne 0 ]; then
  cat <<EOF

[HATA] Kurulum başlangıcı $setup_exit koduyla kapandı.
Kurulum verileri bu hata nedeniyle değiştirilmez.
EOF
  exit "$setup_exit"
fi
exit 0
