use std::collections::HashSet;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use once_cell::sync::Lazy;
use regex::Regex;

use crate::engines::{default_provider, EngineSpec, ENGINE_SPECS};
use crate::env::home_dir;
use crate::resolve::known_launch;
use crate::shared::{EngineId, ProviderInfo};

fn expand(p: &str) -> String {
    let home = home_dir().to_string_lossy().to_string();
    let appdata =
        env::var("APPDATA").unwrap_or_else(|_| format!("{}\\AppData\\Roaming", home_dir().to_string_lossy()));
    let localappdata =
        env::var("LOCALAPPDATA").unwrap_or_else(|_| format!("{}\\AppData\\Local", home_dir().to_string_lossy()));
    p.replace("%USERPROFILE%", &home)
        .replace("%APPDATA%", &appdata)
        .replace("%LOCALAPPDATA%", &localappdata)
}

fn which(bin: &str, extra_dirs: &[String]) -> Option<String> {
    let path_env = env::var("PATH").or_else(|_| env::var("Path")).unwrap_or_default();
    let mut dirs: Vec<PathBuf> = extra_dirs
        .iter()
        .map(|d| PathBuf::from(expand(d)))
        .collect();
    for d in path_env.split(';') {
        if !d.is_empty() {
            dirs.push(PathBuf::from(d));
        }
    }
    let has_ext = Regex::new(r"\.(exe|cmd|bat)$").unwrap();
    let exts: Vec<&str> = if has_ext.is_match(bin) { vec![""] } else { vec![".exe", ".cmd", ".bat"] };
    for dir in dirs {
        for ext in &exts {
            let full = dir.join(format!("{bin}{ext}"));
            if full.is_meta_ok_file() {
                return Some(full.to_string_lossy().to_string());
            }
        }
    }
    None
}

trait MetaOk {
    fn is_meta_ok_file(&self) -> bool;
}
impl MetaOk for PathBuf {
    fn is_meta_ok_file(&self) -> bool {
        fs::metadata(self).map(|m| m.is_file()).unwrap_or(false)
    }
}

fn read_text(file: &Path) -> String {
    fs::read_to_string(file).unwrap_or_default()
}

fn read_json(file: &Path) -> Option<serde_json::Value> {
    let s = fs::read_to_string(file).ok()?;
    serde_json::from_str(&s).ok()
}

static EMAIL_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}").unwrap());

static AUTH_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)refresh_token|auth_mode|oidc|access_token|credential_pool|chatgpt|apiKey|api_key|auth:")
        .unwrap()
});

fn emails_in(text: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for cap in EMAIL_RE.captures_iter(text) {
        let e = cap[0].to_lowercase();
        if seen.insert(e.clone()) {
            out.push(e);
        }
    }
    out
}

fn walk_files(root: &str, max: usize) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![PathBuf::from(root)];
    let mut visited = HashSet::new();
    while let Some(dir) = stack.pop() {
        if out.len() >= max || !dir.is_dir() || !visited.insert(dir.clone()) {
            continue;
        }
        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let full = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if ["node_modules", ".git", "Cache", "logs"].contains(&name.as_str()) {
                continue;
            }
            match entry.file_type() {
                Ok(t) if t.is_dir() => stack.push(full),
                _ => {
                    let ext_ok = Regex::new(r"\.(json|jsonl|yml|yaml|toml|cfg|ini|txt)$").unwrap().is_match(&name)
                        || name.starts_with('.');
                    if out.len() < max && ext_ok {
                        out.push(full);
                    }
                }
            }
        }
    }
    out
}

#[derive(Default)]
struct Probe {
    files: Vec<PathBuf>,
    emails: Vec<String>,
    authed: bool,
}

fn probe_grok() -> Probe {
    let home = home_dir().join(".grok");
    let mut emails = Vec::new();
    let mut authed = false;
    let mut files = Vec::new();
    for f in [
        home.join("auth.json"),
        home.join("config.toml"),
        home.join("models_cache.json"),
    ] {
        if f.exists() {
            let t = read_text(&f);
            emails.extend(emails_in(&t));
            if f.file_name().map(|n| n == "auth.json").unwrap_or(false) {
                authed = AUTH_RE.is_match(&t);
            }
            files.push(f);
        }
    }
    Probe { files, emails, authed }
}

fn probe_claude() -> Probe {
    let home = home_dir();
    let mut files: Vec<PathBuf> = [
        home.join(".claude.json"),
        home.join(".claude").join("settings.json"),
        home.join(".config").join("claude").join("config.json"),
        home.join("AppData").join("Roaming").join("claude").join("config.json"),
    ]
    .into_iter()
    .filter(|f| f.exists())
    .collect();
    let dir = home.join(".claude");
    if dir.is_dir() {
        files.extend(walk_files(&dir.to_string_lossy(), 25));
    }
    let mut seen = HashSet::new();
    files.retain(|f| seen.insert(f.clone()));
    let mut emails = Vec::new();
    let mut authed = false;
    for f in &files {
        let t = read_text(f).to_lowercase();
        emails.extend(emails_in(&t));
        if t.contains("oauth") || t.contains("token") || t.contains("session") || t.contains('@') {
            authed = true;
        }
    }
    Probe { files, emails, authed }
}

fn probe_opencode() -> Probe {
    let home = home_dir();
    let files: Vec<PathBuf> = [
        home.join(".local").join("share").join("opencode").join("auth.json"),
        home.join(".config").join("opencode").join("opencode.jsonc"),
        home.join(".config").join("opencode").join("cli.json"),
        home.join(".local").join("state").join("opencode").join("model.json"),
    ]
    .into_iter()
    .filter(|f| f.exists())
    .collect();
    let mut emails = Vec::new();
    for f in &files {
        emails.extend(emails_in(&read_text(f)));
    }
    let auth_file = home.join(".local").join("share").join("opencode").join("auth.json");
    let authed = auth_file.exists() || !files.is_empty();
    Probe { files, emails, authed }
}

fn probe_hermes() -> Probe {
    let local = home_dir().join("AppData").join("Local").join("hermes");
    let mut files: Vec<PathBuf> = [
        local.join("auth.json"),
        local.join("auth").join("google_oauth.json"),
        local.join("config.yaml"),
    ]
    .into_iter()
    .filter(|f| f.exists())
    .collect();
    if local.join("auth").is_dir() {
        files.extend(walk_files(&local.join("auth").to_string_lossy(), 10));
    }
    let mut emails = Vec::new();
    for f in &files {
        emails.extend(emails_in(&read_text(f)));
    }
    let auth = if local.join("auth.json").exists() { read_text(&local.join("auth.json")) } else { String::new() };
    let authed = AUTH_RE.is_match(&auth) || !emails.is_empty();
    Probe { files, emails, authed }
}

fn probe_codex() -> Probe {
    let home = home_dir().join(".codex");
    let files: Vec<PathBuf> = [home.join("auth.json"), home.join("config.toml"), home.join("models_cache.json")]
        .into_iter()
        .filter(|f| f.exists())
        .collect();
    let mut emails = Vec::new();
    for f in &files {
        emails.extend(emails_in(&read_text(f)));
    }
    let auth = if home.join("auth.json").exists() { read_text(&home.join("auth.json")) } else { String::new() };
    let authed = AUTH_RE.is_match(&auth);
    Probe { files, emails, authed }
}

fn probe_omp() -> Probe {
    let root = home_dir().join(".omp").join("agent");
    let files: Vec<PathBuf> = [
        root.join("config.yml"),
        root.join("models.yml"),
        root.join("agent.db"),
        root.join("models.db"),
    ]
    .into_iter()
    .filter(|f| f.exists())
    .collect();
    let mut emails = Vec::new();
    for f in files.iter().filter(|f| !f.to_string_lossy().ends_with(".db")) {
        emails.extend(emails_in(&read_text(f)));
    }
    let models_yml = if root.join("models.yml").exists() { read_text(&root.join("models.yml")) } else { String::new() };
    let authed = root.join("agent.db").exists() || AUTH_RE.is_match(&models_yml) || !emails.is_empty();
    Probe { files, emails, authed }
}

fn probe_for(spec: &EngineSpec) -> Probe {
    match spec.id {
        EngineId::Grok => probe_grok(),
        EngineId::Claude => probe_claude(),
        EngineId::Opencode => probe_opencode(),
        EngineId::Hermes => probe_hermes(),
        EngineId::Codex => probe_codex(),
        EngineId::Omp => probe_omp(),
        _ => Probe { authed: true, ..Default::default() },
    }
}

pub fn scan_providers(user_email: Option<&str>, previous: &[ProviderInfo]) -> Vec<ProviderInfo> {
    let prev: std::collections::HashMap<&str, &ProviderInfo> =
        previous.iter().map(|p| (p.id.as_str(), p)).collect();
    let email = user_email.map(|e| e.to_lowercase());

    ENGINE_SPECS
        .iter()
        .map(|spec| {
            let resolved = spec
                .binaries
                .iter()
                .filter_map(|b| which(b, &spec.extra_path_dirs))
                .next()
                .or_else(|| known_launch(spec.id, &[]).map(|lt| lt.spawn_file));
            let probe = probe_for(spec);
            let installed = resolved.is_some() || spec.id == EngineId::Shell;
            let matched = match &email {
                Some(e) => probe.emails.iter().find(|x| *x == e).cloned(),
                None => probe.emails.first().cloned(),
            };
            let detected_auth = spec.id == EngineId::Shell || probe.authed || matched.is_some();
            let old = prev.get(spec.id.as_str()).copied();
            let mut base = default_provider(spec);
            base.installed = installed;
            base.detected_auth = detected_auth;
            base.matched_email = matched.clone();
            base.resolved_path = resolved.clone();
            if let Some(r) = &resolved {
                base.command = r.clone();
            }
            if let Some(old) = old {
                base.enabled = old.enabled;
                base.models = spec
                    .models
                    .iter()
                    .map(|m| {
                        let mut out = m.clone();
                        if let Some(om) = old.models.iter().find(|x| x.id == m.id) {
                            out.enabled = om.enabled;
                        }
                        out
                    })
                    .collect();
            } else {
                // first-time: auto-enable when installed AND (auth detected OR matched)
                base.enabled = installed && (detected_auth || spec.id == EngineId::Shell);
            }
            base
        })
        .collect()
}

pub fn apply_email_match(providers: Vec<ProviderInfo>, user_email: Option<&str>) -> Vec<ProviderInfo> {
    let Some(email) = user_email.map(|e| e.to_lowercase()) else {
        return providers;
    };
    providers
        .into_iter()
        .map(|mut p| {
            if p.id == EngineId::Shell {
                return p;
            }
            let m = p.matched_email.as_deref().map(|x| x.to_lowercase()) == Some(email.clone());
            if m && p.installed {
                p.enabled = true;
                p.detected_auth = true;
            }
            p
        })
        .collect()
}