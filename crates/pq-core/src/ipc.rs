//! IPC protocol stubs between pq-work and pq-voice (Phase 2 overnight slice).
//!
//! [`MemoryChannelStub`] is an **in-process test/demo stub only** — not production IPC.
//! Real transports later implement [`Transport`]: named pipe `\\.\pipe\pq-voice-{session}`
//! or loopback WebSocket `ws://127.0.0.1:<ephemeral>`.
//!
//! Work → voice: StartListen, Cancel
//! Voice → work: Transcript, Status

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Protocol version for future negotiation.
pub const PROTOCOL_VERSION: u32 = 1;

/// All framed messages (JSON lines over the pipe/WS).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum IpcMessage {
    /// work → voice: begin mic capture + STT.
    StartListen(StartListen),
    /// voice → work: partial or final transcript.
    Transcript(Transcript),
    /// work → voice: stop listening / abort in-flight STT.
    Cancel(Cancel),
    /// voice → work (or either): session / health status.
    Status(Status),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StartListen {
    /// Correlation id for this listen session.
    pub session_id: String,
    /// BCP-47 / Whisper language hint (desktop: "pl").
    #[serde(default = "default_lang")]
    pub language: String,
    /// Optional max listen duration in ms (0 = unlimited stub).
    #[serde(default)]
    pub timeout_ms: u64,
}

fn default_lang() -> String {
    "pl".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Transcript {
    pub session_id: String,
    pub text: String,
    /// ISO language tag reported by STT when known.
    #[serde(default)]
    pub lang: Option<String>,
    /// false = partial / hypothesis; true = final utterance.
    pub is_final: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Cancel {
    pub session_id: String,
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Status {
    /// Who is reporting (e.g. "pq-voice", "pq-work").
    pub source: String,
    pub state: VoiceState,
    #[serde(default)]
    pub detail: Option<String>,
    /// Optional listen session this status refers to.
    #[serde(default)]
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VoiceState {
    Idle,
    Listening,
    Processing,
    Ready,
    Error,
    Cancelled,
}

#[derive(Debug, Error)]
pub enum IpcError {
    #[error("serialize: {0}")]
    Serialize(String),
    #[error("deserialize: {0}")]
    Deserialize(String),
    #[error("stub not connected")]
    NotConnected,
    #[error("transport: {0}")]
    Transport(String),
    #[error("{0}")]
    Other(String),
}

/// Encode one message as a single JSON line (no trailing newline added by caller optionally).
pub fn encode_line(msg: &IpcMessage) -> Result<String, IpcError> {
    serde_json::to_string(msg).map_err(|e| IpcError::Serialize(e.to_string()))
}

/// Decode one JSON line into [`IpcMessage`].
pub fn decode_line(line: &str) -> Result<IpcMessage, IpcError> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Err(IpcError::Deserialize("empty line".into()));
    }
    serde_json::from_str(trimmed).map_err(|e| IpcError::Deserialize(e.to_string()))
}

/// Outbound sink used by stubs (work client / voice server).
pub trait IpcSink {
    fn send(&mut self, msg: IpcMessage) -> Result<(), IpcError>;
}

/// Inbound handler.
pub trait IpcHandler {
    fn on_message(&mut self, msg: IpcMessage) -> Result<(), IpcError>;
}

/// Future production transport (named pipe / WebSocket).
///
/// Phase 2 only provides [`MemoryChannelStub`] for compile-time demos and unit tests.
/// Do not treat the memory stub as the production IPC path.
pub trait Transport: IpcSink {
    /// Non-blocking poll for one inbound message (None = nothing ready).
    fn try_recv(&mut self) -> Result<Option<IpcMessage>, IpcError>;
    /// Human label for logs (`memory-stub`, `named-pipe`, `ws`).
    fn kind(&self) -> &'static str;
}

/// In-memory duplex for unit tests / Phase 2 demos **only** — not production IPC.
#[derive(Debug, Default)]
pub struct MemoryChannelStub {
    pub outbound: Vec<IpcMessage>,
    pub inbound: Vec<IpcMessage>,
}

impl IpcSink for MemoryChannelStub {
    fn send(&mut self, msg: IpcMessage) -> Result<(), IpcError> {
        self.outbound.push(msg);
        Ok(())
    }
}

impl Transport for MemoryChannelStub {
    fn try_recv(&mut self) -> Result<Option<IpcMessage>, IpcError> {
        if self.inbound.is_empty() {
            Ok(None)
        } else {
            Ok(Some(self.inbound.remove(0)))
        }
    }

    fn kind(&self) -> &'static str {
        "memory-stub"
    }
}

impl MemoryChannelStub {
    pub fn take_outbound(&mut self) -> Vec<IpcMessage> {
        std::mem::take(&mut self.outbound)
    }

    /// Queue a message as if it arrived from the peer (test helper).
    pub fn push_inbound(&mut self, msg: IpcMessage) {
        self.inbound.push(msg);
    }
}

/// Stub client living in **pq-work**: sends StartListen / Cancel; records Status / Transcript.
#[derive(Debug, Default)]
pub struct StubWorkClient {
    pub channel: MemoryChannelStub,
    pub last_status: Option<Status>,
    pub transcripts: Vec<Transcript>,
}

impl StubWorkClient {
    pub fn start_listen(&mut self, session_id: impl Into<String>) -> Result<(), IpcError> {
        self.channel.send(IpcMessage::StartListen(StartListen {
            session_id: session_id.into(),
            language: default_lang(),
            timeout_ms: 0,
        }))
    }

    pub fn cancel(
        &mut self,
        session_id: impl Into<String>,
        reason: Option<String>,
    ) -> Result<(), IpcError> {
        self.channel.send(IpcMessage::Cancel(Cancel {
            session_id: session_id.into(),
            reason,
        }))
    }

    /// Feed a message that arrived from voice (stub loopback).
    pub fn handle_from_voice(&mut self, msg: IpcMessage) -> Result<(), IpcError> {
        match msg {
            IpcMessage::Transcript(t) => {
                self.transcripts.push(t);
                Ok(())
            }
            IpcMessage::Status(s) => {
                self.last_status = Some(s);
                Ok(())
            }
            other => Err(IpcError::Other(format!(
                "work client unexpected inbound: {other:?}"
            ))),
        }
    }
}

/// Stub server living in **pq-voice**: handles StartListen / Cancel; emits Transcript / Status.
#[derive(Debug, Default)]
pub struct StubVoiceServer {
    pub channel: MemoryChannelStub,
    pub active_session: Option<String>,
}

impl StubVoiceServer {
    pub fn handle_from_work(&mut self, msg: IpcMessage) -> Result<(), IpcError> {
        match msg {
            IpcMessage::StartListen(s) => {
                self.active_session = Some(s.session_id.clone());
                self.channel.send(IpcMessage::Status(Status {
                    source: "pq-voice".into(),
                    state: VoiceState::Listening,
                    detail: Some(format!("lang={}", s.language)),
                    session_id: Some(s.session_id),
                }))
            }
            IpcMessage::Cancel(c) => {
                self.active_session = None;
                self.channel.send(IpcMessage::Status(Status {
                    source: "pq-voice".into(),
                    state: VoiceState::Cancelled,
                    detail: c.reason,
                    session_id: Some(c.session_id),
                }))
            }
            other => Err(IpcError::Other(format!(
                "voice server unexpected inbound: {other:?}"
            ))),
        }
    }

    /// Emit a fake final transcript for the active session (demo / tests).
    pub fn emit_stub_transcript(&mut self, text: impl Into<String>) -> Result<(), IpcError> {
        let session_id = self
            .active_session
            .clone()
            .ok_or_else(|| IpcError::Other("no active listen session".into()))?;
        self.channel.send(IpcMessage::Status(Status {
            source: "pq-voice".into(),
            state: VoiceState::Processing,
            detail: None,
            session_id: Some(session_id.clone()),
        }))?;
        self.channel.send(IpcMessage::Transcript(Transcript {
            session_id: session_id.clone(),
            text: text.into(),
            lang: Some("pl".into()),
            is_final: true,
        }))?;
        self.channel.send(IpcMessage::Status(Status {
            source: "pq-voice".into(),
            state: VoiceState::Idle,
            detail: Some("stub utterance done".into()),
            session_id: Some(session_id),
        }))?;
        self.active_session = None;
        Ok(())
    }
}

/// Round-trip work↔voice over memory stub channels (used by binaries + tests).
pub fn stub_loopback_demo() -> Result<(Vec<IpcMessage>, Vec<Transcript>), IpcError> {
    let mut work = StubWorkClient::default();
    let mut voice = StubVoiceServer::default();

    work.start_listen("sess-demo")?;
    for msg in work.channel.take_outbound() {
        voice.handle_from_work(msg)?;
    }
    voice.emit_stub_transcript("czesc pq")?;
    for msg in voice.channel.take_outbound() {
        work.handle_from_voice(msg)?;
    }

    Ok((work.channel.take_outbound(), work.transcripts.clone()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_roundtrip_all_variants() {
        let samples = vec![
            IpcMessage::StartListen(StartListen {
                session_id: "s1".into(),
                language: "pl".into(),
                timeout_ms: 5000,
            }),
            IpcMessage::Transcript(Transcript {
                session_id: "s1".into(),
                text: "hello".into(),
                lang: Some("pl".into()),
                is_final: true,
            }),
            IpcMessage::Cancel(Cancel {
                session_id: "s1".into(),
                reason: Some("user".into()),
            }),
            IpcMessage::Status(Status {
                source: "pq-voice".into(),
                state: VoiceState::Ready,
                detail: None,
                session_id: None,
            }),
        ];
        for msg in samples {
            let line = encode_line(&msg).unwrap();
            let back = decode_line(&line).unwrap();
            assert_eq!(msg, back);
        }
    }

    #[test]
    fn stub_loopback_produces_final_transcript() {
        let (_out, transcripts) = stub_loopback_demo().unwrap();
        assert_eq!(transcripts.len(), 1);
        assert_eq!(transcripts[0].text, "czesc pq");
        assert!(transcripts[0].is_final);
    }

    #[test]
    fn memory_stub_is_transport_not_production() {
        let mut ch = MemoryChannelStub::default();
        assert_eq!(ch.kind(), "memory-stub");
        ch.send(IpcMessage::Cancel(Cancel {
            session_id: "x".into(),
            reason: None,
        }))
        .unwrap();
        assert_eq!(ch.take_outbound().len(), 1);
        ch.push_inbound(IpcMessage::Status(Status {
            source: "t".into(),
            state: VoiceState::Idle,
            detail: None,
            session_id: None,
        }));
        assert!(ch.try_recv().unwrap().is_some());
        assert!(ch.try_recv().unwrap().is_none());
    }
}
