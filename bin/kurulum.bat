@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title setup v1.0 — Otomatik Kurulum Ön Kontrolü

set "SCRIPT_DIR=%~dp0"
if exist "%SCRIPT_DIR%package.json" (
  if exist "%SCRIPT_DIR%scripts" (
    set "SETUP_ROOT=%SCRIPT_DIR%"
  ) else (
    for %%I in ("%SCRIPT_DIR%..") do set "SETUP_ROOT=%%~fI\"
  )
) else (
  for %%I in ("%SCRIPT_DIR%..") do set "SETUP_ROOT=%%~fI\"
)

if defined SETUP_PROJECT_ROOT (
  set "PROJECT_ROOT=%SETUP_PROJECT_ROOT%"
) else (
  set "PROJECT_ROOT=%SETUP_ROOT%"
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

if not exist "package.json" (
  echo [HATA] package.json bulunamadı. Bu dosyayı uygulama ana dizininden çalıştırın.
  goto :failed
)

set "HAS_ERROR=0"
set "NODE_VERSION="
set "NODE_MAJOR="
where node >nul 2>&1
if errorlevel 1 (
  echo [EKSİK] Node.js bulunamadı.
  set "HAS_ERROR=1"
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
    echo [UYUMSUZ] Node.js !NODE_VERSION! bulundu. Node.js 18, 20, 22 veya 24 LTS gereklidir.
    set "HAS_ERROR=1"
  )
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [EKSİK] Paket yöneticisi (npm) bulunamadı.
  set "HAS_ERROR=1"
) else (
  for /f "delims=" %%V in ('npm --version 2^>nul') do set "NPM_VERSION=%%V"
  echo [TAMAM] npm !NPM_VERSION!
)

if "%HAS_ERROR%"=="1" goto :requirements

set "CHECK_PORT=5049"
if defined SETUP_BOOTSTRAP_PORT set "CHECK_PORT=%SETUP_BOOTSTRAP_PORT%"

rem --- Kurulum baslangic portu kontrolu ---
set "PORT_HOLDER_PID="
for /f "delims=" %%P in ('node "%SETUP_ROOT%scripts\find-port-holder.mjs" !CHECK_PORT! 2^>nul') do set "PORT_HOLDER_PID=%%P"

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
for /f "delims=" %%P in ('node "%SETUP_ROOT%scripts\find-port-holder.mjs" !WIZARD_PORT! 2^>nul') do set "WIZARD_PID=%%P"
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
node "%SETUP_ROOT%scripts\setup-bootstrap.mjs"
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
echo ------------------------------------------------------------
pause

:failed
echo.
echo Kurulum başlatılmadı; mevcut dosya ve veriler değiştirilmedi.
popd
pause
exit /b 1
