# pq workbench (gauntlet live board)

Last update: 2026-09-12 23:35 PT

## Phase 1 (done)
- Branch: `feat/rust-phase1`
- Commit: `a47871e` — Rust scaffold, migration doc, updater stub, pq-work/pq-voice
- `cargo build` OK; `pq-core` tests OK
- STT desktop lock: Whisper Large v3 / pl

## Phase 2 overnight slice (this run)
- Port map: `docs/PORT-MAP.md` — every `src/main/*.ts` → Rust crate/module
- IPC stubs: `pq_core::ipc` — StartListen / Transcript / Cancel / Status + StubWorkClient / StubVoiceServer
- Binaries: pq-work (client stub) + pq-voice (server stub) exercise loopback; `cargo build` must pass
- Android STT: `docs/ANDROID-STT.md` + `android/sketch/SpeechRecognizerBridge.kt` (SpeechRecognizer only, no Whisper on phone)
- Krytyk feedback deferred for this slice

## Night wave (items 8–12)
| Item | Topic | Wave | Verdict |
|------|-------|------|---------|
| 8 | Android SpeechRecognizer | propose→krytyk→revise | Lock + **sketch/doc landed**; MainActivity wire later |
| 9 | MSI + Setup.exe | propose→krytyk→revise | Plan; no packaging break tonight |
| 10 | Logos inventory | inventory + krytik | No engine image assets; pq vector exists on Android only |
| 11 | DnD to terminals | propose→krytyk→revise | Paths-only v1 design |
| 12 | Gauntlet process | adopted | workbench + BACKLOG-NIGHT |

## DnD wave (item 11) — implemented
- preload: pq.files.pathFor via webUtils.getPathForFile
- TerminalPane: dragover/drop → quoted paths into PTY
- CSS drop overlay; helper lib/dropPaths.ts
- Krytyk follow-up: manual matrix still pending; folder recursion deferred

## Brand seed (item 10)
- Added resources/brand/pq.svg (same motif as Android ic_launcher.xml)
- Still need .ico for electron-builder / stamp-host

## Next build wave (after silence / morning)
1. Rust: `env` + `store` in pq-core; portable-pty spike
2. Wire IPC stubs to real named pipe / WS
3. Android: paste SpeechRecognizer bridge into MainActivity + phone JS
4. Brand: `resources/brand/pq.ico` then `npm run dist` NSIS/MSI (item 9)
