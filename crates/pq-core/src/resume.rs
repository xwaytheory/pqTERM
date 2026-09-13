//! Resume sketch — Electron `src/main/resume.ts` (types + pick + fixture I/O).
//!
//! **Honesty:** no opencode/omp live disk scan. Electron remains the production
//! session scanner. Fixture helpers load from **explicit paths** or in-memory
//! JSON/NDJSON only (tests + later host wiring). They never call
//! [`crate::store::state_path`] / prod AppData and never write unless given an
//! explicit destination path ([`write_sessions_to`]).

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::Path;
use thiserror::Error;

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

/// Errors from resume fixture load/save (explicit paths only).
#[derive(Debug, Error)]
pub enum ResumeIoError {
    #[error("io: {0}")]
    Io(#[from] io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("ndjson line {line}: {source}")]
    Ndjson {
        line: usize,
        #[source]
        source: serde_json::Error,
    },
}

/// Sort newest-first (`updated_at` desc) — matches Electron resume list order.
pub fn sort_sessions_newest_first(sessions: &mut [SessionRef]) {
    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
}

/// Parse a JSON array of [`SessionRef`] (camelCase wire).
pub fn sessions_from_json(raw: &str) -> Result<Vec<SessionRef>, ResumeIoError> {
    let mut sessions: Vec<SessionRef> = serde_json::from_str(raw)?;
    sort_sessions_newest_first(&mut sessions);
    Ok(sessions)
}

/// Parse NDJSON: one [`SessionRef`] JSON object per non-empty line.
pub fn sessions_from_ndjson(raw: &str) -> Result<Vec<SessionRef>, ResumeIoError> {
    let mut sessions = Vec::new();
    for (idx, line) in raw.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let s: SessionRef = serde_json::from_str(line).map_err(|source| ResumeIoError::Ndjson {
            line: idx + 1,
            source,
        })?;
        sessions.push(s);
    }
    sort_sessions_newest_first(&mut sessions);
    Ok(sessions)
}

/// In-memory fixture: JSON array if trimmed text starts with `[`, else NDJSON.
pub fn sessions_from_fixture(raw: &str) -> Result<Vec<SessionRef>, ResumeIoError> {
    let trimmed = raw.trim_start();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    if trimmed.starts_with('[') {
        sessions_from_json(raw)
    } else {
        sessions_from_ndjson(raw)
    }
}

/// Load sessions from an **explicit** file path (no default AppData / engine dirs).
pub fn sessions_from_path(path: impl AsRef<Path>) -> Result<Vec<SessionRef>, ResumeIoError> {
    let raw = fs::read_to_string(path)?;
    sessions_from_fixture(&raw)
}

/// Write sessions as pretty JSON array to an **explicit** path only.
///
/// Never use for live Electron AppData. Creates parent dirs when needed.
pub fn write_sessions_to(
    path: impl AsRef<Path>,
    sessions: &[SessionRef],
) -> Result<(), ResumeIoError> {
    let path = path.as_ref();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let body = serde_json::to_string_pretty(sessions)?;
    fs::write(path, body)?;
    Ok(())
}

/// In-memory resume cache twin of Electron `primeResume` / `pickResume`.
///
/// Types + claim algorithm only. Populate via [`ResumeCache::prime`] /
/// [`ResumeCache::prime_from_path`] / [`ResumeCache::prime_from_fixture`].
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

    /// Prime from an explicit fixture path (JSON array or NDJSON).
    pub fn prime_from_path(
        &mut self,
        workspace_id: &str,
        engine: &str,
        path: impl AsRef<Path>,
    ) -> Result<(), ResumeIoError> {
        let sessions = sessions_from_path(path)?;
        self.prime(workspace_id, engine, sessions);
        Ok(())
    }

    /// Prime from in-memory fixture text (JSON array or NDJSON).
    pub fn prime_from_fixture(
        &mut self,
        workspace_id: &str,
        engine: &str,
        raw: &str,
    ) -> Result<(), ResumeIoError> {
        let sessions = sessions_from_fixture(raw)?;
        self.prime(workspace_id, engine, sessions);
        Ok(())
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
    use std::time::{SystemTime, UNIX_EPOCH};

    fn r(handle: &str, updated_at: u64) -> SessionRef {
        SessionRef {
            handle: handle.into(),
            title: handle.into(),
            updated_at,
        }
    }

    fn temp_dir() -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("pq-resume-fixture-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
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

    #[test]
    fn sessions_from_json_sorts_newest_first() {
        let raw = r#"[
          {"handle":"old","title":"Old","updatedAt":1},
          {"handle":"new","title":"New","updatedAt":9}
        ]"#;
        let v = sessions_from_json(raw).unwrap();
        assert_eq!(v[0].handle, "new");
        assert_eq!(v[1].handle, "old");
    }

    #[test]
    fn sessions_from_ndjson_and_fixture_dispatch() {
        let nd = "{\"handle\":\"a\",\"title\":\"A\",\"updatedAt\":2}\n{\"handle\":\"b\",\"title\":\"B\",\"updatedAt\":5}\n";
        let v = sessions_from_ndjson(nd).unwrap();
        assert_eq!(v[0].handle, "b");
        let from_fix = sessions_from_fixture(nd).unwrap();
        assert_eq!(from_fix[0].handle, "b");
        assert!(sessions_from_fixture("").unwrap().is_empty());
    }

    #[test]
    fn prime_from_path_tempdir_roundtrip() {
        let dir = temp_dir();
        let path = dir.join("sessions.json");
        let sessions = vec![r("s2", 20), r("s1", 10)];
        write_sessions_to(&path, &sessions).unwrap();
        let loaded = sessions_from_path(&path).unwrap();
        assert_eq!(loaded[0].handle, "s2");
        let mut cache = ResumeCache::default();
        cache.prime_from_path("ws", "omp", &path).unwrap();
        assert_eq!(cache.slots("ws", "omp").unwrap().len(), 2);
        let picked = cache.pick("ws", "omp", None).unwrap();
        assert_eq!(picked.handle, "s2");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prime_from_fixture_in_memory() {
        let mut cache = ResumeCache::default();
        cache
            .prime_from_fixture(
                "ws",
                "opencode",
                r#"[{"handle":"x","title":"X","updatedAt":1}]"#,
            )
            .unwrap();
        assert_eq!(cache.pick("ws", "opencode", Some("x")).unwrap().handle, "x");
    }

    #[test]
    fn write_sessions_to_requires_explicit_path_only() {
        // Documented contract: helper takes Path; no state_path() call exists in this module.
        let dir = temp_dir();
        let path = dir.join("out").join("s.json");
        write_sessions_to(&path, &[r("z", 1)]).unwrap();
        assert!(path.is_file());
        let _ = fs::remove_dir_all(&dir);
    }
}
