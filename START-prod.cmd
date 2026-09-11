@echo off
title pq
cd /d "%~dp0"
if not exist node_modules (
  echo [pq] npm install...
  call npm install
  call npm run rebuild
)
if not exist out\renderer\index.html (
  echo [pq] build UI...
  call npm run build
)
set PQ_MODE=prod
set ELECTRON_RENDERER_URL=
start "pq" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
exit
