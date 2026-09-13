# pq workbench (gauntlet live board)

Last update: 2026-09-13 ~03:15 PT (Europe/Warsaw) — night progress toward **07:00** report

## Stage / progress
- **Stage:** Phase 2 overnight — Electron pq-voice spawn sketch (opt-in)
- **Rough %:** ~92% Phase 2 scaffolding
- **Branch:** feat/rust-phase1 (local commits only)
- **Base:** 6f1ebb6 + this wave
- **Gauntlet A/B:** CLOSED WARUNKOWO OK (Architecture + Electron-process; no boot auto-spawn; missing-exe structured error; no --allow-download)
- **HTML board:** docs/workbench.html
- **Night report draft:** docs/NIGHT-REPORT-DRAFT.md (PL, for Szef)

## This wave
| Item | Outcome |
|------|---------|
| `src/main/voice-host.ts` | Opt-in spawn sketch mirroring Rust candidates + pipe/tcp args |
| Gate | `PQ_VOICE_HOST=1` OR `enabled:true` — production default unchanged |
| Windows | Prefer `--ipc-pipe` + sanitized session; else `--ipc-tcp 127.0.0.1:4791` |
| Errors | Structured (`disabled` / `missing-exe` / `bad-session` / `spawn-failed`); no throw storm |
| index.ts | Dead re-export only — **not** called from whenReady / UI / before-quit |
| Docs | VOICE-HOST-BRIDGE / workbench / PARITY / night report |
| Dist / GGML / cargo | skipped (disk ~1.43 GB; TS-only wave) |

## Gauntlet blockers addressed
- Auto-spawn on every launch = ODRZUĆ → gated; no boot call
- Missing binary as success = ODRZUĆ → `{ ok:false, code:'missing-exe', candidates }`
- Whisper download = ODRZUĆ → never passes `--allow-download`

## Tests
- Syntax / tsc cheap check on voice-host (no cargo this wave)

## Toward 07:00
- Honest: still no whisper.cpp, no production Electron↔voice cutover, no PTY parity.
- Next: code signing when cert; real whisper.cpp = separate disk decision; optional UI gate still behind env.

## Next
1. Code signing when cert available
2. Optional: harden named-pipe ACL / wire quit Cancel+kill when flag set
3. Real whisper.cpp = separate disk decision