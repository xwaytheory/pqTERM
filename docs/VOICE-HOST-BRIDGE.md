# Electron host → pq-voice.exe (thin bridge, future)

**Status:** documentation + **opt-in Electron spawn sketch** (`src/main/voice-host.ts`).
Production path does **not** auto-spawn. Gate: `PQ_VOICE_HOST=1` **or** explicit
`spawnVoiceHost({ enabled: true, sessionId })`. Dead re-export from `src/main/index.ts`
(not called from `app.whenReady` / UI / `before-quit`).

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

## How the host resolves / spawns (sketch, opt-in)

1. Resolve `pq-voice.exe` via candidates mirroring `voice_exe_candidates(app_dir)`:
   - `{app}\pq-voice.exe`
   - `{app}\resources\pq-voice.exe`
   - `{app}\extraResources\pq-voice.exe`
   - Also searches: same dir as host (`dirname(process.execPath)`), `process.resourcesPath`,
     and **dev last-resort** `crates\target\debug\pq-voice.exe` (never ship this path)
2. **Windows:** prefer `--ipc-pipe <sessionId>` (session sanitized: ASCII alnum / `-` / `_`, max 64).
   **Else:** `--ipc-tcp 127.0.0.1:4791` (or override).
3. `child_process.spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })`
4. Host should listen (`pq-work --ipc-pipe` / `--ipc-tcp` / future Electron `net.Server`) **before** spawn when using TCP.
5. On quit (future wiring): send `Cancel`, then `child.kill()` / `stopVoiceHost(child)`.
6. Do **not** pass `--allow-download`. Missing `ggml-large-v3.bin` is a printed error, not a 3 GB fetch.
7. Missing exe → structured `{ ok: false, code: 'missing-exe', candidates }` — **never** treated as success.

Shared helper (Rust, types + candidates):

```rust
pq_core::ipc::voice_exe_candidates(app_dir)  // three candidate PathBufs
VoiceHostSpawnPlan::default().default_args   // ["--ipc-tcp"]  // Electron prefers pipe on win32
```

## Electron module (`src/main/voice-host.ts`)

```ts
import {
  spawnVoiceHost,
  resolveVoiceExe,
  isVoiceHostEnvEnabled
} from './voice-host'

// Off by default:
spawnVoiceHost({ sessionId: 'demo1' })
// → { ok: false, code: 'disabled', ... }

// Opt-in:
process.env.PQ_VOICE_HOST = '1'
const r = spawnVoiceHost({ sessionId: 'demo1' })
// or: spawnVoiceHost({ sessionId: 'demo1', enabled: true })
if (!r.ok) {
  // missing-exe | bad-session | spawn-failed | disabled
  console.warn('[pq-voice]', r.code, r.message)
} else {
  // r.child, r.transport ('ipc-pipe' | 'ipc-tcp'), r.exe, r.args
}
```

Gauntlet blockers that must not ship:

- Auto-spawn on every launch
- Swallowing missing-binary as success
- Pointing at / triggering whisper model download

## Demo flags (already in the Rust bins)

```
pq-work  --ipc-demo     # in-process LocalTcpTransport e2e
pq-voice --ipc-demo     # same
pq-work  --ipc-pipe [session]   # Windows named-pipe listen
pq-voice --ipc-pipe [session]   # connect
pq-voice --listen       # AppData GGML probe + skeleton pipeline (no download)
```

## Out of scope

- Packaging pq-voice into NSIS/MSI extraResources
- Mic capture / whisper.cpp
- Replacing `voiceCommander.ts`
- Wiring spawn into UI click paths or `app.whenReady`