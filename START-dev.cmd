@echo off
title pqTERM-test
cd /d "%~dp0"
if not exist node_modules (
  echo [pqTERM] npm install...
  call npm install
)
echo [pqTERM] starting (edycja test)...
:: Testsowa instancja ma własny profil pqTERM-test (env.ts profileDirName C9).
set PQ_EDITION=test
call npm run dev
