# pq workbench (gauntlet live board)

Last update: 2026-09-13 01:25 PT (Europe/Warsaw)

## Stage / progress
- **Stage:** Phase 2 overnight — PtyManager parity + Android STT wire + dist NSIS fix
- **Rough %:** ~72% Phase 2 scaffolding
- **Branch:** `feat/rust-phase1` (local commits only)
- **Base:** `535fb80` + this wave

## This wave
| Item | Outcome |
|------|---------|
| Disk recovery | C: was 0 free; npm-cache cleared (~3.5 GB) |
| PtyManager | spawn/write/resize/kill + buf/seq — `docs/PTY-MANAGER.md` |
| Android STT | `PqSttBridge` wired + origin lock on `JavascriptInterface` |
| Dist | **MSI + NSIS OK** after reclaim — `docs/DIST-SMOKE.md` |
| `cargo test` | pq-core 23 + pq-work 4 green |

## Tests
- `cargo test -p pq-core` — 23 pass
- `cargo test -p pq-work` — 4 pass

## Next
1. Phone JS mic → `PqStt.startListen` / WS final text
2. PtyManager live engine spawn (beyond `spawn_cmd` spike)
3. Code signing when cert available