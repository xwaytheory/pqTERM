//! Shared library for pq Rust migration (Phase 1–2).
//!
//! STT **intent** (desktop Rust / pq-voice): OpenAI Whisper Large v3 for Polish.
//! Model id: `openai/whisper-large-v3` (HF); local GGML: `ggml-large-v3.bin`.
//! This is a product **intent**, not a runtime lock — Electron production still uses
//! `Xenova/whisper-tiny` in `src/renderer/src/lib/voiceCommander.ts` via
//! `@huggingface/transformers`. Large v3 applies when the voice path is ported.
//! Android phone: system SpeechRecognizer only (see docs/ANDROID-STT.md).

pub mod env;
pub mod ipc;
pub mod store;
pub mod updater;
pub mod version;

pub use env::{
    appdata_roaming, prod_user_data_dir, product_name, running_dev, user_data_dir,
    user_data_dir_for,
};
pub use ipc::{
    decode_line, encode_line, stub_loopback_demo, tcp_loopback_demo, Cancel, IpcError,
    IpcMessage, IpcSink, LocalTcpTransport, MemoryChannelStub, NamedPipeTransport, Transport,
    named_pipe_path, DEFAULT_TCP_ADDR, PIPE_NAME_PREFIX, PROTOCOL_VERSION, StartListen, Status, StubVoiceServer,
    StubWorkClient, Transcript, VoiceState,
};
pub use store::{
    empty_snapshot, exists_state, exists_state_at, load_state, load_state_from, save_state,
    save_state_to, state_path, state_path_in, touch_workspace, AppSnapshot, AuthProvider,
    GoogleOAuthConfig, ModelChoice, PaneState, ProviderInfo, StoreError, UserSession, Workspace,
};
pub use updater::{
    compare_semver, fetch_manifest, CheckOnLaunchPlan, ManifestFetch, UpdateManifest,
    UpdaterError, STUB_REMOTE_LATEST,
};
pub use version::{PQ_CORE_VERSION, WORKSPACE_VERSION};

/// Speech-to-text **intent** for desktop pq-voice (Polish). Not the live Electron model.
pub mod stt {
    use std::path::PathBuf;

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

    /// Relative dir under `%LOCALAPPDATA%` (or `%APPDATA%`) for ggml weights.
    /// Full path example: `%LOCALAPPDATA%\\pq\\models\\whisper\\ggml-large-v3.bin`
    pub const GGML_REL_DIR: &str = r"pq\models\whisper";

    /// Official whisper.cpp HF resolve URL (f16). ~3.1 GB — do **not** auto-download in CI/overnight.
    pub const GGML_DOWNLOAD_URL: &str =
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin";

    /// Exact published size of `ggml-large-v3.bin` (f16) as of 2026-06 (HF).
    pub const GGML_APPROX_BYTES: u64 = 3_095_033_483;

    /// Memory / footprint note for operators (INTENT spike, not a measured bench).
    pub const GGML_MEMORY_NOTE: &str =
        "~3.1 GB on disk (f16). Plan ~4-6+ GB RAM for whisper.cpp large-v3 inference; \
         quantized q5_0 (~1.1 GiB) is a future option, not the INTENT default.";

    /// Resolve intended local path for ggml-large-v3 under AppData (Windows).
    /// Uses `LOCALAPPDATA` if set, else `APPDATA`. Does **not** create dirs or download.
    pub fn intended_ggml_path() -> Option<PathBuf> {
        let base = std::env::var_os("LOCALAPPDATA").or_else(|| std::env::var_os("APPDATA"))?;
        Some(PathBuf::from(base).join(GGML_REL_DIR).join(GGML_FILENAME))
    }

    /// Stub load/ensure for pq-voice. Checks local file only.
    ///
    /// When `allow_download` is false (default for overnight/CI): never fetches the 3.1 GB model.
    /// When true: still a stub — returns Err describing the URL; full download lands in a later slice.
    pub fn ensure_ggml_model(allow_download: bool) -> Result<PathBuf, String> {
        let path = intended_ggml_path().ok_or_else(|| {
            "LOCALAPPDATA/APPDATA unset — cannot resolve ggml path".to_string()
        })?;
        if path.is_file() {
            return Ok(path);
        }
        if !allow_download {
            return Err(format!(
                "GGML missing at {} (~{:.1} GB). INTENT URL: {}. \
                 allow_download=false — overnight/CI must not fetch. See docs/WHISPER-LARGE.md",
                path.display(),
                GGML_APPROX_BYTES as f64 / 1_000_000_000.0,
                GGML_DOWNLOAD_URL
            ));
        }
        Err(format!(
            "download stub only: would fetch {} (~{:.1} GB) to {} — not implemented yet ({})",
            GGML_DOWNLOAD_URL,
            GGML_APPROX_BYTES as f64 / 1_000_000_000.0,
            path.display(),
            GGML_MEMORY_NOTE
        ))
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn intended_path_ends_with_filename() {
            let p = intended_ggml_path().expect("AppData on Windows CI");
            assert!(p.ends_with(GGML_FILENAME));
            assert!(p.to_string_lossy().contains("models"));
        }

        #[test]
        fn ensure_without_download_errs_when_missing() {
            match ensure_ggml_model(false) {
                Ok(p) => assert!(p.is_file()),
                Err(e) => {
                    assert!(e.contains("GGML missing") || e.contains("unset"));
                    assert!(!e.to_lowercase().contains("downloaded"));
                }
            }
        }
    }
}
