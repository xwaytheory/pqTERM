# pq workbench (gauntlet live board)

Last update: 2026-09-13 ~03:45 PT (Europe/Warsaw) — night progress toward **07:00** report

## Stage / progress
- **Stage:** Phase 2 overnight — voice-host StartListen / Status on held duplex (TS)
- **Rough %:** ~95% Phase 2 scaffolding
- **Branch:** feat/rust-phase1 (local commits only)
- **Base:** 1004423 + this wave
- **Gauntlet A/B:** CLOSED WARUNKOWO OK (Architecture + IPC; honest StartListen/Cancel; language default pl; no auto-enable; no before-quit read block)
- **HTML board:** docs/workbench.html
- **Night report draft:** docs/NIGHT-REPORT-DRAFT.md (PL, for Szef)

## This wave
| Item | Outcome |
|------|---------|
| StartListen encode | `{"type":"start_listen","session_id","language":"pl","timeout_ms":0}` matches Rust IpcMessage |
| sendStartListen | Honest boolean — true only when writable peer socket + write ok |
| Status reader | Non-blocking line buffer → `lastStatus` / `lastTranscripts` (capped); no throw on partial |
| Gate | Still `PQ_VOICE_HOST=1` or `enabled:true`; before-quit no-op when inactive; no read-loop block |
| Smoke | `node --experimental-strip-types src/main/voice-host.shutdown.smoke.ts` |
| Dist / GGML / cargo | skipped (disk reclaim wave; TS+docs only) |

## Gauntlet blockers addressed
- Fake StartListen/Cancel success = ODRZUĆ → false without socket; true only after write
- Wrong default language = ODRZUĆ → `pl`
- Blocking before-quit on reads = ODRZUĆ → event `data` buffer only
- Auto-enable without flag = ODRZUĆ → gate unchanged

## Tests
- Smoke: Cancel + StartListen honesty; encode defaults; Status/Transcript ingest + chunked lines; TCP duplex StartListen + peer Status; win32 SIGKILL path

## Toward 07:00
- Honest: still no whisper.cpp, no production Electron↔voice cutover, no PTY parity.
- Next: code signing when cert; packaging pq-voice optional later.

## Next
1. Code signing when cert available
2. Optional packaging pq-voice as extraResource
3. Real whisper.cpp = separate disk decision
