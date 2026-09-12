//! Shared library for pq Rust migration (Phase 1–2).
//!
//! STT **intent** (desktop Rust / pq-voice): OpenAI Whisper Large v3 for Polish.
//! Model id: `openai/whisper-large-v3` (HF); local GGML: `ggml-large-v3.bin`.
//! This is a product **intent**, not a runtime lock — Electron production still uses
//! `Xenova/whisper-tiny` in `src/renderer/src/lib/voiceCommander.ts` via
//! `@huggingface/transformers`. Large v3 applies when the voice path is ported.
//! Android phone: system SpeechRecognizer only (see docs/ANDROID-STT.md).

pub mod ipc;
pub mod updater;
pub mod version;

pub use ipc::{
    decode_line, encode_line, stub_loopback_demo, tcp_loopback_demo, Cancel, IpcError,
    IpcMessage, IpcSink, LocalTcpTransport, MemoryChannelStub, Transport, DEFAULT_TCP_ADDR,
    PROTOCOL_VERSION, StartListen, Status, StubVoiceServer, StubWorkClient, Transcript,
    VoiceState,
};
pub use updater::{
    compare_semver, fetch_manifest, CheckOnLaunchPlan, ManifestFetch, UpdateManifest,
    UpdaterError, STUB_REMOTE_LATEST,
};
pub use version::{PQ_CORE_VERSION, WORKSPACE_VERSION};

/// Speech-to-text **intent** for desktop pq-voice (Polish). Not the live Electron model.
pub mod stt {
    /// Hugging Face / OpenAI model id (Large family) — Rust port target.
    pub const MODEL_ID: &str = "openai/whisper-large-v3";
    /// Common whisper.cpp / ggml filename for the same generation.
    pub const GGML_FILENAME: &str = "ggml-large-v3.bin";
    /// Forced decode language (ISO-639-1 style used by Whisper).
    pub const LANGUAGE: &str = "pl";
    /// Electron production model today (do not claim otherwise).
    pub const ELECTRON_CURRENT_MODEL: &str = "Xenova/whisper-tiny";
    /// Human-readable rationale (intent, not lock).
    pub const RATIONALE: &str =
        "INTENT: Whisper Large v3 for desktop pq-voice (best Polish ASR in Whisper family). \
         CURRENT Electron still runs Xenova/whisper-tiny in voiceCommander.ts until the voice port.";
}
