@echo off
title pqTERM-pr
cd /d "%~dp0"
if not exist node_modules (
  echo [pqTERM] npm install...
  call npm install
)
if not exist out\renderer\index.html (
  echo [pqTERM] build UI...
  call npm run build
)
if not exist "%~dp0host\pqterm.exe" (
  echo [pqTERM] stamp host...
  call node "%~dp0scripts\stamp-host.cjs"
)
if not exist "%~dp0host\ffmpeg.dll" (
  echo [pqTERM] stamp host dist...
  call node "%~dp0scripts\stamp-host.cjs"
)
set PQ_MODE=prod
set ELECTRON_RENDERER_URL=
start "pqTERM-pr" "%~dp0host\pqterm.exe" "%~dp0."
exit
