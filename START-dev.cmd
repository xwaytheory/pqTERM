@echo off
title pq-dev
cd /d "%~dp0"
if not exist node_modules (
  echo [pq-dev] npm install...
  call npm install
  call npm run rebuild
)
echo [pq-dev] starting...
call npm run dev
