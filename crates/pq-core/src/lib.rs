//! Shared library for pq Rust migration (Phase 1–2).
//!
//! STT target (locked): OpenAI Whisper Large v3 — best quality for Polish.
//! Model id: `openai/whisper-large-v3` (HF); local GGML: `ggml-large-v3.bin`.
//! Do NOT use tiny/base/small/medium for production Polish STT.
//! Android phone: system SpeechRecognizer only (see docs/ANDROID-STT.md).

pub mod ipc;
pub mod updater;
pub mod version;

pub use ipc::{
    decode_line, encode_line, stub_loopback_demo, Cancel, IpcError, IpcMessage, IpcSink,
    MemoryChannel, PROTOCOL_VERSION, StartListen, Status, StubVoiceServer, StubWorkClient,
    Transcript, VoiceState,
};
pub use updater::{
    compare_semver, fetch_manifest, CheckOnLaunchPlan, ManifestFetch, UpdateManifest,
    UpdaterError,
};
pub use version::{PQ_CORE_VERSION, WORKSPACE_VERSION};

/// Locked speech-to-text target for Polish (Paweł / product decision).
pub mod stt {
    /// Hugging Face / OpenAI model id (latest Large family).
    pub const MODEL_ID: &str = "openai/whisper-large-v3";
    /// Common whisper.cpp / ggml filename for the same generation.
    pub const GGML_FILENAME: &str = "ggml-large-v3.bin";
    /// Forced decode language (ISO-639-1 style used by Whisper).
    pub const LANGUAGE: &str = "pl";
    /// Human-readable rationale.
    pub const RATIONALE: &str =
        "Whisper Large v3 is the current flagship OpenAI Whisper checkpoint; \
         best Polish ASR quality in the Whisper family vs tiny/base used in Electron today.";
}
