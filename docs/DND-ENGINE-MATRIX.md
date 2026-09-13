# DnD engine matrix — path quoting into TTY

Living checklist for plan item **11** (terminal drag-and-drop). Source of truth is code, not this doc — re-verify after changing quoting.

| Area | Path |
|------|------|
| Quoting | `src/renderer/src/lib/dropPaths.ts` |
| Units | `src/renderer/src/lib/dropPaths.test.ts` |
| Drop handler | `src/renderer/src/components/TerminalPane.tsx` (`onDropFiles`) |
| Engine ids | `src/main/engines.ts` → `ENGINE_SPECS` |
| Pane shape | `src/shared/types.ts` → `PaneState` |

**Related:** `docs/BACKLOG-NIGHT.md` §11 · Electron parity board: `docs/PARITY.md` (DnD stays renderer/Electron).

---

## 1. Engine → `pathShellForPane` shell

`TerminalPane` calls:

```ts
formatDroppedPaths(paths, pathShellForPane({ engine: pane.engine }))
```

It does **not** pass `hostType` today (`PaneState` has no such field).

`pathShellForPane` rules (`dropPaths.ts`):

1. `hostType === 'wsl' | 'posix'` → `posix` (future hook only)
2. `hostType === 'pwsh'` → `pwsh`
3. `hostType === 'cmd' | 'conpty'` → `cmd`
4. else if `engine === 'shell'` → `pwsh` (PowerShell pane — `ENGINE_SPECS` binaries `pwsh` / `powershell`)
5. else → `cmd` (all agent CLIs on Windows ConPTY)

| Engine id (`ENGINE_SPECS`) | Name | `pathShellForPane` (today) | Notes |
|----------------------------|------|----------------------------|--------|
| `grok` | Grok CLI | **cmd** | Agent TUI on ConPTY |
| `omp` | Omp | **cmd** | |
| `hermes` | Hermes | **cmd** | |
| `opencode` | OpenCode | **cmd** | |
| `codex` | Codex | **cmd** | |
| `claude` | Claude Code | **cmd** | |
| `qwen` | Qwen Code | **cmd** | |
| `dsh` | DeepSeek Harness | **cmd** | |
| `gemini` | Gemini CLI | **cmd** | |
| `crush` | Crush | **cmd** | |
| `aider` | Aider | **cmd** | |
| `copilot` | Copilot CLI | **cmd** | |
| `shell` | PowerShell | **pwsh** | Only engine mapped to pwsh without `hostType` |

**Quoting behavior:** for `cmd` and `pwsh`, `quotePath` uses the **same** Windows rules today — quote when spaces / `"&<>|^%` appear; escape `"` as `""`. Do **not** use Unix `\"`. `posix` uses single-quotes + `'\''` (unused until `hostType` is wired).

`formatDroppedPaths` joins with spaces and appends a **trailing space** so the caret sits ready for more typing. Drop does **not** send Enter / CR.

---

## 2. Manual checklist (per engine)

Run on a focused pane with that engine already in the TTY. Drop from Explorer; confirm via what appears at the prompt (not only the overlay).

| # | Case | Expect |
|---|------|--------|
| A | File with space (`C:\…\my file.txt`) | Lands as `"C:\…\my file.txt"` (Windows `""` style) |
| B | Multi-select (2+ files) | Space-separated quoted paths + trailing space |
| C | Folder drop | Directory path inserted (not recursive listing) |
| D | UNC with space (`\\server\share\my folder\x.txt`) | Quoted UNC |
| E | Path with `%` or `^` | Quoted (metacharacters covered by unit tests) |
| F | Image file (`.png` / `.jpg`) | Absolute path only (no bytes pasted into PTY) |
| G | Quote integrity | TUI does **not** strip / eat the surrounding `"` |
| H | No auto-submit | After drop, **Enter is not fired**; user presses Enter to send |

Also verify:

- Drag overlay shows „upuść ścieżki” (`.drop-overlay`) while over a live pane.
- Failed `pathFor` shows status overlay + `console.warn` (`DnD: failed to resolve path…`).
- Idle pane (`pane.engine == null`) ignores drop.

Spot-check at least: **grok**, **claude**, **opencode**, **shell** (pwsh quoting path). Full 13-engine pass when time allows.

---

## 3. Known gaps

| Gap | Detail |
|-----|--------|
| **Ctrl+Drop → `.pq/drops/`** | Backlog v1.1 — **not implemented**. `onDropFiles` ignores `ctrlKey`; always paths-only insert. No copy into workspace `.pq/drops/`. |
| **No `hostType` on `PaneState`** | Hint type exists on `PathShellHostHint`, but panes only store `engine` / title / model / session. WSL/bash quoting cannot be selected from pane state yet. |
| **Folders / images untested in TUI** | Units cover quoting edges; real TUI agents (Grok/Claude/OpenCode/…) still need manual matrix rows C + F. |
| **Vision / bytes** | By design v1 pastes **paths only** — no image bytes into agent stdin. |
| **cmd vs pwsh identical escapes** | Mapping to `pwsh` for `shell` is correct for future divergence; today `quotePath('cmd')` ≡ `quotePath('pwsh')`. |

---

## 4. Implementation notes (quick)

- Resolve paths with `window.pq.files.pathFor(f)` (Electron `webUtils` bridge) — not `File.path` alone.
- Write via `window.pq.terminals.write(pane.id, payload)` after `onFocus()`.
- `dropEffect = 'copy'` is an OS cursor hint only; we do not copy file bytes into the PTY.

Updated: 2026-09-13 (plan point 11 — docs matrix).
