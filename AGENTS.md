# AGENTS.md — instructions for AI coding agents working in pq

pq is a Windows-first Electron terminal grid for AI coding agents
(React 18 + xterm.js + node-pty, TypeScript strict, Electron 33).

## Golden commands (run from repo root)

- `npm run dev` — dev instance (hot reload, profile `%AppData%\pq-dev`)
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

## Workflow (mandatory)

1. One task = one worktree = one branch (`new-work.cjs create`).
   Never commit directly to `main`, never work in `C:\Users\pq\pq` main checkout.
2. Keep changes small; conventional commits in English (`feat:`, `fix:`).
3. Before declaring done: `test:unit` green + `tsc` clean (modulo TS5097)
   + `npm run build` green.
4. Human reviews the diff, merges, and pushes. Do NOT `git push`,
   `npm run dist`, or bump versions unless explicitly asked.

## Hard rules / do NOT

- Do NOT touch `host/`, `release/`, `out/`, `node_modules/`, `crates/target/`.
- Do NOT "fix" `sandbox:false` (needed for DnD paths), `win.signAndEditExecutable:false`
  (no cert yet), or the dual Rust tracks (`crates/` vs `src-tauri/` spike).
- Version `1.1.1` is synced across `package.json`, `crates/`, `src-tauri/`,
  `stamp-host.cjs`, README — never bump it in one place alone.
- Do NOT edit `%AppData%\pq*\pq-state.json` by hand while the app runs
  (in-memory state overwrites it on next persist).
- Only ONE dev/test Electron instance at a time (single-instance ports/locks).
- `npm install` while pq runs can hit Windows file locks — close instances first.
