@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo [pq] npm install...
  call npm install
  call npm run rebuild
)
call npm run dev
