//! Resume sketch — Electron `src/main/resume.ts` (types + pick logic only).
//!
//! No opencode/omp disk scan. Electron remains the production session scanner.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Engine-native conversation handle (Electron `SessionRef`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRef {
    pub handle: String,
    pub title: String,
    pub updated_at: u64,
}

/// Cache slot: one discovered session, claimable by a pane.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeSlot {
    #[serde(rename = "ref")]
    pub session: SessionRef,
    pub claimed: bool,
}

/// CLI flags that make an engine resume a previous conversation (Electron `resumeFlag`).
pub fn resume_flag(engine: &str, handle: &str) -> Option<Vec<String>> {
    match engine {
        "opencode" => Some(vec!["--session".into(), handle.into()]),
        "omp" => Some(vec!["--resume".into(), handle.into()]),
        _ => None,
    }
}

fn key_of(workspace_id: &str, engine: &str) -> String {
    format!("{workspace_id}\u{0000}{engine}")
}

/// In-memory resume cache twin of Electron `primeResume` / `pickResume`.
///
/// Types + claim algorithm only. Populate via [`ResumeCache::prime`] (tests / later I/O).
#[derive(Debug, Default, Clone)]
pub struct ResumeCache {
    slots: BTreeMap<String, Vec<ResumeSlot>>,
}

impl ResumeCache {
    pub fn prime(&mut self, workspace_id: &str, engine: &str, sessions: Vec<SessionRef>) {
        let slots = sessions
            .into_iter()
            .map(|session| ResumeSlot {
                session,
                claimed: false,
            })
            .collect();
        self.slots.insert(key_of(workspace_id, engine), slots);
    }

    pub fn slots(&self, workspace_id: &str, engine: &str) -> Option<&[ResumeSlot]> {
        self.slots.get(&key_of(workspace_id, engine)).map(|v| v.as_slice())
    }

    /// Persisted handle wins if still unclaimed; else newest still-unclaimed slot.
    /// Caller should prime newest-first (Electron sorts `updatedAt` desc).
    pub fn pick(
        &mut self,
        workspace_id: &str,
        engine: &str,
        session_handle: Option<&str>,
    ) -> Option<SessionRef> {
        let slots = self.slots.get_mut(&key_of(workspace_id, engine))?;
        if let Some(want) = session_handle {
            if let Some(prev) = slots.iter_mut().find(|s| s.session.handle == want && !s.claimed)
            {
                prev.claimed = true;
                return Some(prev.session.clone());
            }
        }
        for s in slots.iter_mut() {
            if s.claimed {
                continue;
            }
            s.claimed = true;
            return Some(s.session.clone());
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(handle: &str, updated_at: u64) -> SessionRef {
        SessionRef {
            handle: handle.into(),
            title: handle.into(),
            updated_at,
        }
    }

    #[test]
    fn resume_flag_opencode_and_omp_only() {
        assert_eq!(
            resume_flag("opencode", "abc"),
            Some(vec!["--session".into(), "abc".into()])
        );
        assert_eq!(
            resume_flag("omp", "xyz"),
            Some(vec!["--resume".into(), "xyz".into()])
        );
        assert_eq!(resume_flag("grok", "x"), None);
        assert_eq!(resume_flag("claude", "x"), None);
        assert_eq!(resume_flag("shell", "x"), None);
    }

    #[test]
    fn pick_persisted_handle_wins_then_next_unclaimed() {
        let mut cache = ResumeCache::default();
        cache.prime("ws1", "opencode", vec![r("new", 3), r("old", 1), r("mid", 2)]);
        let first = cache.pick("ws1", "opencode", Some("mid")).unwrap();
        assert_eq!(first.handle, "mid");
        let second = cache.pick("ws1", "opencode", None).unwrap();
        assert_eq!(second.handle, "new");
        let third = cache.pick("ws1", "opencode", None).unwrap();
        assert_eq!(third.handle, "old");
        assert!(cache.pick("ws1", "opencode", None).is_none());
    }

    #[test]
    fn pick_unknown_workspace_is_none() {
        let mut cache = ResumeCache::default();
        assert!(cache.pick("nope", "omp", None).is_none());
    }

    #[test]
    fn session_ref_json_camel_case() {
        let s = r("h1", 42);
        let raw = serde_json::to_string(&s).unwrap();
        assert!(raw.contains("updatedAt"));
        assert!(raw.contains("\"handle\":\"h1\""));
        let back: SessionRef = serde_json::from_str(&raw).unwrap();
        assert_eq!(s, back);
    }
}
