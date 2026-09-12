//! Remote hub sketch — Electron `src/main/remote.ts` (HTTP+WS `:4747`).
//!
//! Phase 1–2: Electron-parity types (RemoteInfo, WS events, pair limit, MIME). No real listener yet.
//! Phone pair / cloudflared / WS fan-out remain Electron until Phase 8.

use serde::{Deserialize, Serialize};

/// Default local remote control port (Electron `PORT = 4747`).
pub const DEFAULT_REMOTE_PORT: u16 = 4747;

/// cloudflared Windows amd64 download URL (Electron `CLOUDFLARED_URL`). Not fetched by Rust stub.
pub const CLOUDFLARED_WINDOWS_AMD64_URL: &str =
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";

/// WS / push event twin of Electron `broadcast({ e: ... })`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "e", rename_all = "camelCase")]
pub enum RemoteWsEvent {
    #[serde(rename = "state")]
    State {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        snapshot: Option<serde_json::Value>,
    },
    #[serde(rename = "term")]
    Term {
        #[serde(rename = "paneId")]
        pane_id: String,
        data: String,
    },
    #[serde(rename = "exit")]
    Exit {
        #[serde(rename = "paneId")]
        pane_id: String,
        code: i32,
    },
}

/// Pairing rate-limit sketch (Electron `pairFails` / `pairBlockedUntil`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PairRateLimit {
    pub fails: u32,
    /// Unix ms when pairing is unblocked (0 = not blocked).
    pub blocked_until_ms: i64,
}

impl PairRateLimit {
    pub fn register_fail(&mut self, now_ms: i64, max_fails: u32, block_ms: i64) {
        self.fails = self.fails.saturating_add(1);
        if self.fails >= max_fails {
            self.blocked_until_ms = now_ms.saturating_add(block_ms);
        }
    }

    pub fn is_blocked(&self, now_ms: i64) -> bool {
        self.blocked_until_ms > 0 && now_ms < self.blocked_until_ms
    }

    pub fn reset(&mut self) {
        self.fails = 0;
        self.blocked_until_ms = 0;
    }
}

/// MIME map twin of Electron `MIME` for static phone UI assets (lookup only).
pub fn mime_for_ext(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        ".html" | "html" => "text/html; charset=utf-8",
        ".js" | "js" => "text/javascript; charset=utf-8",
        ".css" | "css" => "text/css; charset=utf-8",
        ".json" | "json" => "application/json",
        ".svg" | "svg" => "image/svg+xml",
        ".png" | "png" => "image/png",
        ".woff2" | "woff2" => "font/woff2",
        ".map" | "map" => "application/json",
        _ => "application/octet-stream",
    }
}


/// Tunnel lifecycle twin of TS `RemoteInfo['tunnel']`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum TunnelState {
    #[default]
    Off,
    Starting,
    Up,
    Error,
}

/// Wire-facing remote status (TS `RemoteInfo`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub enabled: bool,
    pub pin: String,
    pub port: u16,
    pub urls: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wan_url: Option<String>,
    pub tunnel: TunnelState,
    #[serde(default)]
    pub tunnel_error: String,
    pub clients: u32,
}

impl Default for RemoteInfo {
    fn default() -> Self {
        Self {
            enabled: false,
            pin: String::new(),
            port: DEFAULT_REMOTE_PORT,
            urls: Vec::new(),
            wan_url: None,
            tunnel: TunnelState::Off,
            tunnel_error: String::new(),
            clients: 0,
        }
    }
}

/// Persist sketch (TS `Persist` in remote.ts) — token/pin/wan for relaunch.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct RemotePersist {
    pub enabled: bool,
    pub token: String,
    pub pin: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wan_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
}

/// Phone → hub command envelope (TS `RemoteCommand`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RemoteCommand {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub m: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub a: Option<Vec<serde_json::Value>>,
}

/// Compile-safe hub stub — documents surface; does not bind sockets.
#[derive(Debug, Default)]
pub struct RemoteHubStub {
    pub info: RemoteInfo,
    pub persist: RemotePersist,
    pub pair_limit: PairRateLimit,
}

impl RemoteHubStub {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_port(port: u16) -> Self {
        let mut s = Self::default();
        s.info.port = port;
        s
    }

    /// Documented bind address for a future listener (`127.0.0.1:4747` LAN bind later).
    pub fn listen_addr(&self) -> String {
        format!("0.0.0.0:{}", self.info.port)
    }

    pub fn set_enabled(&mut self, on: bool) {
        self.info.enabled = on;
        self.persist.enabled = on;
    }

    /// Record a failed PIN attempt (no I/O).
    pub fn note_pair_fail(&mut self, now_ms: i64) {
        self.pair_limit.register_fail(now_ms, 5, 30_000);
    }

    pub fn pair_blocked(&self, now_ms: i64) -> bool {
        self.pair_limit.is_blocked(now_ms)
    }

    /// Sketch of Electron `pushTerm` payload (does not send).
    pub fn term_event(pane_id: impl Into<String>, data: impl Into<String>) -> RemoteWsEvent {
        RemoteWsEvent::Term {
            pane_id: pane_id.into(),
            data: data.into(),
        }
    }

    pub fn exit_event(pane_id: impl Into<String>, code: i32) -> RemoteWsEvent {
        RemoteWsEvent::Exit {
            pane_id: pane_id.into(),
            code,
        }
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_port_4747() {
        let h = RemoteHubStub::new();
        assert_eq!(h.info.port, DEFAULT_REMOTE_PORT);
        assert_eq!(h.listen_addr(), "0.0.0.0:4747");
    }

    #[test]
    fn remote_info_roundtrip() {
        let info = RemoteInfo {
            enabled: true,
            pin: "123456".into(),
            port: 4747,
            urls: vec!["http://192.168.0.10:4747".into()],
            wan_url: Some("https://x.trycloudflare.com".into()),
            tunnel: TunnelState::Up,
            tunnel_error: String::new(),
            clients: 1,
        };
        let raw = serde_json::to_string(&info).unwrap();
        let back: RemoteInfo = serde_json::from_str(&raw).unwrap();
        assert_eq!(back, info);
    }

    #[test]
    fn remote_command_shape() {
        let raw = r#"{"m":"type","a":["hello"],"id":"1"}"#;
        let c: RemoteCommand = serde_json::from_str(raw).unwrap();
        assert_eq!(c.m, "type");
        assert_eq!(c.id.as_deref(), Some("1"));
    }

    #[test]
    fn ws_event_term_roundtrip() {
        let ev = RemoteHubStub::term_event("p1", "hi");
        let raw = serde_json::to_string(&ev).unwrap();
        assert!(raw.contains("\"e\":\"term\"") || raw.contains("\"e\": \"term\""));
        let back: RemoteWsEvent = serde_json::from_str(&raw).unwrap();
        assert_eq!(back, ev);
    }

    #[test]
    fn mime_and_cloudflared_const() {
        assert!(mime_for_ext(".html").starts_with("text/html"));
        assert!(CLOUDFLARED_WINDOWS_AMD64_URL.contains("cloudflared-windows-amd64.exe"));
    }

    #[test]
    fn pair_rate_limit() {
        let mut h = RemoteHubStub::new();
        for _ in 0..5 {
            h.note_pair_fail(1_000);
        }
        assert!(h.pair_blocked(1_001));
        assert!(!h.pair_blocked(50_000));
    }
}
