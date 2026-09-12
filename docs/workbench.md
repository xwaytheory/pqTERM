# pq workbench (gauntlet live board)

Last update: 2026-09-13 00:55 PT (Europe/Warsaw)

## Phase 1 (done)
- Branch: `feat/rust-phase1`
- Rust scaffold, migration doc, updater stub, pq-work/pq-voice
- `cargo build` OK; `pq-core` tests OK
- STT desktop **INTENT**: Whisper Large v3 / pl (Electron CURRENT still `Xenova/whisper-tiny`)

## Phase 2 overnight slice
- Port map: `docs/PORT-MAP.md`
- IPC stubs: `pq_core::ipc` — StartListen / Transcript / Cancel / Status + StubWorkClient / StubVoiceServer
- **`MemoryChannelStub` + `Transport` trait** + **`LocalTcpTransport` spike** (`--ipc-tcp`, JSON-lines on `127.0.0.1:4791`) — demo/cross-process only, **not** production IPC
- Android STT: `docs/ANDROID-STT.md` (**INTENT**, not lock) + sketch (SpeechRecognizer only)

## Gauntlet round 2 → r3 revise (this run)
| Area | Was | Revise |
|------|-----|--------|
| STT docs | README implied Large v3 lock; ANDROID **LOCKED** | Honest three-way map: CURRENT tiny / INTENT Large v3 / Android SpeechRecognizer INTENT |
| Updater | Tautology `current` vs `current` | `STUB_REMOTE_LATEST=1.1.2` + `stub_remote_delta()` (still stub, no network) |
| Transport | Memory-only | `LocalTcpTransport` + binary `--ipc-tcp` demos; docs say not prod |
| Logos / UI | color dots; favicon TODO; inventory "colors only" | Letter-mark chips + two-letter collisions (Cl/Cx/Cr/Co, Gr/Ge, Om/Oc); favicon from brand; inventory fixed |
| Packaging | no publisherName; installer claims fuzzy | `publisherName` placeholder; README: don't claim NSIS/MSI without `release/` artifacts; `npm run dist` smoke still TODO |
| PTY PATH | Cursor IDE bin injected | Removed (Krytyk r3) |

## Night wave (items 8–12)
| Item | Topic | Wave | Verdict |
|------|-------|------|---------|
| 8 | Android SpeechRecognizer | propose→krytyk→revise | INTENT + sketch/doc; MainActivity wire later |
| 9 | MSI + Setup.exe | r3 revise | appId + upgradeCode + publisherName placeholder; unsigned; dist smoke TODO |
| 10 | Logos inventory | r3 revise | brand + favicon + letter-mark chips + collision marks |
| 11 | DnD to terminals | r2 revise | quoting/tests/status; manual matrix pending |
| 12 | Gauntlet process | adopted | r3 revise folded into overnight slice |

## Next
1. Rust: `env` + `store` in pq-core; portable-pty spike; WS/named-pipe Transport (beyond TCP spike)
2. Android: paste SpeechRecognizer bridge into MainActivity + phone JS
3. `npm run dist` smoke when free; code signing when cert available
4. Optional per-engine SVG monograms under `resources/engines/`
5. DnD / shell: note WSL/bash quoting param later (Krytyk #2 warunkowo OK)
