# pq workbench (gauntlet live board)

Last update: 2026-09-12 23:13 PT

## Phase 1 (done)
- Branch: `feat/rust-phase1`
- Commit: `a47871e` — Rust scaffold, migration doc, updater stub, pq-work/pq-voice
- `cargo build` OK; `pq-core` tests OK
- STT desktop lock: Whisper Large v3 / pl

## Night wave (items 8–12)
| Item | Topic | Wave | Verdict |
|------|-------|------|---------|
| 8 | Android SpeechRecognizer | propose→krytyk→revise | Lock documented; impl later |
| 9 | MSI + Setup.exe | propose→krytyk→revise | Plan; no packaging break tonight |
| 10 | Logos inventory | inventory + krytik | No engine image assets; pq vector exists on Android only |
| 11 | DnD to terminals | propose→krytyk→revise | Paths-only v1 design |
| 12 | Gauntlet process | adopted | workbench + BACKLOG-NIGHT |

## Next build wave (after silence / morning)
1. Electron: TerminalPane DnD paths (item 11)
2. Brand: `resources/brand/pq.ico` (item 10) then `npm run dist` NSIS/MSI (item 9)
3. Android: SpeechRecognizer bridge (item 8)
4. Rust Phase 2: store/env + portable-pty spike
