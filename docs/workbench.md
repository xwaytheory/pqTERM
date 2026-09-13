# pq workbench (gauntlet live board)

Last update: 2026-09-13 ~02:45 PT (Europe/Warsaw) — night progress toward **07:00** report

## Stage / progress
- **Stage:** Phase 2 overnight — slice10 output pump + phone PqStt→WS glue
- **Rough %:** ~87% Phase 2 scaffolding
- **Branch:** feat/rust-phase1 (local commits only)
- **Base:** 8f19da7 + this wave
- **Gauntlet A/B:** CLOSED WARUNKOWO OK (output pump Architecture; phone UX/Android)
- **HTML board:** docs/workbench.html
- **Night report draft:** docs/NIGHT-REPORT-DRAFT.md (PL, for Szef)

## This wave
| Item | Outcome |
|------|---------|
| SessionRegistry output pump | Reader thread under `pty-spike`; DSR reply; `sync_output_pumps` / `output_pump_active`; registry stays honest |
| Phone JS PqStt glue | `src/phone/src/pqSttGlue.ts` + mic in PaneView → same `client.write` as typed |
| Docs | PTY-MANAGER, ANDROID-STT, workbench, night report |
| Dist / GGML | skipped (disk ~2.5 GB) |
| cargo test | pq-core/work/voice green; pq-work --features pty-spike green |

## Gauntlet blockers addressed
- No fake pump without live ConPTY
- ConPTY DSR stall → auto `[1;1R` in pump
- Phone: no Web Speech fallback; finals = typed WS path only

## Tests
- cargo test -p pq-core -p pq-work -p pq-voice
- cargo test -p pq-work --features pty-spike

## Toward 07:00
- Honest: still no whisper.cpp, no Electron spawn cutover, no production PTY parity.
- Next: optional fixture I/O; code signing when cert; real whisper.cpp = separate disk decision.

## Next
1. Optional fixture I/O for resume/providers (no live AppData write)
2. Code signing when cert available
3. Deeper remote/auth only if needed — Electron remains host
