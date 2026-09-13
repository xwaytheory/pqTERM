# pq workbench (gauntlet live board)

Last update: 2026-09-13 ~03:25 PT (Europe/Warsaw) — night progress toward **07:00** report

## Stage / progress
- **Stage:** Phase 2 overnight — voice-host quit lifecycle (Cancel TODO + kill when active)
- **Rough %:** ~93% Phase 2 scaffolding
- **Branch:** feat/rust-phase1 (local commits only)
- **Base:** 8ce9e72 + this wave
- **Gauntlet A/B:** CLOSED WARUNKOWO OK (Architecture + Electron-process; shutdown no-op when never spawned; no auto-spawn; Cancel not pretended)
- **HTML board:** docs/workbench.html
- **Night report draft:** docs/NIGHT-REPORT-DRAFT.md (PL, for Szef)

## This wave
| Item | Outcome |
|------|---------|
| Active handle | Module-level child+sessionId+transport+exe on successful spawn; cleared on stop/exit/shutdown |
| `getActiveVoiceHost` / `shutdownVoiceHost` | No-op if nothing active; kill then win32 SIGKILL after ~800ms |
| Cancel IPC | **TODO honesty** — stdin ignore; no duplex held; `trySendCancelToActiveVoiceHost` → false |
| `before-quit` | Calls `shutdownVoiceHost()` — production unchanged when never spawned |
| Smoke | `node --experimental-strip-types src/main/voice-host.shutdown.smoke.ts` |
| Dist / GGML / cargo | skipped (disk ~1.35 GB free; TS+docs only) |

## Gauntlet blockers addressed
- Auto-spawn on quit/ready = ODRZUĆ → no spawn; shutdown only
- Killing unrelated PIDs = ODRZUĆ → only tracked active child
- Pretending Cancel sent = ODRZUĆ → documented TODO + returns false

## Tests
- Smoke: no-active shutdown no throw; fake handle kill + SIGKILL path no throw

## Toward 07:00
- Honest: still no whisper.cpp, no production Electron↔voice cutover, no PTY parity.
- Next: optional Cancel-over-pipe/TCP when duplex exists; code signing when cert.

## Next
1. Code signing when cert available
2. Optional: Cancel JSON-line over held pipe/TCP duplex (not stdin)
3. Real whisper.cpp = separate disk decision