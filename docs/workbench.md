# pq workbench (gauntlet live board)

Last update: 2026-09-13 ~02:55 PT (Europe/Warsaw) — night progress toward **07:00** report

## Stage / progress
- **Stage:** Phase 2 overnight — Windows NamedPipeTransport JSON-line IPC
- **Rough %:** ~91% Phase 2 scaffolding
- **Branch:** feat/rust-phase1 (local commits only)
- **Base:** 73187e3 + this wave
- **Gauntlet A/B:** CLOSED WARUNKOWO OK (Architecture + IPC/security; pipe ACL defaults OK for local demo; session id sanitized)
- **HTML board:** docs/workbench.html
- **Night report draft:** docs/NIGHT-REPORT-DRAFT.md (PL, for Szef)

## This wave
| Item | Outcome |
|------|---------|
| NamedPipeTransport | Real Windows duplex byte pipe + JSON-line framing (`encode_line`/`decode_line`) |
| kind() honesty | `named-pipe` when connected; `named-pipe-stub` when disconnected / non-Windows |
| Demo | `--ipc-pipe [session]` on pq-work (listen) + pq-voice (connect); unit cross-process via PowerShell peer |
| Session id | `sanitize_pipe_session_id` (ASCII alnum / `-` / `_`) |
| Docs | PARITY / workbench / night report |
| Dist / GGML | skipped (disk tight) |
| cargo test | pq-core/work/voice green |

## Gauntlet blockers addressed
- Fake success on stub pipe = ODRZUĆ → real OS I/O on Windows; stub kind off-Windows
- Same-process CreateFile↔ConnectNamedPipe deadlock → cross-process test peer (honest)
- Pipe ACL = creator default DACL (local same-user demo OK; not multi-user hardened)

## Tests
- cargo test -p pq-core -p pq-work -p pq-voice

## Toward 07:00
- Honest: still no whisper.cpp, no Electron spawn cutover, no production PTY parity.
- Next: code signing when cert; real whisper.cpp = separate disk decision.

## Next
1. Code signing when cert available
2. Optional: harden named-pipe ACL / Electron spawn of pq-voice
3. Real whisper.cpp = separate disk decision
