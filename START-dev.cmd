@echo off
title pqTERM-dev
cd /d "%~dp0"
if not exist node_modules (
  echo [pqTERM] npm install...
  call npm install
  call npm run rebuild
)
echo [pqTERM] starting...
call npm run dev
