# Logos / brand inventory (pq)

Scan date: 2026-09-13 (gauntlet hygiene — letter-mark table)

## Finding

**Product mark exists under `resources/brand/`.** Engines are still identified primarily by
**name + hex color** in `src/main/engines.ts` (`EngineSpec.color`). Optional `logo` / `icon`
fields were added to `EngineSpec` for future letter-mark chips; no per-engine SVG/PNG yet.

| Asset | Location | Status |
|-------|----------|--------|
| Brand SVG | `resources/brand/pq.svg` | present (three-bar mint mark) |
| ICO | `resources/brand/pq.ico` | present; wired as `build.win.icon` |
| PNG 256 | `resources/brand/pq-256.png` | present (**not** `pq.png`) |
| PNG 512 | `resources/brand/pq-512.png` | present (**not** `pq.png`) |
| Android launcher | `android/app/src/main/res/drawable/ic_launcher.xml` | vector mark |
| Favicon / renderer | `src/renderer/favicon.png` / `.ico` (from brand) | present; `index.html` + BrowserWindow |
| Engine brand marks | `src/renderer/src/assets/engines/` | present — official vendor marks (see source table below), wired via `engineLogoFiles.ts` |

## Built-in harness “logos” (letter-mark + color)

Letter monograms are the fallback only. Primary marks are the official vendor
assets in `src/renderer/src/components/engineLogos.tsx`
(Grok X, Omp π, Hermes H, OpenCode brackets, Codex prompt, Claude starburst,
Qwen hexagon, DeepSeek whale, Gemini spark, Crush C, Aider A, Copilot loop,
PowerShell prompt). External `EngineSpec.logo` / `icon` URLs still win when set.

## Official asset sources (per-engine)

All engine logos sourced from [LobeHub Icons](https://lobehub.com/icons) (lobehub/icons-static-svg npm package):

| id | asset | LobeHub slug |
|----|-------|--------------|
| `grok` | `grok.png` (xAI mark) | `grok` |
| `omp` | `omp.svg` | `omp` (not on LobeHub) |
| `hermes` | `hermes.png` (NousResearch) | `nousresearch` |
| `opencode` | `opencode.png` | `opencode` |
| `codex` | `codex.png` | `codex-color` |
| `claude` | `claude.png` | `claude-color` |
| `qwen` | `qwen.png` | `qwen-color` |
| `dsh` | `deepseek.png` | `deepseek-color` |
| `gemini` | `geminicli.png` | `geminicli-color` |
| `crush` | `crush.png` | `crush` (not on LobeHub) |
| `aider` | `aider.png` | `aider` (not on LobeHub) |
| `copilot` | `copilot.png` | `copilot-color` |
| `antigravity` | `antigravity.png` | `antigravity-color` |
| `zcode` | `zcode.png` (Z.AI / `zai`) | `zai` |
| `ori` | `ori.png` (OpenRouter) | `openrouter-color` |
| `cursor` | `cursor.png` | `cursor` |
| `shell` | `shell.svg` (generic `>_` glyph) | drawn for pq |
| `cmd` | `cmd.svg` (abstract `CommandA` from LobeHub) | `commanda` |

| id | name | vendor | color | asset |
|----|------|--------|-------|-------|
| `grok` | Grok CLI | xAI | `#39ffb6` | `Gr` + `grok.png` |
| `omp` | Omp | oh-my-pi | `#c084fc` | `Om` |
| `hermes` | Hermes | Nous / Hermes | `#f5c542` | `H` + `hermes.png` (NousResearch) |
| `opencode` | OpenCode | OpenCode | `#7aa2ff` | `Oc` + `opencode.png` |
| `codex` | Codex | OpenAI | `#9ae6b4` | `Cx` + `codex.png` |
| `claude` | Claude Code | Anthropic | `#d4a574` | `Cl` + `claude.png` |
| `qwen` | Qwen Code | Alibaba | `#7c5cff` | `Q` + `qwen.png` |
| `dsh` | DeepSeek Harness | DeepSeek | `#4cc9f0` | `D` + `deepseek.png` |
| `gemini` | Gemini CLI | Google | `#4285f4` | `Ge` + `geminicli.png` |
| `crush` | Crush | Charmbracelet | `#ff387b` | `Cr` |
| `aider` | Aider | Aider-AI | `#e8c547` | `A` |
| `copilot` | Copilot CLI | GitHub | `#f0f6fc` | `Co` + `copilot.png` |
| `antigravity` | Antigravity CLI | Google | `#ea4335` | `Ag` + `antigravity.png` |
| `zcode` | ZCode | Z.AI | `#ff8c1a` | `Zc` + `zcode.png` (LobeHub `zai`) |
| `ori` | Ori | OpenRouter | `#8b5cf6` | `Or` + `ori.png` |
| `cursor` | Cursor CLI | Anysphere | `#2563eb` | `Cu` + `cursor.png` |
| `cmd` | CMD | Windows | `#4a5568` | `Cm` + `cmd.svg` |
| `shell` | PowerShell | Windows | `#5b9fd6` | `PS` |

## Letter-mark chip plan

**Status:** letter-mark chips wired in Sidebar / TerminalPane / ProvidersModal / NewWorkspaceModal.
Collision disambiguation (two-letter): `Cl` Claude, `Cx` Codex, `Cr` Crush, `Co` Copilot, `Gr` Grok, `Ge` Gemini, `Om` Omp, `Oc` OpenCode.
Optional `EngineSpec.logo` / `icon` still unused (no per-engine SVG yet — abstract monograms only).

## Letter-mark chip plan (detail)

1. UI chips (Sidebar / TerminalPane / ProvidersModal) keep color dots as fallback.
2. When `EngineSpec.logo` (or `icon`) is set → render a 16×16 / 20×20 letter-mark or SVG tinted by `color`.
3. Prefer **abstract monograms** (first letter) over vendor wordmarks (trademark risk).
4. Optional later: `resources/engines/<id>.svg` monochrome marks.
5. Favicon: done (`src/renderer/favicon.png` / `.ico` from brand; BrowserWindow `pq.ico`).

## Gauntlet — design/logo work (item 10)

**Bar:** Windows Terminal / Warp / Claude Desktop app icon quality + recognizable per-engine marks at 16×16 and 256×256; pq mark must read as “terminal grid for agents”.

**Krytyk pq (r1):** Shipping vendor logos may hit trademark issues; safer abstract monograms. Missing Windows `.ico` was a product gap (now filled).

**Revise (r2):** Inventory corrected (`resources/brand` exists; filenames `pq-256.png` / `pq-512.png`). `EngineSpec.logo`/`icon` optional fields added. Favicon + letter-mark chips landed (gauntlet r3). Per-engine SVG monograms still optional later.
