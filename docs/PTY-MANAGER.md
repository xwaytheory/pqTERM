# SessionRegistry / PtyManager (2026-09-13 gauntlet revise)

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
| `has_live_io` | true only under `pty-spike` with open handle |
| `register_stub` / `write_stub` / `clear_pane` | aliases |

## Live ConPTY (`--features pty-spike`)

- `spawn_prefer_live(program, args)` — try ConPTY; on failure **registry-only** + `live_error` (honest)
- `SpawnOutcome { registry, live_io, live_error }`
- `spawn_argv(program, args)` — preferred direct (no shell)
- `spawn_cmd(cmdline)` — `cmd /D /Q /C` **hardened**: rejects `&\|<>^%` etc.; prefer `spawn_argv`
- Spike CLI: `pty_spike::run_echo_spike` / `pq-work --pty-spike`
- Full engine launch / PATH / yoloEnv remain Electron

### Injection note

`spawn_cmd` still goes through `cmd /C`. Metacharacter filter reduces risk for smoke strings; **do not** pass untrusted UI text. Use `spawn_argv`.

### Electron trustWorkspace (optional note)

TS `trustWorkspace` swallows per-engine trust errors (`catch { /* ignore */ }`). Rust port should surface/log failures instead of silent swallow when that module is sketched.

## Tests

```bat
cargo test -p pq-work
cargo test -p pq-work --features pty-spike
```

Registry tests assert `write` is false without live I/O; `pty-spike` tests cover metacharacter refuse + `spawn_argv` live write.
