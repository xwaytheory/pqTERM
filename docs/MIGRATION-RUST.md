# Migracja Electron → Rust (pq)

## Podsumowanie (PL)

Phase 1 to **plan + szkielet** — bez zastępowania Electrona.

- Dzielimy produkt na dwa procesy: **pq-work** (workbench: siatka terminali, IPC, store, remote) i **pq-voice** (asystent głosowy + STT).
- Workspace Cargo w `crates/`: `pq-core` (wspólne typy, wersja, updater stub), `pq-work`, `pq-voice`.
- **STT INTENT (nie runtime lock):** Whisper **Large v3** (`openai/whisper-large-v3` / `ggml-large-v3.bin`), język `pl` — cel produktu dla **pq-voice**. **CURRENT Electron** nadal używa `Xenova/whisper-tiny` w `voiceCommander.ts` (`@huggingface/transformers`). Large dopiero przy porcie voice.
- Auto-update: check przy starcie względem manifestu z GitHub Releases (szkic JSON + `compare_semver` + mock fetch).
- Electron (`src/`, `package.json`, `host/`) **zostaje** produkcją do kolejnych faz.
- Hipoteza UI później: **Tauri** dla pq-work; terminale: **ConPTY** / `portable-pty` (lekka weryfikacja poniżej — bez implementacji w Phase 1).

---

## English detail


### Phase 2 progress (2026-09-13 overnight)

- `pq-core::env`: `running_dev()`, `product_name()`, `user_data_dir()` (+ tests).
- `pq-core::store`: lean `AppSnapshot` serde, `load_state` / `save_state` / tempfile roundtrip.
  Provider merge vs `ENGINE_SPECS` still Electron-only (documented gap).
- `NamedPipeTransport` stub in `pq-core::ipc` (path contract `\\.\pipe\pq-voice-{session}`); `LocalTcpTransport` kept.
- Optional `pq-work` feature `pty-spike` (`portable-pty` ConPTY echo) — see `docs/PTY-SPIKE.md`.
- Spike docs: `docs/TAURI-SPIKE.md`, parity board `docs/PARITY.md`, live `docs/workbench.html`.
### Goals of the migration

Replace the Electron shell gradually with native Rust binaries while keeping feature parity:

| Process | Role |
|---------|------|
| **pq-work** | Workbench: windows/UI host, PTY grid, engines, auth, store, board, remote WS, usage |
| **pq-voice** | Voice assistant: mic capture, VAD, STT, intent router; talks to pq-work over IPC |

Shared logic lives in **pq-core** (version constants, update manifest types, later: shared protocol types).

### STT target (INTENT — not a runtime lock)

| Field | Value |
|-------|--------|
| Model family | **OpenAI Whisper Large (latest)** |
| Model id (HF / OpenAI) | `openai/whisper-large-v3` |
| Local GGML / whisper.cpp | `ggml-large-v3.bin` |
| Language | `pl` (Polish) |
| Rationale | **Intent** for desktop Rust/pq-voice: Large v3 flagship Whisper for Polish. Not tiny/base/small/medium as the port default. |
| Electron **CURRENT** | `Xenova/whisper-tiny` via `@huggingface/transformers` in `voiceCommander.ts` — **still production**; do not document as Large. Port upgrades to Large v3. |

Constants are mirrored in `pq_core::stt` for Rust code comments/docs.

### Workspace layout (Phase 1)

```
pq/
├── crates/
│   ├── Cargo.toml          # workspace
│   ├── pq-core/            # lib: version, updater stubs, stt constants
│   ├── pq-work/            # bin stub
│   └── pq-voice/           # bin stub
├── docs/MIGRATION-RUST.md  # this file
├── src/                    # Electron (still production)
└── ...
```

License: workspace crates use **MIT** (aligned with root `package.json`).

Build:

```bat
cd crates
cargo build
cargo test -p pq-core
```

### Phased port order of `src/main/*`

Suggested order (dependencies first; do not rip out Electron until the Rust side covers the same IPC surface):

| Phase | Module(s) | Notes |
|-------|-----------|--------|
| 1 (done) | — | Plan + Cargo scaffold + updater stubs |
| 2 (partial) | port map + `pq_core::ipc` stubs | `docs/PORT-MAP.md`; StartListen/Transcript/Cancel/Status; Android STT doc |
| 2 | `env.ts`, `host.ts`, `store.ts` | Paths, product name, `%AppData%\pq*` state JSON |
| 3 | `pty-manager.ts`, `bridge.ts` | ConPTY / portable-pty; pane spawn/write/resize |
| 4 | `engines.ts`, `providers.ts`, `resolve-launch.ts` | Agent CLI discovery + launch args |
| 5 | `index.ts` shell + window/lifecycle | Replace Electron BrowserWindow with Tauri (or alternate) |
| 6 | `auth.ts`, `trust.ts` | Google OAuth PKCE / AccountChooser / local |
| 7 | `resume.ts`, `board.ts`, `sync.ts`, `usage.ts` | Session resume, `.pq/board.json`, token budgets |
| 8 | `remote.ts` | WS :4747 phone control + cloudflared |
| 9 | Voice port → **pq-voice** | Whisper Large v3 + commander intents |
| 10 | Updater end-to-end | Real HTTP fetch, checksum, replace+relaunch |
| 11 | Cutover | Stamp Rust binaries; Electron becomes fallback / removed |

Renderer (`src/renderer`), preload, phone, android stay on web/Kotlin until UI host decision solidifies.

### IPC between pq-work and pq-voice

Phase 2 overnight slice: **typed stubs compile** in `pq_core::ipc` + used from both binaries.

- **Transport (Windows first, later):** named pipe `\\.\pipe\pq-voice-{session}` or loopback WebSocket `ws://127.0.0.1:<ephemeral>`.
- **Auth (later):** random token written by pq-work at launch; pq-voice receives via argv/env.
- **Messages (JSON lines, `serde` tagged `type`) — stubbed now:**
  - `start_listen` → `StartListen { session_id, language, timeout_ms }` (work → voice)
  - `transcript` → `Transcript { session_id, text, lang, is_final }` (voice → work)
  - `cancel` → `Cancel { session_id, reason }` (work → voice)
  - `status` → `Status { source, state, detail, session_id }` (voice → work)
- **Stubs:** `StubWorkClient` (pq-work), `StubVoiceServer` (pq-voice), `encode_line` / `decode_line`, **`MemoryChannelStub` (test/demo only — not production IPC)** + [`Transport`] trait for future named pipe / WS.
- **Later (not this slice):** `voice.intent`, `work.snapshot` / `work.focus` / `work.exec`.
- **Lifecycle:** pq-work spawns pq-voice when VoicePanel opens (or on demand); kills on close.
- Electron path today keeps voice in-renderer; dual-run during migration via feature flag.

Full Electron→Rust module table: **`docs/PORT-MAP.md`**. Android phone STT sketch: **`docs/ANDROID-STT.md`**.

### Updater via GitHub Releases (manifest sketch)

Check-on-launch (both binaries):

1. Read embedded `WORKSPACE_VERSION` (`pq_core::version`) — **synced to Electron `package.json` `1.1.1`** (dual-track documented in `version.rs`).
2. `GET` manifest URL (default sketch: `.../releases/latest/download/pq-update-manifest.json`).
3. `compare_semver(current, manifest.latest)`.
4. If newer: download matching `assets[].platform`, verify `sha256`, stage, relaunch.

Example manifest:

```json
{
  "latest": "1.2.0",
  "channel": "stable",
  "published_at": "2026-09-12T20:00:00Z",
  "assets": [
    {
      "platform": "windows-x64",
      "url": "https://github.com/xwaytheory/pq/releases/download/v1.2.0/pq-work-windows-x64.exe",
      "sha256": "...",
      "size": 12345678
    },
    {
      "platform": "windows-x64-voice",
      "url": "https://github.com/xwaytheory/pq/releases/download/v1.2.0/pq-voice-windows-x64.exe",
      "sha256": "...",
      "size": 23456789
    }
  ]
}
```

Phase 1 implements: types, `compare_semver`, `ManifestFetch` trait + `MockManifestFetch`, `fetch_manifest` parse. No live network in the stub path.

### Voice inventory (Electron → later pq-voice)

| Path | Role |
|------|------|
| `src/renderer/src/components/VoicePanel.tsx` | UI: mic button, phase labels (PL), transcript, logs, clarify flow |
| `src/renderer/src/lib/voiceCommander.ts` | Capture + VAD, Whisper pipeline (`Xenova/whisper-tiny`, `language: 'polish'`), intent router (`runText`) |
| `src/renderer/src/styles.css` | `.voice-stage`, `.voice-state`, `.voice-log`, `.voice-edit`, `.voice-pending` (~line 1036+) |
| `src/renderer/src/screens/DeckScreen.tsx` | Embeds / opens VoicePanel |
| `package.json` | `@huggingface/transformers` ^4.2.0 |
| `android/.../AndroidManifest.xml` | `RECORD_AUDIO` permission |
| `android/.../MainActivity.kt` | WebView `onPermissionRequest` → `REQ_MIC` (401); grants `RESOURCE_AUDIO_CAPTURE` |

Android mic notes: phone WebView requests audio capture; activity bridges to runtime `RECORD_AUDIO`. Rust voice on desktop will use native capture (cpal / wasapi); Android remains WebView/Kotlin until a separate native voice path exists.

### Hypothesis: Tauri + ConPTY (light verification)

| Topic | Finding (Phase 1, no impl) |
|-------|----------------------------|
| **Tauri 2** | Fits pq-work as thin native shell + webview for React/xterm UI; sidesteps shipping full Chromium via Electron. IPC maps cleanly to Tauri commands/events. Risk: node-pty / native Node addons need pure-Rust replacements. |
| **ConPTY** | Windows Console Pseudo-Terminal is the right backend for pane TTYs (what node-pty uses under the hood on Win). Rust: `portable-pty` (wezterm) or `conpty` crates are viable. |
| **Decision** | Defer choosing Tauri vs egui/iced until Phase 5; prefer Tauri if renderer reuse is valuable. |

### Non-goals (Phase 1)

- No git push; no rewriting Electron.
- No full Tauri project, no real Whisper runtime in Rust yet.
- No deleting `host/`, `src/`, or npm scripts.

### Toolchain

Verified on DESKTOP-3I4REKQ: `rustc`/`cargo`/`rustup` **1.93.1** already installed — no rustup install required for Phase 1.

---

## Suggested next phase

**Phase 2 (partial — this overnight slice):** Port map (`docs/PORT-MAP.md`), IPC stubs (`pq_core::ipc`), Android SpeechRecognizer sketch (`docs/ANDROID-STT.md`).

**Still Phase 2+:** Implement `store` + `env` in `pq-core`/`pq-work`, real HTTP `ManifestFetch` (reqwest), spike `portable-pty` hello-world pane, wire Android sketch into `MainActivity` — Electron remains daily driver.

## Night additions (2026-09-12) — product intents

### Android voice = native STT (INTENT)

- **Phone/Android does NOT run Whisper.** Use Android `SpeechRecognizer` (system STT) for mic → text on device.
- Desktop **pq-voice INTENT** remains Whisper Large v3 (`openai/whisper-large-v3` / `ggml-large-v3.bin`, `pl`).
- Wire Android → existing remote WS intents the same way typed commands do; no on-device Whisper model download on phone.

### Windows installers (target)

- Ship **MSI** + classic **Setup .exe** (electron-builder `nsis` + `msi`, later WiX/cargo-wix for Rust).
- **Two packaging paths (do not conflate):**
  - `build.win.target: "dir"` + `npm run stamp` / `START-prod.cmd` → stamped `host/pq.exe` (daily portable).
  - `npm run dist` → `electron-builder --win nsis msi` → installers under `release/` (NSIS Setup + MSI with stable `upgradeCode`).
  - Builds are **unsigned** → Windows SmartScreen warnings expected until a code-signing cert is configured.

### Process

Every non-trivial solution runs **gauntlet-loop**: propose → Krytyk pq (independent) → revise. Skill: Hermes `software-development/gauntlet-loop`. Night backlog detail: `docs/BACKLOG-NIGHT.md`, logos: `docs/LOGOS-INVENTORY.md`, live board: `docs/workbench.md`.
