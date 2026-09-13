# pq workbench (gauntlet live board)

Last update: 2026-09-13 ~04:05 PT (Europe/Warsaw) — polish toward **07:00** Szef report
Product HEAD: **3a06472** (voice-host StartListen + Status reader)

## Stage / progress
- **Stage:** Phase 2 overnight **frozen for 07:00 review** (docs + `--help` honesty) — not a cutover lock-in
- **Rough %:** ~95% Phase 2 scaffolding (product unchanged vs 3a06472)
- **Branch:** feat/rust-phase1 (local commits only, no push)
- **Base:** 3a06472 + polish `6a1f879` (NIGHT-REPORT + workbench stamp + pq-voice `--help`)
- **Gauntlet A/B:** CLOSED WARUNKOWO OK (Architecture + IPC; honest StartListen/Cancel; language default pl; no auto-enable; no before-quit read block)
- **HTML board:** docs/workbench.html
- **Night report:** docs/NIGHT-REPORT-DRAFT.md (PL, 07:00 Szef)

## Product reality @ 3a06472
| Item | Outcome |
|------|---------|
| StartListen encode | `{"type":"start_listen","session_id","language":"pl","timeout_ms":0}` matches Rust IpcMessage |
| sendStartListen / Cancel | Honest boolean — true only when writable peer socket + write ok |
| Status reader | Non-blocking line buffer → `lastStatus` / `lastTranscripts` (capped); no throw on partial |
| Gate | `PQ_VOICE_HOST=1` or `enabled:true`; `before-quit` no-op when inactive |
| MSI / NSIS | Built unsigned overnight, then **reclaimed** from `release\` (disk). Rebuild later. |
| resolve-launch / trust | Present in `pq-core` (pure helpers; no spawn / no live write) |
| Dist / GGML | skipped on purpose (disk ~1.6 GB free) |

## This polish slice
| Item | Outcome |
|------|---------|
| DAY-PLAN.md | After 07:00: push?, signing, whisper.cpp, second MSI upgrade |
| NIGHT-REPORT-DRAFT.md | Full PL arc 23:06→04:07; gauntlet; MSI built-then-reclaimed; blockers; DAY-PLAN |
| workbench.md/html | Stamped to 3a06472 (not stale 1004423 / named-pipe-only table) |
| pq-voice --help | Honest: not production STT, no mic, no whisper.cpp, no download, exit 2, `--pipeline` alias, Windows-only pipe, opt-in `PQ_VOICE_HOST` |

## Gauntlet 8–12
| # | Item | Status |
|---|------|--------|
| 8 | Android SpeechRecognizer | WARUNKOWO OK — bridge + origin lock + JS glue |
| 9 | MSI / NSIS | unsigned; built then reclaimed for disk |
| 10 | Logos / marks | inventory + brand + letter-marks |
| 11 | Terminal DnD | quoting done; engine matrix TODO |
| 12 | Gauntlet process | adopted; A/B conditional (same-session critic) |

## Tests
- `cargo test --workspace`: **98 passed, 0 failed** (pq-core 89 + pq-voice 1 + pq-work 8 denylist)
- `npm run test:unit`: **24 passed** (dropPaths %/^ + originsMatch contract)
- Smoke: `scripts\rust-smoke.cmd` (no model download)
- TS: `node --experimental-strip-types src/main/voice-host.shutdown.smoke.ts`

## Toward 07:00
- Honest: still no whisper.cpp, no production Electron↔voice cutover, no PTY parity, no signing.
- Next day: cert → sign → optional dist refill; whisper.cpp = separate disk decision.

## Next
1. Code signing when cert available
2. Optional packaging pq-voice as extraResource
3. Real whisper.cpp = separate disk decision (not at ~1.6 GB free)
