use std::fs;
use std::path::{Path, PathBuf};

use crate::engines::{default_provider, ENGINE_SPECS};
use crate::env::{app_data_dir, home_dir};
use crate::shared::{AppSnapshot, GoogleOAuthConfig, PaneState, ProviderInfo, Workspace};

fn save_file() -> PathBuf {
    app_data_dir().join("pq-state.json")
}

fn load_file() -> PathBuf {
    let dest = save_file();
    if !dest.exists() {
        let from_prod = home_dir().join("AppData").join("Roaming").join("pq").join("pq-state.json");
        if from_prod.exists() {
            if let Some(parent) = dest.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let _ = fs::copy(&from_prod, &dest);
        }
    }
    if dest.exists() {
        dest
    } else if home_dir()
        .join("AppData")
        .join("Roaming")
        .join("pq")
        .join("pq-state.json")
        .exists()
    {
        home_dir().join("AppData").join("Roaming").join("pq").join("pq-state.json")
    } else {
        dest
    }
}

fn empty() -> AppSnapshot {
    AppSnapshot {
        user: None,
        google: GoogleOAuthConfig { client_id: String::new(), client_secret: String::new() },
        workspaces: Vec::new(),
        active_workspace_id: None,
        providers: ENGINE_SPECS.iter().map(default_provider).collect(),
        sidebar_open: true,
    }
}

fn merge_providers(saved: &[ProviderInfo]) -> Vec<ProviderInfo> {
    let by_id: std::collections::HashMap<&str, &ProviderInfo> = saved
        .iter()
        .map(|p| (p.id.as_str(), p))
        .collect();
    ENGINE_SPECS
        .iter()
        .map(|spec| {
            let base = default_provider(spec);
            let Some(prev) = by_id.get(spec.id.as_str()).copied() else {
                return base;
            };
            let models = spec
                .models
                .iter()
                .map(|m| {
                    let mut out = m.clone();
                    if let Some(old) = prev.models.iter().find(|x| x.id == m.id) {
                        out.enabled = old.enabled;
                    }
                    out
                })
                .collect();
            ProviderInfo {
                models,
                enabled: prev.enabled,
                installed: prev.installed,
                detected_auth: prev.detected_auth,
                matched_email: prev.matched_email.clone(),
                resolved_path: prev.resolved_path.clone(),
                ..base
            }
        })
        .collect()
}

fn sanitize_pane(p: &PaneState) -> PaneState {
    let engine_name = p
        .engine
        .and_then(|e| ENGINE_SPECS.iter().find(|s| s.id == e).map(|s| s.name.clone()))
        .unwrap_or_else(|| "idle".to_string());
    let keep = p.title_locked.unwrap_or(false)
        && p.title.trim().len() > 0
        && !crate::shared::looks_like_path_title(&p.title);
    PaneState {
        id: p.id.clone(),
        engine: p.engine,
        title: if keep { p.title.clone() } else { engine_name },
        title_locked: Some(keep),
        model: p.model.clone(),
        session_handle: p.session_handle.clone(),
    }
}

pub fn load_state() -> AppSnapshot {
    let raw = fs::read_to_string(load_file());
    let parsed = match raw {
        Ok(s) => serde_json::from_str::<AppSnapshot>(&s).ok(),
        Err(_) => None,
    };
    match parsed {
        Some(mut parsed) => {
            let workspaces: Vec<Workspace> = parsed
                .workspaces
                .iter()
                .map(|w| Workspace {
                    id: w.id.clone(),
                    title: w.title.clone(),
                    cwd: w.cwd.clone(),
                    layout: w.layout,
                    panes: w.panes.iter().map(sanitize_pane).collect(),
                    zoomed_pane_id: w.zoomed_pane_id.clone(),
                    created_at: w.created_at,
                    updated_at: w.updated_at,
                })
                .collect();
            parsed.workspaces = workspaces;
            parsed.google = GoogleOAuthConfig {
                client_id: parsed.google.client_id,
                client_secret: parsed.google.client_secret,
            };
            parsed.providers = merge_providers(&parsed.providers);
            parsed
        }
        None => empty(),
    }
}

pub fn save_state(state: &AppSnapshot) {
    let file = save_file();
    if let Some(parent) = file.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(state) {
        let _ = fs::write(file, json);
    }
}

pub fn exists_state() -> bool {
    load_file().exists()
}

#[allow(dead_code)]
pub fn touch_workspace(mut ws: Workspace) -> Workspace {
    ws.touch();
    ws
}