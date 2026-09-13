use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, WebviewUrl, WebviewWindowBuilder};
use tauri::async_runtime::Mutex as AsyncMutex;

use crate::shared::millis;

/// Whisper bridge to a bundled webview running onnxruntime-web model.
/// The renderer sends PCM audio; we forward to the voice window which
/// transcribes and reports back via document.title (`__pq__` payload),
/// polling the same way auth popups work.

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WhisperJob {
    pub pane_id: String,
    pub sample_rate: u32,
    pub channels: u32,
    /// base64 f32le PCM
    pub audio_b64: String,
}

pub struct BridgeManager {
    pub app: AppHandle,
    pub window: AsyncMutex<Option<tauri::WebviewWindow>>,
    pub ready: AsyncMutex<bool>,
    pub last_result: AsyncMutex<Option<serde_json::Value>>,
}

impl BridgeManager {
    pub fn new(app: AppHandle) -> Self {
        BridgeManager {
            app,
            window: AsyncMutex::new(None),
            ready: AsyncMutex::new(false),
            last_result: AsyncMutex::new(None),
        }
    }

    pub fn ensure_window(&self) -> Result<tauri::WebviewWindow, String> {
        if let Some(w) = self.window.try_lock().map(|g| g.clone()).unwrap_or(None) {
            return Ok(w);
        }
        let app = self.app.clone();
        let win = WebviewWindowBuilder::new(
            &app,
            "voice-bridge",
            tauri::WebviewUrl::App("whisperBridge.html".into()),
        )
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;
        *self.window.try_lock().unwrap() = Some(win.clone());
        Ok(win)
    }

    /// forward a job to the bridge window; poll `document.title` for the result
    pub async fn run_whisper(&self, job: WhisperJob) -> Result<serde_json::Value, String> {
        let win = self.ensure_window()?;
        let js = format!(
            "window.__pqRunWhisper({});",
            serde_json::to_string(&job).map_err(|e| e.to_string())?
        );
        win.eval(&js).map_err(|e| e.to_string())?;
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(120);
        while std::time::Instant::now() < deadline {
            if let Ok(t) = win.title() {
                let t = t.to_string();
                if let Some(stripped) = t.strip_prefix("__pq__") {
                    let _ = win
                        .set_title("")
                        .or_else(|_| win.set_title("whisper-bridge"));
                    let v = serde_json::from_str::<serde_json::Value>(stripped).unwrap_or_default();
                    *self.last_result.lock().await = Some(v.clone());
                    return Ok(v);
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }
        Err("whisper bridge timeout".into())
    }

    pub fn audio_redirect_happy(&self, b64: String) {
        let _ = self.app.emit("bridge:audio", b64);
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VoiceCommandResult {
    pub intent: String,
    pub text: String,
    pub pane_id: Option<String>,
    pub action: Option<String>,
    pub ok: bool,
}

/// run a voice command (parse intent from the shell-side helper)
pub fn run_voice_command(command: &str) -> VoiceCommandResult {
    let lower = command.trim().to_lowercase();
    let intent = if lower.starts_with("open") || lower.starts_with("nowa") || lower.starts_with("start") {
        "open"
    } else if lower.starts_with("close") || lower.starts_with("zamknij") || lower.starts_with("kill") {
        "kill"
    } else if lower.starts_with("stop") || lower.starts_with("halt") {
        "stop"
    } else if lower.starts_with("reset") || lower.starts_with("usu") {
        "reset"
    } else {
        "mention"
    };
    VoiceCommandResult {
        intent: intent.to_string(),
        text: command.to_string(),
        pane_id: None,
        action: None,
        ok: true,
    }
}

#[allow(dead_code)]
pub fn now_ms() -> i64 {
    millis()
}