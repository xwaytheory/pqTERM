# AGENTS.md — instructions for AI coding agents working in pq

pqTERM is a Windows-first Electron terminal grid for AI coding agents
(React 18 + xterm.js + node-pty, TypeScript strict, Electron 33).

## Three worktrees (mandatory layout)

Single git hub = bare repo at `C:\Users\pq\pq` (no working files).
Three linked worktrees, one per branch — ALWAYS work in the right one:

| Worktree | Branch | What it is |
|---|---|---|
| `C:\Users\pq\pqTERM`      | `main`   | Official/stable release for the client. `host\pqterm.exe` + `out\` present. Launch: `START-pr.cmd`. |
| `C:\Users\pq\pqTERM-dev`  | `dev`    | Where you develop daily. Launch: `START-dev.cmd` (npm run dev). |
| `C:\Users\pq\pqTERM-test` | `test`   | Pre-release verification; contains fixes from `dev` pending approval. Launch: `START-dev.cmd`. |

Each worktree keeps its own `node_modules/` (not shared by default).
`host\` and `out\` are gitignored build artifact copies (binary, electron-hub
host) — they live in the worktrees, NOT in git.

## Promoting changes (dev → test → main)

Work in `pqTERM-dev` (branch `dev`). When a fix is ready for verification:

1. Commit it on `dev` (in `pqTERM-dev`).
2. Merge into test for verification:
   `git -C C:\Users\pq\pqTERM-test merge dev`  (resolve on `test`)
   Run the unit tests + typecheck there before declaring it good.
3. When approved by a human, promote to official:
   `git -C C:\Users\pq\pqTERM merge test`
   Rebuild official artifacts: `node scripts/stamp-host.cjs` then
   `npm run build` in `C:\Users\pq\pqTERM` (regenerate `host\pqterm.exe`, `out\`).
4. Never skip `test` → read only `dev` → `main`; only a human pushes/publishes.

## Golden commands (run from repo root)

- `npm run dev` — dev instance (hot reload, profile `%AppData%\pqTERM-dev`)
- `npm run build` — production bundles into `out/`
- `npm run test:unit` — unit tests, must be green before "done"
- `npx tsc --noEmit -p tsconfig.json` — typecheck (`TS5097` in `*.test.ts`
  is pre-existing noise: tests use `.ts` import extensions for
  `node --experimental-strip-types`; do NOT "fix" it)
- `node scripts/new-work.cjs create <branch>` — isolated worktree per task

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

1. Daily dev happens in `C:\Users\pq\pqTERM-dev` on branch `dev`
   (NOT on `main`). Commit there, run unit tests + tsc + build.
2. For a fix ready to verify: merge `dev` → `test` (in `pqTERM-test`),
   run the checks there, get the fix approved.
3. Only promote to official after approval: merge `test` → `main`
   in `C:\Users\pq\pqTERM`, then rebuild official artifacts
   (`npm run build` + `host\` stamp) — see "Promoting changes" above.
4. Keep changes small; conventional commits in English (`feat:`, `fix:`).
5. Human reviews the diff, merges, and pushes. Do NOT `git push`,
   `npm run dist`, or bump versions unless explicitly asked.

## Hard rules / do NOT

- Do NOT touch `host/`, `release/`, `out/`, `node_modules/`, `crates/target/`.
- Do NOT "fix" `sandbox:false` (needed for DnD paths), `win.signAndEditExecutable:false`
  (no cert yet), or the dual Rust tracks (`crates/` vs `src-tauri/` spike).
- Version `1.1.2` is synced across `package.json`, `crates/`, `src-tauri/`,
  `stamp-host.cjs`, README — never bump it in one place alone.
- Do NOT edit `%AppData%\pq*\pq-state.json` by hand while the app runs
  (in-memory state overwrites it on next persist).
- Only ONE dev/test Electron instance at a time (single-instance ports/locks).
- `npm install` while pq runs can hit Windows file locks — close instances first.
