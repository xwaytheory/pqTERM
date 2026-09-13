use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use regex::Regex;

use crate::env::home_dir;
use crate::shared::EngineId;

pub fn q(s: &str) -> String {
    if s.contains(' ') || s.contains('"') {
        format!("\"{}\"", s.replace('"', "\\\""))
    } else {
        s.to_string()
    }
}

fn first_existing(paths: &[PathBuf]) -> Option<PathBuf> {
    paths
        .iter()
        .filter(|p| !p.as_os_str().is_empty() && p.exists())
        .next()
        .map(|p| p.clone())
}

fn npm_dir() -> PathBuf {
    home_dir().join("AppData").join("Roaming").join("npm")
}

pub struct LaunchTarget {
    pub spawn_file: String,
    pub args: Vec<String>,
}

/// Known install locations for engines (mirrors resolve-launch knownLaunch).
pub fn known_launch(engine: EngineId, extra: &[String]) -> Option<LaunchTarget> {
    let npm = npm_dir();
    let home = home_dir();
    match engine {
        EngineId::Grok => {
            let exe = first_existing(&[home.join(".grok").join("bin").join("grok.exe")]);
            exe.map(|e| LaunchTarget { spawn_file: e.to_string_lossy().to_string(), args: extra.to_vec() })
        }
        EngineId::Opencode => {
            let exe = first_existing(&[
                npm.join("node_modules").join("opencode-ai").join("bin").join("opencode.exe"),
                npm.join("node_modules").join("opencode-windows-x64").join("bin").join("opencode.exe"),
            ]);
            exe.map(|e| LaunchTarget { spawn_file: e.to_string_lossy().to_string(), args: extra.to_vec() })
        }
        EngineId::Claude => {
            let exe = first_existing(&[npm
                .join("node_modules")
                .join("@anthropic-ai")
                .join("claude-code")
                .join("bin")
                .join("claude.exe")]);
            exe.map(|e| LaunchTarget { spawn_file: e.to_string_lossy().to_string(), args: extra.to_vec() })
        }
        EngineId::Codex => {
            let exe = first_existing(&[npm
                .join("node_modules")
                .join("@openai")
                .join("codex")
                .join("node_modules")
                .join("@openai")
                .join("codex-win32-x64")
                .join("vendor")
                .join("x86_64-pc-windows-msvc")
                .join("bin")
                .join("codex.exe")]);
            exe.map(|e| LaunchTarget { spawn_file: e.to_string_lossy().to_string(), args: extra.to_vec() })
        }
        EngineId::Hermes => {
            let exe = first_existing(&[
                home.join("AppData")
                    .join("Local")
                    .join("hermes")
                    .join("hermes-agent")
                    .join("venv")
                    .join("Scripts")
                    .join("hermes.exe"),
                home.join("AppData").join("Local").join("hermes").join("bin").join("hermes.exe"),
            ]);
            exe.map(|e| LaunchTarget { spawn_file: e.to_string_lossy().to_string(), args: extra.to_vec() })
        }
        EngineId::Omp => {
            let script = first_existing(&[npm
                .join("node_modules")
                .join("@oh-my-pi")
                .join("pi-coding-agent")
                .join("dist")
                .join("cli.js")]);
            let bun = first_existing(&[npm.join("bun.exe"), home.join(".bun").join("bin").join("bun.exe")]);
            if let (Some(b), Some(s)) = (bun, script) {
                let mut args = vec![s.to_string_lossy().to_string()];
                args.extend(extra.iter().cloned());
                return Some(LaunchTarget { spawn_file: b.to_string_lossy().to_string(), args });
            }
            let cmd = first_existing(&[npm.join("omp.cmd")]);
            cmd.map(|c| LaunchTarget { spawn_file: c.to_string_lossy().to_string(), args: extra.to_vec() })
        }
        EngineId::Qwen | EngineId::Dsh | EngineId::Gemini | EngineId::Crush | EngineId::Copilot => {
            let name = engine.as_str();
            let exe = first_existing(&[
                npm.join(format!("{name}.cmd")),
                npm.join(format!("{name}.exe")),
                npm.join("node_modules").join(".bin").join(format!("{name}.cmd")),
            ]);
            exe.map(|e| LaunchTarget { spawn_file: e.to_string_lossy().to_string(), args: extra.to_vec() })
        }
        EngineId::Aider => {
            let exe = first_existing(&[
                home.join("AppData").join("Roaming").join("Python").join("Python314").join("Scripts").join("aider.exe"),
                home.join("AppData").join("Local").join("Programs").join("Python").join("Python314").join("Scripts").join("aider.exe"),
                npm.join("aider.cmd"),
            ]);
            exe.map(|e| LaunchTarget { spawn_file: e.to_string_lossy().to_string(), args: extra.to_vec() })
        }
        _ => None,
    }
}

pub fn yolo_env(engine: EngineId) -> HashMap<String, String> {
    let mut m = HashMap::new();
    match engine {
        EngineId::Opencode => {
            m.insert("OPENCODE_YOLO".into(), "true".into());
            m.insert("OPENCODE_DANGEROUSLY_SKIP_PERMISSIONS".into(), "1".into());
        }
        EngineId::Hermes => {
            m.insert("HERMES_YOLO_MODE".into(), "1".into());
        }
        EngineId::Grok => {
            m.insert("GROK_FOLDER_TRUST".into(), "0".into());
        }
        EngineId::Gemini | EngineId::Qwen => {
            m.insert("GEMINI_CLI_TRUST_WORKSPACE".into(), "true".into());
        }
        _ => {}
    }
    m
}

/// Returns the real executable + argv so ConPTY attaches to the TUI.
pub fn resolve_launch(engine: EngineId, target: &str, extra: &[String]) -> LaunchTarget {
    if engine == EngineId::Shell {
        return LaunchTarget {
            spawn_file: "powershell.exe".into(),
            args: vec!["-NoLogo".into(), "-NoExit".into()],
        };
    }

    if let Some(known) = known_launch(engine, extra) {
        return known;
    }

    let lower = target.to_lowercase();
    let target_path = PathBuf::from(target);

    if lower.ends_with(".exe") && target_path.exists() {
        return LaunchTarget { spawn_file: target.to_string(), args: extra.to_vec() };
    }

    if !target.is_empty() && !lower.ends_with(".cmd") && !lower.ends_with(".bat") {
        let as_cmd = if target.ends_with(".cmd") { target.to_string() } else { format!("{target}.cmd") };
        let abs_cmd = if Path::new(&as_cmd).exists() {
            Some(PathBuf::from(&as_cmd))
        } else {
            first_existing(&[npm_dir().join(format!("{}.cmd", engine.as_str())), npm_dir().join(format!("{target}.cmd"))])
        };
        if let Some(c) = abs_cmd {
            return resolve_launch(engine, &c.to_string_lossy(), extra);
        }
        let as_exe =
            first_existing(&[PathBuf::from(format!("{target}.exe")), npm_dir().join(format!("{}.exe", engine.as_str()))]);
        if let Some(e) = as_exe {
            return LaunchTarget { spawn_file: e.to_string_lossy().to_string(), args: extra.to_vec() };
        }
    }

    if !target.is_empty() && (lower.ends_with(".cmd") || lower.ends_with(".bat")) && target_path.exists() {
        let dir = target_path.parent().map(|p| p.to_path_buf()).unwrap_or_default();
        if let Ok(text) = fs::read_to_string(target) {
            let re = Regex::new(r#""%dp0%\\([^"\r\n]+?\.exe)""#).unwrap();
            let mut native: Option<PathBuf> = None;
            for cap in re.captures_iter(&text) {
                let path = dir.join(cap[1].replace('/', "\\"));
                let lower = path.to_string_lossy().to_lowercase();
                if lower.ends_with("\\bun.exe") || lower.ends_with("\\node.exe") {
                    continue;
                }
                if path.exists() {
                    native = Some(path);
                    break;
                }
            }
            if let Some(n) = native {
                return LaunchTarget { spawn_file: n.to_string_lossy().to_string(), args: extra.to_vec() };
            }
        }
    }

    let com_spec = env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".into());
    let mut parts = vec![q(target)];
    parts.extend(extra.iter().map(|a| q(a)));
    LaunchTarget {
        spawn_file: com_spec,
        args: vec!["/d".into(), "/s".into(), "/k".into(), parts.join(" ")],
    }
}

/// strip Electron-ish env vars our children must not inherit
pub fn sanitize_env(env: &HashMap<String, String>) -> HashMap<String, String> {
    let mut out = env.clone();
    out.retain(|k, _| {
        !k.starts_with("ELECTRON_")
            && k != "CHROME_CRASHPAD_PIPE_NAME"
            && k != "ORIGINAL_XDG_CURRENT_DESKTOP"
            && k != "NSIS_LOG"
            && k != "PKG_EXECPATH"
    });
    out
}