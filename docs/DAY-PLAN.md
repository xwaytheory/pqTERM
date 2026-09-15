# Day plan — after 07:00 (Europe/Warsaw)

**Branch:** `feat/rust-phase1` (local commits only overnight; **push is a morning decision**)
**HEAD overnight tip:** `0ec9f0f` (~06:15 verify-night OK) / polish `92c8459` / product tip `3a06472`.  
**Disk:** ~0.43 GB free after ENOSPC reclaim — hard constraint. **First:** restore Electron (`npm rebuild` / reinstall `electron`) — overnight zeroed `node_modules/electron/dist/electron.exe` to free Shell.  
**Product path:** still Electron. No cutover claim.

Drafted overnight (~04:07 PT). Revise with Szef after reading `docs/NIGHT-REPORT-DRAFT.md` + `docs/workbench.html`.

---

## 0. First 15 minutes

1. Read **Werdykt** in `NIGHT-REPORT-DRAFT.md` — scaffolding + opt-in voice-host bridge only.
2. Open `docs/workbench.html` — freeze-for-review, not lock-in.
3. Confirm `git status` / HEAD; decide **push?** (overnight did **not** push).
4. Restore Electron binary (overnight disk emergency truncated `electron.exe`); then optional push.

---

## 1. Push? (decision)

| Option | When |
|--------|------|
| **No push yet** | Default if Szef wants local review / squash first. |
| **Push `feat/rust-phase1`** | After skimming report + green `cargo test --workspace`. No force-push. |
| **Open PR → main** | Only if Szef wants review thread; keep title honest (Phase 1–2 scaffold, not cutover). |

Do **not** push installer artifacts (they were reclaimed).

---

## 2. Code signing

- **Blocker:** no cert → unsigned MSI/NSIS = SmartScreen.
- Morning: confirm whether a code-signing cert is available (org / personal EV/OV).
- If **no cert:** skip refill `npm run dist` unless disk ≥ ~4–5 GB and Szef accepts SmartScreen.
- If **cert arrives:** document thumbprint/store location, then rebuild + sign in a **separate** day slot (not while disk is ~1.6 GB).

---

## 3. whisper.cpp (INTENT Large v3)

- Still **not linked**. `pq-voice --listen` = probe + skeleton; exit 2 if GGML missing; **no download** overnight/CI.
- Electron production STT remains `Xenova/whisper-tiny`.
- Next steps (only with disk + explicit go):
  1. Decide: vendored whisper.cpp vs system DLL vs later crate.
  2. Place `ggml-large-v3.bin` manually under `%LOCALAPPDATA%\pq\models\whisper\` (~3.1 GB) — **not** this morning at 1.6 GB free.
  3. Wire real inference behind the existing pipeline stages (replace stub transcript).

---

## 4. Second MSI upgrade test

Context: Wave 2 built MSI+NSIS, smoked, then **reclaimed** `release\` for disk. UpgradeCode in `package.json`: `3BBDA8F5-596C-47EF-9538-BDEF42EEBA06`.

Checklist when disk allows (≥4–5 GB) and (ideally) signing is decided:

1. `npm run dist` → produce MSI + NSIS again (unsigned ok for lab).
2. Install MSI v1.1.6 on a clean / VM machine.
3. Bump or keep version per policy; rebuild; run **second MSI** over the first (upgrade path).
4. Confirm shortcuts, `host/pq.exe` stamp path, and that upgrade does not leave dual installs.
5. If signed: repeat smoke under SmartScreen-happy install.
6. Reclaim fat `win-unpacked` / Setup again if C: is tight — keep sources.

Target `dir` / stamp-host path stays the daily path until Rust cutover (not today).

---

## 5. Nice-to-have (same day only if capacity)

- Optional `pq-voice.exe` as `extraResource` (disk decision).
- Independent gauntlet critic to lift **WARUNKOWO OK**.
- ConPTY DSR noise / PTY parity — not morning-critical.
- UI spawn / production STT cutover — **not** today unless separate go.

---

## 6. Commands (safe on low disk)

```
cd crates && cargo test --workspace
npm run test:unit
scripts\verify-night.cmd
cargo run -p pq-voice -- --help
scripts\rust-smoke.cmd
node --experimental-strip-types src/main/voice-host.shutdown.smoke.ts
```

**Avoid until disk/cert:** `npm run dist`, GGML download.
