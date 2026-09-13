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
| (ten slice) | *(po commit)* | resolve-launch / trust / providers szkice, `rust-smoke.cmd`, NIGHT-REPORT, workbench |

---

## 3. Status gauntlet (pozycje 8–12)

| # | Temat | Status (uczciwie) |
|---|--------|-------------------|
| 8 | Android = SpeechRecognizer | **Dokument + sketch Kotlin** + origin lock; MainActivity / phone JS = jeszcze nie |
| 9 | MSI + Setup.exe | `npm run dist` (NSIS+MSI); target `dir` zostaje dla stamp-host; **unsigned** → SmartScreen |
| 10 | Logo / marks | Brand files + inventory; letter-marks; favicon częściowo |
| 11 | DnD plików do TTY | Quoting Windows + overlay; manual matrix engine’ów TODO |
| 12 | Gauntlet-loop | Przyjęty proces; A/B **WARUNKOWO OK** (ten sam agent = słabszy krytyk) |

---

## 4. Co jest w Rust (fakty)

**Zrobione (lean / stub / sketch):**
- `pq-core`: env, store, engines+merge, version, updater fixtures, IPC (Memory + LocalTcp + named-pipe path contract), stt probe (bez download), auth/remote/board deepen, resume/usage/sync types, **resolve-launch / trust / providers** (pure helpers)
- `pq-work`: SessionRegistry + opcjonalny ConPTY prefer-live, `--help` / `--check-update` / `--ipc-demo` / `--ipc-tcp`
- `pq-voice`: `--listen` skeleton (probe GGML), `--ipc-demo`, bez whisper.cpp
- Docs: PORT-MAP, PARITY, VOICE-HOST-BRIDGE, ANDROID-STT, workbench

**Nie zrobione (świadomie):**
- Brak whisper.cpp / Large v3 runtime
- Brak spawnu `pq-voice` z Electron (tylko dokument)
- Brak żywego skanu dysku providers/trust w Rust (Electron zostaje production)
- Brak output pump SessionRegistry dla żywych paneli
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

1. Phone JS mic → `PqStt.startListen` / finalny tekst po WS  
2. SessionRegistry: reader thread / output pump dla live panes  
3. Opcjonalnie: fixture’owe I/O dla resume/providers (bez zapisu do live configs)  
4. Code signing gdy będzie cert  
5. Dopiero potem: real whisper.cpp w pq-voice (osobna decyzja dyskowa)

---

## 8. Werdykt (bez hype)

Noc dowiozła **rusztowanie Phase 2** i dokumentację pod poranny przegląd. Product path nadal = **Electron**. Rust ma typy, stuby CLI i testy jednostkowe; nie ma cutoveru, nie ma Large v3 w runtime, nie ma pełnej paryty PTY/IPC production.

