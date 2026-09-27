//! App state persistence (Electron `store.ts` twin) — lean serde snapshot.
//!
//! File: `{user_data_dir}/pq-state.json` (see [`crate::env::user_data_dir`]).
//! A missing file is a fresh profile. Another profile's workspaces are not copied.
//!
//! Provider merge: `pq_core::engines::merge_providers` (catalog + saved toggles).
//! Pane title sanitize similarly deferred — load/save roundtrip preserves JSON fields.

use crate::env::user_data_dir;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use thiserror::Error;

/// Auth provider label (`google` | `local`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuthProvider {
    Google,
    Local,
}

/// Signed-in user (optional in snapshot).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UserSession {
    pub email: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub picture: Option<String>,
    pub provider: AuthProvider,
    pub signed_in_at: i64,
}

/// Google OAuth client config stored in snapshot.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct GoogleOAuthConfig {
    #[serde(default)]
    pub client_id: String,
    #[serde(default)]
    pub client_secret: String,
}

/// One model row under a provider.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ModelChoice {
    pub id: String,
    pub name: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

/// Provider / engine row (kept lean; merge-with-ENGINE_SPECS is Electron-only for now).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub vendor: String,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub color: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub logo: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mark: Option<String>,
    #[serde(default)]
    pub installed: bool,
    #[serde(default)]
    pub detected_auth: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub matched_email: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved_path: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub models: Vec<ModelChoice>,
    #[serde(default)]
    pub hint: String,
}

/// One terminal pane inside a workspace.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PaneState {
    pub id: String,
    #[serde(default)]
    pub engine: Option<String>,
    #[serde(default)]
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title_locked: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_handle: Option<String>,
}

/// Workspace grid snapshot.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub title: String,
    pub cwd: String,
    /// Layout id: 1 | 2 | 3 | 4 | 6 | 9 (TS `LayoutId`).
    pub layout: u8,
    #[serde(default)]
    pub panes: Vec<PaneState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub zoomed_pane_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Full app state file (`pq-state.json`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    #[serde(default)]
    pub user: Option<UserSession>,
    #[serde(default)]
    pub google: GoogleOAuthConfig,
    #[serde(default)]
    pub workspaces: Vec<Workspace>,
    #[serde(default)]
    pub active_workspace_id: Option<String>,
    #[serde(default)]
    pub providers: Vec<ProviderInfo>,
    #[serde(default = "default_true")]
    pub sidebar_open: bool,
}

impl Default for AppSnapshot {
    fn default() -> Self {
        empty_snapshot()
    }
}

/// Empty snapshot matching Electron `empty()` — providers from ENGINE_SPECS defaults.
pub fn empty_snapshot() -> AppSnapshot {
    AppSnapshot {
        user: None,
        google: GoogleOAuthConfig::default(),
        workspaces: Vec::new(),
        active_workspace_id: None,
        providers: crate::engines::merge_providers(None),
        sidebar_open: true,
    }
}

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("io: {0}")]
    Io(#[from] io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
}

/// `{user_data}/pq-state.json` for the current product profile.
pub fn state_path() -> PathBuf {
    user_data_dir().join("pq-state.json")
}

/// Explicit path helper (tests / alternate roots).
pub fn state_path_in(user_data: impl AsRef<Path>) -> PathBuf {
    user_data.as_ref().join("pq-state.json")
}

/// Whether this profile already has a state file.
pub fn exists_state() -> bool {
    exists_state_at(&state_path())
}

pub fn exists_state_at(path: impl AsRef<Path>) -> bool {
    path.as_ref().is_file()
}

/// Load snapshot from disk; on any error returns [`empty_snapshot`] (Electron catch behaviour).
pub fn load_state() -> AppSnapshot {
    load_state_from(state_path()).unwrap_or_else(|_| empty_snapshot())
}

/// Load from an explicit path. Missing/invalid → error.
pub fn load_state_from(path: impl AsRef<Path>) -> Result<AppSnapshot, StoreError> {
    let raw = fs::read_to_string(path)?;
    let mut snap: AppSnapshot = serde_json::from_str(&raw)?;
    snap.providers = crate::engines::merge_providers(Some(&snap.providers));
    Ok(snap)
}

/// Persist snapshot to the current product `pq-state.json` (pretty JSON).
pub fn save_state(state: &AppSnapshot) -> Result<(), StoreError> {
    save_state_to(state_path(), state)
}

/// Persist to an explicit path (creates parent dirs).
pub fn save_state_to(path: impl AsRef<Path>, state: &AppSnapshot) -> Result<(), StoreError> {
    let path = path.as_ref();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let body = serde_json::to_string_pretty(state)?;
    fs::write(path, body)?;
    Ok(())
}

/// Bump `updated_at` to now (ms), matching Electron `touchWorkspace`.
pub fn touch_workspace(ws: &mut Workspace) {
    ws.updated_at = now_ms();
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = env_temp().join(format!("pq-store-test-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn env_temp() -> PathBuf {
        std::env::var_os("TEMP")
            .or_else(|| std::env::var_os("TMP"))
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
    }

    #[test]
    fn empty_snapshot_defaults() {
        let s = empty_snapshot();
        assert!(s.user.is_none());
        assert!(s.workspaces.is_empty());
        assert_eq!(s.providers.len(), crate::engines::ENGINE_SPECS.len());
        assert!(s.sidebar_open);
        assert_eq!(s.google.client_id, "");
    }

    #[test]
    fn roundtrip_tempfile() {
        let dir = temp_dir();
        let path = state_path_in(&dir);
        let mut snap = empty_snapshot();
        snap.sidebar_open = false;
        snap.active_workspace_id = Some("ws1".into());
        snap.google.client_id = "cid".into();
        snap.workspaces.push(Workspace {
            id: "ws1".into(),
            title: "Demo".into(),
            cwd: r"C:\proj".into(),
            layout: 2,
            panes: vec![PaneState {
                id: "p1".into(),
                engine: Some("grok".into()),
                title: "Grok".into(),
                title_locked: Some(true),
                model: None,
                session_handle: None,
            }],
            zoomed_pane_id: None,
            created_at: 1,
            updated_at: 2,
        });
        if let Some(g) = snap.providers.iter_mut().find(|p| p.id == "grok") {
            g.installed = true;
        }
        snap.user = Some(UserSession {
            email: "a@b.c".into(),
            name: "A".into(),
            picture: None,
            provider: AuthProvider::Local,
            signed_in_at: 99,
        });

        save_state_to(&path, &snap).unwrap();
        assert!(exists_state_at(&path));
        let back = load_state_from(&path).unwrap();
        // load merges providers against ENGINE_SPECS (Electron twin)
        snap.providers = crate::engines::merge_providers(Some(&snap.providers));
        assert_eq!(back, snap);
        assert!(back.providers.iter().any(|p| p.id == "grok" && p.installed));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_missing_via_public_api_shape() {
        // empty_snapshot is the fallback contract; explicit path errors on missing.
        let dir = temp_dir();
        let path = state_path_in(&dir.join("nope"));
        assert!(load_state_from(&path).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn camel_case_wire_compat() {
        // Electron writes camelCase keys — ensure we accept them.
        let json = r#"{
          "user": null,
          "google": { "clientId": "x", "clientSecret": "y" },
          "workspaces": [],
          "activeWorkspaceId": null,
          "providers": [],
          "sidebarOpen": true
        }"#;
        let snap: AppSnapshot = serde_json::from_str(json).unwrap();
        assert_eq!(snap.google.client_id, "x");
        assert_eq!(snap.google.client_secret, "y");
        assert!(snap.sidebar_open);
    }
}