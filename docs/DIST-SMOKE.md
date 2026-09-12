# Dist smoke (2026-09-13 overnight)

Command: `npx electron-builder --win nsis msi` with `CSC_IDENTITY_AUTO_DISCOVERY=false` and `win.signAndEditExecutable: false` (winCodeSign Darwin symlink privilege workaround). `build.win.target` remains `"dir"` for stamp-host / START-prod.

## Wave 2 results (after disk reclaim) — **PASS**

| Artifact | Path | Size | Status |
|----------|------|------|--------|
| Unpacked | `release/win-unpacked/pq.exe` | — | OK |
| MSI | `release/pq 1.1.1.msi` | ~194.6 MB | **OK** (unsigned; SmartScreen expected) |
| NSIS Setup | `release/pq Setup 1.1.1.exe` | ~177.2 MB | **OK** (unsigned) |
| Blockmap | `release/pq Setup 1.1.1.exe.blockmap` | ~185 KB | OK |

Log: `release/dist-wave2.log`.

### DIST_EXIT honesty

- Builder process reported **`DIST_EXIT:0`** in `release/dist-wave2.log` for wave 2 (both MSI + NSIS produced).
- Treat **artifact presence + sizes** as the source of truth if a future log line is missing or wrapped by a parent shell.
- Wave 1 did **not** exit 0 (NSIS write failed on 0 free bytes) even though MSI had already been written earlier in that run.

## Wave 1 failure (context)

NSIS failed with `can't write 67108864 bytes to output` when **C: had 0 bytes free**. MSI had already succeeded (~194.6 MB) then was temporarily replaced with a placeholder during recovery so Shell could spawn again.

Recovery:

1. Cleared `%LOCALAPPDATA%\npm-cache` (~3.5 GB) + Temp noise
2. Removed `release/win-unpacked` + partial NSIS stubs
3. Freed ~5+ GB → rebuilt MSI+NSIS successfully

## Packaging notes

- `build.files` excludes `crates/`, `host/`, `release/`, … so stamp-host / cargo target races do not enter the asar.
- `publisherName` still deprecated warning → move to `win.signtoolOptions` later.
- Keep ≥4 GB free before `npm run dist` (unpacked + MSI + NSIS + 7z temp concurrently).
- Overnight policy: **do not refill `release/` needlessly** when disk is tight — prefer docs+code.
