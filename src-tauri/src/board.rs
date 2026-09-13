use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri::async_runtime::Mutex as AsyncMutex;

use crate::shared::{BoardRelation, millis, new_id};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BoardPane {
    pub pane_id: String,
    pub engine: crate::shared::EngineId,
    pub title: String,
    pub files: Vec<String>,
    pub alive: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BoardNote {
    pub id: String,
    pub kind: String,
    pub x: f64,
    pub y: f64,
    pub body: String,
    pub created_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BoardSnapshot {
    pub ws: String,
    pub panes: Vec<BoardPane>,
    pub notes: Vec<BoardNote>,
}

pub struct Board {
    pub panes: Vec<BoardPane>,
    pub notes: Vec<BoardNote>,
    pub active_ws: String,
    pub dirty: bool,
}

pub struct BoardManager {
    pub board: AsyncMutex<Board>,
    pub last_saved: Mutex<i64>,
}

impl BoardManager {
    pub fn new() -> Self {
        BoardManager {
            board: AsyncMutex::new(Board {
                panes: Vec::new(),
                notes: Vec::new(),
                active_ws: String::new(),
                dirty: false,
            }),
            last_saved: Mutex::new(0),
        }
    }
}

fn send(svc: &AppHandle, payload: &str) {
    let _ = svc.emit("board:changed", payload.to_string());
}

pub struct BoardStm {
    pub manager: Arc<BoardManager>,
    pub app: AppHandle,
}

impl BoardStm {
    pub async fn load_panes(&self, ws_id: &str, panes: Vec<BoardPane>) {
        let mut b = self.manager.board.lock().await;
        b.active_ws = ws_id.to_string();
        b.panes = panes;
        b.dirty = true;
    }

    pub async fn set_active(&self, ws_id: &str) {
        let mut b = self.manager.board.lock().await;
        let prev = b.active_ws.clone();
        b.active_ws = ws_id.to_string();
        if prev != *ws_id {
            b.dirty = true;
        }
    }

    pub async fn apply_panes(&self, ws_id: &str, panes: Vec<BoardPane>, patch: bool) {
        let mut b = self.manager.board.lock().await;
        b.active_ws = ws_id.to_string();
        b.dirty = true;
        if patch {
            for p in panes {
                if let Some(existing) = b.panes.iter_mut().find(|x| x.pane_id == p.pane_id) {
                    *existing = p;
                } else {
                    b.panes.push(p);
                }
            }
        } else {
            b.panes = panes;
        }
    }

    pub async fn add_note(&self, note: BoardNote) {
        let mut b = self.manager.board.lock().await;
        b.notes.push(note);
        b.dirty = true;
    }

    pub async fn delete_note(&self, id: &str) -> bool {
        let mut b = self.manager.board.lock().await;
        let before = b.notes.len();
        b.notes.retain(|n| n.id != id);
        if b.notes.len() != before {
            b.dirty = true;
            true
        } else {
            false
        }
    }

    pub async fn connect(
        &self,
        ws_id: &str,
        relation: BoardRelation,
        local_panes: Vec<BoardPane>,
        connected_ws: Option<&str>,
    ) -> BoardSnapshot {
        let mut b = self.manager.board.lock().await;

        if let Some(cws) = connected_ws {
            b.active_ws = cws.to_string();
        } else if b.active_ws.is_empty() || b.active_ws != ws_id {
            b.active_ws = ws_id.to_string();
        }

        if b.panes.is_empty() && !local_panes.is_empty() {
            b.panes = local_panes;
        }
        b.dirty = true;

        let snapshot = BoardSnapshot {
            ws: b.active_ws.clone(),
            panes: b.panes.clone(),
            notes: b.notes.clone(),
        };

        if relation == BoardRelation::Overlap {
            let new_note = BoardNote {
                id: new_id(),
                kind: "ws".into(),
                x: 0.2,
                y: 0.15,
                body: format!("+ remote `{ws_id}`  —  relay active"),
                created_at: millis(),
            };
            if !b.notes.iter().any(|n| n.body == new_note.body) {
                b.notes.push(new_note);
                b.dirty = true;
            }
        }
        drop(b);
        send(&self.app, &serde_json::to_string(&snapshot).unwrap_or_default());
        snapshot
    }

    pub async fn disconnect(&self, ws_id: &str) {
        let mut b = self.manager.board.lock().await;
        b.notes.retain(|n| !n.body.contains(&format!("remote `{ws_id}`")));
        if b.active_ws == *ws_id {
            b.active_ws = String::new();
        }
        b.dirty = true;
    }

    pub async fn push(&self, relation: BoardRelation, local_panes: &[BoardPane]) {
        let mut b = self.manager.board.lock().await;
        b.panes = local_panes.to_vec();
        b.dirty = true;
        drop(b);
        if relation == BoardRelation::Overlap {
            send(&self.app, &serde_json::to_string(local_panes).unwrap_or_default());
        }
    }

    pub async fn snapshot(&self, ws_id: &str) -> BoardSnapshot {
        let b = self.manager.board.lock().await;
        BoardSnapshot {
            ws: ws_id.to_string(),
            panes: if b.panes.is_empty() { Vec::new() } else { b.panes.clone() },
            notes: b.notes.clone(),
        }
    }
}