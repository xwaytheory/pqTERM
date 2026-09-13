# Electron host → pq-voice.exe (thin bridge, future)

**Status:** documentation + shared types only. Electron does **not** spawn `pq-voice.exe` yet.
Production STT stays in-renderer `Xenova/whisper-tiny` (`voiceCommander.ts`).

See also: `pq_core::ipc::VoiceHostSpawnPlan`, `docs/WHISPER-LARGE.md`, `docs/PORT-MAP.md`.

## Why a separate process

pq-voice owns mic / VAD / Whisper Large v3 (INTENT). pq-work (or today's Electron host)
owns the grid, store, and command routing. They talk JSON-lines IPC:

| Message | Direction | Purpose |
|---------|-----------|---------|
| `StartListen` | host → voice | Begin capture/STT for `session_id` |
| `Transcript` | voice → host | Partial/final text (+ lang) |
| `Cancel` | host → voice | Abort listen / STT |
| `Status` | voice → host | Idle / Listening / Processing / Ready / Error / Cancelled |

Codec: `encode_line` / `decode_line`. Spike transport: `LocalTcpTransport` (`127.0.0.1:4791`
or `--ipc-demo` ephemeral). Production later: named pipe `\\.\pipe\pq-voice-{session}` or `ws://127.0.0.1`.

## How the host will spawn (not wired)

1. Resolve `pq-voice.exe` next to the stamped host, then extraResources:
   - `{app}\pq-voice.exe`
   - `{app}\resources\pq-voice.exe`
   - `{app}\extraResources\pq-voice.exe`
   - Dev: `crates\target\debug\pq-voice.exe` (never ship this path)
2. `child_process.spawn(exe, ['--ipc-tcp', '127.0.0.1:4791'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })`
3. Host listens (`pq-work --ipc-tcp` / future Electron `net.Server`) **before** spawn, or pass an ephemeral port.
4. On `app.before-quit` / workspace close: send `Cancel`, then `child.kill()`.
5. Do **not** pass `--allow-download`. Missing `ggml-large-v3.bin` is a printed error, not a 3 GB fetch.

Shared helper (Rust, types only):

```rust
pq_core::ipc::voice_exe_candidates(app_dir)  // three candidate PathBufs
VoiceHostSpawnPlan::default().default_args   // ["--ipc-tcp"]
```

## Electron sketch (do not import yet)

```ts
// future src/main/voice-bridge.ts — not imported from index.ts
import { spawn, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

export function resolveVoiceExe(appDir: string): string | null {
  const rel = ['pq-voice.exe', join('resources', 'pq-voice.exe'), join('extraResources', 'pq-voice.exe')]
  for (const r of rel) {
    const p = join(appDir, r)
    if (existsSync(p)) return p
  }
  return null
}

export function spawnVoice(exe: string, addr = '127.0.0.1:4791'): ChildProcess {
  return spawn(exe, ['--ipc-tcp', addr], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
}
```

Keep this file out of the Electron boot graph until pq-voice is a stamped extraResource.

## Demo flags (already in the Rust bins)

```
pq-work  --ipc-demo     # in-process LocalTcpTransport e2e
pq-voice --ipc-demo     # same
pq-voice --listen       # AppData GGML probe + skeleton pipeline (no download)
```

## Out of scope

- Packaging pq-voice into NSIS/MSI extraResources
- Mic capture / whisper.cpp
- Replacing `voiceCommander.ts`
