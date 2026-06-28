@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Please install Node.js, then run this file again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

if not exist dist (
  echo Building app...
  call npm run build
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

start "" "http://127.0.0.1:4173"
node local-server.mjs

pause
