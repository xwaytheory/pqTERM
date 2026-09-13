# Electron vs Rust parity checklist

Legend: **done** / **stub** / **planned** / **electron** (still Electron-only) / **n/a**

Living board — update with PORT-MAP. Electron remains production.

## Main modules (`src/main/*`)

| Module | Electron | Rust target | Status |
|--------|----------|-------------|--------|
| `env.ts` | live | `pq-core::env` | **done** (unit tests) |
| `store.ts` | live | `pq-core::store` | **done** lean load/save; provider ENGINE_SPECS merge **gap** |
| `host.ts` | live | Tauri/host facade | **n/a** replace later |
| `pty-manager.ts` | live | `pq-work` SessionRegistry | **stub registry** — not twin; ConPTY = `pty-spike` |
| `bridge.ts` | live | `pq-work::bridge` | **planned** |
| `engines.ts` | live | `pq-core::engines` | **done** |
| `providers.ts` | live | `pq-core::providers` | **stub** fixture I/O (no live home scan) |
| `resolve-launch.ts` | live | `pq-work::launch` | **planned** |
| `index.ts` | live | `pq-work` / Tauri | **planned** |
| `auth.ts` | live | `pq-core::auth` | **stub** sketch |
| `trust.ts` | live | `pq-work::trust` | **planned** (TS swallows errors) |
| `resume.ts` | live | `pq-core::resume` | **stub** types + fixture path I/O |
| `board.ts` | live | `pq-core::board` | **stub** sketch |
| `sync.ts` | live | `pq-core::sync` | **stub** types + order |
| `usage.ts` | live | `pq-core::usage` | **stub** types + pct |
| `remote.ts` | live | `pq-core::remote` | **stub** `:4747` types |

## Cross-cutting

| Area | Status |
|------|--------|
| Version constants | **stub** `pq-core::version` |
| Updater | **stub** FileManifestFetch + GitHub fixture (no network) |
| IPC protocol messages | **stub** + JSON codec |
| `MemoryChannelStub` | **stub** (tests/demo) |
| `LocalTcpTransport` | **stub** spike + `--ipc-demo` e2e |
| `NamedPipeTransport` | **spike** real Windows JSON-line (`kind=named-pipe`); stub off-Windows; `--ipc-pipe` |
| WebSocket transport | **planned** |
| Shared TS types serde twins | **partial** (store + board/remote/auth sketches) |
| STT desktop | Electron CURRENT tiny; Rust INTENT Large v3 **skeleton** (`--listen`, no download) |
| Android STT | **wired** origin lock + gauntlet B (getUserMedia deny, mic retry) |
| Tauri shell | **spike doc only** (`docs/TAURI-SPIKE.md`) |

Updated: 2026-09-13 NamedPipeTransport Windows spike + resume/providers fixture honesty.
