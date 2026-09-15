use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::auth::{AuthManager, GoogleAuthParams};
use crate::board::BoardManager;
use crate::bridge::{BridgeManager, VoiceCommandResult, WhisperJob};
use crate::engines::spec_by_id;
use crate::pty::{PtyManager, PtySize2d};
use crate::remote::{RemoteInfo, RemoteManager};
use crate::resolve::resolve_launch;
use crate::resume::{pick_resume, resume_flag};
use crate::shared::{AppSnapshot, EngineId, ProviderInfo, millis};
use crate::store;
use crate::sync::{SyncManager, SyncEvent};
use crate::trust::trust_workspace;
use crate::usage::{UsageManager, UsageDelta};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

pub struct Pq {
    pub pty: PtyManager,
    pub usage: UsageManager,
    pub sync: SyncManager,
    pub board: BoardManager,
    pub auth: AuthManager,
    pub bridge: BridgeManager,
    pub remote: RemoteManager,
    pub state: std::sync::Mutex<AppSnapshot>,
}

// ---------------------------------------------------------------- window/app

#[tauri::command]
pub fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub mode: String,
    pub platform: String,
    pub arch: String,
    pub running_dev: bool,
}

#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        mode: if crate::env::running_dev() { "dev" } else { "prod" }.to_string(),
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        running_dev: crate::env::running_dev(),
    }
}

#[tauri::command]
pub fn window_minimize(app: AppHandle) {
    let _ = app.get_webview_window("main").map(|w| w.minimize());
}

#[tauri::command]
pub fn window_maximize_toggle(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_maximized().unwrap_or(false) {
            let _ = w.unmaximize();
        } else {
            let _ = w.maximize();
        }
    }
}

#[tauri::command]
pub fn window_is_maximized(app: AppHandle) -> bool {
    app.get_webview_window("main").and_then(|w| w.is_maximized().ok()).unwrap_or(false)
}

#[tauri::command]
pub fn window_close(app: AppHandle) {
    let _ = app.get_webview_window("main").map(|w| w.close());
}

#[tauri::command]
pub fn window_set_title(app: AppHandle, title: String) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_title(&title);
    }
}

// ---------------------------------------------------------------- state

#[tauri::command]
pub fn state_load(state: State<'_, Pq>) -> AppSnapshot {
    state.state.lock().unwrap().clone()
}

#[tauri::command]
pub fn state_save(state: State<'_, Pq>, snapshot: AppSnapshot) -> bool {
    let mut g = state.state.lock().unwrap();
    *g = snapshot.clone();
    store::save_state(&snapshot);
    true
}

#[tauri::command]
pub fn state_exists() -> bool {
    store::exists_state()
}

// ---------------------------------------------------------------- providers

#[tauri::command]
pub async fn providers_scan(
    app: AppHandle,
    state: State<'_, Pq>,
    email: Option<String>,
) -> Result<Vec<ProviderInfo>, String> {
    let snapshot = state.state.lock().unwrap().clone();
    let providers = crate::providers::scan_providers(email.as_deref(), &snapshot.providers);
    {
        let mut g = state.state.lock().unwrap();
        g.providers = providers.clone();
        store::save_state(&g.clone());
    }
    let _ = app.emit("providers:changed", serde_json::to_string(&providers).unwrap_or_default());
    Ok(providers)
}

#[tauri::command]
pub fn providers_get(state: State<'_, Pq>) -> Vec<ProviderInfo> {
    state.state.lock().unwrap().providers.clone()
}

#[tauri::command]
pub fn providers_activate(state: State<'_, Pq>, id: String, active: bool) -> Vec<ProviderInfo> {
    let mut g = state.state.lock().unwrap();
    if let Some(p) = g.providers.iter_mut().find(|p| p.id.as_str() == id) {
        p.enabled = active;
        store::save_state(&g.clone());
    }
    g.providers.clone()
}

#[tauri::command]
pub fn providers_auth_config(state: State<'_, Pq>) -> crate::shared::GoogleOAuthConfig {
    state.auth.get_config()
}

#[tauri::command]
pub fn providers_set_auth_config(
    state: State<'_, Pq>,
    config: crate::shared::GoogleOAuthConfig,
) -> bool {
    state.auth.set_config(config.clone());
    let mut g = state.state.lock().unwrap();
    g.google = config;
    store::save_state(&g.clone());
    true
}

#[tauri::command]
pub async fn providers_list_accounts(
    state: State<'_, Pq>,
    hint: Option<String>,
) -> Result<Vec<String>, String> {
    state.auth.list_accounts(hint.as_deref()).await
}

#[tauri::command]
pub async fn providers_authorize(
    state: State<'_, Pq>,
    provider_id: String,
    email: String,
) -> Result<serde_json::Value, String> {
    let cfg = state.auth.get_config();
    let params = GoogleAuthParams {
        provider_id,
        client_id: Some(cfg.client_id.clone()),
        scopes: vec![
            "openid".into(),
            "email".into(),
            "profile".into(),
            "https://www.googleapis.com/auth/userinfo.email".into(),
            "https://www.googleapis.com/auth/userinfo.profile".into(),
        ],
        hint: Some(email),
    };
    let result = state.auth.oauth_flow(&params).await?;
    let g = state.state.lock().unwrap();
    store::save_state(&g.clone());
    Ok(result)
}

// ---------------------------------------------------------------- pty

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PtySpawnPayload {
    pub pane_id: String,
    pub spawn_file: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
    pub cols_px: u32,
    pub rows_px: u32,
    pub env: std::collections::HashMap<String, String>,
}

#[tauri::command]
pub fn pty_spawn(state: State<'_, Pq>, payload: PtySpawnPayload) -> bool {
    let env = crate::resolve::sanitize_env(&payload.env);
    state.pty.spawn(
        &payload.pane_id,
        &payload.spawn_file,
        &payload.args,
        &payload.cwd,
        env,
        PtySize2d {
            cols: payload.cols,
            rows: payload.rows,
            cols_px: payload.cols_px as u16,
            rows_px: payload.rows_px as u16,
        },
    )
}

#[tauri::command]
pub fn pty_write(state: State<'_, Pq>, pane_id: String, data: String) -> bool {
    state.pty.write(&pane_id, &data)
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PtyResizePayload {
    pub pane_id: String,
    pub cols: u16,
    pub rows: u16,
    pub cols_px: u32,
    pub rows_px: u32,
}

#[tauri::command]
pub fn pty_resize(state: State<'_, Pq>, payload: PtyResizePayload) {
    state.pty.resize(
        &payload.pane_id,
        PtySize2d {
            cols: payload.cols,
            rows: payload.rows,
            cols_px: payload.cols_px as u16,
            rows_px: payload.rows_px as u16,
        },
    );
}

#[tauri::command]
pub fn pty_kill(state: State<'_, Pq>, pane_id: String) {
    state.sync.forget_session(&pane_id);
    state.pty.kill_pane(&pane_id);
}

#[tauri::command]
pub fn pty_kill_all(state: State<'_, Pq>) {
    state.pty.kill_all();
}

#[tauri::command]
pub fn pty_maxbuf(state: State<'_, Pq>, pane_id: String) -> Option<String> {
    state.pty.maxbuf(&pane_id)
}

// ---------------------------------------------------------------- workspace spawn

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSpawnPayload {
    pub workspace_id: String,
    pub pane_id: String,
    pub engine: EngineId,
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
    pub cols_px: u32,
    pub rows_px: u32,
    pub model: Option<String>,
    pub session_handle: Option<String>,
    pub env: Option<std::collections::HashMap<String, String>>,
}

#[tauri::command]
pub async fn workspace_spawn(app: AppHandle, state: State<'_, Pq>, payload: WorkspaceSpawnPayload) -> Result<bool, String> {
    let spec = spec_by_id(payload.engine);
    let target = state
        .state
        .lock()
        .unwrap()
        .providers
        .iter()
        .find(|p| p.id == payload.engine)
        .and_then(|p| p.resolved_path.clone())
        .unwrap_or_else(|| spec.binaries[0].clone());
    let _ = app;
    let pane_id = payload.pane_id.clone();

    let mut extra: Vec<String> = Vec::new();
    if let Some(m) = &payload.model {
        extra.extend(spec.model_flag_args(m));
    }
    if let Some(handle) = &payload.session_handle {
        if let Some(flags) = resume_flag(payload.engine, handle) {
            extra.extend(flags);
        }
    } else if let Some(r) = pick_resume(&payload.workspace_id, payload.engine, None) {
        if let Some(flags) = resume_flag(payload.engine, &r.handle) {
            extra.extend(flags);
        }
    }

    let lt = resolve_launch(payload.engine, &target, &extra);
    trust_workspace(&payload.cwd);

    let mut env = crate::resolve::yolo_env(payload.engine);
    if let Some(extra_env) = payload.env {
        env.extend(extra_env);
    }
    env = crate::resolve::sanitize_env(&env);

    let _sc = state.sync.register_session(&pane_id);
    let ok = state.pty.spawn(
        &pane_id,
        &lt.spawn_file,
        &lt.args,
        &payload.cwd,
        env,
        PtySize2d {
            cols: payload.cols,
            rows: payload.rows,
            cols_px: payload.cols_px as u16,
            rows_px: payload.rows_px as u16,
        },
    );
    if ok {
        let _ = state.remote.app.emit("board:changed", "spawned");
    }
    Ok(ok)
}

#[tauri::command]
pub async fn workspace_resume(
    _state: State<'_, Pq>,
    workspace_id: String,
    engine: EngineId,
    session_handle: String,
) -> Result<bool, String> {
    let r = pick_resume(&workspace_id, engine, Some(&session_handle));
    Ok(r.is_some())
}

// ---------------------------------------------------------------- board / usage

#[tauri::command]
pub fn board_set_active(state: State<'_, Pq>, workspace_id: String) {
    let mut g = state.state.lock().unwrap();
    g.active_workspace_id = Some(workspace_id);
    store::save_state(&g.clone());
}

#[tauri::command]
pub fn usage_update_panes(
    state: State<'_, Pq>,
    enabled: Vec<String>,
    mapped: Vec<(String, String)>,
) {
    state.usage.update_panes(enabled, mapped);
}

#[tauri::command]
pub fn usage_reset(state: State<'_, Pq>) {
    state.usage.reset_window();
}

#[tauri::command]
pub fn usage_tick(state: State<'_, Pq>, pane_id: String, cmd: String) -> Option<UsageDelta> {
    state.usage.add_usage(&pane_id, &cmd, millis())
}

// ---------------------------------------------------------------- remote

#[tauri::command]
pub fn remote_info(state: State<'_, Pq>) -> RemoteInfo {
    state.remote.info()
}

#[tauri::command]
pub async fn remote_start(app: AppHandle, state: State<'_, Pq>) -> Result<bool, String> {
    let mgr = state.remote.clone_for_conn();
    let _ = app.emit("remote:status", "starting");
    tauri::async_runtime::spawn(async move {
        let _ = mgr.listen().await;
    });
    tokio::time::sleep(std::time::Duration::from_millis(120)).await;
    *state.remote.running.lock().unwrap() = true;
    Ok(true)
}

#[tauri::command]
pub async fn remote_tunnel_start(
    _app: AppHandle,
    state: State<'_, Pq>,
    name: String,
) -> Result<String, String> {
    crate::remote::ensure_cloudflared().await?;
    crate::remote::spawn_tunnel(&state.remote.clone_for_conn(), &name).await
}

#[tauri::command]
pub fn remote_tunnel_stop(state: State<'_, Pq>) {
    crate::remote::stop_tunnel(&state.remote);
}

#[tauri::command]
pub async fn remote_ensure_binary() -> Result<String, String> {
    let p = crate::remote::ensure_cloudflared().await?;
    Ok(p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn remote_relay_emit(state: State<'_, Pq>, event: serde_json::Value) {
    match serde_json::from_value::<SyncEvent>(event) {
        Ok(ev) => {
            state.remote.relay.ev(ev);
        }
        Err(_) => {}
    }
}

// ---------------------------------------------------------------- sync

#[tauri::command]
pub fn sync_register_session(state: State<'_, Pq>, pane_id: String) -> String {
    state.sync.register_session(&pane_id).session_id
}

#[tauri::command]
pub fn sync_subscribe(state: State<'_, Pq>, channel: String, pane_id: String) {
    state.sync.subscribe(&channel, &pane_id);
}

#[tauri::command]
pub fn sync_unsubscribe(state: State<'_, Pq>, channel: String, pane_id: String) {
    state.sync.unsubscribe(&channel, &pane_id);
}

#[tauri::command]
pub fn sync_file_event(state: State<'_, Pq>, kind: String, file: String, content: Option<String>) {
    state.sync.file_event(&kind, &file, content.as_deref());
}

#[tauri::command]
pub fn sync_route(state: State<'_, Pq>, kind: String, payload: serde_json::Value) -> Option<String> {
    state.sync.route(&kind, payload, &state.usage)
}

#[tauri::command]
pub fn sync_emit(state: State<'_, Pq>, kind: String, payload: serde_json::Value) {
    state.sync.emit(SyncEvent { kind, payload });
}

// ---------------------------------------------------------------- bridge / voice

#[tauri::command]
pub fn bridge_run_voice_command(command: String) -> VoiceCommandResult {
    crate::bridge::run_voice_command(&command)
}

#[tauri::command]
pub async fn bridge_whisper(state: State<'_, Pq>, job: WhisperJob) -> Result<serde_json::Value, String> {
    state.bridge.run_whisper(job).await
}

// ---------------------------------------------------------------- shell

#[tauri::command]
pub fn shell_open_external(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn shell_open_path(path: String) -> Result<(), String> {
    let _ = std::process::Command::new("explorer.exe")
        .arg(&path)
        .creation_flags(0x08000000)
        .spawn();
    Ok(())
}

// ---------------------------------------------------------------- updates

#[tauri::command]
pub async fn update_check() -> Result<crate::update::UpdateInfo, String> {
    crate::update::check_latest().await
}

#[tauri::command]
pub fn update_ignore(version: String) -> bool {
    crate::update::ignore_version(&version);
    true
}

#[tauri::command]
pub fn update_clear_ignored() -> bool {
    crate::update::clear_ignored();
    true
}