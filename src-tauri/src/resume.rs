use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::Stdio;

use tokio::process::Command;

use crate::env::home_dir;
use crate::resolve::resolve_launch;
use crate::shared::{EngineId, Workspace};

pub struct SessionRef {
    pub handle: String,
    pub title: String,
    pub updated_at: i64,
}

pub fn resume_flag(engine: EngineId, handle: &str) -> Option<Vec<String>> {
    match engine {
        EngineId::Opencode => Some(vec!["--session".into(), handle.to_string()]),
        EngineId::Omp => Some(vec!["--resume".into(), handle.to_string()]),
        _ => None,
    }
}

fn norm(p: &str) -> String {
    p.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

struct Slot {
    ref_: SessionRef,
    claimed: bool,
}

fn resume_cache() -> &'static std::sync::Mutex<HashMap<String, Vec<Slot>>> {
    use once_cell::sync::Lazy;
    static C: Lazy<std::sync::Mutex<HashMap<String, Vec<Slot>>>> = Lazy::new(Default::default);
    &C
}

fn key_of(workspace_id: &str, engine: EngineId) -> String {
    format!("{workspace_id}\u{0}{}", engine.as_str())
}

async fn opencode_sessions(cwd: &str, target: &str) -> Vec<SessionRef> {
    let extra = vec![
        "db".into(),
        "select id, directory, title, time_updated from session".into(),
        "--format".into(),
        "json".into(),
    ];
    let lt = resolve_launch(EngineId::Opencode, target, &extra.clone());
    let mut cmd = Command::new(&lt.spawn_file);
    cmd.args(&lt.args)
        .creation_flags(0x08000000)
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let out = tokio::time::timeout(std::time::Duration::from_secs(20), cmd.output()).await;
    let Ok(Ok(output)) = out else {
        return Vec::new();
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    let rows: Vec<serde_json::Value> =
        serde_json::from_str(stdout.trim()).unwrap_or_default();
    let mut refs: Vec<SessionRef> = rows
        .into_iter()
        .filter_map(|r| {
            let id = r.get("id").and_then(|v| v.as_str())?.to_string();
            let directory = r.get("directory").and_then(|v| v.as_str())?.to_string();
            if norm(&directory) != norm(cwd) {
                return None;
            }
            Some(SessionRef {
                handle: id,
                title: r.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                updated_at: r.get("time_updated").and_then(|v| v.as_i64()).unwrap_or(0),
            })
        })
        .collect();
    refs.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    refs
}

fn omp_id_from_file(name: &str) -> Option<String> {
    let stripped = name.trim_end_matches(".jsonl");
    let idx = stripped.rfind('_')?;
    Some(stripped[idx + 1..].to_string())
}

fn read_session_line(file: std::path::PathBuf) -> String {
    use std::io::Read;
    let mut f = match fs::File::open(&file) {
        Ok(f) => f,
        Err(_) => return String::new(),
    };
    let mut buf = [0u8; 64 * 1024];
    let n = f.read(&mut buf).unwrap_or(0);
    let text = String::from_utf8_lossy(&buf[..n]).to_string();
    let first = text.find('\n').unwrap_or(usize::MAX);
    if first == usize::MAX {
        return text;
    }
    let start = first + 1;
    match text[start..].find('\n') {
        Some(second) => text[start..start + second].to_string(),
        None => text[start..].to_string(),
    }
}

fn omp_sessions(cwd: &str) -> Vec<SessionRef> {
    let root = home_dir().join(".omp").join("agent").join("sessions");
    if !root.is_dir() {
        return Vec::new();
    }
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let Ok(projects) = fs::read_dir(&root) else {
        return Vec::new();
    };
    for proj in projects.flatten() {
        let dir = proj.path();
        if !dir.is_dir() {
            continue;
        }
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let full = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.ends_with(".jsonl") {
                continue;
            }
            let Some(id) = omp_id_from_file(&name) else { continue };
            if !seen.insert(id.clone()) {
                continue;
            }
            let head = read_session_line(full.clone());
            let parsed = serde_json::from_str::<serde_json::Value>(&head);
            let Ok(parsed) = parsed else { continue };
            let t = parsed.get("type").and_then(|v| v.as_str()).unwrap_or("");
            let p_cwd = parsed.get("cwd").and_then(|v| v.as_str()).unwrap_or("");
            if t != "session" || p_cwd.is_empty() || norm(p_cwd) != norm(cwd) {
                continue;
            }
            let mtime = fs::metadata(&full)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64);
            out.push(SessionRef {
                handle: id,
                title: name,
                updated_at: mtime.unwrap_or(0),
            });
        }
    }
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    out
}

async fn list_sessions(engine: EngineId, cwd: &str, target: &str) -> Vec<SessionRef> {
    match engine {
        EngineId::Opencode => opencode_sessions(cwd, target).await,
        EngineId::Omp => omp_sessions(cwd),
        _ => Vec::new(),
    }
}

/// scan engine session storage once per (workspace, engine) at boot
pub async fn prime_resume(workspaces: &[Workspace], providers: &[crate::shared::ProviderInfo]) {
    {
        let mut cx = resume_cache().lock().unwrap();
        cx.clear();
    }
    let mut jobs = Vec::new();
    for ws in workspaces {
        let mut engines: Vec<EngineId> = Vec::new();
        for p in &ws.panes {
            if let Some(e) = p.engine {
                if !engines.contains(&e) {
                    engines.push(e);
                }
            }
        }
        for engine in engines {
            let target = providers
                .iter()
                .find(|x| x.id == engine)
                .and_then(|x| x.resolved_path.clone())
                .unwrap_or_else(|| engine.as_str().to_string());
            let ws_id = ws.id.clone();
            let cwd = ws.cwd.clone();
            jobs.push(async move {
                let list = list_sessions(engine, &cwd, &target).await;
                let mut cx = resume_cache().lock().unwrap();
                cx.insert(
                    key_of(&ws_id, engine),
                    list.into_iter().map(|ref_| Slot { ref_, claimed: false }).collect(),
                );
            });
        }
    }
    futures_util::future::join_all(jobs).await;
}

/// pick which stored conversation a pane should resume
pub fn pick_resume(
    workspace_id: &str,
    engine: EngineId,
    session_handle: Option<&str>,
) -> Option<SessionRef> {
    let mut cx = resume_cache().lock().unwrap();
    let slots = cx.get_mut(&key_of(workspace_id, engine))?;
    if let Some(handle) = session_handle {
        if let Some(prev) = slots.iter_mut().find(|s| s.ref_.handle == handle) {
            if !prev.claimed {
                prev.claimed = true;
                return Some(SessionRef {
                    handle: prev.ref_.handle.clone(),
                    title: prev.ref_.title.clone(),
                    updated_at: prev.ref_.updated_at,
                });
            }
        }
    }
    for s in slots.iter_mut() {
        if !s.claimed {
            s.claimed = true;
            return Some(SessionRef {
                handle: s.ref_.handle.clone(),
                title: s.ref_.title.clone(),
                updated_at: s.ref_.updated_at,
            });
        }
    }
    None
}