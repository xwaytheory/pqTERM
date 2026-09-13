# Electron host → pq-voice.exe (thin bridge, future)

**Status:** documentation + **opt-in Electron spawn sketch** + **listen-before-spawn IPC** + **Cancel / StartListen JSON-lines** + **best-effort Status/Transcript reader** + **quit shutdown when active** (`src/main/voice-host.ts`).
Production path does **not** auto-spawn. Gate: `PQ_VOICE_HOST=1` **or** explicit
`spawnVoiceHost({ enabled: true, sessionId })`. Re-export from `src/main/index.ts`. `before-quit` calls `shutdownVoiceHost()` (no-op when never spawned).
Not called from `app.whenReady` / UI. No auto-spawn.

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

## Roles (listen vs connect)

| Side | Flag | Role |
|------|------|------|
| Host (`pq-work` / Electron `voice-host`) | `--ipc-pipe` / `net.Server` | **listens** first |
| `pq-voice` | `--ipc-pipe` / `--ipc-tcp` | **connects** to host |

Electron must bind the pipe/TCP server **before** spawning `pq-voice`, or the peer fails to connect (listen-after-spawn race).

## How the host resolves / spawns (sketch, opt-in)

1. Resolve `pq-voice.exe` via candidates mirroring `voice_exe_candidates(app_dir)`:
   - `{app}\pq-voice.exe`
   - `{app}\resources\pq-voice.exe`
   - `{app}\extraResources\pq-voice.exe`
   - Also searches: same dir as host (`dirname(process.execPath)`), `process.resourcesPath`,
     and **dev last-resort** `crates\target\debug\pq-voice.exe` (never ship this path)
2. **Windows:** prefer `--ipc-pipe <sessionId>` (session sanitized: ASCII alnum / `-` / `_`, max 64).
   **Else:** `--ipc-tcp 127.0.0.1:4791` (or override).
3. **Listen first:** Node `net.Server` on `\\.\pipe\pq-voice-{sanitizedSession}` (pipe) or `127.0.0.1:4791` / `opts.tcpAddr` (TCP).
4. Then `child_process.spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })` — connect args unchanged.
5. On peer connect, keep the `Socket` on the active handle and attach a non-blocking line reader (Status / Transcript → `lastStatus` / `lastTranscripts`).
6. Host may send `StartListen` (`{"type":"start_listen","session_id","language":"pl","timeout_ms":0}\n`) via `sendStartListen` / `trySendStartListenToActiveVoiceHost` — honest `false` without writable socket; language default **pl**.
7. On quit: `shutdownVoiceHost()` from `before-quit` — no-op if never spawned; if socket writable, write one Cancel JSON line (`{"type":"cancel","session_id":"...","reason":"host-shutdown"}\n`) matching Rust `IpcMessage`; else skip Cancel honestly (`false`); then destroy socket/server + orderly `child.kill()` (+ win32 `SIGKILL` after ~800ms). **Never blocks** on read loops.
8. Do **not** pass `--allow-download`. Missing `ggml-large-v3.bin` is a printed error, not a 3 GB fetch.
9. Missing exe → structured `{ ok: false, code: 'missing-exe', candidates }` — **never** treated as success. Listen bind failure → `listen-failed` (no spawn).

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
await spawnVoiceHost({ sessionId: 'demo1' })
// → { ok: false, code: 'disabled', ... }

// Opt-in:
process.env.PQ_VOICE_HOST = '1'
const r = await spawnVoiceHost({ sessionId: 'demo1' })
// or: await spawnVoiceHost({ sessionId: 'demo1', enabled: true })
if (!r.ok) {
  // missing-exe | bad-session | spawn-failed | listen-failed | disabled
  console.warn('[pq-voice]', r.code, r.message)
} else {
  // r.child, r.transport ('ipc-pipe' | 'ipc-tcp'), r.exe, r.args, r.pipePath / r.listenAddr
}
```

### Quit lifecycle + Cancel

- Successful `spawnVoiceHost` registers a module-level **active handle** (child + sessionId + transport + exe + server + socket).
- `getActiveVoiceHost()` / `shutdownVoiceHost()` — safe no-op when nothing active.
- `app.on('before-quit')` calls `shutdownVoiceHost()` — production unchanged when never spawned.
- **Cancel honesty:** spawn uses `stdio: ['ignore', ...]` so Cancel **cannot** go via stdin. When a peer socket is held and writable, `trySendCancelToActiveVoiceHost()` writes one JSON line and returns `true`. If no socket yet (peer not connected), returns `false` — do not pretend Cancel was sent.
- **StartListen honesty:** same contract — `sendStartListen()` / `trySendStartListenToActiveVoiceHost()`; defaults `language:"pl"`, `timeout_ms:0`; never fake success.
- **Status reader:** best-effort line buffer on socket `data`; parses `type:status` / `type:transcript` into `lastStatus` / `lastTranscripts` (capped); no throw on partial lines; does not block `before-quit`.
- Smoke: `node --experimental-strip-types src/main/voice-host.shutdown.smoke.ts`

Gauntlet blockers that must not ship:

- Auto-spawn on every launch
- Swallowing missing-binary as success
- Pointing at / triggering whisper model download
- Killing unrelated processes / auto-spawn on quit
- Pretending IPC Cancel / StartListen was sent when it was not
- Listen-after-spawn race / binding wrong pipe name
- Blocking before-quit on inbound read loops

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
- Wiring spawn into UI click paths or `app.whenReady` (quit cleanup is wired; spawn still opt-in only)
- Full duplex protocol state machine / UI STT cutover