# Tauri 2 vs Electron shell (spike only)

**Decision:** spike-only — **no lock-in**. Electron `src/` stays production until a later cutover phase.

## What maps from `src/main/index.ts`

| Electron concern | Tauri 2 analogue | Notes |
|------------------|------------------|-------|
| `app` ready / quit | Tauri builder lifecycle | Different event names |
| `BrowserWindow` | `WebviewWindow` | One window per workspace later |
| `ipcMain` / `ipcRenderer` | Tauri commands + events | Need 1:1 command inventory |
| `app.getPath('userData')` | `pq_core::env` + path APIs | Already mirrored in Rust |
| `node-pty` | `portable-pty` / ConPTY | See `docs/PTY-SPIKE.md` |
| Tray / shortcuts | Tauri plugins | Optional |
| Auto-updater | `pq_core::updater` + Tauri updater plugin | Stub exists; e2e later |
| NSIS/MSI today | electron-builder | Tauri bundler is alternate, not replacement yet |

## Pros (Tauri 2)

- Smaller disk/RAM vs Chromium-in-Electron
- Rust host shares crates with `pq-core` / `pq-work`
- Clearer security default (explicit command allowlist)

## Cons / risks

- Re-implement IPC surface used by renderer
- PTY + multi-pane performance unknown vs current Electron
- Packaging/signing pipeline already invested in electron-builder
- Voice process stays separate (`pq-voice`) either way

## Recommendation

Keep Electron shell through Phase 5 planning. Use Tauri only as a **spike branch** after `env`/`store`/`pty`/`ipc` are solid in Rust. Revisit with a parity checklist (`docs/PARITY.md`) before any cutover.