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
| `env.ts` | `runningDev()`, `productName()` (`pq` / `pq-dev`) | `pq-core::env` | 2 | planned |
| `host.ts` | Re-export Electron `app` / `BrowserWindow` / IPC | `pq-work` Tauri (or egui) host facade — **not** a 1:1 port | 5 | n/a → replace |
| `store.ts` | `%AppData%\pq*\pq-state.json` load/save, workspace snapshot | `pq-core::store` + `pq-work` | 2 | planned |
| `pty-manager.ts` | node-pty sessions, buf/seq, spawn/write/resize/kill | `pq-work::pty` (`portable-pty` / ConPTY) | 3 | planned |
| `bridge.ts` | Local HTTP control bridge + `pq` CLI helper on PATH | `pq-work::bridge` | 3 | planned |
| `engines.ts` | `ENGINE_SPECS` (bins, colors, models, hints) | `pq-core::engines` | 4 | planned |
| `providers.ts` | Scan installed CLIs / accounts on disk | `pq-work::providers` | 4 | planned |
| `resolve-launch.ts` | Resolve spawn file + args + env sanitization | `pq-work::launch` | 4 | planned |
| `index.ts` | App lifecycle, windows, ipcMain surface | `pq-work` main / Tauri commands | 5 | planned |
| `auth.ts` | Google OAuth PKCE + AccountChooser flow | `pq-work::auth` | 6 | planned |
| `trust.ts` | Workspace trust lists for agent CLIs | `pq-work::trust` | 6 | planned |
| `resume.ts` | Discover / attach prior engine sessions | `pq-work::resume` | 7 | planned |
| `board.ts` | `.pq/board.json` notes + live pane scrape | `pq-work::board` | 7 | planned |
| `sync.ts` | Engine self-update / npm sync events | `pq-work::sync` | 7 | planned |
| `usage.ts` | Token / quota windows per engine | `pq-work::usage` | 7 | planned |
| `remote.ts` | HTTP+WS `:4747`, cloudflared, phone commands | `pq-work::remote` | 8 | planned |

## Shared / cross-cutting (not under `src/main` but in scope)

| Source | Target | Phase | Status |
|--------|--------|-------|--------|
| `src/shared/types.ts` | `pq-core::types` (serde twins) | 2–3 | planned |
| Updater (new) | `pq-core::updater` | 1 done / 10 e2e | stub |
| Version constants | `pq-core::version` | 1 | stub |
| Voice IPC protocol | `pq-core::ipc` | **2 (this slice)** | **stub** |
| `voiceCommander.ts` / VoicePanel | `pq-voice` + IPC | 9 | planned |
| Android mic | Kotlin `SpeechRecognizer` (not Whisper) | docs + sketch | **documented** |

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
`Transport` trait + **`LocalTcpTransport`** spike (`127.0.0.1:4791` JSON-lines; `pq-work`/`pq-voice --ipc-tcp`). Demo/cross-process only — **not** production IPC (WS/named-pipe still future).  
JSON line codec: `encode_line` / `decode_line`.

## Suggested ownership

| Crate | Owns |
|-------|------|
| **pq-core** | env, store types, engines specs, version, updater, **ipc**, shared types |
| **pq-work** | pty, bridge, providers, launch, auth, trust, resume, board, sync, usage, remote, UI host |
| **pq-voice** | mic, VAD, Whisper Large v3, intent hints; speaks IPC only |

Updated: 2026-09-12 gauntlet round 2 (Transport trait + MemoryChannelStub naming).
