//! Speech-to-text **intent** for desktop pq-voice (Polish). Not the live Electron model.
//!
//! Skeleton listen/transcribe pipeline: probe AppData GGML, refuse multi-GB download
//! unless the file is already present, emit honest Status/Transcript IPC.

use std::path::{Path, PathBuf};

use crate::ipc::{IpcMessage, Status, Transcript, VoiceState};

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

/// Stages of the listen/transcribe skeleton (no whisper.cpp bound yet).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PipelineStage {
    Idle,
    Probe,
    Listen,
    Transcribe,
    Emit,
    Done,
    Failed,
}

/// Local GGML probe result. Never fetches.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ModelStatus {
    Present { path: PathBuf, bytes: u64 },
    Missing { path: PathBuf },
    AppDataUnset,
}

impl ModelStatus {
    pub fn is_present(&self) -> bool {
        matches!(self, ModelStatus::Present { .. })
    }
}

/// One pipeline step (optional IPC fan-out for work↔voice).
#[derive(Debug, Clone, PartialEq)]
pub struct PipelineEvent {
    pub stage: PipelineStage,
    pub detail: String,
    pub ipc: Option<IpcMessage>,
}

/// Result of [`run_listen_transcribe_skeleton`] / [`run_listen_transcribe_at`].
#[derive(Debug, Clone, PartialEq)]
pub struct PipelineResult {
    pub model: ModelStatus,
    pub stages: Vec<PipelineStage>,
    pub events: Vec<PipelineEvent>,
    pub transcripts: Vec<Transcript>,
    pub ok: bool,
}

/// Resolve intended local path for ggml-large-v3 under AppData (Windows).
/// Uses `LOCALAPPDATA` if set, else `APPDATA`. Does **not** create dirs or download.
pub fn intended_ggml_path() -> Option<PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA").or_else(|| std::env::var_os("APPDATA"))?;
    Some(PathBuf::from(base).join(GGML_REL_DIR).join(GGML_FILENAME))
}

/// Probe a concrete path (testable; no download).
pub fn probe_ggml_at(path: &Path) -> ModelStatus {
    if path.is_file() {
        let bytes = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        ModelStatus::Present {
            path: path.to_path_buf(),
            bytes,
        }
    } else {
        ModelStatus::Missing {
            path: path.to_path_buf(),
        }
    }
}

/// Probe the INTENT AppData path. Never fetches.
pub fn probe_ggml_model() -> ModelStatus {
    match intended_ggml_path() {
        None => ModelStatus::AppDataUnset,
        Some(p) => probe_ggml_at(&p),
    }
}

/// Operator-facing message. Missing model is explicit and names the 3.1 GB file.
pub fn model_status_message(status: &ModelStatus) -> String {
    match status {
        ModelStatus::Present { path, bytes } => format!(
            "GGML present: {} ({:.1} GB on disk). INTENT {} / {}. Inference still unwired (skeleton).",
            path.display(),
            *bytes as f64 / 1_000_000_000.0,
            MODEL_ID,
            LANGUAGE
        ),
        ModelStatus::Missing { path } => format!(
            "Whisper INTENT model missing — not downloading.\n\
             Expected file: {GGML_FILENAME} (~{:.1} GB f16)\n\
             Expected path: {}\n\
             Place it manually from:\n  {GGML_DOWNLOAD_URL}\n\
             Overnight/CI will not fetch multi-GB weights. See docs/WHISPER-LARGE.md",
            GGML_APPROX_BYTES as f64 / 1_000_000_000.0,
            path.display()
        ),
        ModelStatus::AppDataUnset => {
            "LOCALAPPDATA/APPDATA unset — cannot resolve ggml path. No download attempted."
                .to_string()
        }
    }
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
        return Err(model_status_message(&ModelStatus::Missing { path }));
    }
    Err(format!(
        "download stub only: would fetch {} (~{:.1} GB) to {} — not implemented yet ({})",
        GGML_DOWNLOAD_URL,
        GGML_APPROX_BYTES as f64 / 1_000_000_000.0,
        path.display(),
        GGML_MEMORY_NOTE
    ))
}

/// Default AppData probe + listen/transcribe skeleton. Never downloads.
pub fn run_listen_transcribe_skeleton(session_id: &str) -> PipelineResult {
    run_listen_transcribe_at(session_id, intended_ggml_path())
}

/// Listen → transcribe skeleton against an explicit model path (tests + `--listen`).
///
/// Honest: no mic capture, no whisper.cpp. If weights are present we still emit a
/// stub transcript labeled as unwired inference. If missing, Status::Error with a
/// clear "not downloading" message.
pub fn run_listen_transcribe_at(session_id: &str, model_path: Option<PathBuf>) -> PipelineResult {
    let mut stages = vec![PipelineStage::Idle, PipelineStage::Probe];
    let mut events = Vec::new();
    let mut transcripts = Vec::new();

    let model = match model_path {
        None => ModelStatus::AppDataUnset,
        Some(ref p) => probe_ggml_at(p),
    };
    let msg = model_status_message(&model);
    events.push(PipelineEvent {
        stage: PipelineStage::Probe,
        detail: msg.clone(),
        ipc: Some(IpcMessage::Status(Status {
            source: "pq-voice".into(),
            state: VoiceState::Ready,
            detail: Some(format!("probe: {}", first_line(&msg))),
            session_id: Some(session_id.into()),
        })),
    });

    match &model {
        ModelStatus::Present { path, .. } => {
            stages.push(PipelineStage::Listen);
            events.push(PipelineEvent {
                stage: PipelineStage::Listen,
                detail: format!("listen session={session_id} lang={LANGUAGE} (mic unwired)"),
                ipc: Some(IpcMessage::Status(Status {
                    source: "pq-voice".into(),
                    state: VoiceState::Listening,
                    detail: Some(format!("lang={LANGUAGE}")),
                    session_id: Some(session_id.into()),
                })),
            });
            stages.push(PipelineStage::Transcribe);
            events.push(PipelineEvent {
                stage: PipelineStage::Transcribe,
                detail: format!(
                    "transcribe INTENT {MODEL_ID} at {} — whisper.cpp not linked",
                    path.display()
                ),
                ipc: Some(IpcMessage::Status(Status {
                    source: "pq-voice".into(),
                    state: VoiceState::Processing,
                    detail: Some("skeleton: no inference".into()),
                    session_id: Some(session_id.into()),
                })),
            });
            let text = format!(
                "[stub] model present — inference not wired ({})",
                path.file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or(GGML_FILENAME)
            );
            let t = Transcript {
                session_id: session_id.into(),
                text: text.clone(),
                lang: Some(LANGUAGE.into()),
                is_final: true,
            };
            stages.push(PipelineStage::Emit);
            events.push(PipelineEvent {
                stage: PipelineStage::Emit,
                detail: text,
                ipc: Some(IpcMessage::Transcript(t.clone())),
            });
            transcripts.push(t);
            stages.push(PipelineStage::Done);
            events.push(PipelineEvent {
                stage: PipelineStage::Done,
                detail: "skeleton listen/transcribe complete".into(),
                ipc: Some(IpcMessage::Status(Status {
                    source: "pq-voice".into(),
                    state: VoiceState::Idle,
                    detail: Some("stub utterance done".into()),
                    session_id: Some(session_id.into()),
                })),
            });
            PipelineResult {
                model,
                stages,
                events,
                transcripts,
                ok: true,
            }
        }
        other => {
            stages.push(PipelineStage::Failed);
            events.push(PipelineEvent {
                stage: PipelineStage::Failed,
                detail: model_status_message(other),
                ipc: Some(IpcMessage::Status(Status {
                    source: "pq-voice".into(),
                    state: VoiceState::Error,
                    detail: Some(first_line(&model_status_message(other))),
                    session_id: Some(session_id.into()),
                })),
            });
            PipelineResult {
                model,
                stages,
                events,
                transcripts,
                ok: false,
            }
        }
    }
}

fn first_line(s: &str) -> String {
    s.lines().next().unwrap_or(s).to_string()
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
                assert!(
                    e.contains("missing")
                        || e.contains("unset")
                        || e.contains("not downloading"),
                    "{e}"
                );
                assert!(!e.to_lowercase().contains("downloaded"));
            }
        }
    }

    #[test]
    fn probe_missing_and_present() {
        let missing = std::env::temp_dir().join("pq-stt-definitely-missing-ggml-large-v3.bin");
        let _ = std::fs::remove_file(&missing);
        assert!(matches!(probe_ggml_at(&missing), ModelStatus::Missing { .. }));
        assert!(model_status_message(&probe_ggml_at(&missing)).contains("not downloading"));

        let present = std::env::temp_dir().join("pq-stt-probe-present.bin");
        std::fs::write(&present, b"not-a-real-model").unwrap();
        match probe_ggml_at(&present) {
            ModelStatus::Present { bytes, .. } => assert_eq!(bytes, 16),
            other => panic!("expected present, got {other:?}"),
        }
        let _ = std::fs::remove_file(&present);
    }

    #[test]
    fn pipeline_missing_model_is_failed_error_ipc() {
        let missing = std::env::temp_dir().join("pq-stt-pipeline-missing.bin");
        let _ = std::fs::remove_file(&missing);
        let r = run_listen_transcribe_at("sess-miss", Some(missing));
        assert!(!r.ok);
        assert!(r.stages.contains(&PipelineStage::Failed));
        assert!(r.transcripts.is_empty());
        let err = r
            .events
            .iter()
            .find(|e| e.stage == PipelineStage::Failed)
            .expect("failed event");
        match &err.ipc {
            Some(IpcMessage::Status(s)) => {
                assert_eq!(s.state, VoiceState::Error);
                assert_eq!(s.session_id.as_deref(), Some("sess-miss"));
            }
            other => panic!("expected Status Error, got {other:?}"),
        }
        assert!(err.detail.contains("not downloading"));
        assert!(err.detail.contains(GGML_FILENAME) || err.detail.contains("Expected"));
    }

    #[test]
    fn pipeline_present_model_emits_stub_transcript() {
        let present = std::env::temp_dir().join("pq-stt-pipeline-present.bin");
        std::fs::write(&present, b"ggml-placeholder").unwrap();
        let r = run_listen_transcribe_at("sess-ok", Some(present.clone()));
        let _ = std::fs::remove_file(&present);
        assert!(r.ok);
        assert!(r.stages.contains(&PipelineStage::Listen));
        assert!(r.stages.contains(&PipelineStage::Transcribe));
        assert!(r.stages.contains(&PipelineStage::Done));
        assert_eq!(r.transcripts.len(), 1);
        assert!(r.transcripts[0].is_final);
        assert!(r.transcripts[0].text.contains("inference not wired"));
        assert_eq!(r.transcripts[0].lang.as_deref(), Some("pl"));
    }

    #[test]
    fn missing_message_names_url_and_size() {
        let status = ModelStatus::Missing {
            path: PathBuf::from(r"C:\fake\ggml-large-v3.bin"),
        };
        let m = model_status_message(&status);
        assert!(m.contains(GGML_DOWNLOAD_URL));
        assert!(m.contains("3.1"));
        assert!(m.contains("not downloading"));
    }
}
