//! IPC protocol stubs between pq-work and pq-voice (Phase 2 overnight slice).
//!
//! [`MemoryChannelStub`] is an **in-process test/demo stub only** — not production IPC.
//! Transports implementing [`Transport`]: named pipe `\\.\pipe\pq-voice-{session}`
//! (real on Windows; stub elsewhere), `LocalTcpTransport`, or loopback WebSocket stand-in.
//!
//! Work → voice: StartListen, Cancel
//! Voice → work: Transcript, Status

use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream, ToSocketAddrs};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
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


/// Default loopback address for the Phase-2 TCP JSON-lines spike.
pub const DEFAULT_TCP_ADDR: &str = "127.0.0.1:4791";

/// Localhost TCP transport using the same JSON-line framing as future WS / named-pipe.
///
/// Spike for cross-process `IpcMessage` exchange (pq-work ↔ pq-voice). Not production WS;
/// WebSocket can wrap this codec later (`tungstenite`). Named pipe remains an alternate target.
pub struct LocalTcpTransport {
    stream: TcpStream,
    buf: Vec<u8>,
}

impl LocalTcpTransport {
    /// Accept one inbound connection (blocking listen).
    pub fn listen_once(addr: impl ToSocketAddrs) -> Result<Self, IpcError> {
        let listener = TcpListener::bind(addr).map_err(|e| IpcError::Transport(e.to_string()))?;
        listener
            .set_nonblocking(false)
            .map_err(|e| IpcError::Transport(e.to_string()))?;
        let (stream, peer) = listener
            .accept()
            .map_err(|e| IpcError::Transport(e.to_string()))?;
        let _ = peer;
        Self::from_stream(stream)
    }

    /// Connect to a peer that is already listening.
    pub fn connect(addr: impl ToSocketAddrs) -> Result<Self, IpcError> {
        let stream =
            TcpStream::connect(addr).map_err(|e| IpcError::Transport(e.to_string()))?;
        Self::from_stream(stream)
    }

    fn from_stream(stream: TcpStream) -> Result<Self, IpcError> {
        stream
            .set_nodelay(true)
            .map_err(|e| IpcError::Transport(e.to_string()))?;
        // Non-blocking reads for try_recv; writes still work.
        stream
            .set_nonblocking(true)
            .map_err(|e| IpcError::Transport(e.to_string()))?;
        stream
            .set_read_timeout(Some(Duration::from_millis(50)))
            .ok();
        Ok(Self {
            stream,
            buf: Vec::new(),
        })
    }

    /// Blocking read of exactly one JSON line (used by demos).
    pub fn recv_line_blocking(&mut self) -> Result<IpcMessage, IpcError> {
        self.stream
            .set_nonblocking(false)
            .map_err(|e| IpcError::Transport(e.to_string()))?;
        loop {
            if let Some(msg) = self.drain_one_line()? {
                let _ = self.stream.set_nonblocking(true);
                return Ok(msg);
            }
            let mut chunk = [0u8; 1024];
            let n = self
                .stream
                .read(&mut chunk)
                .map_err(|e| IpcError::Transport(e.to_string()))?;
            if n == 0 {
                let _ = self.stream.set_nonblocking(true);
                return Err(IpcError::Transport("peer closed".into()));
            }
            self.buf.extend_from_slice(&chunk[..n]);
        }
    }

    fn drain_one_line(&mut self) -> Result<Option<IpcMessage>, IpcError> {
        if let Some(pos) = self.buf.iter().position(|b| *b == b'\n') {
            let line = self.buf.drain(..=pos).collect::<Vec<u8>>();
            let s = String::from_utf8_lossy(&line);
            return Ok(Some(decode_line(&s)?));
        }
        Ok(None)
    }
}

impl IpcSink for LocalTcpTransport {
    fn send(&mut self, msg: IpcMessage) -> Result<(), IpcError> {
        let mut line = encode_line(&msg)?;
        line.push('\n');
        // Temporarily blocking write for reliability on nonblocking socket.
        self.stream
            .set_nonblocking(false)
            .map_err(|e| IpcError::Transport(e.to_string()))?;
        let res = self
            .stream
            .write_all(line.as_bytes())
            .and_then(|_| self.stream.flush());
        let _ = self.stream.set_nonblocking(true);
        res.map_err(|e| IpcError::Transport(e.to_string()))
    }
}

impl Transport for LocalTcpTransport {
    fn try_recv(&mut self) -> Result<Option<IpcMessage>, IpcError> {
        if let Some(msg) = self.drain_one_line()? {
            return Ok(Some(msg));
        }
        let mut chunk = [0u8; 1024];
        match self.stream.read(&mut chunk) {
            Ok(0) => Err(IpcError::Transport("peer closed".into())),
            Ok(n) => {
                self.buf.extend_from_slice(&chunk[..n]);
                self.drain_one_line()
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => Ok(None),
            Err(e) if e.kind() == std::io::ErrorKind::TimedOut => Ok(None),
            Err(e) => Err(IpcError::Transport(e.to_string())),
        }
    }

    fn kind(&self) -> &'static str {
        "localhost-tcp"
    }
}

/// Cross-thread / cross-process style demo over localhost TCP (unit-test friendly).
///
/// Spawns a voice-side thread that accepts StartListen and emits a stub transcript;
/// work-side connects and collects the final Transcript.
pub fn tcp_loopback_demo(addr: &str) -> Result<Vec<Transcript>, IpcError> {
    let listener = TcpListener::bind(addr).map_err(|e| IpcError::Transport(e.to_string()))?;
    let bound = listener
        .local_addr()
        .map_err(|e| IpcError::Transport(e.to_string()))?;
    let ready = Arc::new(Mutex::new(false));
    let ready_flag = Arc::clone(&ready);

    let voice_handle = thread::spawn(move || -> Result<(), IpcError> {
        {
            let mut g = ready_flag.lock().map_err(|e| IpcError::Other(e.to_string()))?;
            *g = true;
        }
        let (stream, _) = listener
            .accept()
            .map_err(|e| IpcError::Transport(e.to_string()))?;
        let mut transport = LocalTcpTransport::from_stream(stream)?;
        let mut server = StubVoiceServer::default();
        // Read StartListen
        let start = transport.recv_line_blocking()?;
        server.handle_from_work(start)?;
        for msg in server.channel.take_outbound() {
            transport.send(msg)?;
        }
        server.emit_stub_transcript("czesc tcp")?;
        for msg in server.channel.take_outbound() {
            transport.send(msg)?;
        }
        Ok(())
    });

    // Wait until listener thread is ready to accept
    for _ in 0..50 {
        if *ready.lock().map_err(|e| IpcError::Other(e.to_string()))? {
            break;
        }
        thread::sleep(Duration::from_millis(10));
    }

    let mut work_transport = LocalTcpTransport::connect(bound)?;
    let mut work = StubWorkClient::default();
    work.start_listen("sess-tcp")?;
    for msg in work.channel.take_outbound() {
        work_transport.send(msg)?;
    }

    // Collect until we see a final transcript or idle after transcript
    for _ in 0..40 {
        let msg = work_transport.recv_line_blocking()?;
        work.handle_from_voice(msg)?;
        if work.transcripts.iter().any(|t| t.is_final) {
            break;
        }
    }

    voice_handle
        .join()
        .map_err(|_| IpcError::Other("voice thread panicked".into()))??;

    Ok(work.transcripts)
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


/// Production pipe name prefix: `\\.\pipe\pq-voice-{session}`.
pub const PIPE_NAME_PREFIX: &str = r"\\.\pipe\pq-voice-";

/// Max session id length for pipe path safety.
pub const PIPE_SESSION_ID_MAX: usize = 64;

/// Sanitize a voice session id for use in a Windows named-pipe path.
///
/// Allows ASCII alphanumeric, `-`, `_` only (rejects path separators / spaces).
pub fn sanitize_pipe_session_id(session_id: &str) -> Result<&str, IpcError> {
    if session_id.is_empty() {
        return Err(IpcError::Other("empty pipe session id".into()));
    }
    if session_id.len() > PIPE_SESSION_ID_MAX {
        return Err(IpcError::Other(format!(
            "pipe session id longer than {PIPE_SESSION_ID_MAX}"
        )));
    }
    if !session_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(IpcError::Other(
            "pipe session id must be ASCII alphanumeric, '-' or '_'".into(),
        ));
    }
    Ok(session_id)
}

/// Build the Windows named-pipe path for a voice session id.
///
/// Panics are avoided: invalid ids return a best-effort path only via
/// [`named_pipe_path_checked`]. Prefer the checked variant for demos.
pub fn named_pipe_path(session_id: &str) -> String {
    format!("{PIPE_NAME_PREFIX}{session_id}")
}

/// Build pipe path after sanitizing the session id.
pub fn named_pipe_path_checked(session_id: &str) -> Result<String, IpcError> {
    let id = sanitize_pipe_session_id(session_id)?;
    Ok(named_pipe_path(id))
}

/// Windows named-pipe JSON-line transport (production intent for work ↔ voice).
///
/// On **Windows**, [`Self::listen`] / [`Self::connect`] open a real duplex byte pipe
/// at `\\.\pipe\pq-voice-{session}` and frame with [`encode_line`] / [`decode_line`].
/// On non-Windows, the type remains a compile-safe stub (`kind` = `named-pipe-stub`).
///
/// Default pipe ACL (creator default DACL) is OK for same-user local demos — not a
/// hardened multi-user security boundary.
pub struct NamedPipeTransport {
    /// Full pipe path, e.g. `\\.\pipe\pq-voice-sess1`.
    pub pipe_path: String,
    #[cfg(windows)]
    inner: Option<win_pipe::PipeInner>,
    #[cfg(not(windows))]
    connected: bool,
}

#[cfg(windows)]
mod win_pipe {
    use super::{decode_line, encode_line, IpcError, IpcMessage};
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle, RawHandle};
    use std::ptr;
    use std::time::Duration;

    type HANDLE = *mut std::ffi::c_void;
    type DWORD = u32;
    type BOOL = i32;

    const INVALID_HANDLE_VALUE: isize = -1;
    const PIPE_ACCESS_DUPLEX: DWORD = 0x0000_0003;
    const FILE_FLAG_FIRST_PIPE_INSTANCE: DWORD = 0x0008_0000;
    const PIPE_TYPE_BYTE: DWORD = 0x0000_0000;
    const PIPE_READMODE_BYTE: DWORD = 0x0000_0000;
    const PIPE_WAIT: DWORD = 0x0000_0000;
    const GENERIC_READ: DWORD = 0x8000_0000;
    const GENERIC_WRITE: DWORD = 0x4000_0000;
    const OPEN_EXISTING: DWORD = 3;
    const FILE_ATTRIBUTE_NORMAL: DWORD = 0x80;
    const ERROR_PIPE_CONNECTED: DWORD = 535;
    const ERROR_PIPE_BUSY: DWORD = 231;
    const ERROR_NO_DATA: DWORD = 232;
    const ERROR_BROKEN_PIPE: DWORD = 109;
    const ERROR_PIPE_NOT_CONNECTED: DWORD = 233;

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateNamedPipeW(
            name: *const u16,
            open_mode: DWORD,
            pipe_mode: DWORD,
            max_instances: DWORD,
            out_buf: DWORD,
            in_buf: DWORD,
            default_timeout: DWORD,
            security: *mut std::ffi::c_void,
        ) -> HANDLE;
        fn ConnectNamedPipe(handle: HANDLE, overlapped: *mut std::ffi::c_void) -> BOOL;
        fn CreateFileW(
            name: *const u16,
            access: DWORD,
            share: DWORD,
            security: *mut std::ffi::c_void,
            creation: DWORD,
            flags: DWORD,
            template: HANDLE,
        ) -> HANDLE;
        fn ReadFile(
            handle: HANDLE,
            buf: *mut u8,
            to_read: DWORD,
            read: *mut DWORD,
            overlapped: *mut std::ffi::c_void,
        ) -> BOOL;
        fn WriteFile(
            handle: HANDLE,
            buf: *const u8,
            to_write: DWORD,
            written: *mut DWORD,
            overlapped: *mut std::ffi::c_void,
        ) -> BOOL;
        fn PeekNamedPipe(
            handle: HANDLE,
            buf: *mut u8,
            buf_size: DWORD,
            bytes_read: *mut DWORD,
            total_avail: *mut DWORD,
            bytes_left: *mut DWORD,
        ) -> BOOL;
        fn FlushFileBuffers(handle: HANDLE) -> BOOL;
        fn WaitNamedPipeW(name: *const u16, timeout_ms: DWORD) -> BOOL;
        fn DisconnectNamedPipe(handle: HANDLE) -> BOOL;
        fn GetLastError() -> DWORD;
        fn CancelIoEx(handle: HANDLE, overlapped: *mut std::ffi::c_void) -> BOOL;
    }

    fn to_wide(path: &str) -> Vec<u16> {
        use std::os::windows::ffi::OsStrExt;
        std::ffi::OsStr::new(path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    fn last_err() -> String {
        format!("win32 error {}", unsafe { GetLastError() })
    }

    pub struct PipeInner {
        handle: OwnedHandle,
        buf: Vec<u8>,
        is_server: bool,
    }

    impl Drop for PipeInner {
        fn drop(&mut self) {
            if self.is_server {
                unsafe {
                    let _ = DisconnectNamedPipe(self.handle.as_raw_handle() as HANDLE);
                }
            }
        }
    }

    impl PipeInner {
        pub fn create_server(pipe_path: &str) -> Result<Self, IpcError> {
            let wide = to_wide(pipe_path);
            let handle = unsafe {
                CreateNamedPipeW(
                    wide.as_ptr(),
                    PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE,
                    PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
                    1,
                    4096,
                    4096,
                    5000,
                    ptr::null_mut(),
                )
            };
            if handle as isize == INVALID_HANDLE_VALUE {
                return Err(IpcError::Transport(format!(
                    "CreateNamedPipeW({pipe_path}): {}",
                    last_err()
                )));
            }
            let owned = unsafe { OwnedHandle::from_raw_handle(handle as RawHandle) };
            Ok(Self {
                handle: owned,
                buf: Vec::new(),
                is_server: true,
            })
        }

        pub fn accept(&mut self) -> Result<(), IpcError> {
            let ok = unsafe {
                ConnectNamedPipe(self.handle.as_raw_handle() as HANDLE, ptr::null_mut())
            };
            if ok == 0 {
                let err = unsafe { GetLastError() };
                if err != ERROR_PIPE_CONNECTED {
                    return Err(IpcError::Transport(format!(
                        "ConnectNamedPipe: win32 error {err}"
                    )));
                }
            }
            Ok(())
        }

        pub fn listen(pipe_path: &str) -> Result<Self, IpcError> {
            let mut s = Self::create_server(pipe_path)?;
            s.accept()?;
            Ok(s)
        }

        pub fn connect(pipe_path: &str, attempts: u32) -> Result<Self, IpcError> {
            let wide = to_wide(pipe_path);
            let mut last = String::new();
            for attempt in 1..=attempts {
                unsafe {
                    let _ = WaitNamedPipeW(wide.as_ptr(), 100);
                }
                let handle = unsafe {
                    CreateFileW(
                        wide.as_ptr(),
                        GENERIC_READ | GENERIC_WRITE,
                        0,
                        ptr::null_mut(),
                        OPEN_EXISTING,
                        FILE_ATTRIBUTE_NORMAL,
                        ptr::null_mut(),
                    )
                };
                if handle as isize != INVALID_HANDLE_VALUE {
                    let owned = unsafe { OwnedHandle::from_raw_handle(handle as RawHandle) };
                    return Ok(Self {
                        handle: owned,
                        buf: Vec::new(),
                        is_server: false,
                    });
                }
                let err = unsafe { GetLastError() };
                last = format!("CreateFileW attempt {attempt}: win32 error {err}");
                if err == ERROR_PIPE_BUSY || err == 2 {
                    std::thread::sleep(Duration::from_millis(25));
                    continue;
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(IpcError::Transport(last))
        }

        pub fn send(&mut self, msg: &IpcMessage) -> Result<(), IpcError> {
            let mut line = encode_line(msg)?;
            line.push('\n');
            let bytes = line.as_bytes();
            let mut written: DWORD = 0;
            let ok = unsafe {
                WriteFile(
                    self.handle.as_raw_handle() as HANDLE,
                    bytes.as_ptr(),
                    bytes.len() as DWORD,
                    &mut written,
                    ptr::null_mut(),
                )
            };
            if ok == 0 {
                return Err(IpcError::Transport(format!("WriteFile: {}", last_err())));
            }
            unsafe {
                let _ = FlushFileBuffers(self.handle.as_raw_handle() as HANDLE);
            }
            Ok(())
        }

        fn drain_one_line(&mut self) -> Result<Option<IpcMessage>, IpcError> {
            if let Some(pos) = self.buf.iter().position(|b| *b == b'\n') {
                let line = self.buf.drain(..=pos).collect::<Vec<u8>>();
                let s = String::from_utf8_lossy(&line);
                return Ok(Some(decode_line(&s)?));
            }
            Ok(None)
        }

        pub fn try_recv(&mut self) -> Result<Option<IpcMessage>, IpcError> {
            if let Some(msg) = self.drain_one_line()? {
                return Ok(Some(msg));
            }
            let mut avail: DWORD = 0;
            let peek_ok = unsafe {
                PeekNamedPipe(
                    self.handle.as_raw_handle() as HANDLE,
                    ptr::null_mut(),
                    0,
                    ptr::null_mut(),
                    &mut avail,
                    ptr::null_mut(),
                )
            };
            if peek_ok == 0 {
                let err = unsafe { GetLastError() };
                if err == ERROR_BROKEN_PIPE
                    || err == ERROR_PIPE_NOT_CONNECTED
                    || err == ERROR_NO_DATA
                {
                    return Err(IpcError::Transport("peer closed".into()));
                }
                return Ok(None);
            }
            if avail == 0 {
                return Ok(None);
            }
            let to_read = avail.min(4096);
            let mut chunk = vec![0u8; to_read as usize];
            let mut read: DWORD = 0;
            let ok = unsafe {
                ReadFile(
                    self.handle.as_raw_handle() as HANDLE,
                    chunk.as_mut_ptr(),
                    to_read,
                    &mut read,
                    ptr::null_mut(),
                )
            };
            if ok == 0 {
                let err = unsafe { GetLastError() };
                if err == ERROR_BROKEN_PIPE || err == ERROR_NO_DATA {
                    return Err(IpcError::Transport("peer closed".into()));
                }
                return Err(IpcError::Transport(format!("ReadFile: win32 error {err}")));
            }
            if read == 0 {
                return Err(IpcError::Transport("peer closed".into()));
            }
            self.buf.extend_from_slice(&chunk[..read as usize]);
            self.drain_one_line()
        }

        pub fn recv_line_blocking(&mut self) -> Result<IpcMessage, IpcError> {
            loop {
                if let Some(msg) = self.drain_one_line()? {
                    return Ok(msg);
                }
                let mut chunk = [0u8; 1024];
                let mut read: DWORD = 0;
                let ok = unsafe {
                    ReadFile(
                        self.handle.as_raw_handle() as HANDLE,
                        chunk.as_mut_ptr(),
                        chunk.len() as DWORD,
                        &mut read,
                        ptr::null_mut(),
                    )
                };
                if ok == 0 {
                    let err = unsafe { GetLastError() };
                    if err == ERROR_BROKEN_PIPE || err == ERROR_NO_DATA {
                        return Err(IpcError::Transport("peer closed".into()));
                    }
                    return Err(IpcError::Transport(format!("ReadFile: win32 error {err}")));
                }
                if read == 0 {
                    return Err(IpcError::Transport("peer closed".into()));
                }
                self.buf.extend_from_slice(&chunk[..read as usize]);
            }
        }
    }

    #[allow(dead_code)]
    fn _cancel_io(handle: &OwnedHandle) {
        unsafe {
            let _ = CancelIoEx(handle.as_raw_handle() as HANDLE, ptr::null_mut());
        }
    }
}

impl NamedPipeTransport {
    /// Prepare a client-side stub targeting `\\.\pipe\pq-voice-{session}` (no OS I/O).
    pub fn connect_stub(session_id: impl AsRef<str>) -> Self {
        Self {
            pipe_path: named_pipe_path(session_id.as_ref()),
            #[cfg(windows)]
            inner: None,
            #[cfg(not(windows))]
            connected: false,
        }
    }

    /// Prepare a server-side stub that would create the same pipe path (no OS I/O).
    pub fn listen_stub(session_id: impl AsRef<str>) -> Self {
        Self::connect_stub(session_id)
    }

    /// Mark stub as "connected" for contract tests (no OS pipe).
    pub fn mark_connected_for_test(&mut self) {
        #[cfg(not(windows))]
        {
            self.connected = true;
        }
        let _ = self;
    }

    pub fn is_connected(&self) -> bool {
        #[cfg(windows)]
        {
            self.inner.is_some()
        }
        #[cfg(not(windows))]
        {
            self.connected
        }
    }

    /// Server: create `\\.\pipe\pq-voice-{session}` and block until a client connects.
    #[cfg(windows)]
    pub fn listen(session_id: impl AsRef<str>) -> Result<Self, IpcError> {
        let path = named_pipe_path_checked(session_id.as_ref())?;
        let inner = win_pipe::PipeInner::listen(&path)?;
        Ok(Self {
            pipe_path: path,
            inner: Some(inner),
        })
    }

    /// Client: open an existing pipe (retries briefly while the server comes up).
    #[cfg(windows)]
    pub fn connect(session_id: impl AsRef<str>) -> Result<Self, IpcError> {
        let path = named_pipe_path_checked(session_id.as_ref())?;
        let inner = win_pipe::PipeInner::connect(&path, 80)?;
        Ok(Self {
            pipe_path: path,
            inner: Some(inner),
        })
    }

    #[cfg(not(windows))]
    pub fn listen(_session_id: impl AsRef<str>) -> Result<Self, IpcError> {
        Err(IpcError::Transport(
            "NamedPipeTransport::listen requires Windows".into(),
        ))
    }

    #[cfg(not(windows))]
    pub fn connect(_session_id: impl AsRef<str>) -> Result<Self, IpcError> {
        Err(IpcError::Transport(
            "NamedPipeTransport::connect requires Windows".into(),
        ))
    }

    /// Blocking read of exactly one JSON line (demos / tests).
    pub fn recv_line_blocking(&mut self) -> Result<IpcMessage, IpcError> {
        #[cfg(windows)]
        {
            self.inner
                .as_mut()
                .ok_or(IpcError::NotConnected)?
                .recv_line_blocking()
        }
        #[cfg(not(windows))]
        {
            let _ = self;
            Err(IpcError::Transport(
                "NamedPipeTransport stub: OS pipe I/O not available on this platform".into(),
            ))
        }
    }
}

impl IpcSink for NamedPipeTransport {
    fn send(&mut self, msg: IpcMessage) -> Result<(), IpcError> {
        #[cfg(windows)]
        {
            self.inner
                .as_mut()
                .ok_or(IpcError::NotConnected)?
                .send(&msg)
        }
        #[cfg(not(windows))]
        {
            if !self.connected {
                return Err(IpcError::NotConnected);
            }
            let _ = msg;
            Err(IpcError::Transport(
                "NamedPipeTransport stub: OS pipe I/O not implemented on this platform".into(),
            ))
        }
    }
}

impl Transport for NamedPipeTransport {
    fn try_recv(&mut self) -> Result<Option<IpcMessage>, IpcError> {
        #[cfg(windows)]
        {
            self.inner
                .as_mut()
                .ok_or(IpcError::NotConnected)?
                .try_recv()
        }
        #[cfg(not(windows))]
        {
            if !self.connected {
                return Err(IpcError::NotConnected);
            }
            Err(IpcError::Transport(
                "NamedPipeTransport stub: OS pipe I/O not implemented on this platform".into(),
            ))
        }
    }

    fn kind(&self) -> &'static str {
        #[cfg(windows)]
        {
            if self.inner.is_some() {
                "named-pipe"
            } else {
                "named-pipe-stub"
            }
        }
        #[cfg(not(windows))]
        {
            "named-pipe-stub"
        }
    }
}

/// Cross-thread named-pipe demo (Windows only). Unique session id; timeouts via join.
///
/// Non-Windows: returns a clear transport error so CI stays honest.
pub fn named_pipe_loopback_demo(session_id: &str) -> Result<Vec<Transcript>, IpcError> {
    let _ = sanitize_pipe_session_id(session_id)?;
    #[cfg(not(windows))]
    {
        let _ = session_id;
        return Err(IpcError::Transport(
            "named_pipe_loopback_demo requires Windows".into(),
        ));
    }
    #[cfg(windows)]
    {
        // Same-process CreateFile↔ConnectNamedPipe can deadlock on Windows; use a
        // short-lived PowerShell NamedPipeClientStream peer (cross-process).
        use std::process::{Command, Stdio};

        let session = session_id.to_string();
        let path = named_pipe_path_checked(&session)?;
        let pipe_leaf = format!("pq-voice-{session}");
        let session_server = session.clone();

        let server = thread::spawn(move || -> Result<Vec<Transcript>, IpcError> {
            // Rust listens as pq-voice; PowerShell connects as pq-work client.
            let mut transport = NamedPipeTransport::listen(&session_server)?;
            let mut server = StubVoiceServer::default();
            let start = transport.recv_line_blocking()?;
            server.handle_from_work(start)?;
            for msg in server.channel.take_outbound() {
                transport.send(msg)?;
            }
            server.emit_stub_transcript("czesc pipe")?;
            for msg in server.channel.take_outbound() {
                transport.send(msg)?;
            }
            // Return empty — transcripts are on the client (PS). We assert via exit code
            // and a side-channel file... Better: reverse roles.
            Ok(Vec::new())
        });

        // Give CreateNamedPipe + ConnectNamedPipe a moment (server thread).
        thread::sleep(Duration::from_millis(120));

        let ps = format!(
            r#"
$ErrorActionPreference = 'Stop'
$leaf = '{pipe_leaf}'
$c = New-Object System.IO.Pipes.NamedPipeClientStream('.', $leaf, [System.IO.Pipes.PipeDirection]::InOut)
$c.Connect(8000)
$sw = New-Object System.IO.StreamWriter($c)
$sw.NewLine = [string][char]10
$sw.AutoFlush = $true
$sr = New-Object System.IO.StreamReader($c)
$sw.WriteLine('{{"type":"start_listen","session_id":"{session}","language":"pl","timeout_ms":0}}')
$gotFinal = $false
$text = ''
for ($i = 0; $i -lt 20; $i++) {{
  $line = $sr.ReadLine()
  if ($null -eq $line) {{ break }}
  if ($line -match '"type":"transcript"' -and $line -match '"is_final":true') {{
    $gotFinal = $true
    if ($line -match '"text":"([^"]*)"') {{ $text = $Matches[1] }}
    break
  }}
}}
$c.Dispose()
if (-not $gotFinal) {{ throw "no final transcript" }}
Write-Output $text
"#
        );

        let out = Command::new("powershell")
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &ps])
            .stdin(Stdio::null())
            .output()
            .map_err(|e| IpcError::Transport(format!("powershell: {e}")))?;
        if !out.status.success() {
            return Err(IpcError::Transport(format!(
                "powershell client failed: {} {}",
                String::from_utf8_lossy(&out.stderr),
                String::from_utf8_lossy(&out.stdout)
            )));
        }
        let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let _ = path;
        let _ = server
            .join()
            .map_err(|_| IpcError::Other("server thread panicked".into()))??;

        Ok(vec![Transcript {
            session_id: session_id.to_string(),
            text,
            lang: Some("pl".into()),
            is_final: true,
        }])
    }
}

/// In-process duplex with **real** send/recv (JSON-line queue).
///
/// Stepping stone beyond [`NamedPipeTransport`] stub / before OS pipes:
/// two ends share opposite queues. Production named-pipe/WS will reuse the same
/// [`encode_line`] / [`decode_line`] framing.
#[derive(Debug, Clone)]
pub struct DuplexEndpoint {
    label: &'static str,
    inbound: Arc<Mutex<Vec<IpcMessage>>>,
    outbound: Arc<Mutex<Vec<IpcMessage>>>,
}

impl DuplexEndpoint {
    /// Create a connected pair `(a, b)` — a.send → b.try_recv and vice versa.
    pub fn pair(label: &'static str) -> (Self, Self) {
        let ab = Arc::new(Mutex::new(Vec::new()));
        let ba = Arc::new(Mutex::new(Vec::new()));
        (
            Self {
                label,
                inbound: ba.clone(),
                outbound: ab.clone(),
            },
            Self {
                label,
                inbound: ab,
                outbound: ba,
            },
        )
    }
}

impl IpcSink for DuplexEndpoint {
    fn send(&mut self, msg: IpcMessage) -> Result<(), IpcError> {
        self.outbound
            .lock()
            .map_err(|_| IpcError::Transport("duplex lock poisoned".into()))?
            .push(msg);
        Ok(())
    }
}

impl Transport for DuplexEndpoint {
    fn try_recv(&mut self) -> Result<Option<IpcMessage>, IpcError> {
        let mut q = self
            .inbound
            .lock()
            .map_err(|_| IpcError::Transport("duplex lock poisoned".into()))?;
        if q.is_empty() {
            return Ok(None);
        }
        Ok(Some(q.remove(0)))
    }

    fn kind(&self) -> &'static str {
        self.label
    }
}

/// Localhost JSON-lines over TCP, labeled as the **WS path stand-in**.
///
/// Real `ws://` framing (tungstenite) is deferred; this proves the same codec
/// on a loopback socket under a distinct `kind()` so demos/docs can say "WS later".
pub struct LocalWsTransport {
    inner: LocalTcpTransport,
}

impl LocalWsTransport {
    pub fn listen_once(addr: impl ToSocketAddrs) -> Result<Self, IpcError> {
        Ok(Self {
            inner: LocalTcpTransport::listen_once(addr)?,
        })
    }

    pub fn connect(addr: impl ToSocketAddrs) -> Result<Self, IpcError> {
        Ok(Self {
            inner: LocalTcpTransport::connect(addr)?,
        })
    }

    pub fn recv_line_blocking(&mut self) -> Result<IpcMessage, IpcError> {
        self.inner.recv_line_blocking()
    }
}

impl IpcSink for LocalWsTransport {
    fn send(&mut self, msg: IpcMessage) -> Result<(), IpcError> {
        self.inner.send(msg)
    }
}

impl Transport for LocalWsTransport {
    fn try_recv(&mut self) -> Result<Option<IpcMessage>, IpcError> {
        self.inner.try_recv()
    }

    fn kind(&self) -> &'static str {
        "ws-jsonlines-tcp"
    }
}



/// Shared e2e voice-IPC flow (work ↔ voice). Documents the typed sequence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VoiceIpcFlow {
    pub protocol: u32,
    pub session_id: String,
    pub language: String,
    pub transport: &'static str,
}

impl VoiceIpcFlow {
    pub fn tcp_demo(session_id: impl Into<String>) -> Self {
        Self {
            protocol: PROTOCOL_VERSION,
            session_id: session_id.into(),
            language: "pl".into(),
            transport: "localhost-tcp",
        }
    }

    /// Expected message kinds for one listen turn (work→voice then voice→work).
    pub fn expected_kinds(&self) -> &'static [&'static str] {
        &[
            "start_listen",
            "status", // listening
            "status", // processing
            "transcript",
            "status", // idle
        ]
    }
}

impl IpcMessage {
    pub fn kind_name(&self) -> &'static str {
        match self {
            IpcMessage::StartListen(_) => "start_listen",
            IpcMessage::Transcript(_) => "transcript",
            IpcMessage::Cancel(_) => "cancel",
            IpcMessage::Status(_) => "status",
        }
    }
}

/// Windows host binary name Electron will someday spawn.
pub const VOICE_EXE_NAME: &str = "pq-voice.exe";

/// How the Electron host will locate `pq-voice.exe` (doc + tests; no spawn).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VoiceHostSpawnPlan {
    pub exe_name: &'static str,
    pub default_args: &'static [&'static str],
    /// Relative candidates under the app / extraResources dir.
    pub search_rel: &'static [&'static str],
}

impl Default for VoiceHostSpawnPlan {
    fn default() -> Self {
        Self {
            exe_name: VOICE_EXE_NAME,
            default_args: &["--ipc-tcp"],
            search_rel: &[
                "pq-voice.exe",
                r"resources\pq-voice.exe",
                r"extraResources\pq-voice.exe",
            ],
        }
    }
}

/// Candidate paths for a future `child_process.spawn` of pq-voice.
pub fn voice_exe_candidates(app_dir: impl AsRef<std::path::Path>) -> Vec<std::path::PathBuf> {
    let plan = VoiceHostSpawnPlan::default();
    let root = app_dir.as_ref();
    plan.search_rel.iter().map(|rel| root.join(rel)).collect()
}

/// Self-contained `--ipc-demo` helper: LocalTcpTransport e2e on an ephemeral port.
pub fn local_tcp_ipc_demo() -> Result<Vec<Transcript>, IpcError> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| IpcError::Transport(e.to_string()))?;
    let addr = listener
        .local_addr()
        .map_err(|e| IpcError::Transport(e.to_string()))?;
    drop(listener);
    tcp_loopback_demo(&addr.to_string())
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

    #[test]
    fn localhost_tcp_loopback_produces_final_transcript() {
        // Bind ephemeral via :0 inside demo by using a free port.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let addr = format!("127.0.0.1:{port}");
        let transcripts = tcp_loopback_demo(&addr).unwrap();
        assert_eq!(transcripts.len(), 1);
        assert_eq!(transcripts[0].text, "czesc tcp");
        assert!(transcripts[0].is_final);
    }

    #[test]
    fn local_tcp_kind_label() {
        // Smoke: connect pair and check kind() without full demo.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let accept = std::thread::spawn(move || {
            let (s, _) = listener.accept().unwrap();
            LocalTcpTransport::from_stream(s).unwrap()
        });
        let mut client = LocalTcpTransport::connect(addr).unwrap();
        assert_eq!(client.kind(), "localhost-tcp");
        client
            .send(IpcMessage::Cancel(Cancel {
                session_id: "k".into(),
                reason: None,
            }))
            .unwrap();
        let mut server = accept.join().unwrap();
        let msg = server.recv_line_blocking().unwrap();
        assert!(matches!(msg, IpcMessage::Cancel(_)));
    }

    #[test]
    fn duplex_real_send_recv() {
        let (mut a, mut b) = DuplexEndpoint::pair("duplex");
        assert_eq!(a.kind(), "duplex");
        a.send(IpcMessage::Cancel(Cancel { session_id: "x".into(), reason: None })).unwrap();
        let got = b.try_recv().unwrap().expect("msg");
        match got {
            IpcMessage::Cancel(c) => assert_eq!(c.session_id, "x"),
            _ => panic!("wrong"),
        }
    }

    #[test]
    fn named_pipe_path_contract() {
        assert_eq!(
            named_pipe_path("sess-1"),
            r"\\.\pipe\pq-voice-sess-1"
        );
        assert!(sanitize_pipe_session_id("ok-1_2").is_ok());
        assert!(sanitize_pipe_session_id("../evil").is_err());
        assert!(sanitize_pipe_session_id("has space").is_err());
        let mut t = NamedPipeTransport::connect_stub("demo");
        assert_eq!(t.kind(), "named-pipe-stub");
        assert_eq!(t.pipe_path, r"\\.\pipe\pq-voice-demo");
        assert!(!t.is_connected());
        assert!(matches!(
            t.send(IpcMessage::Cancel(Cancel {
                session_id: "demo".into(),
                reason: None,
            })),
            Err(IpcError::NotConnected)
        ));
        #[cfg(not(windows))]
        {
            t.mark_connected_for_test();
            assert!(t.is_connected());
            assert!(matches!(t.try_recv(), Err(IpcError::Transport(_))));
        }
    }

    #[cfg(windows)]
    #[test]
    fn named_pipe_loopback_produces_final_transcript() {
        let session = format!(
            "t{}{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
                % 100000
        );
        let session2 = session.clone();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(named_pipe_loopback_demo(&session2));
        });
        let transcripts = rx
            .recv_timeout(std::time::Duration::from_secs(15))
            .expect("named_pipe_loopback_demo timed out (15s)")
            .expect("named_pipe_loopback_demo failed");
        assert_eq!(transcripts.len(), 1);
        assert_eq!(transcripts[0].text, "czesc pipe");
        assert!(transcripts[0].is_final);
    }

    #[cfg(not(windows))]
    #[test]
    fn named_pipe_loopback_honest_stub_off_windows() {
        let err = named_pipe_loopback_demo("sess-x").unwrap_err();
        assert!(matches!(err, IpcError::Transport(_)));
    }

    #[test]
    fn voice_ipc_flow_kinds_and_message_names() {
        let flow = VoiceIpcFlow::tcp_demo("sess-e2e");
        assert_eq!(flow.protocol, PROTOCOL_VERSION);
        assert_eq!(flow.transport, "localhost-tcp");
        assert_eq!(flow.expected_kinds()[0], "start_listen");
        assert_eq!(
            IpcMessage::StartListen(StartListen {
                session_id: "s".into(),
                language: "pl".into(),
                timeout_ms: 0,
            })
            .kind_name(),
            "start_listen"
        );
    }

    #[test]
    fn voice_host_spawn_candidates() {
        let plan = VoiceHostSpawnPlan::default();
        assert_eq!(plan.exe_name, "pq-voice.exe");
        assert_eq!(plan.default_args, &["--ipc-tcp"]);
        let c = voice_exe_candidates(r"C:\app");
        assert!(c.iter().any(|p| p.ends_with("pq-voice.exe")));
        assert_eq!(c.len(), 3);
    }

    #[test]
    fn local_tcp_ipc_demo_flag_e2e() {
        let transcripts = local_tcp_ipc_demo().unwrap();
        assert_eq!(transcripts.len(), 1);
        assert_eq!(transcripts[0].text, "czesc tcp");
        assert!(transcripts[0].is_final);
    }

}
