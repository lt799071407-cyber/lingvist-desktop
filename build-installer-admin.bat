@echo off
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/

where npm >nul 2>nul
if errorlevel 1 (
  echo npm not found. Please install Node.js 18+ from https://nodejs.org first.
  echo.
  pause >nul
  exit /b 1
)

echo Building installer, please wait a few minutes...
call npm run dist
echo.
echo Done. Press any key to close.
pause >nul
