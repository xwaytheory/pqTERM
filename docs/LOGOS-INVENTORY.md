# Logos / brand inventory (pq)

Scan date: 2026-09-12 (gauntlet round 2 revise)

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

## Built-in harness “logos” (letter-mark + color)

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
