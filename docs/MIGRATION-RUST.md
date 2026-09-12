# Migracja Electron → Rust (pq)

## Podsumowanie (PL)

Phase 1 to **plan + szkielet** — bez zastępowania Electrona.

- Dzielimy produkt na dwa procesy: **pq-work** (workbench: siatka terminali, IPC, store, remote) i **pq-voice** (asystent głosowy + STT).
- Workspace Cargo w `crates/`: `pq-core` (wspólne typy, wersja, updater stub), `pq-work`, `pq-voice`.
- **STT na sztywno:** Whisper **Large v3** (`openai/whisper-large-v3` / `ggml-large-v3.bin`), język `pl` — decyzja produktowa (Paweł). Electron dziś ma `Xenova/whisper-tiny`; przy porcie voice idziemy od razu na Large.
- Auto-update: check przy starcie względem manifestu z GitHub Releases (szkic JSON + `compare_semver` + mock fetch).
- Electron (`src/`, `package.json`, `host/`) **zostaje** produkcją do kolejnych faz.
- Hipoteza UI później: **Tauri** dla pq-work; terminale: **ConPTY** / `portable-pty` (lekka weryfikacja poniżej — bez implementacji w Phase 1).

---

## English detail

### Goals of the migration

Replace the Electron shell gradually with native Rust binaries while keeping feature parity:

| Process | Role |
|---------|------|
| **pq-work** | Workbench: windows/UI host, PTY grid, engines, auth, store, board, remote WS, usage |
| **pq-voice** | Voice assistant: mic capture, VAD, STT, intent router; talks to pq-work over IPC |

Shared logic lives in **pq-core** (version constants, update manifest types, later: shared protocol types).

### STT target (LOCKED)

| Field | Value |
|-------|--------|
| Model family | **OpenAI Whisper Large (latest)** |
| Model id (HF / OpenAI) | `openai/whisper-large-v3` |
| Local GGML / whisper.cpp | `ggml-large-v3.bin` |
| Language | `pl` (Polish) |
| Rationale | Large v3 is the current flagship Whisper checkpoint; best Polish ASR quality in the Whisper family. Product owner locked Large (not tiny/base/small/medium, not turbo-as-default). |
| Electron today | `Xenova/whisper-tiny` via `@huggingface/transformers` in `voiceCommander.ts` — temporary; port upgrades to Large v3. |

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

Sketch (Phase 1 — design only):

- **Transport (Windows first):** named pipe `\\.\pipe\pq-voice-{session}` or loopback WebSocket `ws://127.0.0.1:<ephemeral>`.
- **Auth:** random token written by pq-work at launch; pq-voice receives via argv/env.
- **Messages (JSON lines):**
  - `voice.transcript` `{ text, lang }`
  - `voice.intent` `{ kind, payload }` (mirror current `runText` outcomes)
  - `work.snapshot` / `work.focus` — app snapshot + focused pane for commander
  - `work.exec` — ask workbench to run an intent (spawn engine, fill pane, etc.)
- **Lifecycle:** pq-work spawns pq-voice when VoicePanel opens (or on demand); kills on close.
- Electron path today keeps voice in-renderer; dual-run during migration via feature flag.

### Updater via GitHub Releases (manifest sketch)

Check-on-launch (both binaries):

1. Read embedded `WORKSPACE_VERSION` (`pq_core::version`).
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

**Phase 2:** Implement `store` + `env` equivalents in `pq-core`/`pq-work`, add real HTTP `ManifestFetch` (reqwest), scaffold IPC protocol crate module, and spike `portable-pty` hello-world pane — still leaving Electron as the daily driver.


---

## Night additions (2026-09-12) — product locks

### Android voice = native STT (LOCKED)

- **Phone/Android does NOT run Whisper.** Use Android `SpeechRecognizer` (system STT) for mic → text on device.
- Desktop **pq-voice** remains Whisper Large v3 (`openai/whisper-large-v3` / `ggml-large-v3.bin`, `pl`).
- Wire Android → existing remote WS intents the same way typed commands do; no on-device Whisper model download on phone.

### Windows installers (target)

- Ship **MSI** + classic **Setup .exe** (electron-builder `nsis` + `msi`, later WiX/cargo-wix for Rust).
- Today: `package.json` `build.win.target` is only `"dir"` + stamped `host/pq.exe` — not a real installer yet.

### Process

Every non-trivial solution runs **gauntlet-loop**: propose → Krytyk pq (independent) → revise. Skill: Hermes `software-development/gauntlet-loop`. Night backlog detail: `docs/BACKLOG-NIGHT.md`, logos: `docs/LOGOS-INVENTORY.md`, live board: `docs/workbench.md`.
