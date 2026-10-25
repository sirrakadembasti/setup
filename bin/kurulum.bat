@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "LAUNCHER_MODE=package"
set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%CD%"
if "%LAUNCHER_MODE%"=="project" set "PROJECT_ROOT=%~dp0"
if defined SETUP_PROJECT_ROOT set "PROJECT_ROOT=%SETUP_PROJECT_ROOT%"
cd /d "%PROJECT_ROOT%"
if errorlevel 1 goto directory_error
set "SETUP_PROJECT_ROOT=%CD%"

where node >nul 2>&1
if errorlevel 1 goto try_bun
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 18 ? 0 : 1)" >nul 2>&1
if errorlevel 1 goto try_bun
set "JS_RUNNER=node"
goto locate_entry
:try_bun
where bun >nul 2>&1
if errorlevel 1 goto runtime_error
bun --version >nul 2>&1
if errorlevel 1 goto runtime_error
set "JS_RUNNER=bun"

:locate_entry
if "%LAUNCHER_MODE%"=="project" goto project_entry
set "SETUP_ENTRY=%SCRIPT_DIR%bin\setup.mjs"
if exist "%SETUP_ENTRY%" goto run_local
for %%I in ("%SCRIPT_DIR%..") do set "SETUP_ENTRY=%%~fI\bin\setup.mjs"
if exist "%SETUP_ENTRY%" goto run_local
goto entry_error

:project_entry
set "SETUP_ENTRY=%SCRIPT_DIR%tools\setup\bin\setup.mjs"
if exist "%SETUP_ENTRY%" goto run_local
set "SETUP_ENTRY=%SCRIPT_DIR%node_modules\setup\bin\setup.mjs"
if exist "%SETUP_ENTRY%" goto run_local
if "%JS_RUNNER%"=="bun" goto remote_bun
where npx >nul 2>&1
if errorlevel 1 goto remote_bun
npx --yes github:sirrakadembasti/setup %*
exit /b %ERRORLEVEL%
:remote_bun
where bunx >nul 2>&1
if errorlevel 1 goto entry_error
bunx github:sirrakadembasti/setup %*
exit /b %ERRORLEVEL%

:run_local
"%JS_RUNNER%" "%SETUP_ENTRY%" %*
set "SETUP_EXIT=%ERRORLEVEL%"
goto finish
:directory_error
echo [HATA] Proje dizinine girilemedi: "%PROJECT_ROOT%" 1>&2
set "SETUP_EXIT=1"
goto finish
:runtime_error
echo [HATA] Node.js 18 veya ustu ya da Bun gereklidir. 1>&2
echo Node.js: https://nodejs.org/en/download - Bun: https://bun.sh 1>&2
set "SETUP_EXIT=127"
goto finish
:entry_error
echo [HATA] Yerel setup bulunamadi. tools\setup kopyasini yenileyin veya npx/bunx kurun. 1>&2
set "SETUP_EXIT=127"
:finish
if "%SETUP_EXIT%"=="0" exit /b 0
if not "%SETUP_NO_PAUSE%"=="1" pause
exit /b %SETUP_EXIT%
