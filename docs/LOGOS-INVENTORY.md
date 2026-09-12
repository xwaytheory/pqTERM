# Logos / brand inventory (pq)

Scan date: 2026-09-12 23:13 PT

## Finding (critical)

**There are no per-harness logo image files in the repo.** Engines are identified by **name + hex color** in `src/main/engines.ts` (`EngineSpec.color`). UI uses colored dots/chips (`Sidebar.tsx`, `TerminalPane.tsx`, `ProvidersModal.tsx`), not SVG/PNG marks.

`resources/` is empty / unused for brand assets. No `src/**/*.svg` or engine PNGs found.

## pq product mark

| Asset | Location | Notes |
|-------|----------|-------|
| Android launcher | `android/app/src/main/res/drawable/ic_launcher.xml` | Vector: dark `#07080A` square + mint `#39FFB6` three bars (terminal motif) |
| Windows / Electron icon | esources/brand/pq.ico\ (+ png 256/512) | Wired as \uild.win.icon\; pm run dist\ -> NSIS+MSI; stamp-host path unchanged |
| Brand SVG (seed) | `resources/brand/pq.svg` | Same three-bar mint mark as Android |
| Favicon / renderer | **MISSING** | No favicon asset found under renderer |

## Built-in harness “logos” (colors only)

| id | name | vendor | color | asset |
|----|------|--------|-------|-------|
| `grok` | Grok CLI | xAI | `#39ffb6` | color swatch only |
| `omp` | Omp | oh-my-pi | `#c084fc` | color swatch only |
| `hermes` | Hermes | Nous / Hermes | `#f5c542` | color swatch only |
| `opencode` | OpenCode | OpenCode | `#7aa2ff` | color swatch only |
| `codex` | Codex | OpenAI | `#9ae6b4` | color swatch only |
| `claude` | Claude Code | Anthropic | `#d4a574` | color swatch only |
| `qwen` | Qwen Code | Alibaba | `#7c5cff` | color swatch only |
| `dsh` | DeepSeek Harness | DeepSeek | `#4cc9f0` | color swatch only |
| `gemini` | Gemini CLI | Google | `#4285f4` | color swatch only |
| `crush` | Crush | Charmbracelet | `#ff387b` | color swatch only |
| `aider` | Aider | Aider-AI | `#e8c547` | color swatch only |
| `copilot` | Copilot CLI | GitHub | `#f0f6fc` | color swatch only |
| `shell` | PowerShell | Windows | `#5b9fd6` | color swatch only |

## Gauntlet — design/logo work (item 10)

**Bar:** Windows Terminal / Warp / Claude Desktop app icon quality + recognizable per-engine marks at 16×16 and 256×256; pq mark must read as “terminal grid for agents”.

**Propose:** Create `resources/brand/` with `pq.ico`, `pq.png` (256/512), export Android adaptive icons from same mark; add optional `resources/engines/<id>.svg` monochrome marks tinted by `color`.

**Krytyk pq:** Shipping vendor logos may hit trademark issues; safer: abstract monograms (first letter) + official colors, not copied wordmarks. Missing Windows `.ico` is a bigger product gap than engine SVGs.

**Revise:** Priority 1 = pq `.ico`/PNG + wire electron-builder `win.icon`. Priority 2 = letter-mark chips in UI. Priority 3 = optional official marks only with license check. Do not block installer on engine SVGs.
