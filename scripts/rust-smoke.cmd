@echo off
REM rust-smoke.cmd — build + run key CLI checks without downloading models
setlocal EnableExtensions
cd /d "%~dp0.."
if not exist "crates\Cargo.toml" (
  echo error: expected crates\Cargo.toml relative to repo root
  exit /b 1
)

echo === rust-smoke: cargo build ===
pushd crates
cargo build -p pq-core -p pq-work -p pq-voice
if errorlevel 1 (
  popd
  exit /b 1
)

echo === pq-work --help ===
cargo run -q -p pq-work -- --help
if errorlevel 1 ( popd & exit /b 1 )

echo === pq-work --check-update ===
cargo run -q -p pq-work -- --check-update
if errorlevel 1 ( popd & exit /b 1 )

echo === pq-work --ipc-demo ===
cargo run -q -p pq-work -- --ipc-demo
if errorlevel 1 ( popd & exit /b 1 )

echo === pq-voice --help ===
cargo run -q -p pq-voice -- --help
if errorlevel 1 ( popd & exit /b 1 )

echo === pq-voice --ipc-demo ===
cargo run -q -p pq-voice -- --ipc-demo
if errorlevel 1 ( popd & exit /b 1 )

popd
echo === rust-smoke OK (no model download) ===
exit /b 0
