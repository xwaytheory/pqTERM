# pq workbench (gauntlet live board)

Last update: 2026-09-13 ~02:50 PT (Europe/Warsaw) — night progress toward **07:00** report

## Stage / progress
- **Stage:** Phase 2 overnight — fixture I/O resume/providers (no live AppData)
- **Rough %:** ~89% Phase 2 scaffolding
- **Branch:** feat/rust-phase1 (local commits only)
- **Base:** 26ec495 + this wave
- **Gauntlet A/B:** CLOSED WARUNKOWO OK (fixture I/O Architecture + correctness; no prod AppData write)
- **HTML board:** docs/workbench.html
- **Night report draft:** docs/NIGHT-REPORT-DRAFT.md (PL, for Szef)

## This wave
| Item | Outcome |
|------|---------|
| Resume fixture I/O | `sessions_from_*` / `prime_from_path` / `write_sessions_to` (explicit path only) |
| Providers fixture I/O | `probe_from_auth_texts` / paths / `probe_auth_candidates` + injectable home+reader |
| Honesty | no opencode/omp live scan; no PATH walk of real home; no `state_path()` writes |
| Docs | workbench + night report wave |
| Dist / GGML | skipped (disk ~2.1 GB) |
| cargo test | pq-core/work/voice must stay green |

## Gauntlet blockers addressed
- Accidental prod AppData write = ODRZUĆ → fixed by explicit-path-only save + no default home
- Tests use tempdir / in-memory map readers only

## Tests
- cargo test -p pq-core -p pq-work -p pq-voice

## Toward 07:00
- Honest: still no whisper.cpp, no Electron spawn cutover, no production PTY parity.
- Next: code signing when cert; real whisper.cpp = separate disk decision.

## Next
1. Code signing when cert available
2. Deeper remote/auth only if needed — Electron remains host
3. Real whisper.cpp = separate disk decision
