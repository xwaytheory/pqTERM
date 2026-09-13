# pq workbench (gauntlet live board)

Last update: 2026-09-13 ~03:40 PT (Europe/Warsaw) — night progress toward **07:00** report

## Stage / progress
- **Stage:** Phase 2 overnight — voice-host listens before spawn + Cancel JSON-line
- **Rough %:** ~94% Phase 2 scaffolding
- **Branch:** feat/rust-phase1 (local commits only)
- **Base:** 215e042 + this wave
- **Gauntlet A/B:** CLOSED WARUNKOWO OK (Architecture + IPC; listen-before-spawn; honest Cancel; no auto-enable)
- **HTML board:** docs/workbench.html
- **Night report draft:** docs/NIGHT-REPORT-DRAFT.md (PL, for Szef)

## This wave
| Item | Outcome |
|------|---------|
| Listen-before-spawn | Node `net.Server` binds pipe `\\.\pipe\pq-voice-{session}` or TCP `127.0.0.1:4791` **before** spawn |
| Peer socket | Kept on active handle on connect; Cancel writes `{"type":"cancel",...}\n` when writable |
| Cancel honesty | No socket → `trySendCancel` / shutdown skip Cancel (`false`) then kill — never pretend |
| Gate | Still `PQ_VOICE_HOST=1` or `enabled:true`; before-quit no-op when inactive |
| Smoke | `node --experimental-strip-types src/main/voice-host.shutdown.smoke.ts` |
| Dist / GGML / cargo | skipped (disk ~1.18 GB free; TS+docs only) |

## Gauntlet blockers addressed
- Listen-after-spawn race = ODRZUĆ → listen then spawn
- Fake Cancel success = ODRZUĆ → false without socket; true only after write
- Auto-enable without flag = ODRZUĆ → gate unchanged
- Wrong pipe name = ODRZUĆ → `\\.\pipe\pq-voice-{sanitizedSession}`

## Tests
- Smoke: no-active shutdown; Cancel false without socket; Cancel true + JSON line with fake/real socket; TCP listen + peer Cancel; win32 SIGKILL path

## Toward 07:00
- Honest: still no whisper.cpp, no production Electron↔voice cutover, no PTY parity.
- Next: optional StartListen over held duplex; code signing when cert.

## Next
1. Code signing when cert available
2. Optional: StartListen / Status framing over held duplex
3. Real whisper.cpp = separate disk decision