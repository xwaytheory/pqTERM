# Session hub — one task, many CLIs

A free-tier quota dies mid-task. Today the workaround is manual: open another CLI,
describe what the last one was doing, hope it finds the transcript. This document
describes making that a click inside pqTERM instead.

## The idea

Every pane already has a CLI picker. The switch is instant and stateless: kill the
old process, spawn the new one, empty prompt. The idea is to keep the click and
change what happens behind it — **switch the engine of a running pane and have the
new CLI pick up the same task**, without the user retyping anything.

One gesture, no dialog: the pane's engine changes, the replacement loads the
context, a badge says whether it actually did.

## What already ships (v1.9.0)

| Piece | Where | What it does |
|---|---|---|
| Native resume | `src/main/resume.ts` | Reattaches a pane to its CLI's own conversation after a restart, per cwd. |
| Stable session id | `src/main/ledger.ts` | Every pane gets a pqTERM-owned `sessionId` (an epoch) plus a `parentSessionId` when it was handed over. |
| Derived checkpoint | `src/main/ledger.ts` + `session-adapters.ts` + `session-transcripts.ts` | Main reads the *source* CLI's transcript read-only and writes an append-only `checkpoint.<n>.md` outside the repo. |
| Handoff | `src/main/index.ts`, `handoff.ts` | Checkpoint first, then kill, then spawn the target, then one seed line pointing at the file. |
| Entry points | `pqterm checkpoint [slot]`, `pqterm handoff <slot> <engine>`, `POST /v1/session/*` | The same flow from the command line and the bridge. |
| Sidebar switch | `src/renderer/src/components/EngineSwitchMenu.tsx`, `panes:switchEngine` | Click the engine logo in a session row to swap the CLI in place. "z kontekstem" is the default when the source is readable; clean swap stays available. |
| Conversation import | `src/main/opencode-session.ts`, `session-import.ts` | For an OpenCode target, the source transcript's prose turns are rendered into OpenCode's export JSON and imported with `opencode session import`; the pane then launches `opencode --session <id>`, so the conversation is visible in OpenCode. The model is resolved from `opencode models` — the `opencode-default` sentinel imports but refuses every turn. |

## Why the checkpoint is pqTERM's, not a copy of another CLI's store

1. **The stores are private and version-dependent.** opencode keeps SQLite,
   CodeBuddy keeps `~/.codebuddy/projects/*.jsonl`, omp keeps its own tree. All of
   them move between releases; two of them broke during development of the adapters.
2. **No cross-vendor format exists.** ACP standardises *control* of an agent, not
   storage of its history. Nothing to converge on.
3. **Native resume flags are cwd-scoped everywhere.** A handoff must stay in the
   same directory, so "just resume the other tool's session" is not portable.
4. **Several CLIs fail silently.** A bad resume id yields exit 0 and an empty
   conversation. Trusting a handle without asserting on content produces a pane
   that looks resumed and is not.

So the adapters are strictly **read-only** — pqTERM never writes into another
tool's state — and the durable artifact is a plain markdown file the next agent can
read with the tools it already has.

The checkpoint lives under the profile dir, never in the repository: transcripts
carry tokens and environment dumps, and a file inside the repo is a prompt-injection
channel for every agent that greps the tree.

## What shipped in the sidebar (2026-11-03, `dev`)

The engine logo in a session row is a button. It opens a portal menu that names the
row and offers two modes:

- **z kontekstem** (default when the source transcript is readable) — checkpoint
  from the outgoing CLI, then spawn. For an OpenCode target the transcript is also
  imported into OpenCode, so the new TUI shows the old conversation instead of an
  empty prompt. Other targets get one seed line pointing at the checkpoint. If the
  transcript cannot be read, the switch is refused *before* the old process is
  killed, so the owner can pick the clean mode instead.
- **czysta sesja** — kill, spawn, same pane and cwd; no checkpoint, no seed.

### Why OpenCode can show the old conversation and others cannot

OpenCode exposes `session export` and `session import` as public commands, so
pqTERM can render the source transcript into OpenCode's own JSON and let OpenCode
import it — the vendor's command writes its own store, pqTERM never does. A
degraded transcript is not imported — it falls back to the checkpoint + seed so the
next agent sees the warning. The imported session keeps the task title and becomes
the pane's native handle, which also makes a second handoff (OpenCode → anything)
readable. Only prose turns are
carried: reasoning and successful tool calls are not the visible conversation, and
the adapter clips one turn to 4000 characters. Kilo's importer rejected the same
document, and CodeBuddy, Hermes and Freebuff have no import command at all; for those
the checkpoint plus seed is the honest ceiling.

The menu lists enabled engines (favourites first) and never offers the engine that is
already running. `panes:switchEngine` validates the workspace/pane pair and the
engine allowlist; the bridge and `pqterm handoff` keep their existing entry points.

## What is still missing

1. **The seed does not always land.** Writing into a TUI mid-initialisation is
   swallowed: CodeBuddy creates its session and never receives the line. The fix is
   to stop writing into the PTY and pass the seed through the CLI's own
   initial-prompt flag where one exists (`opencode --prompt`, `hermes -z`,
   `kilo run`), falling back to the paste for the rest.
2. **No visible verdict.** The user cannot tell "context loaded" from "empty prompt".
   The pane needs one badge driven by what main observed, not by what the agent
   claims.
3. **The second hop loses context outside OpenCode.** A pane handed to OpenCode
   keeps the imported session as its handle, so the next handoff can export it. A
   pane handed to any other engine still has no readable transcript until the app
   restarts and native resume rebinds it; a quota chain through those engines carries
   context on the first hop only.

## Non-goals

- Editing or re-indexing another CLI's session store directly. Import goes through
  the vendor's own command (`opencode session import`), never through pqTERM file
  writes.
- A shared conversation format across vendors — the checkpoint is a briefing, and
  the OpenCode document is OpenCode's format, not a universal one.
- Resuming across a different working directory.
