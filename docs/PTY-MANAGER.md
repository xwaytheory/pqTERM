# PtyManager parity note (2026-09-13)

**Keep moving** — incremental twin of Electron `src/main/pty-manager.ts`; not a new product architecture. Gauntlet optional.

## Surface (default build, no OS handles)

| API | Status |
|-----|--------|
| `spawn(SpawnOpts)` | registry + reuse same pane/engine/ws |
| `write` / `resize` / `kill` | meta + scrollback; write OK when alive |
| `kill_workspace` / `kill_all` | parity |
| `buffer` / `seed_buffer` / `push_output` / `describe` | buf/seq like Electron (`MAX_BUF` 512 KiB) |
| `register_stub` / `write_stub` / `clear_pane` | aliases kept |

## Live ConPTY

- Spike feature `pty-spike` still owns `pty_spike::run_echo_spike`
- Manager adds optional `spawn_cmd` under the same feature (cmd.exe one-shot)
- Full engine launch / PATH / yoloEnv / trustWorkspace remain Electron until host owns the grid

## Tests

`cargo test -p pq-work` — spawn/write/resize/kill + workspace + seed/describe.