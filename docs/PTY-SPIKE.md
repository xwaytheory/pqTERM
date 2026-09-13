# portable-pty / ConPTY spike

**Status:** optional feature `pty-spike` on `pq-work` — builds and runs on Windows.  
**Date:** 2026-09-13 (synced with SessionRegistry revise)  
**Not production** — Electron `node-pty` / `pty-manager.ts` remains live.

## How to run

```bat
cd crates
cargo run -p pq-work --features pty-spike -- --pty-spike
cargo test -p pq-work --features pty-spike
```

Spawns `cmd /D /Q /C echo pq-pty-ok` via `portable-pty` native ConPTY, answers CSI 6n (DSR) with a dummy cursor report, captures master output.

## Findings

| Topic | Note |
|-------|------|
| Crate | `portable-pty` 0.9 (optional dep) |
| Backend | Windows ConPTY through `native_pty_system()` |
| Init noise | ConPTY emits DSR (`ESC [ 6 n`), mode sets, title OSC before payload |
| Capture | Marker `pq-pty-ok` appears after answering DSR; without reply child can stall |
| Manager | `SessionRegistry` + `spawn_argv` (env via `build_pty_env`) / hardened `spawn_cmd` (see PTY-MANAGER.md) |
| Spawn env | TERM / PQ_* / PATH extras / `yolo_env` applied on live ConPTY only |
| Scope | Spike only — full engine trust + Electron `pty-manager.ts` still production |

## Production path (later Phase 3)

- Grow SessionRegistry → real host-owned grid with live I/O
- Keep Electron path until Rust host owns the grid

## Fallback

If `portable-pty` fails to compile on a machine, keep this doc and a `todo!` module; prefer fixing the feature over removing it.
