use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[serde(rename_all = "lowercase")]
pub enum EngineId {
    Grok,
    Omp,
    Hermes,
    Opencode,
    Codex,
    Claude,
    Qwen,
    Dsh,
    Gemini,
    Crush,
    Aider,
    Copilot,
    Shell,
}

impl EngineId {
    pub fn as_str(&self) -> &'static str {
        match self {
            EngineId::Grok => "grok",
            EngineId::Omp => "omp",
            EngineId::Hermes => "hermes",
            EngineId::Opencode => "opencode",
            EngineId::Codex => "codex",
            EngineId::Claude => "claude",
            EngineId::Qwen => "qwen",
            EngineId::Dsh => "dsh",
            EngineId::Gemini => "gemini",
            EngineId::Crush => "crush",
            EngineId::Aider => "aider",
            EngineId::Copilot => "copilot",
            EngineId::Shell => "shell",
        }
    }

    pub fn parse(raw: &str) -> Option<EngineId> {
        Some(match raw.trim().to_lowercase().as_str() {
            "grok" => EngineId::Grok,
            "omp" => EngineId::Omp,
            "hermes" => EngineId::Hermes,
            "opencode" => EngineId::Opencode,
            "codex" => EngineId::Codex,
            "claude" => EngineId::Claude,
            "qwen" => EngineId::Qwen,
            "dsh" => EngineId::Dsh,
            "gemini" => EngineId::Gemini,
            "crush" => EngineId::Crush,
            "aider" => EngineId::Aider,
            "copilot" => EngineId::Copilot,
            "shell" => EngineId::Shell,
            _ => return None,
        })
    }
}

pub const ENGINE_ORDER: &[EngineId] = &[
    EngineId::Grok,
    EngineId::Omp,
    EngineId::Hermes,
    EngineId::Opencode,
    EngineId::Codex,
    EngineId::Claude,
    EngineId::Qwen,
    EngineId::Dsh,
    EngineId::Gemini,
    EngineId::Crush,
    EngineId::Aider,
    EngineId::Copilot,
    EngineId::Shell,
];

impl std::fmt::Display for EngineId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

pub type LayoutId = u8;

pub const LAYOUTS: &[LayoutId] = &[1, 2, 3, 4, 6, 9];

pub fn layout_valid(l: LayoutId) -> bool {
    LAYOUTS.contains(&l)
}

pub fn pane_count(l: LayoutId) -> usize {
    l as usize
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum AuthProvider {
    Google,
    Local,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UserSession {
    pub email: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub picture: Option<String>,
    pub provider: AuthProvider,
    pub signed_in_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ModelChoice {
    pub id: String,
    pub name: String,
    pub enabled: bool,
}

impl ModelChoice {
    pub fn new(id: &str, name: &str) -> ModelChoice {
        ModelChoice {
            id: id.to_string(),
            name: name.to_string(),
            enabled: true,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    pub id: EngineId,
    pub name: String,
    pub vendor: String,
    pub command: String,
    pub args: Vec<String>,
    pub color: String,
    pub installed: bool,
    pub detected_auth: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matched_email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_path: Option<String>,
    pub enabled: bool,
    pub models: Vec<ModelChoice>,
    pub hint: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PaneState {
    pub id: String,
    pub engine: Option<EngineId>,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title_locked: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_handle: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub title: String,
    pub cwd: String,
    pub layout: LayoutId,
    pub panes: Vec<PaneState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zoomed_pane_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl Workspace {
    pub fn touch(&mut self) {
        self.updated_at = millis()
    }
}

pub fn clip_title(raw: &str, max: usize) -> String {
    let t: String = raw
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .filter(|c| !is_ctl(*c))
        .collect::<String>()
        .trim()
        .to_string();
    if t.is_empty() {
        return String::new();
    }
    if t.chars().count() > max {
        let mut out: String = t.chars().take(max.saturating_sub(1)).collect();
        out.push('…');
        out
    } else {
        t
    }
}

fn is_ctl(c: char) -> bool {
    (c as u32) < 0x20 || (c as u32) == 0x7f
}

pub fn is_default_pane_title(title: &str, engine_name: Option<&str>) -> bool {
    let t = title.trim();
    if t.is_empty() || t == "idle" {
        return true;
    }
    if t.to_lowercase().starts_with("pane ") {
        if t[5..].chars().all(|c| c.is_ascii_digit()) {
            return true;
        }
    }
    if let Some(name) = engine_name {
        if t.to_lowercase() == name.to_lowercase() {
            return true;
        }
    }
    false
}

pub fn looks_like_path_title(title: &str) -> bool {
    let t = title.trim();
    if t.is_empty() {
        return false;
    }
    let re_drive =
        regex::Regex::new(r"^[A-Za-z]:[\\/]").unwrap(); // [A-Za-z]:[\\/]
    if re_drive.is_match(t) {
        return true;
    }
    if (t.contains('/') || t.contains('\\'))
        && regex::Regex::new(r"\.(?:exe|cmd|bat|js|mjs|dll)$").unwrap().is_match(&t.to_lowercase())
    {
        return true;
    }
    false
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PanePatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub engine: Option<Option<EngineId>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title_locked: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GoogleOAuthConfig {
    pub client_id: String,
    pub client_secret: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub user: Option<UserSession>,
    pub google: GoogleOAuthConfig,
    pub workspaces: Vec<Workspace>,
    pub active_workspace_id: Option<String>,
    pub providers: Vec<ProviderInfo>,
    pub sidebar_open: bool,
}

impl AppSnapshot {
    pub fn active_ws(&self) -> Option<&Workspace> {
        self.workspaces
            .iter()
            .find(|w| Some(w.id.as_str()) == self.active_workspace_id.as_deref())
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SyncEvent {
    pub running: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<String>,
    pub line: String,
    pub done: usize,
    pub total: usize,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum BoardRelation {
    Independent,
    Related,
    Overlap,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BoardPane {
    pub pane_id: String,
    pub engine: EngineId,
    pub title: String,
    pub files: Vec<String>,
    pub alive: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BoardNote {
    pub relation: BoardRelation,
    pub engines: Vec<EngineId>,
    pub detail: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BoardSnapshot {
    pub cwd: String,
    pub board_path: String,
    pub updated_at: i64,
    pub panes: Vec<BoardPane>,
    pub git: Vec<String>,
    pub notes: Vec<BoardNote>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub enabled: bool,
    pub pin: String,
    pub port: u16,
    pub urls: Vec<String>,
    pub wan_url: Option<String>,
    pub tunnel: TunnelStatus,
    pub tunnel_error: String,
    pub clients: usize,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum TunnelStatus {
    Off,
    LocalOnly,
    Tunneled { name: String, addr: String, online_at: i64 },
    Restarting,
    Disabled,
}

impl TunnelStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            TunnelStatus::Off => "off",
            TunnelStatus::LocalOnly => "local",
            TunnelStatus::Tunneled { .. } => "tunneled",
            TunnelStatus::Restarting => "restarting",
            TunnelStatus::Disabled => "disabled",
        }
    }
}

pub fn board_relation() -> BoardRelation {
    BoardRelation::Independent
}

pub fn millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}