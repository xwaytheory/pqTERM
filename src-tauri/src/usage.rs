use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::shared::millis;

const WINDOW_MS: i64 = 7 * 24 * 60 * 60 * 1000;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub start: i64,
    pub end: i64,
    pub usage_total: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UsageDelta {
    pub pane_id: String,
    pub cmd: String,
    pub delta: i64,
}

#[derive(Default)]
struct PaneUsage {
    /// cmd -> accumulated ms
    by_cmd: HashMap<String, i64>,
}

pub struct UsageManager {
    inner: Mutex<UsageInner>,
    app: AppHandle,
}

struct UsageInner {
    cur_start: Option<i64>,
    windows: Vec<UsageWindow>,
    panes: HashMap<String, PaneUsage>,
    enabled: HashSet<String>,
    mapped: HashMap<String, String>,
    last_add: HashMap<(String, String), i64>,
}

impl UsageManager {
    pub fn new(app: AppHandle) -> Self {
        UsageManager {
            inner: Mutex::new(UsageInner {
                cur_start: None,
                windows: Vec::new(),
                panes: HashMap::new(),
                enabled: HashSet::new(),
                mapped: HashMap::new(),
                last_add: HashMap::new(),
            }),
            app,
        }
    }

    fn add_window_if_needed(&self, inner: &mut UsageInner, now: i64, emit: bool) -> Option<UsageWindow> {
        let Some(start) = inner.cur_start else {
            inner.cur_start = Some(now);
            inner.windows.push(UsageWindow { start: now, end: now + WINDOW_MS, usage_total: 0 });
            let w = inner.windows.last().cloned().unwrap();
            if emit {
                let _ = self.app.emit("usage:changed", serde_json::to_string(&w).unwrap_or_default());
            }
            return Some(w);
        };
        if now >= start && now <= start + WINDOW_MS {
            return inner.windows.last().cloned();
        }
        // roll into next window
        let next_base = start + WINDOW_MS;
        inner.cur_start = Some(next_base);
        inner.windows.push(UsageWindow {
            start: next_base,
            end: next_base + WINDOW_MS,
            usage_total: 0,
        });
        while inner.windows.len() > 30 {
            inner.windows.remove(0);
        }
        let w = inner.windows.last().cloned().unwrap();
        if emit {
            let _ = self.app.emit("usage:changed", serde_json::to_string(&w).unwrap_or_default());
        }
        Some(w)
    }

    pub fn add_usage(&self, pane_id: &str, cmd: &str, now: i64) -> Option<UsageDelta> {
        let no_command = pane_id.is_empty() || cmd.is_empty();
        let mut inner = self.inner.lock().unwrap();
        self.add_window_if_needed(&mut inner, now, false)?;

        let prev = *inner.last_add.get(&(pane_id.to_string(), cmd.to_string())).unwrap_or(&now);
        let mut delta = now - prev;
        if !(0..WINDOW_MS).contains(&delta) {
            delta = 0;
        }
        if delta > 0 {
            // attribute to the highest-order mapped cmd for that pane, else cmd itself
            let map = inner
                .mapped
                .get(pane_id)
                .cloned()
                .filter(|c| !c.is_empty())
                .unwrap_or_else(|| cmd.to_string());
            let entry = inner.panes.entry(pane_id.to_string()).or_default();
            *entry.by_cmd.entry(map.clone()).or_insert(0) += delta;
            *entry.by_cmd.entry(cmd.to_string()).or_insert(0) += delta;
            let w = inner.windows.last_mut().unwrap();
            w.usage_total += delta;
            inner.last_add.insert((pane_id.to_string(), cmd.to_string()), now);
        }

        if no_command {
            return None;
        }

        let _ = self.app.emit(
            "usage:changed",
            serde_json::to_string(inner.windows.last().unwrap()).unwrap_or_default(),
        );

        Some(UsageDelta {
            pane_id: pane_id.to_string(),
            cmd: cmd.to_string(),
            delta,
        })
    }

    pub fn update_panes(&self, enabled: Vec<String>, mapped: Vec<(String, String)>) {
        let mut inner = self.inner.lock().unwrap();
        inner.enabled = enabled.into_iter().collect();
        inner.mapped = mapped.into_iter().collect();
        // drop panes no longer enabled
        let keys: Vec<String> = inner.panes.keys().cloned().collect();
        for k in keys {
            if !inner.enabled.contains(&k) {
                inner.panes.remove(&k);
            }
        }
    }

    pub fn get_window(&self) -> Option<UsageWindow> {
        let inner = self.inner.lock().unwrap();
        inner.windows.last().cloned()
    }

    /// per-cmd breakdown for the current window (0s share for unmapped)
    pub fn breakdown(&self) -> HashMap<String, i64> {
        let inner = self.inner.lock().unwrap();
        let mut out: HashMap<String, i64> = HashMap::new();
        for (pane, usage) in inner.panes.iter() {
            if !inner.enabled.contains(pane) {
                continue;
            }
            for (cmd, cum) in usage.by_cmd.iter() {
                *out.entry(cmd.clone()).or_insert(0) += *cum;
            }
        }
        out
    }

    pub fn reset_window(&self) {
        let mut inner = self.inner.lock().unwrap();
        inner.windows.clear();
        inner.cur_start = None;
        inner.last_add.clear();
        inner.panes = inner
            .panes
            .drain()
            .map(|(k, v)| (k, PaneUsage { by_cmd: HashMap::new() }))
            .collect();
        self.add_window_if_needed(&mut inner, millis(), true);
    }
}