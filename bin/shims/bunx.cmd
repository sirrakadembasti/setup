@echo off
setlocal EnableDelayedExpansion
set "SELF_DIR=%~dp0"
for /f "delims=" %%I in ('where bunx 2^>nul') do (
  if /i not "%%~dpI"=="%SELF_DIR%" (
    "%%~fI" %*
    exit /b !errorlevel!
  )
)
where npx >nul 2>&1
if not errorlevel 1 (
  npx --yes %*
  exit /b !errorlevel!
)
echo [HATA] Sistemde ne bunx ne de npx calistirilabilir programi bulunamadi. >&2
exit /b 1
