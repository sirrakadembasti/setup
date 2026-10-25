#!/usr/bin/env sh
set -u
LAUNCHER_MODE=package
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
PROJECT_ROOT=$(pwd)
[ "$LAUNCHER_MODE" = project ] && PROJECT_ROOT="$SCRIPT_DIR"
PROJECT_ROOT="${SETUP_PROJECT_ROOT:-$PROJECT_ROOT}"
cd "$PROJECT_ROOT" || exit 1
SETUP_PROJECT_ROOT=$(pwd)
export SETUP_PROJECT_ROOT

if command -v node >/dev/null 2>&1 && node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' >/dev/null 2>&1; then
  JS_RUNNER=node
elif command -v bun >/dev/null 2>&1 && bun --version >/dev/null 2>&1; then
  JS_RUNNER=bun
else
  printf '%s\n' '[HATA] Node.js 18 veya üstü ya da Bun gereklidir.' 'Node.js: https://nodejs.org/en/download - Bun: https://bun.sh' >&2
  exit 127
fi

if [ "$LAUNCHER_MODE" = package ]; then
  if [ -f "$SCRIPT_DIR/bin/setup.mjs" ]; then
    SETUP_ENTRY="$SCRIPT_DIR/bin/setup.mjs"
  else
    SETUP_ENTRY="$SCRIPT_DIR/../bin/setup.mjs"
  fi
  if [ -f "$SETUP_ENTRY" ]; then
    exec "$JS_RUNNER" "$SETUP_ENTRY" "$@"
  fi
elif [ -f "$SCRIPT_DIR/tools/setup/bin/setup.mjs" ]; then
  exec "$JS_RUNNER" "$SCRIPT_DIR/tools/setup/bin/setup.mjs" "$@"
elif [ -f "$SCRIPT_DIR/node_modules/setup/bin/setup.mjs" ]; then
  exec "$JS_RUNNER" "$SCRIPT_DIR/node_modules/setup/bin/setup.mjs" "$@"
elif [ "$JS_RUNNER" = node ] && command -v npx >/dev/null 2>&1; then
  exec npx --yes github:sirrakadembasti/setup "$@"
elif command -v bunx >/dev/null 2>&1; then
  exec bunx github:sirrakadembasti/setup "$@"
fi
printf '%s\n' '[HATA] Yerel setup bulunamadı. tools/setup kopyasını yenileyin veya npx/bunx kurun.' >&2
exit 127
