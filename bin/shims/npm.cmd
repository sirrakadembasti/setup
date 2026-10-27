@echo off
setlocal EnableDelayedExpansion
set "SELF_DIR=%~dp0"
for /f "delims=" %%I in ('where npm 2^>nul') do (
  if /i not "%%~dpI"=="%SELF_DIR%" (
    "%%~fI" %*
    exit /b !errorlevel!
  )
)
where bun >nul 2>&1
if not errorlevel 1 (
  bun "%SELF_DIR%npm-shim.mjs" %*
  exit /b !errorlevel!
)
echo [HATA] Sistemde ne npm ne de bun calistirilabilir programi bulunamadi. >&2
exit /b 1
