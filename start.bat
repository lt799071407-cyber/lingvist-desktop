@echo off
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
if not exist "node_modules\electron\dist\electron.exe" (
  echo Installing dependencies, please wait a few minutes...
  call npm install
)
start "" "node_modules\electron\dist\electron.exe" .
