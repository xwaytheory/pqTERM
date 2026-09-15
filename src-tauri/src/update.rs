use std::cmp::Ordering;
use std::fs;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::env::app_data_dir;
use crate::shared::millis;

const REPO_OWNER: &str = "xwaytheory";
const REPO_NAME: &str = "pq";
const API: &str = "https://api.github.com/repos/xwaytheory/pq/releases/latest";
const UA: &str = "pq-updater/1.0";

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    pub latest: String,
    pub available: bool,
    pub installer_url: Option<String>,
    pub changelog: Option<String>,
    pub checked_at: i64,
    pub ignored: bool,
}

fn ignore_file() -> PathBuf {
    app_data_dir().join("pq-update-ignore.json")
}

fn read_ignored() -> Vec<String> {
    match fs::read_to_string(ignore_file()) {
        Ok(s) => serde_json::from_str::<Vec<String>>(&s).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

fn write_ignored(v: Vec<String>) {
    if let Some(parent) = ignore_file().parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(ignore_file(), serde_json::to_string_pretty(&v).unwrap_or_default());
}

pub fn is_ignored(version: &str) -> bool {
    read_ignored().iter().any(|v| v == version)
}

pub fn ignore_version(version: &str) {
    let mut v = read_ignored();
    if !v.contains(&version.to_string()) {
        v.push(version.to_string());
        write_ignored(v);
    }
}

pub fn clear_ignored() {
    write_ignored(Vec::new());
}

/// trims a version string down to its dotted numeric part (drops `v` prefix and `-suffix`)
fn norm_version(s: &str) -> &str {
    let s = s.trim();
    let s = s
        .strip_prefix('v')
        .or_else(|| s.strip_prefix('V'))
        .unwrap_or(s);
    s.split(['-', '+']).next().unwrap_or(s)
}

/// numeric dotted comparison, handles optional leading "v" and "-suffix"
pub fn compare_versions(a: &str, b: &str) -> Ordering {
    let a = norm_version(a);
    let b = norm_version(b);
    let av: Vec<u64> = a
        .split('.')
        .map(|x| x.parse::<u64>().unwrap_or(0))
        .collect();
    let bv: Vec<u64> = b
        .split('.')
        .map(|x| x.parse::<u64>().unwrap_or(0))
        .collect();
    let len = av.len().max(bv.len());
    for i in 0..len {
        let x = av.get(i).copied().unwrap_or(0);
        let y = bv.get(i).copied().unwrap_or(0);
        match x.cmp(&y) {
            Ordering::Equal => continue,
            o => return o,
        }
    }
    Ordering::Equal
}

#[derive(Deserialize, Debug)]
struct AssetJson {
    name: String,
    browser_download_url: String,
}

#[derive(Deserialize, Debug)]
struct ReleaseJson {
    tag_name: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    body: Option<String>,
    assets: Vec<AssetJson>,
}

fn pick_installer(assets: &[AssetJson]) -> Option<String> {
    assets
        .iter()
        .filter(|a| a.name.to_lowercase().ends_with(".exe"))
        .filter(|a| !a.name.to_lowercase().contains("symbols"))
        .find(|a| {
            let n = a.name.to_lowercase();
            n.contains("setup") || n.contains("installer") || n.contains("64")
        })
        .map(|a| a.browser_download_url.clone())
        .or_else(|| {
            assets
                .iter()
                .filter(|a| a.name.to_lowercase().ends_with(".exe"))
                .next()
                .map(|a| a.browser_download_url.clone())
        })
}

pub async fn check_latest() -> Result<UpdateInfo, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();

    let res = reqwest::Client::builder()
        .user_agent(UA)
        .build()
        .map_err(|e| e.to_string())?
        .get(API)
        .send()
        .await
        .map_err(|e| format!("brak sieci (nie można dojść do GitHub): {e}"))?;

    if !res.status().is_success() {
        return Ok(UpdateInfo {
            current: current.clone(),
            latest: current.clone(),
            available: false,
            installer_url: None,
            changelog: None,
            checked_at: millis(),
            ignored: false,
        });
    }

    let release: ReleaseJson = res.json().await.map_err(|e| e.to_string())?;
    let latest = release.tag_name.trim().to_string();
    let newer = compare_versions(&latest, &current) == Ordering::Greater;
    let installer_url = pick_installer(&release.assets);
    let ignored = is_ignored(&latest);

    Ok(UpdateInfo {
        current,
        latest,
        available: newer && installer_url.is_some(),
        installer_url,
        changelog: release.body,
        checked_at: millis(),
        ignored,
    })
}

pub async fn download_installer(url: &str, version: &str) -> Result<PathBuf, String> {
    let dest = std::env::temp_dir().join(format!("pq-setup-{}.exe", version));
    let bytes = reqwest::Client::builder()
        .user_agent(UA)
        .build()
        .map_err(|e| e.to_string())?
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
    Ok(dest)
}

/// spawn silent NSIS update, then quit the app
pub fn spawn_updater(installer: &PathBuf) -> Result<(), String> {
    let mut cmd = std::process::Command::new(installer);
    cmd.arg("/S")
        .arg("/currentuser")
        .creation_flags(0x08000000); // CREATE_NO_WINDOW — win hides installer UI on silent
    let _ = cmd.spawn().map_err(|e| e.to_string())?;
    Ok(())
}

/// on boot: check GitHub, notify renderer, ask the user (native dialog)
pub async fn check_on_boot(app: AppHandle) {
    if crate::env::running_dev() && std::env::var("PQ_UPDATE_ALLOW_DEV").ok().as_deref() != Some("1") {
        return;
    }

    let info = match check_latest().await {
        Ok(i) => i,
        Err(_) => return,
    };

    // always mirror status to renderer (badge in settings etc.)
    let _ = app.emit("update:status", serde_json::to_string(&info).unwrap_or_default());

    if !info.available || info.ignored {
        return;
    }
    if info.latest == info.current {
        return;
    }

    let latest = info.latest.clone();
    let url = info.installer_url.clone().unwrap_or_default();
    let summary = short_changelog(info.changelog.as_deref());

    let reply = {
        let dialog = app
            .dialog()
            .message(format!(
                "Dostępna nowa wersja aplikacji pq.\n\nObecna: {}\nNowa:\t{latest}\n\n{summary}\n\nZainstalować teraz?",
                info.current
            ))
            .title("pq — aktualizacja")
            .kind(MessageDialogKind::Info)
            .buttons(MessageDialogButtons::YesNoCancel);
        // `blocking_show()` only returns bool; Yes/No/Cancel needs the *result* variant
        tauri::async_runtime::spawn_blocking(move || dialog.blocking_show_with_result())
            .await
            .unwrap_or(tauri_plugin_dialog::MessageDialogResult::No)
    };

    match reply {
        tauri_plugin_dialog::MessageDialogResult::Yes => {
            let app2 = app.clone();
            let _ = app.emit("update:status", "installing");
            tauri::async_runtime::spawn(async move {
                // give the dialog a moment to close before exiting below
                tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                match download_installer(&url, &latest).await {
                    Ok(path) => match spawn_updater(&path) {
                        Ok(()) => {
                            let _ = app2.emit("update:done", latest);
                            // NSIS will replace the running exe; quit first
                            std::thread::sleep(std::time::Duration::from_millis(500));
                            app2.exit(0);
                        }
                        Err(e) => {
                            let _ = app2.emit("update:error", e);
                        }
                    },
                    Err(e) => {
                        let _ = app2.emit("update:error", e);
                    }
                }
            });
        }
        tauri_plugin_dialog::MessageDialogResult::Cancel => {
            ignore_version(&latest);
        }
        _ => {}
    }
}

fn short_changelog(body: Option<&str>) -> String {
    match body {
        Some(b) if !b.trim().is_empty() => {
            let lines: Vec<&str> = b.lines().take(6).collect();
            lines.join("\n")
        }
        _ => String::new(),
    }
}

pub fn version_now() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}