@echo off
setlocal EnableDelayedExpansion
set "SELF_DIR=%~dp0"
for /f "delims=" %%I in ('where npx 2^>nul') do (
  if /i not "%%~dpI"=="%SELF_DIR%" (
    "%%~fI" %*
    exit /b !errorlevel!
  )
)
where bunx >nul 2>&1
if not errorlevel 1 (
  bunx %*
  exit /b !errorlevel!
)
echo [HATA] Sistemde ne npx ne de bunx calistirilabilir programi bulunamadi. >&2
exit /b 1
