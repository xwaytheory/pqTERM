# SessionRegistry / PtyManager (2026-09-13 gauntlet revise — output pump)

**Honest name:** in-memory **SessionRegistry** (type alias `SessionRegistry = PtyManager`).  
**Not** an Electron `pty-manager.ts` twin — default build has **no OS PTY I/O**.

Gauntlet: keep moving. Electron `node-pty` remains production.

## Surface (default build)

| API | Behavior |
|-----|----------|
| `spawn(SpawnOpts)` | registry + reuse same pane/engine/ws |
| `write` | **`false` without live ConPTY** (no fake success) |
| `resize` / `kill` | meta + scrollback |
| `kill_workspace` / `kill_all` | registry |
| `buffer` / `seed_buffer` / `push_output` / `describe` | buf/seq (`MAX_BUF` 512 KiB) |
| `sync_output_pumps` | no-op without live handles |
| `output_pump_active` | always `false` without `pty-spike` |
| `has_live_io` | true only under `pty-spike` with open handle |
| `register_stub` / `write_stub` / `clear_pane` | aliases |

## Live ConPTY (`--features pty-spike`)

- `spawn_prefer_live(program, args)` — try ConPTY; on failure **registry-only** + `live_error` (honest)
- `SpawnOutcome { registry, live_io, live_error }`
- `spawn_argv(program, args)` — preferred direct (no shell); starts **reader-thread output pump**
- Output pump: ConPTY bytes → shared scroll → `buffer()` / `sync_output_pumps()` into session buf/seq
- DSR (CSI 6n): pump replies `\x1b[1;1R` (same lesson as `pty_spike`)
- `spawn_cmd(cmdline)` — `cmd /D /Q /C` **hardened**: rejects `&\|<>^%` etc.; prefer `spawn_argv`
- Spike CLI: `pty_spike::run_echo_spike` / `pq-work --pty-spike`
- Full engine launch / PATH / yoloEnv remain Electron

### Gauntlet (Architecture) — output pump

**Propose:** detached reader + `Arc<Mutex<PtyBuffer>>`; registry never starts a thread.  
**Critics:** race on kill; ConPTY DSR stall; do not fake pump without live I/O.  
**Revise:** stop flag before kill; merge scroll into session; DSR auto-reply; `output_pump_active` honesty.  
**Verdict:** WARUNKOWO OK — not Electron parity.

### Injection note

`spawn_cmd` still goes through `cmd /C`. Metacharacter filter reduces risk for smoke strings; **do not** pass untrusted UI text. Use `spawn_argv`.

## Tests

```bat
cargo test -p pq-work
cargo test -p pq-work --features pty-spike
```

Registry tests assert `write`/`output_pump_active` false without live I/O; `pty-spike` covers pump + metacharacter refuse + `spawn_argv`.