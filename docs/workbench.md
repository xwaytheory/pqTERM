# pq workbench (gauntlet live board)

Last update: 2026-09-13 ~01:40 PT (Europe/Warsaw)

## Stage / progress
- **Stage:** Phase 2 overnight — Krytyk A/B revise + auth/remote/board/updater fixtures
- **Rough %:** ~74% Phase 2 scaffolding
- **Branch:** `feat/rust-phase1` (local commits only)
- **Base:** `7a91ac6` + this wave

## This wave
| Item | Outcome |
|------|---------|
| Krytyk A | SessionRegistry honesty; `write` false w/o I/O; spawn_cmd hardened; docs sync |
| Krytyk B | Origin scheme+authority; deny getUserMedia; mic auto-retry; PL UTF-8; ANDROID-STT notes |
| Dist docs | DIST-SMOKE DIST_EXIT honesty (no rebuild) |
| pq-core | auth / remote `:4747` / board sketches + FileManifestFetch fixtures |
| `cargo test` | keep green (core + work; pty-spike optional) |

## Tests
- `cargo test -p pq-core`
- `cargo test -p pq-work`
- `cargo test -p pq-work --features pty-spike` (optional ConPTY)

## Next
1. Phone JS mic → `PqStt.startListen` / WS final text
2. SessionRegistry live engine spawn (beyond `spawn_argv` smoke)
3. Code signing when cert available
