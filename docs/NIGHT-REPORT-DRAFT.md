# Raport nocny — dla Szefa (07:00)

**Data:** 2026-09-13 (noc 12/13 → poranek)  
**Strefa:** Europe/Warsaw (PT)  
**Branch:** `feat/rust-phase1`  
**HEAD (ten raport / tip):** `cabba7f` — pre-dawn sanity ~04:20 (cargo 98 / npm unit 24 OK)  
**HEAD polish content:** `92c8459` — verify-night.cmd + trustWorkspace catch-ignore docs  
**HEAD produktu (ostatni feature):** `3a06472` — voice-host StartListen + Status reader  
**Zasada nocy:** commity **lokalne, bez push**. Bez pobierania `ggml-large-v3` (~3.1 GB). Dysk ciasny — pełny `npm run dist` nie jest bramką poranną.

---

## Werdykt (czytać pierwsze)

Noc dowiozła **rusztowanie Phase 1–2** i **opt-in mostek Electron → pq-voice** (listen-before-spawn, Cancel / StartListen JSON-line, Status reader). Product path nadal = **Electron**. Nie ma cutoveru, nie ma whisper.cpp, nie ma code signing, nie ma Large v3 w runtime.

To jest uczciwy szkic migracji + dokument pod przegląd, nie gotowy host Rust.

---

## 1. Cel nocy

Przygotowanie migracji Electron → Rust (Phase 1–2): crate’y `pq-core` / `pq-work` / `pq-voice`, gauntlet 8–12, IPC work↔voice, cienki voice-host w Electron, status board i ten raport na **07:00**.

---

## 2. Łuk nocy (chronologia, czasy PT)

| Czas (PT) | HEAD | Co weszło |
|-----------|------|-----------|
| 23:06 | `a47871e` | Phase 1: workspace Rust, plan migracji, updater stub, binarki pq-work / pq-voice |
| 23:14 | `90cdd33` | Backlog nocny 8–12 (Android STT, MSI, logo, DnD, gauntlet) |
| 23:24 | `dec1d5d` | DnD ścieżek do terminala + brand SVG |
| 23:27 | `e4941f7` | `pq.ico`/`png` + **`npm run dist` (NSIS + MSI)**; target `dir` zostaje dla stamp-host |
| 23:28 | `d75e049` | Poprawki backticków w docs |
| 23:35 | `9cec05d` | Phase 2: PORT-MAP, IPC stubs work↔voice, Android STT sketch |
| 23:46 | `886148d` | Gauntlet r2 (STT INTENT, DnD quoting, packaging, logos) |
| 23:59 | `8efd5d7` | Letter-marks, favicon, LocalTcpTransport + gauntlet r3 |
| 00:22 | `d6827fc` | pq-core env+store, named-pipe stub, pty-spike + parity docs |
| 00:55 | `535fb80` | Engines merge, duplex/WS, shell DnD, **dist MSI smoke** |
| 01:24 | `7a91ac6` | PtyManager parity, Android STT origin lock, NSIS fix |
| 01:36 | `300dab3` | Krytyk A/B, SessionRegistry, auth/remote/board stubs |
| 01:53 | `7636011` | ConPTY prefer-live, deepen stubs, `--check-update` |
| 02:01 | `f63fec6` | Slice8: voice pipeline skeleton, `--ipc-demo`, resume/usage/sync |
| 02:12 | `8f19da7` | Slice9: resolve-launch / trust / providers, `rust-smoke.cmd`, szkic raportu |
| 02:13 | `484a2fe` | Stamp slice9 HEAD w NIGHT-REPORT |
| 02:24 | `13c028c` / `26ec495` | SessionRegistry output pump (pty-spike) + phone PqStt→WS glue |
| 02:36 | `73187e3` | Fixture I/O resume/providers (bez żywego AppData) |
| 03:10 | `6f1ebb6` | Real Windows NamedPipeTransport JSON-line + `--ipc-pipe` |
| 03:21 | `8ce9e72` | Electron voice-host spawn sketch (opt-in `PQ_VOICE_HOST`) |
| 03:30 | `215e042` | `before-quit` → `shutdownVoiceHost()` gdy active |
| 03:40 | `581cb18` | Listen **przed** spawn + Cancel JSON-line (uczciwy boolean) |
| 03:45 | `1004423` | **Reclaim MSI/NSIS** (~0.74 → ~1.8 GB free); źródła nietknięte |
| 03:50 | `3a06472` | StartListen + Status/Transcript reader na trzymanym duplexie |
| 04:07 | `391287f` | Unit: spawn_cmd denylist (%/^/|), dropPaths %/^, originsMatch contract; DAY-PLAN; LOCKED→frozen |
| 04:09 | `00bb7e2` | Stamp polish HEAD 391287f into 07:00 report / workbench |
| 04:15 | `92c8459` | verify-night.cmd + trustWorkspace catch-ignore docs; DAY-PLAN/workbench stamp |
| 04:20 | `cabba7f` | Pre-dawn sanity: git clean; cargo 98; npm unit 24; `release\` tylko yml/log (MSI nadal reclaim); tip stamp |

---

## 3. Gauntlet 8–12 (uczciwie)

| # | Temat | Status |
|---|--------|--------|
| 8 | Android = SpeechRecognizer | Bridge + origin lock + phone JS glue (`pqSttGlue` / mic) — **WARUNKOWO OK**. XSS na dozwolonym origin nadal może wołać `PqStt`. |
| 9 | MSI + Setup.exe | **Zbudowane** w nocy (`npm run dist`, unsigned). Smoke OK. Potem **usunięte z `release\`** bo dysk (regenerowalne). SmartScreen będzie krzyczał bez certu. Target `dir` zostaje dla stamp-host. |
| 10 | Logo / marks | Brand files + inventory + letter-marks; favicon częściowo. |
| 11 | DnD plików do TTY | Quoting Windows + overlay. Manual matrix silników — TODO. |
| 12 | Gauntlet-loop | Proces przyjęty. A/B **WARUNKOWO OK** — ten sam agent = słabszy krytyk, nie „done”. |

Późniejsze fale voice-host / IPC / fixture I/O: Architecture + IPC **WARUNKOWO OK** (honest Cancel/StartListen, brak auto-spawn, brak fake success, brak zapisu w żywy AppData).

---

## 4. Co jest w drzewie (fakty na `3a06472`)

**Zrobione (lean / stub / sketch — nie cutover):**
- `pq-core`: env, store, engines+merge, version, updater fixtures, IPC (Memory + LocalTcp + **NamedPipe Windows real**), STT probe (bez download), auth/remote/board deepen, resume/usage/sync, **resolve-launch / trust / providers** (pure helpers + fixture I/O)
- `pq-work`: SessionRegistry + opcjonalny ConPTY prefer-live / output pump (`pty-spike`), `--help` / `--check-update` / `--ipc-demo` / `--ipc-tcp` / `--ipc-pipe`
- `pq-voice`: `--listen` skeleton (probe GGML, exit 2 gdy brak pliku), `--ipc-*` spike; **brak whisper.cpp**, brak mic
- Electron `src/main/voice-host.ts`: opt-in spawn (`PQ_VOICE_HOST=1` / `enabled:true`), listen-before-spawn, Cancel + StartListen (język default `pl`), Status reader, `before-quit` shutdown
- Phone: `pqSttGlue` podpięty do tego samego WS co typed compose
- Docs: PORT-MAP, PARITY, VOICE-HOST-BRIDGE, ANDROID-STT, workbench, ten raport
- `scripts/rust-smoke.cmd` — build + CLI **bez** modelu
- `scripts/verify-night.cmd` — `cargo test --workspace` + `npm run test:unit` (OK/FAIL)

**Świadomie nie:**
- whisper.cpp / Large v3 runtime / auto-download (~3.1 GB)
- Production STT nadal = Electron `Xenova/whisper-tiny`
- Brak UI spawn / `app.whenReady` auto-start
- Brak packaging `pq-voice` jako extraResource
- Brak code signing
- Brak żywego skanu providers/trust i zapisu Rust `save_state` do AppData
- Named pipe ACL = default creator DACL (demo, nie multi-user)
- PTY output pump = `pty-spike`, nie pełna parity Electron

---

## 5. MSI / NSIS i dysk

1. **23:27** `e4941f7` — `npm run dist` (NSIS Setup.exe + MSI), unsigned, stamp-host `dir` zachowany.  
2. **00:55** `535fb80` — dist MSI smoke.  
3. **03:45** `1004423` — reclaim: skasowane `release\pq 1.1.1.msi`, `pq Setup 1.1.1.exe` (+ blockmap), cały `win-unpacked\`. Zostawione małe `builder-debug.yml` / `dist-wave2.log` / `latest.yml`.  
4. **Nie ruszane:** `node_modules`, `crates\target`, `.git`, źródła.

**Teraz:** C: ~1.49 GB wolnego (po reclaimu było ~1.8 GB; target Rust ~611 MB). Tej nocy **nie** powtarzać `npm run dist` i **nie** ciągnąć GGML.

Rebuild installerów = osobna decyzja dzienna, gdy będzie ≥4–5 GB i (najlepiej) cert.

---

## 6. Testy

`cargo test --workspace` (crates, ~04:07 PT): **98 passed, 0 failed** (`pq-core` 89 + `pq-voice` 1 help-honesty + `pq-work` 8 incl. spawn_cmd denylist). Doc-tests pq-core: 0.

`npm run test:unit`: **24 passed** (dropPaths %/^ edges + `originsMatch` Android STT contract mirror).

`scripts\rust-smoke.cmd` — bez download; nie odpalany ponownie (dysk). Help `pq-voice` pokryty unit testem.

Smoke voice-host (TS, bez cargo; nie powtarzane w tej fali):
`node --experimental-strip-types src/main/voice-host.shutdown.smoke.ts`

---

## 7. Blokery / ryzyka

1. **Dysk** — ~1.49 GB. Nie robić pełnego release refill, nie pobierać GGML.  
2. **Code signing** — brak certu; unsigned MSI/NSIS = SmartScreen.  
3. **whisper.cpp** — niezlinkowane; INTENT Large v3 to dokument + probe, nie runtime.  
4. ConPTY — szum DSR/init zależny od buildu Windows.  
5. Android origin lock nie zamyka XSS na allowlisted origin.  
6. Nie celować Rust `save_state` w żywy `%APPDATA%\pq`.  
7. Gauntlet A/B bez niezależnego krytyka = status warunkowy.

---

## 8. Plan na dzień (po 07:00)

Szczegóły: **`docs/DAY-PLAN.md`** (push?, signing, whisper.cpp, second MSI upgrade).


1. Przegląd tego raportu + `docs/workbench.html` — **bez** twierdzenia cutover.  
2. Code signing, gdy będzie cert; dopiero potem refill `npm run dist`.  
3. Opcjonalnie: packaging `pq-voice.exe` jako extraResource (osobna decyzja dyskowa).  
4. Real whisper.cpp + Large v3 = **osobna decyzja dyskowa** (nie dziś rano przy 1.6 GB).  
5. Niezależny krytyk gauntlet, jeśli Szef chce zdjąć „WARUNKOWO”.  
6. UI spawn / production STT cutover — **nie** na dziś, chyba że osobne go.

Zrobione w nocy (skreślone z backlogu dnia): phone JS mic glue; SessionRegistry output pump (spike); fixture I/O; named-pipe spike; voice-host opt-in + quit + Cancel + StartListen/Status.

---

## 9. Komendy (lokalne)

```
cd crates && cargo test --workspace
npm run test:unit
scripts\verify-night.cmd
scripts\rust-smoke.cmd
cargo run -p pq-voice -- --help
node --experimental-strip-types src/main/voice-host.shutdown.smoke.ts
```

Nie: `npm run dist`. Nie: download `ggml-large-v3.bin`.

---

## Załącznik — fale (audit)

Poniżej oryginalne notatki fal po ~02:50. Główny raport jest wyżej; to ślad, nie drugi werdykt.

### Wave — fixture I/O resume/providers (~02:36 PT)

**Cel:** injectable loaders for resume session lists + provider auth texts without touching live Electron AppData.

**Dostarczone:**
- `resume`: `sessions_from_json` / `ndjson` / `fixture` / `path`, `write_sessions_to` (explicit path), `ResumeCache::prime_from_path` / `prime_from_fixture`
- `providers`: `probe_from_auth_texts` / `probe_from_auth_map` / `probe_from_auth_paths`, `probe_auth_candidates` + `AuthFileReader` (inject home)
- Docs: `workbench.md` / `workbench.html` / this wave
- Gauntlet: Architecture + correctness → **WARUNKOWO OK** (blocker prod AppData write = uniknięty)

**Świadomie nie:** brak skanu żywych katalogów opencode/omp; brak zapisu do `%APPDATA%\pq`; brak GGML / npm dist.

### Wave — NamedPipeTransport Windows JSON-line (~03:10 PT)

**Cel:** zamiana stubu `NamedPipeTransport` na minimalny real Windows named-pipe (JSON-line) work↔voice.

**Dostarczone:**
- `pq-core::ipc`: real `CreateNamedPipeW` / `CreateFileW` + `encode_line`/`decode_line`; `kind()` = `named-pipe` vs `named-pipe-stub`
- `sanitize_pipe_session_id` + `named_pipe_path_checked`
- `named_pipe_loopback_demo` (cross-process PowerShell peer)
- CLI: `pq-work --ipc-pipe` (listen) / `pq-voice --ipc-pipe` (connect)
- Gauntlet Architecture + IPC/security → **WARUNKOWO OK** (ACL = default creator DACL)

**Świadomie nie:** brak tokio; brak hardened pipe ACL / Electron spawn cutover; brak GGML / npm dist.

### Wave — Electron pq-voice spawn sketch (~03:21 PT)

**Cel:** opt-in Electron main-process sketch do spawnu `pq-voice.exe`, bez zmiany production path.

**Dostarczone:**
- `src/main/voice-host.ts`: resolve candidates, Win `--ipc-pipe` + session / else `--ipc-tcp`, `spawnVoiceHost` structured result
- Gate: `PQ_VOICE_HOST=1` **lub** `enabled:true` — brak auto-spawn na boot
- Dead re-export w `src/main/index.ts` (overnight default off)
- Gauntlet Architecture + Electron-process → **WARUNKOWO OK**

**Świadomie nie:** brak UI click paths; brak packaging extraResource.

### Wave — voice-host quit lifecycle (~03:30 PT)

**Cel:** gdy `pq-voice` jest aktywny, `before-quit` zamyka go; gdy nigdy nie spawnnięty — no-op.

**Dostarczone:**
- active handle; `shutdownVoiceHost` no-op gdy brak active; win32 `SIGKILL` po ~800 ms; **nie** ubija obcych PID
- `before-quit` → `shutdownVoiceHost()`
- Smoke: `voice-host.shutdown.smoke.ts`

**Świadomie nie (w tej fali):** real Cancel był jeszcze TODO — domknięte w fali 03:40.

### Wave — voice-host listen-before-spawn + Cancel (~03:40 PT)

**Cel:** Electron słucha (pipe/TCP) **zanim** spawnnie `pq-voice`; Cancel JSON-line po peer socket — bez udawania sukcesu.

**Dostarczone:**
- `listenVoiceIpc` → `net.Server` na `\\.\pipe\pq-voice-{session}` lub `127.0.0.1:4791` przed `spawn`
- `trySendCancelToActiveVoiceHost` / shutdown piszą `{"type":"cancel",...}` gdy writable; inaczej `false`
- Gauntlet Architecture + IPC → **WARUNKOWO OK**

### Wave — disk reclaim overnight dist (~03:45 PT)

**Cel:** odzyskać C: (było ~0.74 GB free).

Usunięte tylko regenerowalne artefakty `release\`. Dysk ~0.74 → ~1.80 GB. Źródła nietknięte.

### Wave — voice-host StartListen / Status (~03:50 PT) — HEAD `3a06472`

**Cel:** framing StartListen + lekki Status/Transcript reader na trzymanym duplexie (TS only).

**Dostarczone:**
- `encodeStartListenLine` / `sendStartListen` — JSON `{"type":"start_listen","session_id","language":"pl","timeout_ms":0}`
- Uczciwy boolean; Status reader cap 32; brak throw na partial; `before-quit` nie blokuje na read
- Gauntlet Architecture + IPC → **WARUNKOWO OK**

**Świadomie nie:** brak cargo / GGML / `npm run dist` / push; brak UI spawn / production STT cutover.

### Wave — cheap unit tests + DAY-PLAN (~04:07 PT)

**Cel:** kilka tanich testów + uczciwy plan dnia; bez dist/GGML/push.

**Dostarczone:**
- `pq-work`: `assert_safe_cmdline` zawsze kompilowane; testy denylist `%` `^` `|` `<>&` + too-long / plain OK
- `dropPaths`: edge `%` / `^` w `quotePath` + `formatDroppedPaths`
- `originsMatch` contract mirror (`src/phone/src/originsMatch.ts`) + Node tests (scheme+authority; docs/ANDROID-STT)
- `docs/DAY-PLAN.md` — push?, signing, whisper.cpp, second MSI upgrade
- workbench: "locked" → **frozen for 07:00 review** (not cutover lock-in)
- `cargo test --workspace` **98** green; `npm run test:unit` **24** green

**Świadomie nie:** brak dist, brak GGML, brak push, brak whisper.cpp link.

### Wave — verify-night + trustWorkspace docs (~04:15 PT) — HEAD `92c8459`

**Cel:** bramka pre-dawn bez dist/GGML; udokumentować catch-ignore trust (bez zmiany zachowania).

**Dostarczone:**
- `scripts/verify-night.cmd` — `cargo test --workspace` + `npm run test:unit` (jeśli jest w package.json); echo OK/FAIL/SKIP
- `trustWorkspace`: JSDoc + komentarze że catch-ignore jest celowy (best-effort; nie blokuje PTY spawn); outer catch w `pty-manager` zostaje (belt+suspenders)
- HEAD stamp w raporcie: polish `92c8459` / product tip `3a06472`

**Świadomie nie:** brak dist, brak GGML, brak push, brak zmiany logiki trust (tylko docs/komentarze).
