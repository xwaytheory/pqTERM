# pq workbench (gauntlet live board)

Last update: 2026-09-13 00:25 PT (Europe/Warsaw)

## Stage / progress
- **Stage:** Phase 2 overnight slice (env + store + pty spike + named-pipe stub)
- **Rough %:** ~55% of Phase 2 scaffolding (IPC/env/store in; engines/pty-manager/bridge still ahead)
- **Branch:** `feat/rust-phase1` (local commits only)

## Phase 1 (done)
- Rust scaffold, migration doc, updater stub, pq-work/pq-voice
- `cargo build` OK; `pq-core` tests OK
- STT desktop **INTENT**: Whisper Large v3 / pl (Electron CURRENT still `Xenova/whisper-tiny`)

## Phase 2 overnight slice (this run)
- Port map: `docs/PORT-MAP.md` (env/store → **done**; pty → stub)
- **`pq-core::env`**: `running_dev`, `product_name`, `%APPDATA%\{pq|pq-dev}` helpers + tests
- **`pq-core::store`**: lean `AppSnapshot` serde, load/save/exists, tempfile roundtrip; ENGINE_SPECS merge **gap**
- **`NamedPipeTransport` stub** (`\\.\pipe\pq-voice-{session}`) + contract test; `LocalTcpTransport` kept
- **`pty-spike`** optional feature on pq-work (`portable-pty` ConPTY echo) — `docs/PTY-SPIKE.md`
- Docs: `docs/TAURI-SPIKE.md`, `docs/PARITY.md`, `docs/workbench.html`
- IPC stubs from prior night: MemoryChannelStub + LocalTcpTransport + Android STT doc

## Gauntlet (same-session Krytyk pq) — env/store + pty

### Propose
- Port Electron `env.ts` / `store.ts` into pq-core with Windows AppData paths and JSON roundtrip.
- Optional `portable-pty` feature proving ConPTY spawn on this machine.
- Named-pipe Transport stub documenting production pipe path without ripping TCP spike.

### Krytyk pq (same-session critic)
1. **Store parity:** Without `ENGINE_SPECS`, Rust `empty()`/`mergeProviders` diverge from Electron — risk of wiping providers if Rust save is pointed at real `%APPDATA%\pq`.
2. **CamelCase wire:** TS uses `signedInAt` / `clientId`; Rust must serde-rename or break Electron files.
3. **PTY spike:** ConPTY DSR (`CSI 6n`) can stall `cmd`; a spike that only `openpty` without answering DSR is a false green.
4. **Named pipe:** A stub that claims "transport" but never I/O must not be documented as production-ready.
5. **Env tests:** Process-global env vars need a mutex or tests flake under `--test-threads`.

### Revise (addressed)
1. Document ENGINE_SPECS merge **gap**; Rust save used in unit tests via tempfile only — do not replace Electron store in prod yet.
2. `#[serde(rename_all = "camelCase")]` on snapshot structs; camelCase wire compat test.
3. Spike answers DSR; captures `pq-pty-ok`; docs note init noise (`docs/PTY-SPIKE.md`).
4. `kind()` = `named-pipe-stub`; send/recv return `NotConnected` / Transport error; PORT-MAP says not prod.
5. `ENV_LOCK` mutex in `env` tests.

### Verdict
**WARUNKOWO OK** — env/store/pty-spike/named-pipe stub land with documented gaps (provider merge, real pipe I/O, full pty-manager). Electron production paths untouched.

## Night wave (items 8–12) — prior
| Item | Topic | Verdict |
|------|-------|---------|
| 8 | Android SpeechRecognizer | INTENT + sketch/doc |
| 9 | MSI + Setup.exe | publisherName placeholder; dist smoke TODO |
| 10 | Logos inventory | letter-marks + favicon |
| 11 | DnD to terminals | quoting/tests; manual matrix pending |
| 12 | Gauntlet process | adopted |

## Decisions
- Tauri: spike-only, no lock-in (`docs/TAURI-SPIKE.md`)
- Keep Electron store as production writer until engines ported
- Named pipe path contract fixed; OS I/O later

## Risks
- Accidental Rust `save_state()` to real AppData without provider merge
- ConPTY behaviour differs across Windows builds
- Feature `pty-spike` pulls winapi — keep optional

## Files touched (this slice)
- `crates/pq-core/src/{env,store,lib,ipc}.rs`
- `crates/pq-work/src/{main,pty_spike}.rs`, `Cargo.toml`
- `docs/{PORT-MAP,MIGRATION-RUST,PTY-SPIKE,TAURI-SPIKE,PARITY,workbench.md,workbench.html}`

## Next night slot
1. `pq-core::engines` + real provider merge in store
2. Real named-pipe I/O (or WS) behind Transport
3. Start `pty-manager` port (resize/write/session map) beyond spike
4. Android MainActivity SpeechRecognizer wire
5. `npm run dist` smoke when free