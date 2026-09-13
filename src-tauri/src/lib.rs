#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod auth;
mod board;
mod bridge;
mod cmd;
mod engines;
mod env;
mod providers;
mod pty;
mod remote;
mod resolve;
mod resume;
mod shared;
mod store;
mod sync;
mod trust;
mod update;
mod usage;

use cmd::Pq;
use tauri::{AppHandle, Emitter, Manager};

#[tauri::command]
fn ping() -> bool {
    true
}

fn boot(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let snapshot = store::load_state();
        let email = snapshot.user.as_ref().map(|u| u.email.clone());

        let providers = providers::scan_providers(email.as_deref(), &snapshot.providers);
        {
            let state = app.state::<Pq>();
            let mut g = state.state.lock().unwrap();
            g.providers = providers.clone();
            store::save_state(&g.clone());
        }

        let ws: Vec<crate::shared::Workspace> = {
            let state = app.state::<Pq>();
            let all = state.state.lock().unwrap().workspaces.clone();
            all
        };
        resume::prime_resume(&ws, &providers).await;

        let _ = app.emit(
            "providers:changed",
            serde_json::to_string(&providers).unwrap_or_default(),
        );
        let _ = app.emit("boot:done", true);
    });

    // check GitHub for a new release shortly after launch
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        update::check_on_boot(app.clone()).await;
    });
}

/// main entry; binary just calls this
pub fn run() {
    let initial = store::load_state();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            ping,
            cmd::app_version,
            cmd::app_info,
            cmd::window_minimize,
            cmd::window_maximize_toggle,
            cmd::window_is_maximized,
            cmd::window_close,
            cmd::window_set_title,
            cmd::state_load,
            cmd::state_save,
            cmd::state_exists,
            cmd::providers_scan,
            cmd::providers_get,
            cmd::providers_activate,
            cmd::providers_auth_config,
            cmd::providers_set_auth_config,
            cmd::providers_list_accounts,
            cmd::providers_authorize,
            cmd::pty_spawn,
            cmd::pty_write,
            cmd::pty_resize,
            cmd::pty_kill,
            cmd::pty_kill_all,
            cmd::pty_maxbuf,
            cmd::workspace_spawn,
            cmd::workspace_resume,
            cmd::board_set_active,
            cmd::usage_update_panes,
            cmd::usage_reset,
            cmd::usage_tick,
            cmd::remote_info,
            cmd::remote_start,
            cmd::remote_tunnel_start,
            cmd::remote_tunnel_stop,
            cmd::remote_ensure_binary,
            cmd::remote_relay_emit,
            cmd::sync_register_session,
            cmd::sync_subscribe,
            cmd::sync_unsubscribe,
            cmd::sync_file_event,
            cmd::sync_route,
            cmd::sync_emit,
            cmd::bridge_run_voice_command,
            cmd::bridge_whisper,
            cmd::shell_open_external,
            cmd::shell_open_path,
            cmd::update_check,
            cmd::update_ignore,
            cmd::update_clear_ignored,
        ])
        .setup(move |app| {
            let app_handle = app.handle().clone();

            let remote = remote::RemoteManager::new(app_handle.clone());
            let relay = remote.relay.clone();
            remote::reg::set(relay.clone());

            let usage = usage::UsageManager::new(app_handle.clone());
            let sync = sync::SyncManager::new(app_handle.clone());
            sync.register_ws(relay);

            let auth = auth::AuthManager::new(app_handle.clone(), initial.google.clone());
            let bridge = bridge::BridgeManager::new(app_handle.clone());
            let pty = pty::PtyManager::new(app_handle.clone());
            let board = board::BoardManager::new();

            app_handle.manage(Pq {
                pty,
                usage,
                sync,
                board,
                auth,
                bridge,
                remote,
                state: std::sync::Mutex::new(initial),
            });

            boot(app_handle.clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building pq tauri application");

    app.run(|_app, event| {
        if let tauri::RunEvent::ExitRequested { .. } = event {
            if let Some(st) = _app.try_state::<Pq>() {
                st.pty.kill_all();
            }
        }
    });
}