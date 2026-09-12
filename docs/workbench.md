# pq workbench (gauntlet live board)

Last update: 2026-09-13 00:45 PT (Europe/Warsaw)

## Stage / progress
- **Stage:** Phase 2 overnight â€” engines merge + duplex/WS + DnD shell + dist smoke
- **Rough %:** ~65% Phase 2 scaffolding
- **Branch:** `feat/rust-phase1` (local commits only)
- **Base:** `d6827fc` + this wave

## This wave
| Item | Outcome |
|------|---------|
| Gauntlet hygiene | LOCKED â†’ INTENT in Android sketch + MIGRATION; LOGOS table letter-mark chips (not color-swatch-only) |
| Shell-aware DnD | `pathShellForPane` + TerminalPane wire; fragment fix for drop overlays; unit tests green |
| Whisper INTENT | already in `d6827fc` (`docs/WHISPER-LARGE.md`, `stt::intended_ggml_path` / `ensure_ggml_model`) |
| `pq-core::engines` | ENGINE_SPECS twin + `merge_providers` / `default_provider`; store empty+load merge |
| Transport beyond stub | `DuplexEndpoint` real send/recv; `LocalWsTransport` (`ws-jsonlines-tcp`); named-pipe still OS-stub |
| PtyManager start | `pq-work::pty_manager` session map + register/resize/write_stub/clear |
| `npm run dist` | **MSI OK** (`release/pq 1.1.1.msi`); NSIS FAIL disk write — see `docs/DIST-SMOKE.md` |
| Android MainActivity | deferred (sketch INTENT only; wire next) |

## Tests
- `npm run test:unit` â€” 18 pass
- `cargo test -p pq-core` â€” 23 pass (engines + duplex + store merge)
- `cargo test -p pq-work` â€” pty_manager pass

## Next
1. Finish/document dist smoke (NSIS+MSI under `release/`) when WiX completes
2. OS named-pipe I/O or real tungstenite WS
3. PtyManager â†” portable-pty spawn (beyond stub registry)
4. Android MainActivity + `PqStt` JSInterface wire
5. Code signing when cert available
