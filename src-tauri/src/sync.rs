use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::shared::new_id;
use crate::usage::UsageManager;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SyncEvent {
    pub kind: String,
    pub payload: serde_json::Value,
}

#[derive(Clone)]
pub struct SessionClient {
    pub session_id: String,
    pub pane_id: String,
    pub created_at: i64,
}

pub struct SyncManager {
    app: AppHandle,
    /// pane_id -> session client registered by main (spawn side)
    sessions: Mutex<HashMap<String, SessionClient>>,
    /// channel subscribes from renderer, e.g. ["update:shared"] -> pane_ids
    subs: Mutex<HashMap<String, Vec<String>>>,
    /// pane_id -> last usage tick
    last_tick: Mutex<HashMap<String, i64>>,
    ws_forward: Mutex<Option<crate::remote::RelayHandle>>,
}

impl SyncManager {
    pub fn new(app: AppHandle) -> Self {
        SyncManager {
            app,
            sessions: Mutex::new(HashMap::new()),
            subs: Mutex::new(HashMap::new()),
            last_tick: Mutex::new(HashMap::new()),
            ws_forward: Mutex::new(None),
        }
    }

    pub fn register_ws(&self, handle: crate::remote::RelayHandle) {
        *self.ws_forward.lock().unwrap() = Some(handle);
    }

    pub fn set_app(&self, app: AppHandle) {
        let _ = app; // app is owned at construction
    }

    pub fn register_session(&self, pane_id: &str) -> SessionClient {
        let sc = SessionClient {
            session_id: new_id(),
            pane_id: pane_id.to_string(),
            created_at: crate::shared::millis(),
        };
        self.sessions.lock().unwrap().insert(pane_id.to_string(), sc.clone());
        sc
    }

    pub fn forget_session(&self, pane_id: &str) {
        self.sessions.lock().unwrap().remove(pane_id);
        self.last_tick.lock().unwrap().remove(pane_id);
    }

    pub fn pane_for_session(&self, session_id: &str) -> Option<String> {
        self.sessions
            .lock()
            .unwrap()
            .iter()
            .find(|(_, sc)| sc.session_id == session_id)
            .map(|(_, sc)| sc.pane_id.clone())
    }

    /// heartbeat from a pane (idle/voice/renderer) — meters usage
    pub fn tick(&self, pane_id: &str, cmd: &str, usage: &UsageManager, now: i64) {
        self.last_tick.lock().unwrap().insert(pane_id.to_string(), now);
        usage.add_usage(pane_id, cmd, now);
    }

    pub fn subscribe(&self, channel: &str, pane_id: &str) {
        let mut subs = self.subs.lock().unwrap();
        let v = subs.entry(channel.to_string()).or_default();
        if !v.iter().any(|p| p == pane_id) {
            v.push(pane_id.to_string());
        }
    }

    pub fn unsubscribe(&self, channel: &str, pane_id: &str) {
        let mut subs = self.subs.lock().unwrap();
        if let Some(v) = subs.get_mut(channel) {
            v.retain(|p| p != pane_id);
        }
    }

    /// route a typed event to local sessions + remote relay; returns paneId if routed
    pub fn route(
        &self,
        kind: &str,
        payload: serde_json::Value,
        usage: &UsageManager,
    ) -> Option<String> {
        let pane_id = payload
            .get("paneId")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        if let Some(pid) = &pane_id {
            if self.sessions.lock().unwrap().contains_key(pid) {
                let now = crate::shared::millis();
                let cmd = payload
                    .get("cmd")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                self.tick(pid, &cmd, usage, now);
                let ev = SyncEvent {
                    kind: kind.to_string(),
                    payload,
                };
                if let Some(h) = self.ws_forward.lock().unwrap().clone() {
                    h.ev(ev);
                }
            }
        }
        pane_id
    }

    /// renderer-side file ops that should reach the relay device
    pub fn file_event(&self, kind: &str, file: &str, content: Option<&str>) {
        let ev = SyncEvent {
            kind: format!("file:{kind}"),
            payload: serde_json::json!({ "file": file, "content": content }),
        };
        if let Some(h) = self.ws_forward.lock().unwrap().clone() {
            h.ev(ev);
        }
    }

    /// locally echo a sync event to the renderer (e.g. presence)
    pub fn emit(&self, ev: SyncEvent) {
        let _ = self.app.emit("sync:event", serde_json::to_string(&ev).unwrap_or_default());
    }
}