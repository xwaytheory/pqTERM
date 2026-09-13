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

User explicitly requested original vendor marks (overrides the old
monogram-only trademark caution — these ship inside the user's own local app):

| id | asset | source |
|----|-------|--------|
| `grok` | `grok.svg` (xAI mark, fill lightened for dark UI) | Wikimedia Commons `File:XAI-Logo.svg` (sourced from x.ai) |
| `omp` | `omp.svg` (official favicon: gradient glyph on dark rounded square) | https://omp.sh/favicon.svg |
| `hermes` | `hermes.png` (NousResearch org avatar) | https://github.com/NousResearch.png |
| `opencode` | `opencode.svg` (blocky “O” glyph, dark variant) | https://opencode.ai/brand (inline wordmark SVG) |
| `codex` | `codex.png` (OpenAI blossom avatar) | https://github.com/openai.png |
| `claude` | `claude.png` (Anthropic org avatar) | https://github.com/anthropics.png |
| `qwen` | `qwen.png` (Qwen org avatar, transparent) | https://github.com/QwenLM.png |
| `dsh` | `dsh.svg` (DeepSeek whale path, brand blue) | simple-icons `deepseek` (CC0) |
| `gemini` | `gemini.svg` (Gemini spark path + brand gradient) | simple-icons `googlegemini` (CC0) |
| `crush` | `crush.png` (Charm org avatar — Crush ships no square icon; same brand family) | https://github.com/charmbracelet.png |
| `aider` | `aider.png` (official square touch icon) | Aider-AI/aider repo `aider/website/assets/icons/apple-touch-icon.png` |
| `copilot` | `copilot.svg` (Copilot mark path) | simple-icons `githubcopilot` (CC0) |
| `shell` | `shell.svg` (generic `>_` glyph, not a vendor mark) | drawn for pq |

| id | name | vendor | color | asset |
|----|------|--------|-------|-------|
| `grok` | Grok CLI | xAI | `#39ffb6` | Gr (letter-mark chip + color) |
| `omp` | Omp | oh-my-pi | `#c084fc` | Om (letter-mark chip + color) |
| `hermes` | Hermes | Nous / Hermes | `#f5c542` | H (letter-mark chip + color) |
| `opencode` | OpenCode | OpenCode | `#7aa2ff` | Oc (letter-mark chip + color) |
| `codex` | Codex | OpenAI | `#9ae6b4` | Cx (letter-mark chip + color) |
| `claude` | Claude Code | Anthropic | `#d4a574` | Cl (letter-mark chip + color) |
| `qwen` | Qwen Code | Alibaba | `#7c5cff` | Q (letter-mark chip + color) |
| `dsh` | DeepSeek Harness | DeepSeek | `#4cc9f0` | D (letter-mark chip + color) |
| `gemini` | Gemini CLI | Google | `#4285f4` | Ge (letter-mark chip + color) |
| `crush` | Crush | Charmbracelet | `#ff387b` | Cr (letter-mark chip + color) |
| `aider` | Aider | Aider-AI | `#e8c547` | A (letter-mark chip + color) |
| `copilot` | Copilot CLI | GitHub | `#f0f6fc` | Co (letter-mark chip + color) |
| `shell` | PowerShell | Windows | `#5b9fd6` | PS (letter-mark chip + color) |

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
