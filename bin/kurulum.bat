@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title setup v1.0 — Otomatik Kurulum Ön Kontrolü

set "INVOKE_DIR=%CD%"
set "SCRIPT_DIR=%~dp0"
rem setup paketinin kökü (bin içinden veya doğrudan kökten çalıştırılabilir)
if exist "%SCRIPT_DIR%bin\setup.mjs" (
  set "SETUP_ROOT=%SCRIPT_DIR%"
) else (
  for %%I in ("%SCRIPT_DIR%..") do set "SETUP_ROOT=%%~fI\"
)

rem Hedef proje: SETUP_PROJECT_ROOT, yoksa betiğin çağrıldığı dizin (eklentinin kendi dizini değil)
if defined SETUP_PROJECT_ROOT (
  set "PROJECT_ROOT=%SETUP_PROJECT_ROOT%"
) else (
  set "PROJECT_ROOT=%INVOKE_DIR%"
)

pushd "%PROJECT_ROOT%" >nul 2>&1
if errorlevel 1 (
  echo [HATA] Proje dizinine girilemedi: %PROJECT_ROOT%
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   setup v1.0 — Otomatik Kurulum Ön Kontrolü
echo ============================================================
echo Proje dizini: %PROJECT_ROOT%
echo.

rem package.json zorunlu değildir (Python, Go, .NET, Rust ve statik projeler)
set "HAS_PACKAGE_JSON=0"
if exist "package.json" set "HAS_PACKAGE_JSON=1"

set "HAS_ERROR=0"
set "NODE_VERSION="
set "NODE_MAJOR="
set "JS_RUNNER=node"
where node >nul 2>&1
if errorlevel 1 (
  where bun >nul 2>&1
  if not errorlevel 1 (
    for /f "delims=" %%V in ('bun --version 2^>nul') do set "BUN_VERSION=%%V"
    echo [TAMAM] Bun !BUN_VERSION! [Node.js yerine Bun calisma ortami kullanilacak]
    set "JS_RUNNER=bun"
  ) else (
    echo [EKSİK] Node.js veya Bun bulunamadı.
    set "HAS_ERROR=1"
  )
) else (
  for /f "delims=" %%V in ('node -p "process.versions.node" 2^>nul') do set "NODE_VERSION=%%V"
  for /f "delims=" %%M in ('node -p "process.versions.node.split('.')[0]" 2^>nul') do set "NODE_MAJOR=%%M"
  if "!NODE_MAJOR!"=="18" (
    echo [TAMAM] Node.js !NODE_VERSION!
  ) else if "!NODE_MAJOR!"=="20" (
    echo [TAMAM] Node.js !NODE_VERSION!
  ) else if "!NODE_MAJOR!"=="22" (
    echo [TAMAM] Node.js !NODE_VERSION!
  ) else if "!NODE_MAJOR!"=="24" (
    echo [TAMAM] Node.js !NODE_VERSION!
  ) else (
    where bun >nul 2>&1
    if not errorlevel 1 (
      for /f "delims=" %%V in ('bun --version 2^>nul') do set "BUN_VERSION=%%V"
      echo [UYARI] Node.js !NODE_VERSION! [18, 20, 22, 24 LTS onerilir]. Sistemde Bun !BUN_VERSION! mevcut.
    ) else (
      echo [UYUMSUZ] Node.js !NODE_VERSION! bulundu. Node.js 18, 20, 22 veya 24 LTS gereklidir.
      set "HAS_ERROR=1"
    )
  )
)

set "PM_NAME=npm"
if exist "pnpm-lock.yaml" (
  set "PM_NAME=pnpm"
) else if exist "pnpm-workspace.yaml" (
  set "PM_NAME=pnpm"
) else if exist "yarn.lock" (
  set "PM_NAME=yarn"
) else if exist "bun.lockb" (
  set "PM_NAME=bun"
) else if exist "bun.lock" (
  set "PM_NAME=bun"
)

if "%HAS_PACKAGE_JSON%"=="0" (
  echo [ATLANDI] package.json yok; Node paket yöneticisi denetimi gerekmiyor.
  goto :pm_done
)
where !PM_NAME! >nul 2>&1
if errorlevel 1 (
  where npm >nul 2>&1
  if errorlevel 1 (
    where bun >nul 2>&1
    if errorlevel 1 (
      echo [EKSİK] Paket yöneticisi [!PM_NAME! / npm / bun] bulunamadı.
      set "HAS_ERROR=1"
    ) else (
      for /f "delims=" %%V in ('bun --version 2^>nul') do set "BUN_VERSION=%%V"
      echo [TAMAM] bun !BUN_VERSION! [!PM_NAME! / npm bulunamadi, bun kullanilacak]
      set "PM_NAME=bun"
    )
  ) else (
    for /f "delims=" %%V in ('npm --version 2^>nul') do set "NPM_VERSION=%%V"
    echo [TAMAM] npm !NPM_VERSION! [!PM_NAME! bulunamadi, npm kullanilacak]
    set "PM_NAME=npm"
  )
) else (
  for /f "delims=" %%V in ('!PM_NAME! --version 2^>nul') do set "PM_VERSION=%%V"
  echo [TAMAM] !PM_NAME! !PM_VERSION!
)
:pm_done

if "%HAS_ERROR%"=="1" goto :requirements

set "CHECK_PORT=5049"
if defined SETUP_BOOTSTRAP_PORT set "CHECK_PORT=%SETUP_BOOTSTRAP_PORT%"

rem --- Kurulum baslangic portu kontrolu ---
set "PORT_HOLDER_PID="
for /f "delims=" %%P in ('!JS_RUNNER! "%SETUP_ROOT%scripts\find-port-holder.mjs" !CHECK_PORT! 2^>nul') do set "PORT_HOLDER_PID=%%P"

if defined PORT_HOLDER_PID (
  echo.
  echo [UYARI] Kurulum başlangıç portu zaten kullanımda: 127.0.0.1:!CHECK_PORT!
  echo Portu tutan süreç: PID !PORT_HOLDER_PID!
  echo.
  choice /C DK /N /M "Kalan kurulum süreci şimdi durdurulsun mu? [D=durdur ve devam et / K=kapat]: "
  if errorlevel 2 goto :failed
  taskkill /PID !PORT_HOLDER_PID! /F >nul 2>&1
  ping -n 2 127.0.0.1 >nul
)

set "WIZARD_PORT=5050"
if defined SETUP_WIZARD_PORT set "WIZARD_PORT=%SETUP_WIZARD_PORT%"
set "WIZARD_PID="
for /f "delims=" %%P in ('!JS_RUNNER! "%SETUP_ROOT%scripts\find-port-holder.mjs" !WIZARD_PORT! 2^>nul') do set "WIZARD_PID=%%P"
if defined WIZARD_PID (
  echo.
  echo [UYARI] Sihirbaz portu zaten kullanımda: 127.0.0.1:!WIZARD_PORT!
  echo Portu tutan süreç: PID !WIZARD_PID!
  echo.
  choice /C DK /N /M "Sihirbaz portu şimdi durdurulsun mu? [D=durdur ve devam / K=geç ve devam]: "
  if not errorlevel 2 (
    taskkill /PID !WIZARD_PID! /F >nul 2>&1
    ping -n 2 127.0.0.1 >nul
  )
)

echo.
echo [TAMAM] Gerekli çalışma ortamı hazır.
echo Web kurulum başlangıcı açılıyor...
echo.
set "SETUP_PROJECT_ROOT=%PROJECT_ROOT%"
rem setup.mjs: proje algılama + setup.config.json otomatik oluşturma + başlatıcı
!JS_RUNNER! "%SETUP_ROOT%bin\setup.mjs" --root "%PROJECT_ROOT%" %*
set "SETUP_EXIT=%ERRORLEVEL%"
if not "%SETUP_EXIT%"=="0" (
  echo.
  echo [HATA] Kurulum başlangıcı %SETUP_EXIT% koduyla kapandı.
  pause
)
popd
exit /b %SETUP_EXIT%

:requirements
echo.
echo ------------------------------------------------------------
echo Kurulması veya düzeltilmesi gereken bileşenler var.
echo Node.js LTS: https://nodejs.org/en/download
echo Bun:         https://bun.sh
echo ------------------------------------------------------------
pause

:failed
echo.
echo Kurulum başlatılmadı; mevcut dosya ve veriler değiştirilmedi.
popd
pause
exit /b 1
