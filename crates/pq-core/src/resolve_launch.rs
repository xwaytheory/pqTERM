//! Resolve-launch sketch — Electron `src/main/resolve-launch.ts` (paths + env only).
//!
//! No process spawn. Electron remains the production launcher. Disk existence is
//! injected via [`PathExists`] so unit tests stay offline.

use std::path::{Path, PathBuf};

/// Quote a path/arg for cmd.exe style when it contains spaces or quotes.
pub fn quote_arg(s: &str) -> String {
    if s.chars().any(|c| c.is_whitespace() || c == '"') {
        format!("\"{}\"", s.replace('"', "\\\""))
    } else {
        s.to_string()
    }
}

/// `%USERPROFILE%\AppData\Roaming\npm` twin (Electron `npmDir`).
pub fn npm_dir(home: &Path) -> PathBuf {
    home.join("AppData").join("Roaming").join("npm")
}

/// Spawn plan for an engine CLI (no OS spawn).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchPlan {
    pub spawn_file: String,
    pub args: Vec<String>,
}

/// YOLO / trust-skip env vars twin of Electron `yoloEnv`.
pub fn yolo_env(engine: &str) -> Vec<(String, String)> {
    match engine {
        "opencode" => vec![
            ("OPENCODE_YOLO".into(), "true".into()),
            ("OPENCODE_DANGEROUSLY_SKIP_PERMISSIONS".into(), "1".into()),
        ],
        "hermes" => vec![("HERMES_YOLO_MODE".into(), "1".into())],
        "grok" => vec![("GROK_FOLDER_TRUST".into(), "0".into())],
        "gemini" | "qwen" => vec![("GEMINI_CLI_TRUST_WORKSPACE".into(), "true".into())],
        _ => Vec::new(),
    }
}

/// True when a key must be dropped from inherited env (Electron `sanitizeEnv`).
pub fn is_sanitize_drop_key(key: &str) -> bool {
    key.starts_with("ELECTRON_")
        || key == "CHROME_CRASHPAD_PIPE_NAME"
        || key == "ORIGINAL_XDG_CURRENT_DESKTOP"
}

/// Strip Electron/Chromium noise keys (Electron `sanitizeEnv` twin).
pub fn sanitize_env_keys<'a, I>(keys: I) -> Vec<String>
where
    I: IntoIterator<Item = &'a str>,
{
    keys.into_iter()
        .filter(|k| !is_sanitize_drop_key(k))
        .map(|s| s.to_string())
        .collect()
}

/// Inputs for Electron `envFor` twin (ConPTY / agent spawn env).
#[derive(Debug, Clone)]
pub struct PtyEnvOpts<'a> {
    pub cwd: &'a str,
    pub engine: &'a str,
    pub home: &'a Path,
    /// `%APPDATA%\{pq|pq-dev}\bin` (or test fixture).
    pub product_bin: &'a Path,
    /// Resolved engine binary — its parent dir is prepended to PATH.
    pub extra_path: Option<&'a str>,
    /// Bridge `PQ_BIN` dir (optional).
    pub pq_bin: Option<&'a str>,
    pub extra_env: &'a [(String, String)],
}

/// PATH prepend list twin of Electron `pty-manager` `envFor` extras.
///
/// Order: `PQ_BIN`, dirname(`extra_path`), product `bin`, `.grok\bin`, npm, hermes.
/// Does **not** inject Cursor IDE bin (Krytyk r3).
pub fn pty_path_extras(opts: &PtyEnvOpts<'_>) -> Vec<String> {
    let mut extras: Vec<String> = Vec::new();
    if let Some(bin) = opts.pq_bin {
        if !bin.is_empty() {
            extras.push(bin.to_string());
        }
    }
    if let Some(p) = opts.extra_path {
        if !p.is_empty() {
            let pb = Path::new(p);
            if let Some(parent) = pb.parent() {
                let s = parent.to_string_lossy();
                if !s.is_empty() {
                    extras.push(s.into_owned());
                }
            }
        }
    }
    extras.push(opts.product_bin.to_string_lossy().into_owned());
    extras.push(
        opts.home
            .join(".grok")
            .join("bin")
            .to_string_lossy()
            .into_owned(),
    );
    extras.push(npm_dir(opts.home).to_string_lossy().into_owned());
    extras.push(
        opts.home
            .join("AppData")
            .join("Local")
            .join("hermes")
            .join("bin")
            .to_string_lossy()
            .into_owned(),
    );
    extras.into_iter().filter(|s| !s.is_empty()).collect()
}

/// Prepend unique extras onto an existing PATH/Path value (`;`-joined).
pub fn merge_path_prepend(current: &str, extras: &[String]) -> String {
    let mut parts: Vec<String> = Vec::new();
    for e in extras {
        if e.is_empty() {
            continue;
        }
        if parts.iter().any(|p| p.eq_ignore_ascii_case(e)) {
            continue;
        }
        parts.push(e.clone());
    }
    for seg in current.split(';') {
        if seg.is_empty() {
            continue;
        }
        if parts.iter().any(|p| p.eq_ignore_ascii_case(seg)) {
            continue;
        }
        parts.push(seg.to_string());
    }
    parts.join(";")
}

/// Build sanitized env for ConPTY/agent spawn (Electron `envFor` twin).
///
/// - Drops Electron/Chromium noise keys from `base`
/// - Merges [`yolo_env`] for `opts.engine`
/// - Applies `opts.extra_env`
/// - Prepends PATH extras ([`pty_path_extras`]) onto both `PATH` and `Path`
/// - Sets `TERM` / `COLORTERM` / `TERM_PROGRAM` / `PQ` / `PWD` / `FORCE_COLOR`
///
/// Pure: no process spawn, no disk I/O. Callers apply the pairs onto a
/// `portable-pty` `CommandBuilder` (or tests assert the map).
pub fn build_pty_env(
    base: impl IntoIterator<Item = (String, String)>,
    opts: &PtyEnvOpts<'_>,
) -> Vec<(String, String)> {
    use std::collections::BTreeMap;
    let mut map: BTreeMap<String, String> = BTreeMap::new();
    for (k, v) in base {
        if is_sanitize_drop_key(&k) {
            continue;
        }
        map.insert(k, v);
    }
    for (k, v) in yolo_env(opts.engine) {
        map.insert(k, v);
    }
    for (k, v) in opts.extra_env {
        map.insert(k.clone(), v.clone());
    }
    let current = map
        .get("Path")
        .cloned()
        .or_else(|| map.get("PATH").cloned())
        .unwrap_or_default();
    let extras = pty_path_extras(opts);
    let path = merge_path_prepend(&current, &extras);
    map.insert("PATH".into(), path.clone());
    map.insert("Path".into(), path);
    map.insert("TERM".into(), "xterm-256color".into());
    map.insert("COLORTERM".into(), "truecolor".into());
    map.insert("TERM_PROGRAM".into(), "pq".into());
    map.insert("PQ".into(), "1".into());
    map.insert("PWD".into(), opts.cwd.to_string());
    map.insert("FORCE_COLOR".into(), "1".into());
    map.into_iter().collect()
}

/// Candidate absolute paths for a known engine (may or may not exist on disk).
pub fn known_launch_candidates(engine: &str, home: &Path, extra: &[String]) -> Option<LaunchPlan> {
    let npm = npm_dir(home);
    let plan = |spawn: PathBuf| LaunchPlan {
        spawn_file: spawn.to_string_lossy().into_owned(),
        args: extra.to_vec(),
    };
    match engine {
        "grok" => Some(plan(home.join(".grok").join("bin").join("grok.exe"))),
        "opencode" => Some(plan(
            npm.join("node_modules")
                .join("opencode-ai")
                .join("bin")
                .join("opencode.exe"),
        )),
        "claude" => Some(plan(
            npm.join("node_modules")
                .join("@anthropic-ai")
                .join("claude-code")
                .join("bin")
                .join("claude.exe"),
        )),
        "codex" => Some(plan(
            npm.join("node_modules")
                .join("@openai")
                .join("codex")
                .join("node_modules")
                .join("@openai")
                .join("codex-win32-x64")
                .join("vendor")
                .join("x86_64-pc-windows-msvc")
                .join("bin")
                .join("codex.exe"),
        )),
        "hermes" => Some(plan(
            home.join("AppData")
                .join("Local")
                .join("hermes")
                .join("bin")
                .join("hermes.exe"),
        )),
        "omp" => Some(plan(npm.join("omp.cmd"))),
        "qwen" | "dsh" | "gemini" | "crush" | "copilot" => {
            Some(plan(npm.join(format!("{engine}.cmd"))))
        }
        "aider" => Some(plan(
            home.join("AppData")
                .join("Roaming")
                .join("Python")
                .join("Python314")
                .join("Scripts")
                .join("aider.exe"),
        )),
        _ => None,
    }
}

/// First existing candidate among known paths (Electron `knownLaunch`).
pub fn known_launch<E: PathExists>(
    engine: &str,
    home: &Path,
    extra: &[String],
    exists: &E,
) -> Option<LaunchPlan> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    let npm = npm_dir(home);
    match engine {
        "grok" => candidates.push(home.join(".grok").join("bin").join("grok.exe")),
        "opencode" => {
            candidates.push(
                npm.join("node_modules")
                    .join("opencode-ai")
                    .join("bin")
                    .join("opencode.exe"),
            );
            candidates.push(
                npm.join("node_modules")
                    .join("opencode-windows-x64")
                    .join("bin")
                    .join("opencode.exe"),
            );
        }
        "claude" => candidates.push(
            npm.join("node_modules")
                .join("@anthropic-ai")
                .join("claude-code")
                .join("bin")
                .join("claude.exe"),
        ),
        "codex" => candidates.push(
            npm.join("node_modules")
                .join("@openai")
                .join("codex")
                .join("node_modules")
                .join("@openai")
                .join("codex-win32-x64")
                .join("vendor")
                .join("x86_64-pc-windows-msvc")
                .join("bin")
                .join("codex.exe"),
        ),
        "hermes" => {
            candidates.push(
                home.join("AppData")
                    .join("Local")
                    .join("hermes")
                    .join("hermes-agent")
                    .join("venv")
                    .join("Scripts")
                    .join("hermes.exe"),
            );
            candidates.push(
                home.join("AppData")
                    .join("Local")
                    .join("hermes")
                    .join("bin")
                    .join("hermes.exe"),
            );
        }
        "omp" => {
            let script = npm
                .join("node_modules")
                .join("@oh-my-pi")
                .join("pi-coding-agent")
                .join("dist")
                .join("cli.js");
            let bun_npm = npm.join("bun.exe");
            let bun_home = home.join(".bun").join("bin").join("bun.exe");
            if exists.path_exists(&script) {
                if exists.path_exists(&bun_npm) {
                    return Some(LaunchPlan {
                        spawn_file: bun_npm.to_string_lossy().into_owned(),
                        args: std::iter::once(script.to_string_lossy().into_owned())
                            .chain(extra.iter().cloned())
                            .collect(),
                    });
                }
                if exists.path_exists(&bun_home) {
                    return Some(LaunchPlan {
                        spawn_file: bun_home.to_string_lossy().into_owned(),
                        args: std::iter::once(script.to_string_lossy().into_owned())
                            .chain(extra.iter().cloned())
                            .collect(),
                    });
                }
            }
            candidates.push(npm.join("omp.cmd"));
        }
        "qwen" | "dsh" | "gemini" | "crush" | "copilot" => {
            candidates.push(npm.join(format!("{engine}.cmd")));
            candidates.push(npm.join(format!("{engine}.exe")));
            candidates.push(
                npm.join("node_modules")
                    .join(".bin")
                    .join(format!("{engine}.cmd")),
            );
        }
        "aider" => {
            candidates.push(
                home.join("AppData")
                    .join("Roaming")
                    .join("Python")
                    .join("Python314")
                    .join("Scripts")
                    .join("aider.exe"),
            );
            candidates.push(
                home.join("AppData")
                    .join("Local")
                    .join("Programs")
                    .join("Python")
                    .join("Python314")
                    .join("Scripts")
                    .join("aider.exe"),
            );
            candidates.push(npm.join("aider.cmd"));
        }
        _ => return None,
    }
    for c in candidates {
        if exists.path_exists(&c) {
            return Some(LaunchPlan {
                spawn_file: c.to_string_lossy().into_owned(),
                args: extra.to_vec(),
            });
        }
    }
    None
}

/// Pure resolve without `.cmd` shim parsing (Electron `resolveLaunch` subset).
pub fn resolve_launch<E: PathExists>(
    engine: &str,
    target: &str,
    extra: &[String],
    home: &Path,
    comspec: &str,
    exists: &E,
) -> LaunchPlan {
    if engine == "shell" {
        return LaunchPlan {
            spawn_file: "powershell.exe".into(),
            args: vec!["-NoLogo".into(), "-NoExit".into()],
        };
    }
    if let Some(known) = known_launch(engine, home, extra, exists) {
        return known;
    }
    let lower = target.to_ascii_lowercase();
    if lower.ends_with(".exe") && exists.path_exists(Path::new(target)) {
        return LaunchPlan {
            spawn_file: target.into(),
            args: extra.to_vec(),
        };
    }
    let cmdline = std::iter::once(quote_arg(if target.is_empty() {
        engine
    } else {
        target
    }))
    .chain(extra.iter().map(|a| quote_arg(a)))
    .collect::<Vec<_>>()
    .join(" ");
    LaunchPlan {
        spawn_file: comspec.to_string(),
        args: vec!["/d".into(), "/s".into(), "/k".into(), cmdline],
    }
}

/// Injectable path existence (production: [`FsExists`]; tests: set/map).
pub trait PathExists {
    fn path_exists(&self, path: &Path) -> bool;
}

/// Real filesystem probe.
#[derive(Debug, Default, Clone, Copy)]
pub struct FsExists;

impl PathExists for FsExists {
    fn path_exists(&self, path: &Path) -> bool {
        path.exists()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    struct SetExists(HashSet<PathBuf>);

    impl PathExists for SetExists {
        fn path_exists(&self, path: &Path) -> bool {
            self.0.contains(path)
        }
    }

    #[test]
    fn quote_wraps_spaces() {
        assert_eq!(quote_arg("a b"), "\"a b\"");
        assert_eq!(quote_arg("plain"), "plain");
    }

    #[test]
    fn yolo_opencode_and_shell() {
        assert_eq!(yolo_env("opencode").len(), 2);
        assert!(yolo_env("shell").is_empty());
        assert_eq!(yolo_env("grok")[0].0, "GROK_FOLDER_TRUST");
    }

    #[test]
    fn sanitize_drops_electron_keys() {
        let keys = sanitize_env_keys([
            "PATH",
            "ELECTRON_RUN_AS_NODE",
            "CHROME_CRASHPAD_PIPE_NAME",
            "USERPROFILE",
        ]);
        assert_eq!(keys, vec!["PATH".to_string(), "USERPROFILE".to_string()]);
        assert!(is_sanitize_drop_key("ELECTRON_RUN_AS_NODE"));
        assert!(!is_sanitize_drop_key("PATH"));
    }

    #[test]
    fn build_pty_env_sets_term_yolo_and_path_extras() {
        let home = PathBuf::from(r"C:\Users\test");
        let product_bin = PathBuf::from(r"C:\Users\test\AppData\Roaming\pq\bin");
        let base = vec![
            ("PATH".into(), r"C:\Windows\System32".into()),
            ("ELECTRON_RUN_AS_NODE".into(), "1".into()),
            ("USERPROFILE".into(), r"C:\Users\test".into()),
        ];
        let extra = vec![("PQ_TOKEN".into(), "tok".into())];
        let opts = PtyEnvOpts {
            cwd: r"C:\work",
            engine: "opencode",
            home: &home,
            product_bin: &product_bin,
            extra_path: Some(r"C:\tools\opencode\opencode.exe"),
            pq_bin: Some(r"C:\pq-bridge\bin"),
            extra_env: &extra,
        };
        let env = build_pty_env(base, &opts);
        let get = |k: &str| {
            env.iter()
                .find(|(a, _)| a == k)
                .map(|(_, v)| v.as_str())
                .unwrap_or("")
        };
        assert_eq!(get("TERM"), "xterm-256color");
        assert_eq!(get("COLORTERM"), "truecolor");
        assert_eq!(get("TERM_PROGRAM"), "pq");
        assert_eq!(get("PQ"), "1");
        assert_eq!(get("PWD"), r"C:\work");
        assert_eq!(get("FORCE_COLOR"), "1");
        assert_eq!(get("OPENCODE_YOLO"), "true");
        assert_eq!(get("PQ_TOKEN"), "tok");
        assert!(!env.iter().any(|(k, _)| k.starts_with("ELECTRON_")));
        let path = get("PATH");
        assert_eq!(path, get("Path"));
        assert!(path.starts_with(r"C:\pq-bridge\bin;"), "{path}");
        assert!(path.contains(r"C:\tools\opencode"), "{path}");
        assert!(path.contains(r"AppData\Roaming\pq\bin"), "{path}");
        assert!(path.contains(r".grok\bin"), "{path}");
        assert!(path.contains(r"AppData\Roaming\npm"), "{path}");
        assert!(path.contains(r"hermes\bin"), "{path}");
        assert!(path.contains(r"C:\Windows\System32"), "{path}");
    }

    #[test]
    fn build_pty_env_shell_has_no_yolo() {
        let home = PathBuf::from(r"C:\Users\test");
        let product_bin = home.join("AppData").join("Roaming").join("pq").join("bin");
        let opts = PtyEnvOpts {
            cwd: "",
            engine: "shell",
            home: &home,
            product_bin: &product_bin,
            extra_path: None,
            pq_bin: None,
            extra_env: &[],
        };
        let env = build_pty_env(vec![("PATH".into(), "x".into())], &opts);
        assert!(!env.iter().any(|(k, _)| k.contains("YOLO") || k == "GROK_FOLDER_TRUST"));
        assert_eq!(
            env.iter().find(|(k, _)| k == "TERM").map(|(_, v)| v.as_str()),
            Some("xterm-256color")
        );
    }

    #[test]
    fn shell_launch_is_powershell() {
        let home = PathBuf::from(r"C:\Users\test");
        let ex = SetExists(HashSet::new());
        let plan = resolve_launch("shell", "", &[], &home, "cmd.exe", &ex);
        assert_eq!(plan.spawn_file, "powershell.exe");
        assert_eq!(plan.args, vec!["-NoLogo", "-NoExit"]);
    }

    #[test]
    fn known_launch_picks_first_existing() {
        let home = PathBuf::from(r"C:\Users\test");
        let grok = home.join(".grok").join("bin").join("grok.exe");
        let mut set = HashSet::new();
        set.insert(grok.clone());
        let ex = SetExists(set);
        let plan = known_launch("grok", &home, &["--trust".into()], &ex).unwrap();
        assert_eq!(plan.spawn_file, grok.to_string_lossy());
        assert_eq!(plan.args, vec!["--trust"]);
    }

    #[test]
    fn fallback_uses_comspec() {
        let home = PathBuf::from(r"C:\Users\test");
        let ex = SetExists(HashSet::new());
        let plan = resolve_launch("crush", "crush", &["a b".into()], &home, "cmd.exe", &ex);
        assert_eq!(plan.spawn_file, "cmd.exe");
        assert_eq!(plan.args[0], "/d");
        assert!(plan.args[3].contains("crush"));
        assert!(plan.args[3].contains("\"a b\""));
    }

    #[test]
    fn candidate_paths_nonempty_for_catalog_engines() {
        let home = PathBuf::from(r"C:\Users\test");
        for eng in ["grok", "opencode", "claude", "codex", "hermes", "omp", "gemini"] {
            assert!(
                known_launch_candidates(eng, &home, &[]).is_some(),
                "missing candidates for {eng}"
            );
        }
    }
}
