# Night backlog — items 8–12 (gauntlet)

Updated: 2026-09-13 00:00 PT (gauntlet round 2 revise)  
Branch: `feat/rust-phase1`  
Process: **gauntlet-loop** (Hermes skill `software-development/gauntlet-loop`) — propose → independent Krytyk pq → revise. Live board: `docs/workbench.md`.

---

## 8) Android voice = native SpeechRecognizer

**Goal:** Phone mic uses Android system STT, not Whisper-on-device.

**Bar:** Compare to Gboard voice input / Google Recorder reliability on Polish; latency < ~1.5s to first final hypothesis on mid-range Android; works offline only if user has offline speech pack (document limitation).

### Propose
- In `MainActivity` / WebView bridge: start `SpeechRecognizer` with `RecognizerIntent.LANGUAGE_MODEL_FREE_FORM`, locale `pl-PL`.
- Stream partial/final results into phone web UI → existing remote WS command path (same as typed).
- Desktop STT stays Whisper Large v3 in pq-voice; Android never downloads GGML.

### Krytyk pq
- WebView already requests `RECORD_AUDIO`; adding SpeechRecognizer must not fight WebView `getUserMedia` if both exist — pick **one** phone path.
- Offline Polish packs are inconsistent across OEMs — UI must show “wymaga usług Google / pakietu mowy”.
- Don’t couple Android STT to Electron Whisper upgrade.

### Revise
- **Canonical phone path:** native `SpeechRecognizer` only; remove/avoid browser STT on Android WebView.
- Surface errors (`ERROR_INSUFFICIENT_PERMISSIONS`, `ERROR_NETWORK`, etc.) in Polish.
- Keep intent routing on PC (`voiceCommander` / later pq-work IPC).

**Status:** documented lock + **overnight sketch landed** (`docs/ANDROID-STT.md`, `android/sketch/SpeechRecognizerBridge.kt`). MainActivity / phone JS wiring = later; no Whisper on phone.

---

## 9) MSI + normal Windows .exe installer

**Goal:** Users install pq via Setup.exe and/or MSI, not only stamped `host/pq.exe`.

**Bar:** VS Code / Discord Windows installers — Start Menu entry, optional Desktop shortcut, per-user default, clean uninstall, signed binary when cert available.

### Propose
- Near-term (Electron still production): electron-builder targets `nsis` (Setup.exe) + `msi`; set `win.icon` once brand `.ico` exists; output under `release/`.
- Long-term (Rust): `cargo-wix` MSI for pq-work; NSIS or `tauri-bundler` for Setup.exe; reuse GitHub Releases + updater manifest from Phase 1.

### Krytyk pq
- Current `build.win.target: "dir"` + custom stamp-host bypasses electron-builder packaging — changing targets must not break `START-prod.cmd` overnight.
- Code signing absent → SmartScreen warnings; document as known gap.
- MSI + NSIS duplicate maintenance — OK for Electron era; consolidate when Rust cutover.

### Revise
1. Add `resources/brand/pq.ico` (depends on item 10).
2. Extend `package.json` build.win targets to `["nsis","msi"]` behind a new script `npm run dist` (keep `stamp`/`START-prod` working).
3. Document install/uninstall in README.
4. Updater manifest assets point at installer or portable exe explicitly.

**Status (r2 revise):** `appId: com.pq.app`; MSI `upgradeCode` stable GUID; brand files `pq.ico` / `pq-256.png` / `pq-512.png`. `build.win.target` stays `dir` for stamp-host/`START-prod`; `npm run dist` builds NSIS+MSI into `release/`. **Unsigned** → SmartScreen warnings (known gap). Full dist smoke-test TODO.

---

## 10) Design/logo + harness marks

See `docs/LOGOS-INVENTORY.md`.

**Status (r2):** inventory fixed (`resources/brand` exists); `EngineSpec.logo`/`icon` optional; letter-mark chip plan in LOGOS-INVENTORY; **favicon TODO**.

---

## 11) Drag & drop images/files/folders into CLI terminals

**Goal:** Drop files/folders/images onto a pane → paths (and/or image bytes for vision CLIs) land in the focused agent TTY.

**Bar:** Windows Terminal / VS Code terminal DnD — dropping a file inserts quoted path; multi-select works; folders allowed; images usable by agents that accept paths.

### Propose
- On `TerminalPane` xterm container: `dragover` preventDefault + `drop` handler.
- Resolve `File.path` (Electron) / use `webUtils.getPathForFile` (Electron 32+) for each item.
- Write to PTY via existing `panes.write` / bridge: space-separated `"C:\quoted\paths"` at cursor.
- Optional: if image and engine supports vision, also copy into workspace `.pq/drops/` and paste relative path.

### Krytyk pq
- Electron security: renderer may not see full paths without `webUtils.getPathForFile` — must implement correctly or DnD silently fails.
- Don’t paste huge binary blobs into TUI agents — **paths only** by default.
- Folder drops: pass directory path, not recursive file list (unless user holds modifier — defer).
- ConPTY paste of Unicode/quotes must match PowerShell vs bash expectations of the engine shell.

### Revise
- v1: paths only, quoted for spaces, focused pane only.
- v1.1: optional Ctrl+Drop → copy into workspace drops folder.
- Add tiny drop overlay CSS (“upuść ścieżki”).
- Tests: unit for path quoting; manual matrix Grok/Claude/OpenCode.

**Status (r2 + matrix doc):** Windows `quotePath` (`""` escapes); pathFor failures surfaced (console + overlay); `sandbox:false` threat note; unit tests `npm run test:unit`. Engine matrix + manual checklist: [`docs/DND-ENGINE-MATRIX.md`](./DND-ENGINE-MATRIX.md). Ctrl+Drop → `.pq/drops/` still TODO.

---

## 12) Gauntlet-loop for every solution

**Skill path (this machine):**  
`C:\Users\admin\AppData\Local\hermes\skills\software-development\gauntlet-loop\SKILL.md`

### Propose
- Lead keeps `docs/workbench.md` updated each wave.
- For each item 8–11: Propose / Krytyk pq / Revise sections (as above).
- When Cloud Agents / Hermes `delegate_task` available: spawn **fresh** critic with artifact only (no builder history).

### Krytyk pq
- Single-agent self-critique is weaker than independent critic — label clearly when critic was same session.
- Don’t pretend blind A/B without a real bar artifact.

### Revise
- Tonight: document-mode gauntlet (same session, explicit Krytyk sections) + concrete bars.
- Next: true split critics when harness allows; never merge builder+critic roles silently.

**Status:** process adopted for this backlog.


---

## Overnight Rust slice (Phase 2 partial)

- `docs/PORT-MAP.md` — full `src/main/*.ts` → Rust targets
- `pq_core::ipc` stubs (StartListen, Transcript, Cancel, Status) + client/server in pq-work / pq-voice
- Android STT path documented/sketched (item 8)
- Krytyk feedback ignored for this focused slice (per overnight brief)
