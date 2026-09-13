use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};

use crate::shared::{EngineId, ModelChoice, ProviderInfo};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EngineSpec {
    pub id: EngineId,
    pub name: String,
    pub vendor: String,
    pub color: String,
    pub binaries: Vec<String>,
    pub args: Vec<String>,
    pub hint: String,
    pub models: Vec<ModelChoice>,
    pub extra_path_dirs: Vec<String>,
    /// flag prefix that selects a model, e.g. ["--model"] or ["-m"]
    pub model_flag: Option<Vec<String>>,
    pub npm_package: Option<String>,
    pub pip_package: Option<String>,
    pub self_update: Option<Vec<String>>,
}

impl EngineSpec {
    pub fn model_flag_args(&self, model_id: &str) -> Vec<String> {
        match &self.model_flag {
            Some(prefix) => {
                let mut v = prefix.clone();
                v.push(model_id.to_string());
                v
            }
            None => Vec::new(),
        }
    }
}

fn mc(id: &str, name: &str) -> ModelChoice {
    ModelChoice::new(id, name)
}

pub static ENGINE_SPECS: Lazy<Vec<EngineSpec>> = Lazy::new(|| {
    vec![
        EngineSpec {
            id: EngineId::Grok,
            name: "Grok CLI".into(),
            vendor: "xAI".into(),
            color: "#39ffb6".into(),
            binaries: vec!["grok".into(), "grok.exe".into()],
            args: vec!["--always-approve".into(), "--trust".into()],
            hint: "Grok Build TUI — sesja lokalna z ~/.grok".into(),
            extra_path_dirs: vec![r"%USERPROFILE%\.grok\bin".into()],
            models: vec![
                mc("grok-4.6", "Grok 4.6"),
                mc("grok-4.5", "Grok 4.5"),
                mc("grok-4-fast", "Grok 4 Fast"),
                mc("grok-code", "Grok Code"),
            ],
            model_flag: Some(vec!["-m".into()]),
            npm_package: None,
            pip_package: None,
            self_update: Some(vec!["update".into()]),
        },
        EngineSpec {
            id: EngineId::Omp,
            name: "Omp".into(),
            vendor: "oh-my-pi".into(),
            color: "#c084fc".into(),
            binaries: vec!["omp".into(), "omp.cmd".into()],
            args: vec!["--yolo".into()],
            hint: "Oh My Pi — open-source terminal coding agent".into(),
            extra_path_dirs: vec![r"%APPDATA%\npm".into()],
            models: vec![
                mc("anthropic/claude-sonnet-4", "Sonnet 4"),
                mc("openai/gpt-5", "GPT-5"),
                mc("xai/grok-4", "Grok 4"),
                mc("google/gemini-2.5-pro", "Gemini 2.5 Pro"),
                mc("zhipuai/glm-4.7", "GLM 4.7"),
                mc("deepseek/deepseek-chat", "DeepSeek"),
            ],
            model_flag: Some(vec!["--model".into()]),
            npm_package: Some("@oh-my-pi/pi-coding-agent".into()),
            pip_package: None,
            self_update: Some(vec!["update".into()]),
        },
        EngineSpec {
            id: EngineId::Hermes,
            name: "Hermes".into(),
            vendor: "Nous / Hermes".into(),
            color: "#f5c542".into(),
            binaries: vec!["hermes".into(), "hermes.cmd".into()],
            args: vec!["--tui".into(), "--yolo".into()],
            hint: "Hermes agent CLI (TUI)".into(),
            extra_path_dirs: vec![r"%LOCALAPPDATA%\hermes\bin".into()],
            models: vec![mc("hermes-default", "Hermes default"), mc("hermes-large", "Hermes large")],
            model_flag: Some(vec!["-m".into()]),
            npm_package: None,
            pip_package: None,
            self_update: None,
        },
        EngineSpec {
            id: EngineId::Opencode,
            name: "OpenCode".into(),
            vendor: "OpenCode".into(),
            color: "#7aa2ff".into(),
            binaries: vec!["opencode".into(), "opencode.cmd".into()],
            args: vec!["--yolo".into()],
            hint: "OpenCode TUI — konta i klucze z lokalnej sesji".into(),
            extra_path_dirs: vec![r"%APPDATA%\npm".into()],
            models: vec![
                mc("opencode-default", "OpenCode default"),
                mc("anthropic/claude-sonnet-4", "Sonnet 4"),
                mc("openai/gpt-5", "GPT-5"),
                mc("xai/grok-4", "Grok 4"),
                mc("zhipuai/glm-4.7", "GLM 4.7"),
                mc("deepseek/deepseek-chat", "DeepSeek"),
            ],
            model_flag: Some(vec!["--model".into()]),
            npm_package: Some("opencode-ai".into()),
            pip_package: None,
            self_update: Some(vec!["upgrade".into()]),
        },
        EngineSpec {
            id: EngineId::Codex,
            name: "Codex".into(),
            vendor: "OpenAI".into(),
            color: "#9ae6b4".into(),
            binaries: vec!["codex".into(), "codex.cmd".into()],
            args: vec!["--yolo".into()],
            hint: "OpenAI Codex CLI".into(),
            extra_path_dirs: vec![r"%APPDATA%\npm".into()],
            models: vec![
                mc("gpt-5.6-sol", "GPT-5.6 Sol"),
                mc("gpt-5.5", "GPT-5.5"),
                mc("gpt-5.4", "GPT-5.4"),
                mc("codex-mini", "Codex mini"),
            ],
            model_flag: Some(vec!["--model".into()]),
            npm_package: Some("@openai/codex".into()),
            pip_package: None,
            self_update: None,
        },
        EngineSpec {
            id: EngineId::Claude,
            name: "Claude Code".into(),
            vendor: "Anthropic".into(),
            color: "#d4a574".into(),
            binaries: vec!["claude".into(), "claude.cmd".into()],
            args: vec!["--dangerously-skip-permissions".into()],
            hint: "Claude Code TUI".into(),
            extra_path_dirs: vec![r"%APPDATA%\npm".into()],
            models: vec![
                mc("claude-sonnet-4", "Sonnet 4"),
                mc("claude-opus-4", "Opus 4"),
                mc("claude-haiku-4", "Haiku 4"),
            ],
            model_flag: Some(vec!["--model".into()]),
            npm_package: Some("@anthropic-ai/claude-code".into()),
            pip_package: None,
            self_update: Some(vec!["update".into()]),
        },
        EngineSpec {
            id: EngineId::Qwen,
            name: "Qwen Code".into(),
            vendor: "Alibaba / Qwen".into(),
            color: "#7c5cff".into(),
            binaries: vec!["qwen".into(), "qwen.cmd".into()],
            args: vec!["--yolo".into()],
            hint: "Qwen Code — OSS agent (Qwen + OpenAI/Anthropic/Gemini compatible)".into(),
            extra_path_dirs: vec![r"%APPDATA%\npm".into()],
            models: vec![mc("qwen3-coder-plus", "Qwen3 Coder Plus"), mc("qwen3.6-plus", "Qwen3.6 Plus")],
            model_flag: Some(vec!["--model".into()]),
            npm_package: Some("@qwen-code/qwen-code".into()),
            pip_package: None,
            self_update: None,
        },
        EngineSpec {
            id: EngineId::Dsh,
            name: "DeepSeek Harness".into(),
            vendor: "DeepSeek".into(),
            color: "#4cc9f0".into(),
            binaries: vec!["dsh".into(), "dsh.cmd".into()],
            args: vec!["--profile".into(), "tui".into()],
            hint: "dsh — oficjalny OSS harness DeepSeek (TUI profile)".into(),
            extra_path_dirs: vec![r"%APPDATA%\npm".into()],
            models: vec![mc("deepseek-v4-pro", "DeepSeek V4 Pro"), mc("deepseek-v4-flash", "DeepSeek V4 Flash")],
            model_flag: Some(vec!["--model".into()]),
            npm_package: Some("@deepseek-ai/dsh".into()),
            pip_package: None,
            self_update: None,
        },
        EngineSpec {
            id: EngineId::Gemini,
            name: "Gemini CLI".into(),
            vendor: "Google".into(),
            color: "#4285f4".into(),
            binaries: vec!["gemini".into(), "gemini.cmd".into()],
            args: vec!["--yolo".into(), "--skip-trust".into()],
            hint: "Gemini CLI (OSS). Consumer Gemini CLI jest wygaszany — zostawiamy binarkę jeśli działa.".into(),
            extra_path_dirs: vec![r"%APPDATA%\npm".into()],
            models: vec![mc("gemini-2.5-pro", "Gemini 2.5 Pro"), mc("gemini-2.5-flash", "Gemini 2.5 Flash")],
            model_flag: Some(vec!["--model".into()]),
            npm_package: Some("@google/gemini-cli".into()),
            pip_package: None,
            self_update: None,
        },
        EngineSpec {
            id: EngineId::Crush,
            name: "Crush".into(),
            vendor: "Charmbracelet".into(),
            color: "#ff387b".into(),
            binaries: vec!["crush".into(), "crush.cmd".into()],
            args: vec![],
            hint: "Crush — OSS TUI Charmbracelet, multi-provider".into(),
            extra_path_dirs: vec![r"%APPDATA%\npm".into()],
            models: vec![],
            model_flag: None,
            npm_package: Some("@charmland/crush".into()),
            pip_package: None,
            self_update: None,
        },
        EngineSpec {
            id: EngineId::Aider,
            name: "Aider".into(),
            vendor: "Aider-AI".into(),
            color: "#e8c547".into(),
            binaries: vec!["aider".into(), "aider.exe".into()],
            args: vec!["--yes".into()],
            hint: "Aider — git-native OSS pair programmer (pip)".into(),
            extra_path_dirs: vec![r"%APPDATA%\Python".into(), r"%LOCALAPPDATA%\Programs\Python".into()],
            models: vec![],
            model_flag: None,
            npm_package: None,
            pip_package: Some("aider-chat".into()),
            self_update: None,
        },
        EngineSpec {
            id: EngineId::Copilot,
            name: "Copilot CLI".into(),
            vendor: "GitHub".into(),
            color: "#f0f6fc".into(),
            binaries: vec!["copilot".into(), "copilot.cmd".into()],
            args: vec!["--yolo".into()],
            hint: "GitHub Copilot CLI".into(),
            extra_path_dirs: vec![r"%APPDATA%\npm".into()],
            models: vec![],
            model_flag: None,
            npm_package: Some("@github/copilot".into()),
            pip_package: None,
            self_update: None,
        },
        EngineSpec {
            id: EngineId::Shell,
            name: "PowerShell".into(),
            vendor: "Windows".into(),
            color: "#5b9fd6".into(),
            binaries: vec!["pwsh".into(), "powershell".into()],
            args: vec!["-NoLogo".into()],
            hint: "Czysty shell — bez agenta".into(),
            extra_path_dirs: vec![],
            models: vec![],
            model_flag: None,
            npm_package: None,
            pip_package: None,
            self_update: None,
        },
    ]
});

pub fn spec_by_id(id: EngineId) -> &'static EngineSpec {
    ENGINE_SPECS.iter().find(|s| s.id == id).expect("unknown engine")
}

pub fn default_provider(spec: &EngineSpec) -> ProviderInfo {
    ProviderInfo {
        id: spec.id,
        name: spec.name.clone(),
        vendor: spec.vendor.clone(),
        command: spec.binaries[0].clone(),
        args: spec.args.clone(),
        color: spec.color.clone(),
        installed: false,
        detected_auth: false,
        matched_email: None,
        resolved_path: None,
        enabled: spec.id != EngineId::Shell,
        models: spec.models.clone(),
        hint: spec.hint.clone(),
    }
}

/// fuzzy engine matching used by parseEngine in the old main process
pub fn parse_engine(raw: &str) -> Option<EngineId> {
    let t = raw.trim();
    let lowered = t.to_lowercase();
    if let Some(id) = EngineId::parse(&lowered) {
        return Some(id);
    }
    let compact: String = lowered
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '_' && *c != '-')
        .collect();
    for spec in ENGINE_SPECS.iter() {
        let name_compact: String = spec
            .name
            .to_lowercase()
            .chars()
            .filter(|c| !c.is_whitespace() && *c != '_' && *c != '-')
            .collect();
        if spec.id.as_str() == compact || name_compact == compact {
            return Some(spec.id);
        }
    }
    None
}