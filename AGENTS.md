# AGENTS.md — instructions for AI coding agents working in pq

pqTERM is a Windows-first Electron terminal grid for AI coding agents
(React 18 + xterm.js + node-pty, TypeScript strict, Electron 33).

## Worktrees (mandatory layout)

Single git hub = bare repo at `C:\Users\pq\pqTERM\repo.git` (no working files).
Stable stays at `C:\Users\pq\pqTERM`; all other worktrees live under `instances\` — ALWAYS work in the right one:

| Worktree | Branch | What it is |
|---|---|---|
| `C:\Users\pq\pqTERM`      | `main`   | Official/stable release for the client. `host\pqterm.exe` + `out\` present. Launch: `START-pr.cmd`. |
| `C:\Users\pq\pqTERM\instances\dev` | `dev` | Where you develop daily. Launch: `START-dev.cmd` (npm run dev). |
| `C:\Users\pq\pqTERM\instances\test` | `test` | Pre-release verification; contains fixes from `dev` pending approval. Launch: `START-dev.cmd`. |
| `C:\Users\pq\pqTERM\instances\wip` | `main` | Existing unfinished work; preserve its staged index. |
| `C:\Users\pq\pqTERM\instances\feat\engine-lifecycle` | `feat/engine-lifecycle` | Isolated feature worktree. |

Each worktree keeps its own `node_modules/` (not shared by default).
`host\` and `out\` are gitignored build artifact copies (binary, electron-hub
host) — they live in the worktrees, NOT in git.
New task branches use `C:\Users\pq\pqTERM\instances\<branch>` (slashes in branch names create subdirectories).

## Ponytail (minimalism) — active by default

Coding tasks in this repo run the **`ponytail` skill** at level `full`.
Source: `dietrichgebert/ponytail` (MIT), installed project-scoped at
`.agents/skills/ponytail/` together with `ponytail-review`, `-audit`, `-debt`,
`-gain`, `-help`; reinstall with `npx skills add dietrichgebert/ponytail --yes`.

Before writing code, stop at the first rung that holds — does this need to exist
at all (YAGNI) → already in this codebase → stdlib → native platform feature →
already-installed dependency → one line → the minimum that works. Climb it
*after* reading the code the change touches, not instead of it. Deletion over
addition; the shortest working diff wins. Bug fix = root cause: grep the callers
and fix once where every caller routes through.

**Lazy, not negligent — never on the chopping block here:**

- trust-boundary validation (`src/preload`, IPC handlers, `/pair`, WS input),
  error handling, security, accessibility;
- **this repo's gates**: `npm run test:unit`, `npm run typecheck`,
  `npm run check:version`, `scripts/verify-night.cmd` stay green. "Less code"
  never means fewer tests or a skipped gate;
- the board protocol — a change lands with its evidence in `docs/workbench.md`.

A deliberate shortcut with a known ceiling gets a marker that names the ceiling
and the upgrade path — `// ponytail: <ceiling>, <when to upgrade>` — instead of a
vague TODO, so `ponytail-debt` can harvest it into a ledger. (This closes the
2026-09-15 audit finding that the repo had no in-code debt markers at all.)

## i-have-adhd (communication) — active by default

At session start, open `.agents/skills/i-have-adhd/SKILL.md` in this repo and
apply it alongside Ponytail: Ponytail governs implementation; i-have-adhd
governs response presentation. This standing opt-in activates the style even
though the unmodified upstream skill carries `disable-model-invocation: true`,
which only stops auto-selection, not this documented instruction.

Lead with the answer or action, number multi-step instructions, show concrete
progress, suppress tangents, and name one next action only when work remains.
Never omit required evidence, safety checks, or requested detail for brevity;
do not invent time estimates or infer a medical diagnosis from this preference.
Higher-priority harness instructions and the user's current request win.
`stop adhd mode` or `normal mode` disables this style for the current session;
an explicit request enables it again. No global CLI configuration is changed.

Source: https://github.com/ayghri/i-have-adhd (MIT). Project install:
`npx skills add ayghri/i-have-adhd --skill i-have-adhd --agent codex --yes`.
Agents without automatic `.agents/skills` discovery use the file path above.

## Promoting changes (dev → test → main)

Work in `C:\Users\pq\pqTERM\instances\dev` (branch `dev`). When a fix is ready for verification:

1. Commit it on `dev` (in `instances\dev`).
2. Merge into test for verification:
   `git -C C:\Users\pq\pqTERM\instances\test merge dev`  (resolve on `test`)
   Run the unit tests + typecheck there before declaring it good.
3. When approved by a human, promote to official:
   `git -C C:\Users\pq\pqTERM merge test`
   Rebuild official artifacts: `node scripts/stamp-host.cjs` then
   `npm run build` in `C:\Users\pq\pqTERM` (regenerate `host\pqterm.exe`, `out\`).
4. Never skip `test` → read only `dev` → `main`; only a human pushes/publishes.
   **Every change lands on `test` FIRST, no exceptions.** Writing code only in
   `dev` is not enough — any implemented fix/feature MUST be committed on `dev`
   and merged into `instances\test` (with its checks run there) before it counts
   as delivered. `dev`-only work is work in progress, not a rollout.

## Golden commands (run from repo root)

- `npm run dev` — dev instance (hot reload, profile `%AppData%\pqTERM-dev`)
- `npm run build` — production bundles into `out/`
- `npm run test:unit` — must be green before "done"; it runs `npm run typecheck`
  first, then the `node --test` suites
- `npm run typecheck` — BOTH TS projects: `tsconfig.json` (renderer/shared/preload)
  and `tsconfig.node.json` (`src/main` — the privileged process; it had no
  typecheck gate until 2026-09-15 and that is how a broken import + a
  non-existent `image.save()` call shipped)
- `npm run check:version` — version sanity; catches a bump that leaked into a
  `Cargo.lock` dependency entry
- `*.test.ts` / `*.smoke.ts` are excluded from both TS projects on purpose: they
  run under `node --experimental-strip-types`, which requires explicit `.ts`
  imports — do NOT "fix" those imports away
- `node scripts/new-work.cjs create <branch>` — isolated worktree at `C:\Users\pq\pqTERM\instances\<branch>`

## Architecture in 30 seconds

- `src/main/` owns everything: workspaces/panes state (`store.ts`,
  persisted to `pq-state.json`), one node-pty session per `paneId`
  (`pty-manager.ts`), engine CLIs (`engines.ts`), IPC handlers (`index.ts`).
- `src/shared/grid.ts` is pure layout math (areas, snap, swap) — covered
  by `src/shared/grid.test.ts`. Put new geometry here, not in components.
- `src/renderer/` is thin: renders snapshots, sends IPC intent.
  Main is authoritative — never trust renderer-provided ids blindly.
- `src/preload/index.ts` is the only bridge. No new privileged channels
  without validation (paneId ∈ workspace, length caps, model allowlists).
- Hermes engine defaults to `-m LongCat-2.0 --provider custom`
  (needs user-configured custom provider in `~/.hermes` — don't touch it).

## Workflow (mandatory, daily)

1. Daily dev happens in `C:\Users\pq\pqTERM\instances\dev` on branch `dev`
   (NOT on `main`). Commit there, run unit tests + tsc + build.
2. For a fix ready to verify: merge `dev` → `test` (in `instances\test`),
   run the checks there, get the fix approved.
3. Only promote to official after approval: merge `test` → `main`
   in `C:\Users\pq\pqTERM`, then rebuild official artifacts
   (`npm run build` + `host\` stamp) — see "Promoting changes" above.
4. Keep changes small; conventional commits in English (`feat:`, `fix:`).
   After touching anything version-like (`package.json`, `crates/`, `src-tauri/`,
   `stamp-host.cjs`, README) run `npm run check:version`.
5. Human reviews the diff, merges, and pushes. Do NOT `git push`,
   `npm run dist`, or bump versions unless explicitly asked.

## Hard rules / do NOT

- Do NOT touch `host/`, `release/`, `out/`, `node_modules/`, `crates/target/`.
- Do NOT "fix" `sandbox:false` (needed for DnD paths), `win.signAndEditExecutable:false`
  (no cert yet), or the dual Rust tracks (`crates/` vs `src-tauri/` spike).
- Version `1.1.8` is synced across `package.json`, `crates/`, `src-tauri/`,
  `stamp-host.cjs`, README — never bump it in one place alone. Bump **real version
  fields only**: a global search/replace over `Cargo.lock` once rewrote the `toml`
  *crate* to a version that does not exist and broke the whole `src-tauri` build
  (fixed 2026-09-15). Guard: `npm run check:version`.
- Do NOT edit `%AppData%\pq*\pq-state.json` by hand while the app runs
  (in-memory state overwrites it on next persist).
- Only ONE dev/test Electron instance at a time (single-instance ports/locks).
- `npm install` while pq runs can hit Windows file locks — close instances first.
