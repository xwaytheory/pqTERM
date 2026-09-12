# pq workbench (gauntlet live board)

Last update: 2026-09-13 00:05 PT (Europe/Warsaw)

## Phase 1 (done)
- Branch: `feat/rust-phase1`
- Rust scaffold, migration doc, updater stub, pq-work/pq-voice
- `cargo build` OK; `pq-core` tests OK
- STT desktop **INTENT**: Whisper Large v3 / pl (Electron CURRENT still `Xenova/whisper-tiny`)

## Phase 2 overnight slice
- Port map: `docs/PORT-MAP.md`
- IPC stubs: `pq_core::ipc` — StartListen / Transcript / Cancel / Status + StubWorkClient / StubVoiceServer
- **`MemoryChannelStub` + `Transport` trait** (named pipe/WS later) — not production IPC
- Android STT: `docs/ANDROID-STT.md` + sketch (SpeechRecognizer only)

## Gauntlet round 2 (Krytyk revise) — this run
| Area | Was | Revise |
|------|-----|--------|
| Rust/STT/updater | LOCK wording; version 0.1.0 vs app 1.1.1; UNLICENSED; MemoryChannel oversell; installer docs contradict `npm run dist` | INTENT + CURRENT Electron tiny; WORKSPACE_VERSION **1.1.1**; MIT; MemoryChannelStub + Transport; dual packaging documented |
| DnD | Unix `\"` quotes; silent pathFor drops; no tests; dropEffect ambiguity | Windows `""` quoting; failures → console/overlay; threat note sandbox:false; `test:unit`; comment fixed |
| Packaging | appId `pq`; no upgradeCode; brand filename drift | `com.pq.app`; MSI upgradeCode GUID; `pq-256.png`/`pq-512.png`; unsigned/SmartScreen; dist vs stamp-host |
| Logos | inventory claimed resources empty | Fixed inventory; EngineSpec.logo/icon; letter-mark plan; favicon TODO |

## Night wave (items 8–12)
| Item | Topic | Wave | Verdict |
|------|-------|------|---------|
| 8 | Android SpeechRecognizer | propose→krytyk→revise | Lock + sketch/doc landed; MainActivity wire later |
| 9 | MSI + Setup.exe | r2 revise | appId + upgradeCode + docs; unsigned gap |
| 10 | Logos inventory | r2 revise | brand present; letter-mark plan; favicon TODO |
| 11 | DnD to terminals | r2 revise | quoting/tests/status; manual matrix pending |
| 12 | Gauntlet process | adopted | round 2 revise landed |

## Next
1. Rust: `env` + `store` in pq-core; portable-pty spike; real `Transport` (pipe/WS)
2. Android: paste SpeechRecognizer bridge into MainActivity + phone JS
3. Favicon from brand PNG; letter-mark chips in UI
4. Code signing when cert available; dist smoke-test
