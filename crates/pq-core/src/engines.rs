//! Engine catalog + provider merge (Electron `engines.ts` / `store.mergeProviders` twin).
//!
//! Static specs only — PATH probing stays Electron `providers.ts` until the Rust port.

use crate::store::{ModelChoice, ProviderInfo};

/// Static engine definition (no PATH resolve / auth probe).
#[derive(Debug, Clone)]
pub struct EngineSpec {
    pub id: &'static str,
    pub name: &'static str,
    pub vendor: &'static str,
    pub color: &'static str,
    pub binaries: &'static [&'static str],
    pub args: &'static [&'static str],
    pub hint: &'static str,
    pub models: &'static [(&'static str, &'static str)],
    pub extra_path_dirs: &'static [&'static str],
    pub npm_package: Option<&'static str>,
    pub pip_package: Option<&'static str>,
    pub mark: Option<&'static str>,
    pub logo: Option<&'static str>,
    pub icon: Option<&'static str>,
}

/// Built-in engines — keep ids/colors/marks in sync with `src/main/engines.ts`.
pub static ENGINE_SPECS: &[EngineSpec] = &[
    EngineSpec {
        id: "grok",
        name: "Grok CLI",
        vendor: "xAI",
        color: "#39ffb6",
        binaries: &["grok", "grok.exe"],
        args: &["--always-approve", "--trust"],
        hint: "Grok Build TUI — sesja lokalna z ~/.grok",
        models: &[("grok-4.6", "Grok 4.6"), ("grok-4.5", "Grok 4.5"), ("grok-4-fast", "Grok 4 Fast"), ("grok-code", "Grok Code")],
        extra_path_dirs: &["%USERPROFILE%\\.grok\\bin"],
        npm_package: None,
        pip_package: None,
        mark: Some("Gr"),
        logo: None,
        icon: None,
    },
    EngineSpec {
        id: "omp",
        name: "Omp",
        vendor: "oh-my-pi",
        color: "#c084fc",
        binaries: &["omp", "omp.cmd"],
        args: &["--yolo"],
        hint: "Oh My Pi — open-source terminal coding agent",
        models: &[("anthropic/claude-sonnet-4", "Sonnet 4"), ("openai/gpt-5", "GPT-5"), ("xai/grok-4", "Grok 4"), ("google/gemini-2.5-pro", "Gemini 2.5 Pro"), ("zhipuai/glm-4.7", "GLM 4.7"), ("deepseek/deepseek-chat", "DeepSeek")],
        extra_path_dirs: &["%APPDATA%\\npm"],
        npm_package: Some("@oh-my-pi/pi-coding-agent"),
        pip_package: None,
        mark: Some("Om"),
        logo: None,
        icon: None,
    },
    EngineSpec {
        id: "hermes",
        name: "Hermes",
        vendor: "Nous / Hermes",
        color: "#f5c542",
        binaries: &["hermes", "hermes.cmd"],
        args: &["--tui", "--yolo"],
        hint: "Hermes agent CLI (TUI)",
        models: &[("hermes-default", "Hermes default"), ("hermes-large", "Hermes large")],
        extra_path_dirs: &["%LOCALAPPDATA%\\hermes\\bin"],
        npm_package: None,
        pip_package: None,
        mark: None,
        logo: None,
        icon: None,
    },
    EngineSpec {
        id: "opencode",
        name: "OpenCode",
        vendor: "OpenCode",
        color: "#7aa2ff",
        binaries: &["opencode", "opencode.cmd"],
        args: &["--yolo"],
        hint: "OpenCode TUI — konta i klucze z lokalnej sesji",
        models: &[("opencode-default", "OpenCode default"), ("anthropic/claude-sonnet-4", "Sonnet 4"), ("openai/gpt-5", "GPT-5"), ("xai/grok-4", "Grok 4"), ("zhipuai/glm-4.7", "GLM 4.7"), ("deepseek/deepseek-chat", "DeepSeek")],
        extra_path_dirs: &["%APPDATA%\\npm"],
        npm_package: Some("opencode-ai"),
        pip_package: None,
        mark: Some("Oc"),
        logo: None,
        icon: None,
    },
    EngineSpec {
        id: "codex",
        name: "Codex",
        vendor: "OpenAI",
        color: "#9ae6b4",
        binaries: &["codex", "codex.cmd"],
        args: &["--yolo"],
        hint: "OpenAI Codex CLI",
        models: &[("gpt-5.6-sol", "GPT-5.6 Sol"), ("gpt-5.5", "GPT-5.5"), ("gpt-5.4", "GPT-5.4"), ("codex-mini", "Codex mini")],
        extra_path_dirs: &["%APPDATA%\\npm"],
        npm_package: Some("@openai/codex"),
        pip_package: None,
        mark: Some("Cx"),
        logo: None,
        icon: None,
    },
    EngineSpec {
        id: "claude",
        name: "Claude Code",
        vendor: "Anthropic",
        color: "#d4a574",
        binaries: &["claude", "claude.cmd"],
        args: &["--dangerously-skip-permissions"],
        hint: "Claude Code TUI",
        models: &[("claude-sonnet-4", "Sonnet 4"), ("claude-opus-4", "Opus 4"), ("claude-haiku-4", "Haiku 4")],
        extra_path_dirs: &["%APPDATA%\\npm"],
        npm_package: Some("@anthropic-ai/claude-code"),
        pip_package: None,
        mark: Some("Cl"),
        logo: None,
        icon: None,
    },
    EngineSpec {
        id: "qwen",
        name: "Qwen Code",
        vendor: "Alibaba / Qwen",
        color: "#7c5cff",
        binaries: &["qwen", "qwen.cmd"],
        args: &["--yolo"],
        hint: "Qwen Code — OSS agent (Qwen + OpenAI/Anthropic/Gemini compatible)",
        models: &[("qwen3-coder-plus", "Qwen3 Coder Plus"), ("qwen3.6-plus", "Qwen3.6 Plus")],
        extra_path_dirs: &["%APPDATA%\\npm"],
        npm_package: Some("@qwen-code/qwen-code"),
        pip_package: None,
        mark: None,
        logo: None,
        icon: None,
    },
    EngineSpec {
        id: "dsh",
        name: "DeepSeek Harness",
        vendor: "DeepSeek",
        color: "#4cc9f0",
        binaries: &["dsh", "dsh.cmd"],
        args: &["--profile", "tui"],
        hint: "dsh — oficjalny OSS harness DeepSeek (TUI profile)",
        models: &[("deepseek-v4-pro", "DeepSeek V4 Pro"), ("deepseek-v4-flash", "DeepSeek V4 Flash")],
        extra_path_dirs: &["%APPDATA%\\npm"],
        npm_package: Some("@deepseek-ai/dsh"),
        pip_package: None,
        mark: None,
        logo: None,
        icon: None,
    },
    EngineSpec {
        id: "gemini",
        name: "Gemini CLI",
        vendor: "Google",
        color: "#4285f4",
        binaries: &["gemini", "gemini.cmd"],
        args: &["--yolo", "--skip-trust"],
        hint: "Gemini CLI (OSS). Consumer Gemini CLI jest wygaszany — zostawiamy binarkę jeśli działa.",
        models: &[("gemini-2.5-pro", "Gemini 2.5 Pro"), ("gemini-2.5-flash", "Gemini 2.5 Flash")],
        extra_path_dirs: &["%APPDATA%\\npm"],
        npm_package: Some("@google/gemini-cli"),
        pip_package: None,
        mark: Some("Ge"),
        logo: None,
        icon: None,
    },
    EngineSpec {
        id: "crush",
        name: "Crush",
        vendor: "Charmbracelet",
        color: "#ff387b",
        binaries: &["crush", "crush.cmd"],
        args: &[],
        hint: "Crush — OSS TUI Charmbracelet, multi-provider",
        models: &[],
        extra_path_dirs: &["%APPDATA%\\npm"],
        npm_package: Some("@charmland/crush"),
        pip_package: None,
        mark: Some("Cr"),
        logo: None,
        icon: None,
    },
    EngineSpec {
        id: "aider",
        name: "Aider",
        vendor: "Aider-AI",
        color: "#e8c547",
        binaries: &["aider", "aider.exe"],
        args: &["--yes"],
        hint: "Aider — git-native OSS pair programmer (pip)",
        models: &[],
        extra_path_dirs: &["%APPDATA%\\Python", "%LOCALAPPDATA%\\Programs\\Python"],
        npm_package: None,
        pip_package: Some("aider-chat"),
        mark: None,
        logo: None,
        icon: None,
    },
    EngineSpec {
        id: "copilot",
        name: "Copilot CLI",
        vendor: "GitHub",
        color: "#f0f6fc",
        binaries: &["copilot", "copilot.cmd"],
        args: &["--yolo"],
        hint: "GitHub Copilot CLI",
        models: &[],
        extra_path_dirs: &["%APPDATA%\\npm"],
        npm_package: Some("@github/copilot"),
        pip_package: None,
        mark: Some("Co"),
        logo: None,
        icon: None,
    },
    EngineSpec {
        id: "shell",
        name: "PowerShell",
        vendor: "Windows",
        color: "#5b9fd6",
        binaries: &["pwsh", "powershell"],
        args: &["-NoLogo"],
        hint: "Czysty shell — bez agenta",
        models: &[],
        extra_path_dirs: &[],
        npm_package: None,
        pip_package: None,
        mark: None,
        logo: None,
        icon: None,
    },
];

/// Look up a static engine by id.
pub fn spec_by_id(id: &str) -> Option<&'static EngineSpec> {
    ENGINE_SPECS.iter().find(|s| s.id == id)
}

/// Electron `defaultProvider(spec)` twin (no PATH / auth extras).
pub fn default_provider(spec: &EngineSpec) -> ProviderInfo {
    ProviderInfo {
        id: spec.id.to_string(),
        name: spec.name.to_string(),
        vendor: spec.vendor.to_string(),
        command: spec.binaries.first().unwrap_or(&"").to_string(),
        args: spec.args.iter().map(|s| (*s).to_string()).collect(),
        color: spec.color.to_string(),
        logo: spec.logo.map(|s| s.to_string()),
        icon: spec.icon.map(|s| s.to_string()),
        mark: spec.mark.map(|s| s.to_string()),
        installed: false,
        detected_auth: false,
        matched_email: None,
        resolved_path: None,
        enabled: spec.id != "shell",
        models: spec
            .models
            .iter()
            .map(|(id, name)| ModelChoice {
                id: (*id).to_string(),
                name: (*name).to_string(),
                enabled: true,
            })
            .collect(),
        hint: spec.hint.to_string(),
    }
}

/// Electron `mergeProviders(saved)` twin — catalog wins; preserves user toggles.
pub fn merge_providers(saved: Option<&[ProviderInfo]>) -> Vec<ProviderInfo> {
    let by_id: std::collections::HashMap<&str, &ProviderInfo> = saved
        .unwrap_or(&[])
        .iter()
        .map(|p| (p.id.as_str(), p))
        .collect();
    ENGINE_SPECS
        .iter()
        .map(|spec| {
            let mut base = default_provider(spec);
            let Some(prev) = by_id.get(spec.id) else {
                return base;
            };
            base.enabled = prev.enabled;
            base.installed = prev.installed;
            base.detected_auth = prev.detected_auth;
            base.matched_email = prev.matched_email.clone();
            base.resolved_path = prev.resolved_path.clone();
            base.models = spec
                .models
                .iter()
                .map(|(id, name)| {
                    let enabled = prev
                        .models
                        .iter()
                        .find(|m| m.id == *id)
                        .map(|m| m.enabled)
                        .unwrap_or(true);
                    ModelChoice {
                        id: (*id).to_string(),
                        name: (*name).to_string(),
                        enabled,
                    }
                })
                .collect();
            base
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_has_shell_and_grok() {
        assert!(spec_by_id("grok").is_some());
        assert!(spec_by_id("shell").is_some());
        assert_eq!(ENGINE_SPECS.len(), 13);
    }

    #[test]
    fn merge_preserves_enabled_and_model_flags() {
        let mut saved = default_provider(spec_by_id("grok").unwrap());
        saved.enabled = false;
        saved.models[0].enabled = false;
        let merged = merge_providers(Some(&[saved]));
        let grok = merged.iter().find(|p| p.id == "grok").unwrap();
        assert!(!grok.enabled);
        assert!(!grok.models[0].enabled);
        assert_eq!(merged.len(), ENGINE_SPECS.len());
        assert!(merged.iter().any(|p| p.id == "shell" && !p.enabled));
    }

    #[test]
    fn empty_merge_equals_defaults() {
        let a = merge_providers(None);
        let b: Vec<_> = ENGINE_SPECS.iter().map(default_provider).collect();
        assert_eq!(a, b);
    }
}
