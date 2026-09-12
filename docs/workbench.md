# pq workbench (gauntlet live board)

Last update: 2026-09-13 ~01:50 PT (Europe/Warsaw)

## Stage / progress
- **Stage:** Phase 2 overnight — slice7 ConPTY / auth-remote-board / updater CLI
- **Rough %:** ~76% Phase 2 scaffolding
- **Branch:** `feat/rust-phase1` (local commits only)
- **Base:** `300dab3` + this wave
- **Gauntlet A/B:** CLOSED WARUNKOWO OK (keep honesty)

## This wave
| Item | Outcome |
|------|---------|
| SessionRegistry | `spawn_prefer_live` behind `pty-spike`; fail → registry + `live_error`; write false without live |
| auth / remote / board | Electron-parity types deepened (authorize URL, WS events, overlap notes, hub stub) |
| Updater CLI | `pq-work --check-update [PATH]` → `OfferUpdate` JSON or up-to-date (FileManifestFetch fixture) |
| Dist | no full rebuild (disk) |
| `cargo test` | keep green (core + work; pty-spike optional) |

## Tests
- `cargo test -p pq-core`
- `cargo test -p pq-work`
- `cargo test -p pq-work --features pty-spike` (optional ConPTY)
- `cargo run -p pq-work -- --check-update`

## Next
1. Phone JS mic → `PqStt.startListen` / WS final text
2. SessionRegistry reader thread / output pump for live panes
3. Code signing when cert available
