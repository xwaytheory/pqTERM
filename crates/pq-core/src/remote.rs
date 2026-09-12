//! Remote hub sketch — Electron `src/main/remote.ts` (HTTP+WS `:4747`).
//!
//! Phase 1–2: types + port/constants + serde for `RemoteInfo`. No real listener yet.
//! Phone pair / cloudflared / WS fan-out remain Electron until Phase 8.

use serde::{Deserialize, Serialize};

/// Default local remote control port (Electron `PORT = 4747`).
pub const DEFAULT_REMOTE_PORT: u16 = 4747;

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
}
