//! pq-voice — voice assistant process (Phase 2 stub).
//!
//! STT INTENT (not runtime lock): Whisper Large v3 for Polish when ported.
//! Model: openai/whisper-large-v3 (GGML: ggml-large-v3.bin), language=pl.
//! Electron today still uses Xenova/whisper-tiny in voiceCommander.ts — upgrade on port.
//!
//! IPC: owns StubVoiceServer (handles StartListen / Cancel; emits Transcript / Status).
//! Spike: `--ipc-tcp [addr]` connects to pq-work localhost TCP JSON-lines (Transport spike, not prod).

use pq_core::ipc::{
    IpcMessage, IpcSink, LocalTcpTransport, StubVoiceServer, Transport, DEFAULT_TCP_ADDR,
    PROTOCOL_VERSION,
};
use pq_core::stt;
use pq_core::WORKSPACE_VERSION;
use std::thread;
use std::time::Duration;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "-h" || a == "--help") {
        print_help();
        return;
    }
    if args.iter().any(|a| a == "-V" || a == "--version") {
        println!("pq-voice {WORKSPACE_VERSION}");
        return;
    }
    if let Some(addr) = ipc_tcp_addr(&args) {
        if let Err(e) = run_ipc_tcp_demo(&addr) {
            eprintln!("ipc-tcp: {e}");
            std::process::exit(1);
        }
        return;
    }

    println!("pq-voice {WORKSPACE_VERSION} (Phase 2 stub)");
    println!("STT target: {} ({})", stt::MODEL_ID, stt::GGML_FILENAME);
    println!("language: {}", stt::LANGUAGE);
    println!("{}", stt::RATIONALE);
    match stt::intended_ggml_path() {
        Some(p) => println!("GGML intended path: {}", p.display()),
        None => println!("GGML intended path: (no AppData)"),
    }
    println!("{}", stt::GGML_MEMORY_NOTE);
    match stt::ensure_ggml_model(false) {
        Ok(p) => println!("GGML present: {}", p.display()),
        Err(e) => println!("GGML ensure (no download): {e}"),
    }
    println!("IPC protocol v{PROTOCOL_VERSION}: StubVoiceServer ready");
    println!("Tip: pq-voice --ipc-tcp  (after pq-work --ipc-tcp) for localhost TCP spike");

    let mut server = StubVoiceServer::default();
    let start = IpcMessage::StartListen(pq_core::ipc::StartListen {
        session_id: "boot-probe".into(),
        language: stt::LANGUAGE.into(),
        timeout_ms: 0,
    });
    match server.handle_from_work(start) {
        Ok(()) => {
            let _ = server.emit_stub_transcript("probe");
            println!(
                "ipc stub: handled StartListen + stub transcript ({} outbound)",
                server.channel.outbound.len()
            );
        }
        Err(e) => eprintln!("ipc stub: {e}"),
    }
}

fn ipc_tcp_addr(args: &[String]) -> Option<String> {
    for (i, a) in args.iter().enumerate() {
        if a == "--ipc-tcp" {
            return Some(
                args
                    .get(i + 1)
                    .cloned()
                    .unwrap_or_else(|| DEFAULT_TCP_ADDR.to_string()),
            );
        }
    }
    None
}

/// Connect as voice side; handle StartListen; emit stub transcript over TCP.
fn run_ipc_tcp_demo(addr: &str) -> Result<(), Box<dyn std::error::Error>> {
    println!("pq-voice {WORKSPACE_VERSION} ipc-tcp connect {addr}");
    let mut transport = None;
    for attempt in 1..=40 {
        match LocalTcpTransport::connect(addr) {
            Ok(t) => {
                transport = Some(t);
                break;
            }
            Err(e) => {
                if attempt == 40 {
                    return Err(e.into());
                }
                thread::sleep(Duration::from_millis(100));
            }
        }
    }
    let mut transport = transport.expect("connected");
    println!("connected ({})", transport.kind());

    let mut server = StubVoiceServer::default();
    let start = transport.recv_line_blocking()?;
    println!("← {start:?}");
    server.handle_from_work(start)?;
    for msg in server.channel.take_outbound() {
        println!("→ {msg:?}");
        transport.send(msg)?;
    }
    server.emit_stub_transcript("czesc z tcp")?;
    for msg in server.channel.take_outbound() {
        println!("→ {msg:?}");
        transport.send(msg)?;
    }
    println!("ipc-tcp demo ok");
    Ok(())
}

fn print_help() {
    println!(
        "pq-voice {WORKSPACE_VERSION}\n\n\
         USAGE:\n\
             pq-voice [OPTIONS]\n\n\
         OPTIONS:\n\
             -h, --help              Show help\n\
             -V, --version           Show version\n\
             --ipc-tcp [ADDR]        Connect to pq-work TCP JSON-lines spike\n\
                                     (default {DEFAULT_TCP_ADDR})\n\n\
         STT INTENT: Whisper Large v3 (Polish). CURRENT Electron: Xenova/whisper-tiny.\n\
         IPC: MemoryChannelStub + LocalTcpTransport spike — docs/PORT-MAP.md / pq_core::ipc."
    );
}
