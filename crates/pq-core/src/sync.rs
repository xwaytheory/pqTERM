//! Sync sketch — Electron `src/main/sync.ts` (types + job order only).
//!
//! No npm/pip/self-update I/O. Electron remains the production EngineSync.

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

/// Progress event sent to the renderer as `sync:event` (Electron `SyncEvent`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncEvent {
    pub running: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current: Option<String>,
    pub line: String,
    pub done: u32,
    pub total: u32,
}

impl Default for SyncEvent {
    fn default() -> Self {
        Self {
            running: false,
            current: None,
            line: String::new(),
            done: 0,
            total: 0,
        }
    }
}

/// Shell is never synced (Electron `ensure` / `start` skip).
pub fn skip_sync_engine(id: &str) -> bool {
    id == "shell"
}

/// Priority engines first, then catalog remainder. Unique; shell dropped.
pub fn order_sync_jobs(priority: &[&str], catalog: &[&str]) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = BTreeSet::new();
    for id in priority.iter().chain(catalog.iter()) {
        if skip_sync_engine(id) || !seen.insert(*id) {
            continue;
        }
        out.push((*id).to_string());
    }
    out
}

pub fn sync_line(id: &str, phase: &str) -> String {
    format!("pq · {id} · {phase}")
}

/// In-memory plan stub (no spawn).
#[derive(Debug, Clone, Default)]
pub struct EngineSyncStub {
    pub last: SyncEvent,
    pub done: BTreeSet<String>,
}

impl EngineSyncStub {
    pub fn emit(&mut self, running: Option<bool>, current: Option<Option<String>>, line: Option<String>, done: Option<u32>, total: Option<u32>) {
        if let Some(r) = running {
            self.last.running = r;
        }
        if let Some(c) = current {
            self.last.current = c;
        }
        if let Some(l) = line {
            self.last.line = l;
        }
        if let Some(d) = done {
            self.last.done = d;
        }
        if let Some(t) = total {
            self.last.total = t;
        }
    }

    pub fn start_plan(&mut self, priority: &[&str], catalog: &[&str]) -> Vec<String> {
        let jobs = order_sync_jobs(priority, catalog);
        self.emit(
            Some(true),
            Some(None),
            Some("pq · sync engines…".into()),
            Some(0),
            Some(jobs.len() as u32),
        );
        jobs
    }

    pub fn finish_one(&mut self, id: &str, done: u32, total: u32) {
        self.done.insert(id.into());
        self.emit(None, Some(Some(id.into())), Some(sync_line(id, "ok")), Some(done), Some(total));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_skipped_and_priority_first() {
        let catalog = ["grok", "omp", "shell", "claude"];
        let jobs = order_sync_jobs(&["claude", "shell"], &catalog);
        assert_eq!(jobs, vec!["claude", "grok", "omp"]);
        assert!(!jobs.iter().any(|j| j == "shell"));
    }

    #[test]
    fn sync_event_json_camel_case() {
        let ev = SyncEvent {
            running: true,
            current: Some("grok".into()),
            line: sync_line("grok", "update"),
            done: 0,
            total: 3,
        };
        let raw = serde_json::to_string(&ev).unwrap();
        assert!(raw.contains("\"running\":true"));
        assert_eq!(ev.line, "pq · grok · update");
        let back: SyncEvent = serde_json::from_str(&raw).unwrap();
        assert_eq!(ev, back);
    }

    #[test]
    fn stub_start_and_finish() {
        let mut s = EngineSyncStub::default();
        let jobs = s.start_plan(&["omp"], &["grok", "omp", "shell"]);
        assert_eq!(jobs, vec!["omp", "grok"]);
        assert!(s.last.running);
        assert_eq!(s.last.total, 2);
        s.finish_one("omp", 1, 2);
        assert!(s.done.contains("omp"));
        assert_eq!(s.last.done, 1);
    }
}
