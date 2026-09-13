//! Providers detection sketch — Electron `src/main/providers.ts` (merge + fixture I/O).
//!
//! **Honesty:** no PATH walk of the real home, no default AppData writes. Feed
//! [`ProviderProbe`] from tests / later host wiring via:
//! - [`probe_from_auth_texts`] (in-memory contents),
//! - [`probe_from_auth_paths`] (explicit file paths only),
//! - [`probe_auth_candidates`] (path *lists* from [`auth_candidate_paths`] + injectable
//!   home + injectable reader — never assumes `%USERPROFILE%`).
//!
//! Electron remains the production scanner. These helpers return data; they do not
//! call [`crate::store::state_path`] or write production configs.

use crate::engines::{default_provider, EngineSpec, ENGINE_SPECS};
use crate::store::ProviderInfo;
use std::fs;
use std::io;
use std::path::Path;
use thiserror::Error;

/// Result of probing one engine on disk (Electron `Probe`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProviderProbe {
    pub installed_path: Option<String>,
    pub auth_files: Vec<String>,
    pub emails: Vec<String>,
    pub authed: bool,
}

/// Errors from provider auth-file fixture reads (explicit paths only).
#[derive(Debug, Error)]
pub enum ProviderIoError {
    #[error("io: {0}")]
    Io(#[from] io::Error),
}

/// Extract emails from free text (Electron `emailsIn`).
pub fn emails_in(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if let Some((email, next)) = scan_email_at(text, i) {
            let lower = email.to_ascii_lowercase();
            if seen.insert(lower.clone()) {
                out.push(lower);
            }
            i = next;
        } else {
            i += 1;
        }
    }
    out
}

fn scan_email_at(text: &str, start: usize) -> Option<(String, usize)> {
    let rest = &text[start..];
    let at = rest.find('@')?;
    if at == 0 {
        return None;
    }
    let local = &rest[..at];
    let local_start = local
        .rfind(|c: char| !(c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '%' || c == '+' || c == '-'))
        .map(|p| p + 1)
        .unwrap_or(0);
    let local_part = &local[local_start..];
    if local_part.is_empty() {
        return None;
    }
    let domain_rest = &rest[at + 1..];
    let mut dom_len = 0;
    for c in domain_rest.chars() {
        if c.is_ascii_alphanumeric() || c == '.' || c == '-' {
            dom_len += c.len_utf8();
        } else {
            break;
        }
    }
    let domain = &domain_rest[..dom_len];
    if !domain.contains('.') || domain.starts_with('.') || domain.ends_with('.') {
        return None;
    }
    let tld = domain.rsplit('.').next()?;
    if tld.len() < 2 {
        return None;
    }
    let email = format!("{local_part}@{domain}");
    let abs_end = start + at + 1 + dom_len;
    Some((email, abs_end))
}

/// Well-known auth/config file relative to home (no existence check).
pub fn auth_candidate_paths(engine: &str, home: &std::path::Path) -> Vec<std::path::PathBuf> {
    match engine {
        "grok" => vec![
            home.join(".grok").join("auth.json"),
            home.join(".grok").join("config.toml"),
            home.join(".grok").join("models_cache.json"),
        ],
        "claude" => vec![
            home.join(".claude.json"),
            home.join(".claude").join("settings.json"),
            home.join(".config").join("claude").join("config.json"),
            home.join("AppData")
                .join("Roaming")
                .join("claude")
                .join("config.json"),
        ],
        "opencode" => vec![
            home.join(".local").join("share").join("opencode").join("auth.json"),
            home.join(".config").join("opencode").join("opencode.jsonc"),
            home.join(".config").join("opencode").join("cli.json"),
            home.join(".local").join("state").join("opencode").join("model.json"),
        ],
        "hermes" => {
            let local = home.join("AppData").join("Local").join("hermes");
            vec![
                local.join("auth.json"),
                local.join("auth").join("google_oauth.json"),
                local.join("config.yaml"),
            ]
        }
        "codex" => vec![
            home.join(".codex").join("auth.json"),
            home.join(".codex").join("config.toml"),
            home.join(".codex").join("models_cache.json"),
        ],
        "omp" => {
            let root = home.join(".omp").join("agent");
            vec![
                root.join("config.yml"),
                root.join("models.yml"),
                root.join("agent.db"),
                root.join("models.db"),
            ]
        }
        _ => Vec::new(),
    }
}

/// Heuristic auth detection from file text (Electron probe patterns).
pub fn text_looks_authed(engine: &str, text: &str) -> bool {
    let t = text.to_ascii_lowercase();
    match engine {
        "grok" => t.contains("refresh_token") || t.contains("auth_mode") || t.contains("oidc"),
        "codex" => t.contains("chatgpt") || t.contains("refresh_token") || t.contains("auth_mode"),
        "hermes" => {
            t.contains("access_token") || t.contains("refresh_token") || t.contains("credential_pool")
        }
        "omp" => t.contains("apikey") || t.contains("api_key") || t.contains("auth:"),
        "claude" => {
            t.contains("oauth") || t.contains("token") || t.contains("session") || t.contains('@')
        }
        "opencode" => !text.is_empty(),
        _ => false,
    }
}

/// Build a [`ProviderProbe`] from in-memory auth-file contents (path label + text).
///
/// Does not touch disk. `auth_files` lists labels whose text was non-empty.
pub fn probe_from_auth_texts(engine: &str, entries: &[(&str, &str)]) -> ProviderProbe {
    let mut auth_files = Vec::new();
    let mut email_seen = std::collections::HashSet::new();
    let mut emails = Vec::new();
    let mut authed = false;
    for (label, text) in entries {
        if text.is_empty() {
            continue;
        }
        auth_files.push((*label).to_string());
        for e in emails_in(text) {
            if email_seen.insert(e.clone()) {
                emails.push(e);
            }
        }
        if text_looks_authed(engine, text) {
            authed = true;
        }
    }
    ProviderProbe {
        installed_path: None,
        auth_files,
        emails,
        authed,
    }
}

/// Convenience overload when labels/texts are already `String` maps / vecs.
pub fn probe_from_auth_map(
    engine: &str,
    map: &std::collections::BTreeMap<String, String>,
) -> ProviderProbe {
    let pairs: Vec<(&str, &str)> = map
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    probe_from_auth_texts(engine, &pairs)
}

/// Read explicit auth-file paths into `(path_display, contents)` pairs.
///
/// Missing files are skipped (not an error). Other I/O errors propagate.
pub fn load_auth_texts_from_paths<P: AsRef<Path>>(
    paths: &[P],
) -> Result<Vec<(String, String)>, ProviderIoError> {
    let mut out = Vec::new();
    for p in paths {
        let path = p.as_ref();
        if !path.is_file() {
            continue;
        }
        let text = fs::read_to_string(path)?;
        out.push((path.to_string_lossy().into_owned(), text));
    }
    Ok(out)
}

/// Probe from explicit file paths (no home discovery).
pub fn probe_from_auth_paths<P: AsRef<Path>>(
    engine: &str,
    paths: &[P],
) -> Result<ProviderProbe, ProviderIoError> {
    let loaded = load_auth_texts_from_paths(paths)?;
    let pairs: Vec<(&str, &str)> = loaded
        .iter()
        .map(|(p, t)| (p.as_str(), t.as_str()))
        .collect();
    Ok(probe_from_auth_texts(engine, &pairs))
}

/// Injectable reader for auth candidate files under an injected `home`.
///
/// Production host may pass a real FS reader; tests pass a map / tempdir reader.
pub trait AuthFileReader {
    fn read_auth(&self, path: &Path) -> Option<String>;
}

/// Real filesystem reader (still only opens paths you pass — never invents home).
#[derive(Debug, Default, Clone, Copy)]
pub struct FsAuthReader;

impl AuthFileReader for FsAuthReader {
    fn read_auth(&self, path: &Path) -> Option<String> {
        fs::read_to_string(path).ok()
    }
}

/// Probe using [`auth_candidate_paths`] for the path *list* only, with injected home + reader.
///
/// Does **not** walk PATH or default to the real user profile.
pub fn probe_auth_candidates<R: AuthFileReader>(
    engine: &str,
    home: &Path,
    reader: &R,
) -> ProviderProbe {
    let candidates = auth_candidate_paths(engine, home);
    let mut pairs: Vec<(String, String)> = Vec::new();
    for path in candidates {
        if let Some(text) = reader.read_auth(&path) {
            if !text.is_empty() {
                pairs.push((path.to_string_lossy().into_owned(), text));
            }
        }
    }
    let refs: Vec<(&str, &str)> = pairs
        .iter()
        .map(|(p, t)| (p.as_str(), t.as_str()))
        .collect();
    probe_from_auth_texts(engine, &refs)
}

fn apply_probe(spec: &EngineSpec, probe: &ProviderProbe, previous: Option<&ProviderInfo>) -> ProviderInfo {
    let installed = probe.installed_path.is_some() || spec.id == "shell";
    let matched = probe.emails.first().cloned();
    let detected_auth = spec.id == "shell" || probe.authed || matched.is_some();
    let mut base = default_provider(spec);
    base.installed = installed;
    base.detected_auth = detected_auth;
    base.matched_email = matched;
    base.resolved_path = probe.installed_path.clone();
    if let Some(path) = &probe.installed_path {
        base.command = path.clone();
    }
    if let Some(old) = previous {
        base.enabled = old.enabled;
        base.models = spec
            .models
            .iter()
            .map(|(id, name)| {
                let enabled = old
                    .models
                    .iter()
                    .find(|m| m.id == *id)
                    .map(|m| m.enabled)
                    .unwrap_or(true);
                crate::store::ModelChoice {
                    id: (*id).to_string(),
                    name: (*name).to_string(),
                    enabled,
                }
            })
            .collect();
    } else {
        base.enabled = installed && (detected_auth || spec.id == "shell");
    }
    // shell: Electron enables when installed; first-time shell enabled if installed
    if spec.id == "shell" && previous.is_none() {
        base.enabled = installed;
    }
    base
}

/// Merge catalog + probes + previous toggles (Electron `scanProviders` pure core).
pub fn merge_provider_probes(
    probes: &std::collections::BTreeMap<String, ProviderProbe>,
    previous: Option<&[ProviderInfo]>,
    user_email: Option<&str>,
) -> Vec<ProviderInfo> {
    let prev: std::collections::HashMap<&str, &ProviderInfo> = previous
        .unwrap_or(&[])
        .iter()
        .map(|p| (p.id.as_str(), p))
        .collect();
    let email = user_email.map(|e| e.to_ascii_lowercase());

    ENGINE_SPECS
        .iter()
        .map(|spec| {
            let probe = probes.get(spec.id).cloned().unwrap_or_default();
            let mut info = apply_probe(spec, &probe, prev.get(spec.id).copied());
            if let Some(ref want) = email {
                if let Some(m) = probe.emails.iter().find(|e| e.as_str() == want.as_str()) {
                    info.matched_email = Some(m.clone());
                    if info.installed {
                        info.detected_auth = true;
                    }
                }
            }
            info
        })
        .collect()
}

/// Electron `applyEmailMatch` twin.
pub fn apply_email_match(providers: &[ProviderInfo], user_email: Option<&str>) -> Vec<ProviderInfo> {
    let Some(email) = user_email.map(|e| e.to_ascii_lowercase()) else {
        return providers.to_vec();
    };
    providers
        .iter()
        .map(|p| {
            if p.id == "shell" {
                return p.clone();
            }
            if p.matched_email.as_deref() == Some(email.as_str()) && p.installed {
                let mut n = p.clone();
                n.enabled = true;
                n.detected_auth = true;
                n
            } else {
                p.clone()
            }
        })
        .collect()
}

/// Empty probe map sized for catalog (helper for tests / stubs).
pub fn empty_probes() -> std::collections::BTreeMap<String, ProviderProbe> {
    ENGINE_SPECS
        .iter()
        .map(|s| (s.id.to_string(), ProviderProbe::default()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engines::spec_by_id;
    use std::collections::{BTreeMap, HashMap};
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("pq-providers-fixture-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn emails_in_finds_unique() {
        let t = "x a@b.co y A@B.CO z not-an-email";
        let e = emails_in(t);
        assert_eq!(e, vec!["a@b.co".to_string()]);
    }

    #[test]
    fn auth_candidates_grok_claude() {
        let home = PathBuf::from(r"C:\Users\test");
        assert_eq!(auth_candidate_paths("grok", &home).len(), 3);
        assert!(!auth_candidate_paths("claude", &home).is_empty());
        assert!(auth_candidate_paths("shell", &home).is_empty());
    }

    #[test]
    fn text_looks_authed_grok() {
        assert!(text_looks_authed("grok", r#"{"refresh_token":"x"}"#));
        assert!(!text_looks_authed("grok", "{}"));
    }

    #[test]
    fn merge_shell_installed_when_path_set() {
        let mut probes = empty_probes();
        probes.insert(
            "shell".into(),
            ProviderProbe {
                installed_path: Some(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe".into()),
                ..Default::default()
            },
        );
        let list = merge_provider_probes(&probes, None, None);
        let shell = list.iter().find(|p| p.id == "shell").unwrap();
        assert!(shell.installed);
        assert!(shell.enabled);
        assert_eq!(list.len(), ENGINE_SPECS.len());
    }

    #[test]
    fn apply_email_match_enables() {
        let mut p = default_provider(spec_by_id("grok").unwrap());
        p.installed = true;
        p.enabled = false;
        p.matched_email = Some("u@x.ai".into());
        let out = apply_email_match(&[p], Some("u@x.ai"));
        assert!(out[0].enabled);
        assert!(out[0].detected_auth);
    }

    #[test]
    fn merge_preserves_previous_enabled() {
        let mut prev = default_provider(spec_by_id("claude").unwrap());
        prev.enabled = false;
        let probes = BTreeMap::new();
        let list = merge_provider_probes(&probes, Some(&[prev]), None);
        let claude = list.iter().find(|p| p.id == "claude").unwrap();
        assert!(!claude.enabled);
    }

    #[test]
    fn probe_from_auth_texts_grok() {
        let entries = [(
            "auth.json",
            r#"{"refresh_token":"rt","email":"dev@x.ai"}"#,
        )];
        let probe = probe_from_auth_texts("grok", &entries);
        assert!(probe.authed);
        assert_eq!(probe.auth_files, vec!["auth.json".to_string()]);
        assert!(probe.emails.iter().any(|e| e == "dev@x.ai"));
    }

    #[test]
    fn probe_from_auth_map_and_paths_tempdir() {
        let dir = temp_dir();
        let auth = dir.join("auth.json");
        fs::write(&auth, r#"{"refresh_token":"z","user":"a@b.co"}"#).unwrap();
        let probe = probe_from_auth_paths("grok", &[&auth]).unwrap();
        assert!(probe.authed);
        assert!(!probe.auth_files.is_empty());
        assert!(probe.emails.contains(&"a@b.co".to_string()));

        let mut map = BTreeMap::new();
        map.insert("mem.json".into(), r#"{"auth_mode":"oidc"}"#.into());
        let mem = probe_from_auth_map("grok", &map);
        assert!(mem.authed);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn probe_auth_candidates_injected_home_no_real_profile() {
        let home = temp_dir();
        let grok_dir = home.join(".grok");
        fs::create_dir_all(&grok_dir).unwrap();
        fs::write(
            grok_dir.join("auth.json"),
            r#"{"refresh_token":"abc","mail":"p@example.com"}"#,
        )
        .unwrap();
        let probe = probe_auth_candidates("grok", &home, &FsAuthReader);
        assert!(probe.authed);
        assert!(probe.emails.contains(&"p@example.com".to_string()));
        // Map reader: only synthetic paths, no disk
        struct MapReader(HashMap<PathBuf, String>);
        impl AuthFileReader for MapReader {
            fn read_auth(&self, path: &Path) -> Option<String> {
                self.0.get(path).cloned()
            }
        }
        let fake_home = PathBuf::from(r"C:\Users\fake-fixture-home");
        let cand = auth_candidate_paths("claude", &fake_home);
        let mut m = HashMap::new();
        m.insert(cand[0].clone(), "session token user@claude.ai".into());
        let p2 = probe_auth_candidates("claude", &fake_home, &MapReader(m));
        assert!(p2.authed);
        assert!(p2.emails.iter().any(|e| e == "user@claude.ai"));
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn load_skips_missing_paths() {
        let dir = temp_dir();
        let missing = dir.join("nope.json");
        let present = dir.join("yes.json");
        fs::write(&present, "api_key: secret").unwrap();
        let loaded = load_auth_texts_from_paths(&[missing.as_path(), present.as_path()]).unwrap();
        assert_eq!(loaded.len(), 1);
        let probe = probe_from_auth_texts("omp", &[(loaded[0].0.as_str(), loaded[0].1.as_str())]);
        assert!(probe.authed);
        let _ = fs::remove_dir_all(&dir);
    }
}
