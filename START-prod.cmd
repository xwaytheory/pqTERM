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
if not exist "%~dp0host\pq.exe" (
  echo [pq] stamp host...
  call node "%~dp0scripts\stamp-host.cjs"
)
if not exist "%~dp0host\ffmpeg.dll" (
  echo [pq] stamp host dist...
  call node "%~dp0scripts\stamp-host.cjs"
)
set PQ_MODE=prod
set ELECTRON_RENDERER_URL=
start "pq" "%~dp0host\pq.exe" "%~dp0."
exit
