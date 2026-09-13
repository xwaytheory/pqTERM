//! Trust sketch — Electron `src/main/trust.ts` (path + patch builders only).
//!
//! No git exec, no silent write to live CLI configs. Electron remains production.
//! Builders return text patches; callers / later I/O decide whether to apply.

use std::path::{Path, PathBuf};

/// Normalize for case-insensitive dedupe (Windows paths).
pub fn path_key(p: &str) -> String {
    PathBuf::from(p)
        .to_string_lossy()
        .replace('/', "\\")
        .to_ascii_lowercase()
}

/// Dedupe folder list preserving order (Electron `unique`).
pub fn unique_folders(paths: &[String]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for p in paths {
        if p.is_empty() {
            continue;
        }
        let k = path_key(p);
        if seen.insert(k) {
            out.push(p.clone());
        }
    }
    out
}

/// Folders to trust: cwd + optional git root (Electron `trustWorkspace` inputs).
pub fn trust_folder_set(cwd: &str, git_root: Option<&str>) -> Vec<String> {
    let mut v = vec![cwd.to_string()];
    if let Some(root) = git_root {
        if !root.is_empty() {
            v.push(root.to_string());
        }
    }
    unique_folders(&v)
}

fn slash(p: &str) -> String {
    p.replace('\\', "/")
}

/// Grok `trusted_folders.toml` block (Electron `trustGrok`).
pub fn grok_trust_block(dir: &str, decided_at: u64) -> String {
    format!("\n[folders.'{dir}']\ntrusted = true\ndecided_at = {decided_at}\n")
}

/// Whether Grok config already mentions this folder.
pub fn grok_already_trusted(toml_text: &str, dir: &str) -> bool {
    let a = format!("folders.'{dir}'");
    let escaped = dir.replace('\\', "\\\\");
    let b = format!("folders.\"{escaped}\"");
    toml_text.contains(&a) || toml_text.contains(&b)
}

/// Claude `.claude.json` project key (slash-normalized).
pub fn claude_project_key(dir: &str) -> String {
    slash(dir)
}

/// Whether Claude project already accepted trust dialog.
pub fn claude_already_trusted(projects_json: &serde_json::Value, dir: &str) -> bool {
    let key = claude_project_key(dir);
    projects_json
        .get(&key)
        .and_then(|p| p.get("hasTrustDialogAccepted"))
        .and_then(|v| v.as_bool())
        == Some(true)
}

/// Patch fragment for Claude projects map entry.
pub fn claude_trust_patch(dir: &str) -> serde_json::Value {
    serde_json::json!({
        claude_project_key(dir): {
            "hasTrustDialogAccepted": true,
            "hasClaudeMdExternalIncludesApproved": true
        }
    })
}

/// Gemini trustedFolders.json key (lowercased slash path).
pub fn gemini_trust_key(dir: &str) -> String {
    slash(dir).to_ascii_lowercase()
}

pub fn gemini_already_trusted(json: &serde_json::Value, dir: &str) -> bool {
    json.get(gemini_trust_key(dir))
        .and_then(|v| v.as_str())
        == Some("TRUST_FOLDER")
}

/// Codex `config.toml` project block (Electron `trustCodex`).
pub fn codex_trust_block(dir: &str) -> String {
    let key = dir.to_ascii_lowercase();
    format!("\n[projects.'{key}']\ntrust_level = \"trusted\"\n")
}

pub fn codex_already_trusted(toml_text: &str, dir: &str) -> bool {
    let key = dir.to_ascii_lowercase();
    let header = format!("[projects.'{key}']");
    let lower = toml_text.to_ascii_lowercase();
    if !lower.contains(&header.to_ascii_lowercase()) {
        return false;
    }
    lower.contains("trust_level") && lower.contains("trusted")
}

/// Well-known trust config paths under a home directory.
pub fn trust_config_paths(home: &Path) -> Vec<(&'static str, PathBuf)> {
    vec![
        (
            "grok",
            home.join(".grok").join("trusted_folders.toml"),
        ),
        ("claude", home.join(".claude.json")),
        (
            "gemini",
            home.join(".gemini").join("trustedFolders.json"),
        ),
        ("codex", home.join(".codex").join("config.toml")),
    ]
}

/// Plan of trust actions without writing (for logging / later I/O).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrustAction {
    pub engine: String,
    pub folder: String,
    pub already: bool,
}

pub fn plan_trust_actions(folders: &[String], probes: &[(&str, bool)]) -> Vec<TrustAction> {
    let mut out = Vec::new();
    for folder in folders {
        for &(engine, already) in probes {
            out.push(TrustAction {
                engine: engine.to_string(),
                folder: folder.clone(),
                already,
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unique_folders_dedupes_case() {
        let u = unique_folders(&[
            r"C:\Work\pq".into(),
            r"c:\work\pq".into(),
            r"C:\Other".into(),
        ]);
        assert_eq!(u.len(), 2);
    }

    #[test]
    fn trust_folder_set_includes_git_root() {
        let set = trust_folder_set(r"C:\Work\pq\crates", Some(r"C:\Work\pq"));
        assert_eq!(set.len(), 2);
    }

    #[test]
    fn grok_block_and_detect() {
        let dir = r"C:\Work\pq";
        let block = grok_trust_block(dir, 1000);
        assert!(block.contains("trusted = true"));
        assert!(grok_already_trusted(&block, dir));
        assert!(!grok_already_trusted("", dir));
    }

    #[test]
    fn claude_gemini_codex_helpers() {
        let dir = r"C:\Work\pq";
        let patch = claude_trust_patch(dir);
        assert_eq!(
            patch[claude_project_key(dir)]["hasTrustDialogAccepted"],
            true
        );
        let gkey = gemini_trust_key(dir);
        let g = serde_json::json!({ gkey.clone(): "TRUST_FOLDER" });
        assert!(gemini_already_trusted(&g, dir));
        let cblock = codex_trust_block(dir);
        assert!(codex_already_trusted(&cblock, dir));
    }

    #[test]
    fn trust_config_paths_cover_four() {
        let home = PathBuf::from(r"C:\Users\test");
        let paths = trust_config_paths(&home);
        assert_eq!(paths.len(), 4);
        assert!(paths.iter().any(|(e, p)| *e == "grok" && p.ends_with("trusted_folders.toml")));
    }
}
