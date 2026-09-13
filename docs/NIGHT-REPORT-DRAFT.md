# Raport nocny (szkic) — dla Szefa

**Data:** 2026-09-13 (noc → poranek)  
**Strefa:** Europe/Warsaw (PT)  
**Branch:** `feat/rust-phase1`  
**Zasada:** commity lokalne, **bez push**; dysk ≥2 GB wolnego; bez pobierania `ggml-large-v3` (~3.1 GB).

---

## 1. Cel nocy

Przygotowanie migracji Electron → Rust (Phase 1–2): szkielety `pq-core` / `pq-work` / `pq-voice`, gauntlet backlog 8–12, status board pod raport **07:00**.

---

## 2. Fazy i HEADy (kolejność chronologiczna)

| Czas (PT) | HEAD (krótki) | Opis |
|-----------|---------------|------|
| 23:06 | `a47871e` | Phase 1: workspace Rust, plan migracji, updater stub, binarki pq-work/pq-voice |
| 23:14 | `90cdd33` | Backlog nocny 8–12 (Android STT, MSI, logo, DnD, gauntlet) |
| 23:24–23:28 | `dec1d5d`…`d75e049` | DnD ścieżek do terminala, brand SVG/ico, `npm run dist`, poprawki docs |
| 23:35 | `9cec05d` | Phase 2: PORT-MAP, IPC stubs work↔voice, Android STT sketch |
| 23:46 | `886148d` | Gauntlet r2 revise (STT INTENT, DnD quoting, packaging, logos) |
| 23:59 | `8efd5d7` | Letter-marks, favicon, LocalTcpTransport + gauntlet r3 |
| 00:22 | `d6827fc` | pq-core env+store, named-pipe stub, pty-spike + parity docs |
| 00:55 | `535fb80` | Engines merge, duplex/WS, shell DnD, dist MSI smoke |
| 01:24 | `7a91ac6` | PtyManager parity, Android STT origin lock, NSIS fix |
| 01:36 | `300dab3` | Krytyk A/B revise, SessionRegistry, auth/remote/board stubs |
| 01:53 | `7636011` | ConPTY prefer-live, auth/remote/board deepen, `--check-update` |
| 02:01 | `f63fec6` | Slice8: voice pipeline skeleton, `--ipc-demo`, resume/usage/sync |
| ~02:30 | 8f19da7 | resolve-launch / trust / providers szkice, `rust-smoke.cmd`, NIGHT-REPORT, workbench |
| ~02:45 | slice10 | SessionRegistry output pump + phone PqStt→WS glue, workbench 87% |
| ~02:50 | fixture-io | Injectable resume/providers fixture I/O (no live AppData), workbench ~89% |
| ~02:55 | named-pipe | Real Windows NamedPipeTransport JSON-line + `--ipc-pipe`, workbench ~91% |

---

## 3. Status gauntlet (pozycje 8–12)

| # | Temat | Status (uczciwie) |
|---|--------|-------------------|
| 8 | Android = SpeechRecognizer | Bridge + origin lock + **phone JS glue** (`pqSttGlue` / mic) — WARUNKOWO OK |
| 9 | MSI + Setup.exe | `npm run dist` (NSIS+MSI); target `dir` zostaje dla stamp-host; **unsigned** → SmartScreen |
| 10 | Logo / marks | Brand files + inventory; letter-marks; favicon częściowo |
| 11 | DnD plików do TTY | Quoting Windows + overlay; manual matrix engine’ów TODO |
| 12 | Gauntlet-loop | Przyjęty proces; A/B **WARUNKOWO OK** (ten sam agent = słabszy krytyk) |

---

## 4. Co jest w Rust (fakty)

**Zrobione (lean / stub / sketch):**
- `pq-core`: env, store, engines+merge, version, updater fixtures, IPC (Memory + LocalTcp + **NamedPipeTransport Windows real**), stt probe (bez download), auth/remote/board deepen, resume/usage/sync types, **resolve-launch / trust / providers** (pure helpers + **fixture I/O**)
- `pq-work`: SessionRegistry + opcjonalny ConPTY prefer-live, `--help` / `--check-update` / `--ipc-demo` / `--ipc-tcp` / **`--ipc-pipe`**
- `pq-voice`: `--listen` skeleton (probe GGML), `--ipc-demo`, bez whisper.cpp
- Docs: PORT-MAP, PARITY, VOICE-HOST-BRIDGE, ANDROID-STT, workbench

**Nie zrobione (świadomie):**
- Brak whisper.cpp / Large v3 runtime
- Brak spawnu `pq-voice` z Electron (tylko dokument)
- Brak żywego skanu dysku providers/trust w Rust (Electron zostaje production)
- ~~Brak output pump~~ → landed under `pty-spike` (nie Electron parity)
- Brak code signing
- Pełny dist smoke nie jest bramką nocną (dysk)

---

## 5. Testy i smoke

- `cargo test -p pq-core` / `pq-work` / `pq-voice` — cel: **green**
- `scripts/rust-smoke.cmd` — build + `--help` / `--check-update` / `--ipc-demo` **bez** pobierania modeli

---

## 6. Blokery / ryzyka

1. **Dysk** — trzymać ≥2 GB; nie robić pełnego release refill / nie ciągnąć GGML.
2. ConPTY — szum DSR/init zależny od buildu Windows.
3. XSS na dozwolonym origin Android nadal może wołać `PqStt` (świadomy kompromis origin lock).
4. Nie celować Rust `save_state` w żywy AppData.
5. Gauntlet A/B bez niezależnego krytyka = status warunkowy, nie „done”.

---

## 7. Plan na dzień (po 07:00)

1. ~~Phone JS mic → PqStt / WS~~ (landed `pqSttGlue.ts`)  
2. ~~SessionRegistry output pump~~ (landed `pty-spike`)  
3. ~~Opcjonalnie: fixture’owe I/O dla resume/providers~~ (landed: explicit path / in-memory only)  
4. Code signing gdy będzie cert  
5. Dopiero potem: real whisper.cpp w pq-voice (osobna decyzja dyskowa)

---

## 8. Werdykt (bez hype)

Noc dowiozła **rusztowanie Phase 2** i dokumentację pod poranny przegląd. Product path nadal = **Electron**. Rust ma typy, stuby CLI i testy jednostkowe; nie ma cutoveru, nie ma Large v3 w runtime, nie ma pełnej paryty PTY/IPC production.



---

## Wave — fixture I/O resume/providers (~02:50 PT)

**Cel:** injectable loaders for resume session lists + provider auth texts without touching live Electron AppData.

**Dostarczone:**
- `resume`: `sessions_from_json` / `ndjson` / `fixture` / `path`, `write_sessions_to` (explicit path), `ResumeCache::prime_from_path` / `prime_from_fixture`
- `providers`: `probe_from_auth_texts` / `probe_from_auth_map` / `probe_from_auth_paths`, `probe_auth_candidates` + `AuthFileReader` (inject home)
- Docs: `workbench.md` / `workbench.html` / this wave
- Gauntlet: Architecture + correctness → **WARUNKOWO OK** (blocker prod AppData write = uniknięty)

**Świadomie nie:**
- Brak skanu żywych katalogów opencode/omp
- Brak zapisu do `%APPDATA%\pq`
- Brak GGML / npm dist


---

## Wave — NamedPipeTransport Windows JSON-line (~02:55 PT)

**Cel:** zamiana stubu `NamedPipeTransport` na minimalny real Windows named-pipe (JSON-line) work↔voice.

**Dostarczone:**
- `pq-core::ipc`: real `CreateNamedPipeW` / `CreateFileW` + `encode_line`/`decode_line`; `kind()` = `named-pipe` vs `named-pipe-stub`
- `sanitize_pipe_session_id` + `named_pipe_path_checked`
- `named_pipe_loopback_demo` (cross-process PowerShell peer — same-process CreateFile↔ConnectNamedPipe deadlock omijany uczciwie)
- CLI: `pq-work --ipc-pipe` (listen) / `pq-voice --ipc-pipe` (connect)
- Docs: PARITY / workbench / ten wave
- Gauntlet Architecture + IPC/security → **WARUNKOWO OK** (ACL = default creator DACL, lokalny demo; nie multi-user hardened)

**Świadomie nie:**
- Brak tokio / ciężkich crate'ów (raw `kernel32` FFI)
- Brak hardened pipe ACL / Electron spawn cutover
- Brak GGML / npm dist
