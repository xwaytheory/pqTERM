@echo off
REM verify-night.cmd - overnight gate: cargo workspace tests + npm unit (if defined)
REM No dist, no model download. Clear OK/FAIL echoes for pre-dawn checks.
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0.."

set FAIL=0

echo === verify-night: cargo test --workspace ===
if not exist "crates\Cargo.toml" (
  echo FAIL: expected crates\Cargo.toml relative to repo root
  exit /b 1
)
pushd crates
cargo test --workspace
if errorlevel 1 (
  popd
  echo FAIL: cargo test --workspace
  set FAIL=1
) else (
  popd
  echo OK: cargo test --workspace
)

echo.
echo === verify-night: npm run test:unit ===
findstr /I /C:"\"test:unit\"" package.json >nul 2>&1
if errorlevel 1 (
  echo SKIP: npm run test:unit ^(script not defined in package.json^)
) else (
  call npm run test:unit
  if errorlevel 1 (
    echo FAIL: npm run test:unit
    set FAIL=1
  ) else (
    echo OK: npm run test:unit
  )
)

echo.
if "!FAIL!"=="1" (
  echo === verify-night FAIL ===
  exit /b 1
)
echo === verify-night ALL OK ===
exit /b 0