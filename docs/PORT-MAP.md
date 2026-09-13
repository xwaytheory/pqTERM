# Electron `src/main/*` → Rust port map

Living map for the overnight migration. Electron remains production until cutover.
See also: `docs/MIGRATION-RUST.md`, `crates/pq-core/src/ipc.rs`.

**Legend**

| Status | Meaning |
|--------|---------|
| stub | Types / empty binary hooks only |
| planned | Documented target module, not started |
| electron | Still Electron-only (no Rust yet) |
| n/a | Stays outside Rust binaries (renderer / host shim) |

## Full table (`src/main/*.ts`)

| Electron source | Role today | Target crate / module | Phase | Status |
|-----------------|------------|------------------------|-------|--------|
| `env.ts` | `runningDev()`, `productName()` (`pq` / `pq-dev`) | `pq-core::env` | 2 | **done** (unit tests) |
| `host.ts` | Re-export Electron `app` / `BrowserWindow` / IPC | `pq-work` Tauri (or egui) host facade — **not** a 1:1 port | 5 | n/a → replace |
| `store.ts` | `%AppData%\pq*\pq-state.json` load/save, workspace snapshot | `pq-core::store` + `pq-work` | 2 | **done** lean serde; ENGINE_SPECS merge gap |
| `pty-manager.ts` | node-pty sessions, buf/seq, spawn/write/resize/kill | `pq-work::pty_manager` **SessionRegistry** (+ `pty-spike` ConPTY) | 3 | **registry + optional live** (`spawn_prefer_live`; write false without I/O) |
| `bridge.ts` | Local HTTP control bridge + `pq` CLI helper on PATH | `pq-work::bridge` | 3 | planned |
| `engines.ts` | `ENGINE_SPECS` (bins, colors, models, hints) | `pq-core::engines` | 4 | **done** catalog + merge |
| `providers.ts` | Scan installed CLIs / accounts on disk | `pq-work::providers` | 4 | planned |
| `resolve-launch.ts` | Resolve spawn file + args + env sanitization | `pq-work::launch` | 4 | planned |
| `index.ts` | App lifecycle, windows, ipcMain surface | `pq-work` main / Tauri commands | 5 | planned |
| `auth.ts` | Google OAuth PKCE + AccountChooser flow | `pq-core::auth` sketch → `pq-work::auth` | 6 | **stub** authorize URL / userinfo / chooser parity types |
| `trust.ts` | Workspace trust lists for agent CLIs | `pq-work::trust` | 6 | planned (note: TS swallows errors) |
| `resume.ts` | Discover / attach prior engine sessions | `pq-core::resume` types → `pq-work` I/O later | 7 | **stub** types + pick/flag tests (no disk scan) |
| `board.ts` | `.pq/board.json` notes + live pane scrape | `pq-core::board` sketch | 7 | **stub** types + overlap notes + hub stub (no timer/git) |
| `sync.ts` | Engine self-update / npm sync events | `pq-core::sync` types → `pq-work` I/O later | 7 | **stub** SyncEvent + job order (no npm/pip) |
| `usage.ts` | Token / quota windows per engine | `pq-core::usage` types → `pq-work` I/O later | 7 | **stub** UsageWindow/Hub (no HTTP) |
| `remote.ts` | HTTP+WS `:4747`, cloudflared, phone commands | `pq-core::remote` sketch | 8 | **stub** RemoteInfo / WS events / pair limit / MIME |

## Shared / cross-cutting (not under `src/main` but in scope)

| Source | Target | Phase | Status |
|--------|--------|-------|--------|
| `src/shared/types.ts` | `pq-core::store` (+ board/remote/auth) | 2–3 | **partial** |
| Updater (new) | `pq-core::updater` + fixtures | 1 / 10 e2e | **stub** FileManifestFetch + `OfferUpdate` + `pq-work --check-update` |
| Version constants | `pq-core::version` | 1 | stub |
| Voice IPC protocol | `pq-core::ipc` | 2 | **stub** + `--ipc-demo` LocalTcp e2e |
| `voiceCommander.ts` / VoicePanel | `pq-voice` + IPC | 9 | **skeleton** listen/transcribe + host-bridge doc |
| Android mic | Kotlin `SpeechRecognizer` + origin lock | docs + bridge | **wired** (gauntlet B revise) |

## IPC message map (work ↔ voice)

| Message | Direction | Purpose |
|---------|-----------|---------|
| `StartListen` | work → voice | Begin capture/STT for `session_id` |
| `Transcript` | voice → work | Partial/final text (+ lang) |
| `Cancel` | work → voice | Abort listen / STT |
| `Status` | voice → work | Idle / Listening / Processing / Ready / Error / Cancelled |

Stub client: `pq_core::ipc::StubWorkClient` (used from `pq-work`).  
Stub server: `pq_core::ipc::StubVoiceServer` (used from `pq-voice`).  
`MemoryChannelStub` = **in-process demo/test only** (not production IPC).  
`Transport` trait + **`LocalTcpTransport`** spike (`127.0.0.1:4791` JSON-lines; `pq-work`/`pq-voice --ipc-tcp`). **`--ipc-demo`** runs the same codec in-process (`local_tcp_ipc_demo`). **`VoiceIpcFlow`** names the e2e kinds. **`NamedPipeTransport` stub** documents `\\.\pipe\pq-voice-{session}` (compile-safe; no OS I/O yet). Host spawn plan: `docs/VOICE-HOST-BRIDGE.md`. Demo/cross-process only — **not** production IPC (WS/named-pipe still future).  
JSON line codec: `encode_line` / `decode_line`.

## Suggested ownership

| Crate | Owns |
|-------|------|
| **pq-core** | env, store, engines, version, updater, ipc, **auth/remote/board/resume/usage/sync sketches**, stt pipeline |
| **pq-work** | SessionRegistry/pty, bridge, providers, launch, trust, resume, sync, usage, UI host |
| **pq-voice** | mic, VAD, Whisper Large v3, intent hints; speaks IPC only |

Updated: 2026-09-13 slice8 — voice pipeline skeleton, --ipc-demo, resume/usage/sync types.
