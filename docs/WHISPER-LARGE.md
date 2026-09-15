# Whisper Large v3 — pq-voice INTENT path (spike)

**Status:** INTENT / research stub — **not** runtime. Desktop CURRENT has **no STT at all** (the Electron `Xenova/whisper-tiny` path was removed in `36d083c`).

## Target

| Field | Value |
|-------|--------|
| Model family | OpenAI Whisper Large v3 |
| HF / OpenAI id | `openai/whisper-large-v3` |
| Local GGML (whisper.cpp) | `ggml-large-v3.bin` |
| Language | `pl` |
| Constants | `pq_core::stt` |

## Download (manual / future)

- **URL:** `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin`
- **Size:** ~3.1 GB (3,095,033,483 bytes f16; sha256 `64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2`)
- **Do not** auto-download in overnight agents, CI, or boot unless the user explicitly opts in.
- Alternate: `whisper.cpp` `./models/download-ggml-model.sh large-v3`

## Local path (Windows INTENT)

```
%LOCALAPPDATA%\pq\models\whisper\ggml-large-v3.bin
```

Fallback base: `%APPDATA%` if `LOCALAPPDATA` unset. Resolved by `pq_core::stt::intended_ggml_path()` (no mkdir, no fetch).

Prod Electron already uses `%AppData%\pq` / `%AppData%\pq-dev` for state — models live under **LOCALAPPDATA** `pq\models\whisper` so large weights stay off the roaming profile.

## Memory note

- Disk: ~3.1 GB f16.
- RAM: plan **~4–6+ GB** for whisper.cpp large-v3 inference (ballpark; not a measured bench on this machine).
- Future option (not INTENT default): quantized `ggml-large-v3-q5_0` (~1.1 GiB) or `large-v3-turbo` for latency.

## Stub API

```rust
pq_core::stt::intended_ggml_path()           // Option<PathBuf>
pq_core::stt::probe_ggml_model()             // Present / Missing / AppDataUnset
pq_core::stt::ensure_ggml_model(false)       // Ok if file exists; Err without download
pq_core::stt::ensure_ggml_model(true)        // still stub: describes URL, does not fetch yet
pq_core::stt::run_listen_transcribe_skeleton(session_id)
```

`pq-voice` boot prints intended path + `probe_ggml_model()` / `model_status_message`.

`--listen` runs `run_listen_transcribe_skeleton`: Idle → Probe → (Listen/Transcribe/Emit/Done **or** Failed).
Missing weights → `VoiceState::Error` and a clear **not downloading** message. File present → stub transcript
(`inference not wired`) — still no whisper.cpp.

```
pq-voice --listen
pq-voice --ipc-demo
```


## Out of scope this slice

- Full model download
- whisper.cpp / candle bindings
- Replacing Electron transformers.js tiny model
