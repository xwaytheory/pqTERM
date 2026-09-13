# pq workbench (gauntlet live board)

Last update: 2026-09-13 ~02:15 PT (Europe/Warsaw) — night progress toward **07:00** report

## Stage / progress
- **Stage:** Phase 2 overnight — slice8 voice pipeline + IPC demo + resume/usage/sync types
- **Rough %:** ~80% Phase 2 scaffolding
- **Branch:** `feat/rust-phase1` (local commits only)
- **Base:** `7636011` + this wave
- **Gauntlet A/B:** CLOSED WARUNKOWO OK (keep honesty)

## This wave
| Item | Outcome |
|------|---------|
| pq-voice pipeline | `stt::run_listen_transcribe_skeleton` — probe AppData GGML; missing `ggml-large-v3.bin` prints a clear no-download message; `--listen` |
| Voice IPC e2e types | `VoiceIpcFlow` + `IpcMessage::kind_name`; `--ipc-demo` runs `LocalTcpTransport` in-process |
| Electron bridge | `docs/VOICE-HOST-BRIDGE.md` + `VoiceHostSpawnPlan` (no spawn wired) |
| resume / usage / sync | `pq-core` types + tests only (mirror `src/main`; no I/O) |
| Dist | no full rebuild (disk) |
| `cargo test` | keep green (core + work + voice) |

## Tests
- `cargo test -p pq-core`
- `cargo test -p pq-work`
- `cargo test -p pq-voice` (bin only; pipeline tests live in pq-core)
- `cargo run -p pq-voice -- --listen`
- `cargo run -p pq-work -- --ipc-demo`

## Toward 07:00
- Honest: still no whisper.cpp, no Electron spawn, no engine disk scan.
- Next useful slices: SessionRegistry output pump; phone JS → PqStt; optional live resume I/O behind fixtures.

## Next
1. Phone JS mic → `PqStt.startListen` / WS final text
2. SessionRegistry reader thread / output pump for live panes
3. Code signing when cert available
