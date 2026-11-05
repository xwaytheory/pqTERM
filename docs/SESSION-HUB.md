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
| Conversation import | `src/main/session-carry.ts`, `session-native.ts`, `opencode-session.ts`, `session-import.ts` | Turns the source transcript into a session the target opens itself: `opencode session import` + `--session`, CodeBuddy `--resume`, omp `-r`. The conversation is visible in the new CLI, not just referenced. OpenCode's model comes from `opencode models` (the `opencode-default` sentinel refuses every turn); omp's comes from `modelRoles.default`. |

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
  from the outgoing CLI, then spawn. The transcript is also imported into
  OpenCode, CodeBuddy, omp or Grok, so the new TUI shows the old
  conversation instead of an empty prompt. Other targets get one seed line with a
  digest of the last turns. If the transcript cannot be read, the switch is refused
  *before* the old process is killed, so the owner can pick the clean mode instead.
- **czysta sesja** — kill, spawn, same pane and cwd; no checkpoint, no seed.

### Which targets show the old conversation (2026-11-04, `dev`)

`carrySession` (`src/main/session-carry.ts`) runs before the old CLI dies and
turns the source transcript into a session the target owns. Only prose turns are
carried (reasoning and successful tool calls are not the visible conversation, and
one turn is clipped to 4000 characters). A degraded transcript is never carried —
it falls back to checkpoint + seed so the next agent sees the warning. The imported
session keeps the task title and becomes the pane's native handle, which is what
makes a second hop readable.

| Target | Mechanism | Verified |
|---|---|---|
| OpenCode | render the export JSON, `opencode session import`, launch `--session <id>` | yes — model answered a fact from the imported history |
| CodeBuddy | write `~/.codebuddy/projects/<slug>/<uuid>.jsonl` (Claude-Code layout), launch `--resume <uuid>` | yes — same fact test |
| omp | write `~/.omp/agent/sessions/<project>/<ts>_<uuid>.jsonl`, launch `-r <uuid>` | yes — model answered the fact test |
| Grok | write `~/.grok/sessions/<url-encoded cwd>/<uuid>/{summary.json,chat_history.jsonl}`, launch `-r <uuid>` | session recognised and replayed (`found locally`, history grows); recall unverified — the xAI API answered 500 during the test |
| Kilo | `kilo import <json>` accepts a kilo-format document, but resuming it fails server-side in 7.8.18 | no — falls back to the seed |
| Hermes | `hermes sessions import --from claude <file>` imports a Claude-shaped jsonl and lists the session, but `hermes --resume <id>` goes through the local gateway and answers "No session found" | no — seed |
| Freebuff, the rest | checkpoint + one seed line that now embeds a 1200-char digest of the last turns | n/a |

The CodeBuddy, omp and Grok writers touch only a *new* session folder in the store
the CLI already reads; no database, index or existing session is modified, and a
failed spawn deletes what it created. The seed digest is the honest ceiling for engines
with no verified import path: the model gets the last turns inline instead of a path
it may never open.

Two constraints learned the hard way, both encoded in the renderers:

- omp restores the model from the last assistant row and aborts the whole resume on
  an unknown one (`Could not restore model imported/imported`), so the row carries
  `modelRoles.default` from `~/.omp/agent/config.yml`. With no readable config
  there is no native import, only the seed.
- CodeBuddy opens a zero-byte session stub at launch and then writes the real
  conversation under a *different* id. Binding that stub is why a handoff used to
  report "brak transkryptu" while the transcript sat on disk. `transcriptExists`
  now requires a non-empty file, and `writePaneCheckpoint` re-asks the live trace
  and keeps whichever handle has turns behind it.

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
3. **The second hop loses context outside the four import targets.** A pane handed
   to OpenCode, CodeBuddy, omp or Grok keeps the imported session as its handle, so
   the next handoff can export it. A pane handed to Hermes, Freebuff or Kilo still
   has no readable transcript until the app restarts and native resume rebinds it; a
   quota chain through those engines carries context on the first hop only.

## Non-goals

- Editing or re-indexing another CLI's existing sessions. OpenCode is imported
  through its own command; CodeBuddy and omp get one *new* file in the folder they
  already read, and a failed spawn deletes it.
- A shared conversation format across vendors — the checkpoint is a briefing, and
  each carried document is that vendor's own format, not a universal one.
- Resuming across a different working directory.
