//! PtyManager port start — session map + spawn/write/resize API (Electron twin sketch).
//!
//! Full ConPTY I/O lives behind the optional `pty-spike` feature for now.
//! This module defines the **manager surface** without replacing Electron `pty-manager.ts`.

use std::collections::HashMap;

/// One live (or recently exited) pane PTY session.
#[derive(Debug, Clone)]
pub struct PtySessionMeta {
    pub pane_id: String,
    pub workspace_id: String,
    pub engine: String,
    pub alive: bool,
    pub cols: u16,
    pub rows: u16,
}

/// In-memory PTY session registry (no OS handles yet in default build).
#[derive(Debug, Default)]
pub struct PtyManager {
    sessions: HashMap<String, PtySessionMeta>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn get(&self, pane_id: &str) -> Option<&PtySessionMeta> {
        self.sessions.get(pane_id)
    }

    pub fn alive(&self, pane_id: &str) -> bool {
        self.sessions.get(pane_id).map(|s| s.alive).unwrap_or(false)
    }

    /// Register a session row (OS spawn deferred — see `pty_spike` / later portable-pty wire).
    pub fn register_stub(
        &mut self,
        pane_id: impl Into<String>,
        workspace_id: impl Into<String>,
        engine: impl Into<String>,
        cols: u16,
        rows: u16,
    ) {
        let pane_id = pane_id.into();
        self.sessions.insert(
            pane_id.clone(),
            PtySessionMeta {
                pane_id,
                workspace_id: workspace_id.into(),
                engine: engine.into(),
                alive: true,
                cols,
                rows,
            },
        );
    }

    pub fn resize(&mut self, pane_id: &str, cols: u16, rows: u16) -> bool {
        if let Some(s) = self.sessions.get_mut(pane_id) {
            s.cols = cols;
            s.rows = rows;
            return true;
        }
        false
    }

    /// Stub write — returns false if missing/dead (real write needs master handle).
    pub fn write_stub(&self, pane_id: &str, _data: &str) -> bool {
        self.alive(pane_id)
    }

    pub fn clear_pane(&mut self, pane_id: &str) {
        if let Some(s) = self.sessions.get_mut(pane_id) {
            s.alive = false;
        }
        self.sessions.remove(pane_id);
    }

    pub fn len(&self) -> usize {
        self.sessions.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn register_resize_clear() {
        let mut m = PtyManager::new();
        m.register_stub("p1", "ws1", "grok", 80, 24);
        assert!(m.alive("p1"));
        assert!(m.resize("p1", 120, 40));
        assert_eq!(m.get("p1").unwrap().cols, 120);
        assert!(m.write_stub("p1", "hi"));
        m.clear_pane("p1");
        assert!(!m.alive("p1"));
        assert_eq!(m.len(), 0);
    }
}
