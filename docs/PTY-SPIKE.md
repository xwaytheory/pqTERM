# portable-pty / ConPTY spike

**Status:** optional feature `pty-spike` on `pq-work` — **builds and runs** on Windows.  
**Date:** 2026-09-13  
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
| Scope | Spike only — no pane grid, resize API, or buf/seq parity with Electron |

## Production path (later Phase 3)

- Port `src/main/pty-manager.ts` → `pq-work::pty`
- Session map: spawn / write / resize / kill + scrollback seq
- Keep Electron path until Rust host owns the grid

## Fallback

If `portable-pty` fails to compile on a machine, keep this doc and a `todo!` module; prefer fixing the feature over removing it.