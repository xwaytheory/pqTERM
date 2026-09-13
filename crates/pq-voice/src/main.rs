//! pq-voice — voice assistant process (Phase 2 stub).
//!
//! STT INTENT (not runtime lock): Whisper Large v3 for Polish when ported.
//! Model: openai/whisper-large-v3 (GGML: ggml-large-v3.bin), language=pl.
//! Electron today still uses Xenova/whisper-tiny in voiceCommander.ts — upgrade on port.
//!
//! Pipeline: `--listen` runs the listen/transcribe skeleton (probe AppData GGML;
//! never downloads the ~3.1 GB file). IPC: StubVoiceServer + `--ipc-tcp` / `--ipc-demo`.

use pq_core::ipc::{
    local_tcp_ipc_demo, IpcMessage, IpcSink, LocalTcpTransport, StubVoiceServer, Transport,
    VoiceIpcFlow, DEFAULT_TCP_ADDR, PROTOCOL_VERSION,
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
    if args.iter().any(|a| a == "--ipc-demo") {
        if let Err(e) = run_ipc_demo() {
            eprintln!("ipc-demo: {e}");
            std::process::exit(1);
        }
        return;
    }
    if args.iter().any(|a| a == "--listen" || a == "--pipeline") {
        run_listen_cli();
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
    let probe = stt::probe_ggml_model();
    println!("{}", stt::model_status_message(&probe));
    if !probe.is_present() {
        println!("Tip: pq-voice --listen  (same probe; no download)");
    }
    println!("IPC protocol v{PROTOCOL_VERSION}: StubVoiceServer ready");
    println!("Tip: pq-voice --ipc-demo  (in-process LocalTcpTransport e2e)");
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

fn run_listen_cli() {
    println!("pq-voice {WORKSPACE_VERSION} listen/transcribe skeleton");
    println!("STT INTENT: {} lang={} — no whisper.cpp yet", stt::MODEL_ID, stt::LANGUAGE);
    let result = stt::run_listen_transcribe_skeleton("listen-cli");
    for ev in &result.events {
        println!("[{:?}] {}", ev.stage, ev.detail);
    }
    let _ = std::io::Write::flush(&mut std::io::stdout());
    if result.ok {
        println!("pipeline ok (model present; inference unwired)");
    } else {
        println!("pipeline failed: model not usable — no download attempted");
        std::process::exit(2);
    }
}

fn run_ipc_demo() -> Result<(), Box<dyn std::error::Error>> {
    let flow = VoiceIpcFlow::tcp_demo("sess-tcp");
    println!(
        "pq-voice {WORKSPACE_VERSION} --ipc-demo protocol={} transport={} session={}",
        flow.protocol, flow.transport, flow.session_id
    );
    println!("expected kinds: {:?}", flow.expected_kinds());
    let probe = stt::probe_ggml_model();
    println!("{}", stt::model_status_message(&probe));
    let transcripts = local_tcp_ipc_demo()?;
    for t in &transcripts {
        println!("transcript final={} lang={:?} text={:?}", t.is_final, t.lang, t.text);
    }
    println!("ipc-demo ok (LocalTcpTransport e2e)");
    Ok(())
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
             --listen                Probe AppData GGML + listen/transcribe skeleton\n\
                                     (no multi-GB download)\n\
             --ipc-demo              In-process LocalTcpTransport e2e (shared IPC types)\n\
             --ipc-tcp [ADDR]        Connect to pq-work TCP JSON-lines spike\n\
                                     (default {DEFAULT_TCP_ADDR})\n\n\
         STT INTENT: Whisper Large v3 (Polish). CURRENT Electron: Xenova/whisper-tiny.\n\
         Missing {ggml} is printed clearly; overnight never fetches it.\n\
         IPC: MemoryChannelStub + LocalTcpTransport spike — docs/PORT-MAP.md / VOICE-HOST-BRIDGE.md.",
        ggml = stt::GGML_FILENAME
    );
}
