//! Usage sketch — Electron `src/main/usage.ts` (types + normalize helpers only).
//!
//! No network, no credential files. Electron remains the production UsageHub.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// One quota window (Electron `UsageWindow`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub id: String,
    pub label: String,
    pub used_pct: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reset_at: Option<u64>,
}

/// Per-engine usage snapshot (Electron `EngineUsage`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineUsage {
    pub engine: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan: Option<String>,
    pub windows: Vec<UsageWindow>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    pub fetched_at: u64,
}

/// Engine id → usage (Electron `UsageMap`).
pub type UsageMap = BTreeMap<String, EngineUsage>;

/// Claude-style: values in `0..=1` are fractions; otherwise already percent.
pub fn normalize_used_pct(raw: f64) -> f64 {
    if !raw.is_finite() {
        return 0.0;
    }
    let pct = if (0.0..=1.0).contains(&raw) {
        raw * 100.0
    } else {
        raw
    };
    pct.clamp(0.0, 100.0)
}

/// Compact window label twin of Electron omp/claude heuristics.
pub fn window_label_hint(label: &str) -> &'static str {
    if label.is_empty() {
        return "plan";
    }
    if regex_week(label) {
        return "7d";
    }
    if regex_hour(label) {
        return "5h";
    }
    "other"
}

fn regex_week(label: &str) -> bool {
    let l = label.to_ascii_lowercase();
    l.contains('7') || l.contains("week") || l == "weekly"
}

fn regex_hour(label: &str) -> bool {
    let l = label.to_ascii_lowercase();
    l.contains('5') || l.contains("hour") || l.contains("session") || l == "5h"
}

/// Offline placeholder (Electron grok/codex `usage offline` note).
pub fn offline_usage(engine: &str, fetched_at: u64) -> EngineUsage {
    EngineUsage {
        engine: engine.into(),
        plan: None,
        windows: Vec::new(),
        note: Some("usage offline".into()),
        fetched_at,
    }
}

/// In-memory hub stub (no timer / HTTP).
#[derive(Debug, Default, Clone)]
pub struct UsageHubStub {
    pub last: UsageMap,
}

impl UsageHubStub {
    pub fn snapshot(&self) -> &UsageMap {
        &self.last
    }

    pub fn apply(&mut self, usage: EngineUsage) {
        self.last.insert(usage.engine.clone(), usage);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_fraction_and_percent() {
        assert!((normalize_used_pct(0.42) - 42.0).abs() < 1e-9);
        assert!((normalize_used_pct(42.0) - 42.0).abs() < 1e-9);
        assert!((normalize_used_pct(0.0) - 0.0).abs() < 1e-9);
        assert!((normalize_used_pct(1.0) - 100.0).abs() < 1e-9);
        assert_eq!(normalize_used_pct(150.0), 100.0);
        assert_eq!(normalize_used_pct(f64::NAN), 0.0);
    }

    #[test]
    fn window_label_hints() {
        assert_eq!(window_label_hint("7d"), "7d");
        assert_eq!(window_label_hint("weekly"), "7d");
        assert_eq!(window_label_hint("5h"), "5h");
        assert_eq!(window_label_hint("session"), "5h");
        assert_eq!(window_label_hint("plan"), "other");
        assert_eq!(window_label_hint(""), "plan");
    }

    #[test]
    fn usage_json_roundtrip_and_hub() {
        let u = EngineUsage {
            engine: "claude".into(),
            plan: Some("pro".into()),
            windows: vec![UsageWindow {
                id: "5h".into(),
                label: "5h".into(),
                used_pct: 12.5,
                reset_at: Some(1),
            }],
            note: None,
            fetched_at: 99,
        };
        let raw = serde_json::to_string(&u).unwrap();
        assert!(raw.contains("usedPct"));
        assert!(raw.contains("fetchedAt"));
        let back: EngineUsage = serde_json::from_str(&raw).unwrap();
        assert_eq!(u, back);

        let mut hub = UsageHubStub::default();
        hub.apply(offline_usage("grok", 1));
        hub.apply(u.clone());
        assert_eq!(hub.snapshot().len(), 2);
        assert_eq!(hub.snapshot()["grok"].note.as_deref(), Some("usage offline"));
    }
}
