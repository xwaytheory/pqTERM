# Dist smoke (2026-09-13 overnight)

Command: `npx electron-builder --win nsis msi` with `CSC_IDENTITY_AUTO_DISCOVERY=false` and `win.signAndEditExecutable: false` (winCodeSign Darwin symlink privilege workaround). `build.win.target` remains `"dir"` for stamp-host / START-prod.

## Results

| Artifact | Path | Status |
|----------|------|--------|
| Unpacked | `release/win-unpacked/pq.exe` | OK |
| MSI | `release/pq 1.1.1.msi` (~194.6 MB) | **OK** (unsigned; SmartScreen expected) |
| NSIS Setup | `release/pq Setup 1.1.1.exe` | **FAIL** |

## NSIS exact failure

```
Error: can't write 67108864 bytes to output
Error - aborting creation process
```

Likely low free disk while compressing ~186 MB payload into Setup.exe (plus concurrent WiX/NSIS caches). Partial `pq Setup 1.1.1.exe` (~98 KB) is **not** a valid installer — delete/ignore until disk free + re-run `npm run dist`.

## Packaging notes

- `build.files` excludes `crates/`, `host/`, `release/`, … so stamp-host / cargo target races do not enter the asar.
- `publisherName` still deprecated warning → move to `win.signtoolOptions` later.
