# pq workbench (gauntlet live board)

Last update: 2026-09-13 ~02:30 PT (Europe/Warsaw) — night progress toward **07:00** report

## Stage / progress
- **Stage:** Phase 2 overnight — slice9 resolve-launch / trust / providers + smoke + night report
- **Rough %:** ~84% Phase 2 scaffolding
- **Branch:** eat/rust-phase1 (local commits only)
- **Base:** 63fec6 + this wave
- **Gauntlet A/B:** CLOSED WARUNKOWO OK (keep honesty)
- **HTML board:** docs/workbench.html (complete status board)
- **Night report draft:** docs/NIGHT-REPORT-DRAFT.md (PL, for Szef)

## This wave
| Item | Outcome |
|------|---------|
| resolve-launch | pq-core::resolve_launch — quote/yolo/sanitize/known paths; no spawn |
| trust | pq-core::trust — grok/claude/gemini/codex patch builders; no live write |
| providers | pq-core::providers — probe merge + emails; no PATH walk |
| smoke | scripts/rust-smoke.cmd — build + --help/--check-update/--ipc-demo |
| night report | Polish draft for morning; honest, no hype |
| Dist | no full rebuild (disk ≥2 GB) |
| cargo test | keep green |

## Tests
- cargo test -p pq-core -p pq-work -p pq-voice
- scripts\rust-smoke.cmd

## Toward 07:00
- Honest: still no whisper.cpp, no Electron spawn, no engine disk scan in Rust.
- Next: SessionRegistry output pump; phone JS → PqStt; optional fixture I/O.

## Next
1. Phone JS mic → PqStt.startListen / WS final text
2. SessionRegistry reader thread / output pump for live panes
3. Code signing when cert available
