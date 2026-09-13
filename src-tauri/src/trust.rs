use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use crate::env::home_dir;
use crate::shared::millis;

fn now_sec() -> i64 {
    millis() / 1000
}

fn unique(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for p in paths {
        let n = p.canonicalize().unwrap_or(p);
        let k = n.to_string_lossy().to_lowercase();
        if seen.insert(k) {
            out.push(n);
        }
    }
    out
}

fn git_root(cwd: &str) -> Option<PathBuf> {
    let out = Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .current_dir(cwd)
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(PathBuf::from(s))
    }
}

fn slash(p: &str) -> String {
    p.replace('\\', "/")
}

fn read_text(file: &Path) -> String {
    fs::read_to_string(file).unwrap_or_default()
}

fn read_json(file: &Path) -> serde_json::Value {
    match fs::read_to_string(file) {
        Ok(s) => serde_json::from_str::<serde_json::Value>(&s).unwrap_or(serde_json::Value::Null),
        Err(_) => serde_json::Value::Null,
    }
}

fn write_json(file: &Path, data: &serde_json::Value) {
    if let Some(parent) = file.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(file, serde_json::to_string_pretty(data).unwrap_or_default());
}

fn trust_grok(dir: &str) {
    let file = home_dir().join(".grok").join("trusted_folders.toml");
    let cur = read_text(&file);
    for key in [
        format!("folders.'{dir}'"),
        format!("folders.\"{}\"", dir.replace('\\', "\\\\")),
    ] {
        if cur.contains(&key) {
            return;
        }
    }
    if let Some(parent) = file.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let block = format!("\n[folders.'{dir}']\ntrusted = true\ndecided_at = {}\n", now_sec());
    let _ = fs::write(&file, format!("{}", format!("{}{}", cur.trim_end(), block)));
}

fn trust_claude(dir: &str) {
    let file = home_dir().join(".claude.json");
    let mut json = read_json(&file);
    let mut projects = json
        .get("projects")
        .cloned()
        .filter(|v| v.is_object())
        .unwrap_or_else(|| serde_json::json!({}));
    let key = slash(dir);
    let prev = projects.get(&key).cloned().unwrap_or_else(|| serde_json::json!({}));
    if prev.get("hasTrustDialogAccepted").and_then(|v| v.as_bool()) == Some(true) {
        return;
    }
    let mut merged = prev;
    merged["hasTrustDialogAccepted"] = serde_json::json!(true);
    merged["hasClaudeMdExternalIncludesApproved"] = serde_json::json!(true);
    projects[key] = merged;
    json["projects"] = projects;
    write_json(&file, &json);
}

fn trust_gemini(dir: &str) {
    let file = home_dir().join(".gemini").join("trustedFolders.json");
    let mut json = read_json(&file);
    let key = slash(dir).to_lowercase();
    if json.get(&key).and_then(|v| v.as_str()) == Some("TRUST_FOLDER") {
        return;
    }
    json[key] = serde_json::json!("TRUST_FOLDER");
    write_json(&file, &json);
}

fn trust_codex(dir: &str) {
    let file = home_dir().join(".codex").join("config.toml");
    let cur = read_text(&file);
    let key = dir.to_lowercase();
    let header = format!("[projects.'{key}']");
    if cur.to_lowercase().contains(&header.to_lowercase()) {
        if cur.to_lowercase().contains("trust_level") && cur.to_lowercase().contains("trusted") {
            return;
        }
    }
    if let Some(parent) = file.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let block = format!("\n[projects.'{key}']\ntrust_level = \"trusted\"\n");
    let base = if cur.trim_end().is_empty() { String::new() } else { format!("{}\n", cur.trim_end()) };
    let _ = fs::write(&file, format!("{base}{block}"));
}

/// Persist "trust this folder" so CLIs skip the first-run trust dialog.
pub fn trust_workspace(cwd: &str) {
    if cwd.is_empty() {
        return;
    }
    let mut dirs = vec![PathBuf::from(cwd)];
    if let Some(root) = git_root(cwd) {
        dirs.push(root);
    }
    for dir in unique(dirs) {
        let d = dir.to_string_lossy().to_string();
        let _ = std::panic::catch_unwind(|| {
            trust_grok(&d);
            trust_claude(&d);
            trust_gemini(&d);
            trust_codex(&d);
        });
    }
}