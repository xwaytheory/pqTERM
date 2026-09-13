//! pq-voice — voice assistant process (Phase 2 stub).
//!
//! STT INTENT (not runtime lock): Whisper Large v3 for Polish when ported.
//! Model: openai/whisper-large-v3 (GGML: ggml-large-v3.bin), language=pl.
//! Electron today still uses Xenova/whisper-tiny in voiceCommander.ts — upgrade on port.
//!
//! Pipeline: `--listen` runs the listen/transcribe skeleton (probe AppData GGML;
//! never downloads the ~3.1 GB file). IPC: StubVoiceServer + `--ipc-tcp` / `--ipc-pipe` / `--ipc-demo`.

use pq_core::ipc::{
    local_tcp_ipc_demo, IpcMessage, IpcSink, LocalTcpTransport, NamedPipeTransport, StubVoiceServer,
    Transport, VoiceIpcFlow, DEFAULT_TCP_ADDR, PROTOCOL_VERSION,
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
    if let Some(session) = ipc_pipe_session(&args) {
        if let Err(e) = run_ipc_pipe_demo(&session) {
            eprintln!("ipc-pipe: {e}");
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
    println!("Tip: pq-voice --ipc-pipe  (after pq-work --ipc-pipe) for Windows named-pipe spike");

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


fn ipc_pipe_session(args: &[String]) -> Option<String> {
    for (i, a) in args.iter().enumerate() {
        if a == "--ipc-pipe" {
            return Some(
                args
                    .get(i + 1)
                    .filter(|p| !p.starts_with('-'))
                    .cloned()
                    .unwrap_or_else(|| format!("demo-{}", std::process::id())),
            );
        }
    }
    None
}

fn run_ipc_pipe_demo(session: &str) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(not(windows))]
    {
        let _ = session;
        return Err("NamedPipeTransport requires Windows (use --ipc-tcp / --ipc-demo)".into());
    }
    #[cfg(windows)]
    {
        println!("pq-voice {WORKSPACE_VERSION} ipc-pipe connect session={session}");
        let mut transport = None;
        for attempt in 1..=80 {
            match NamedPipeTransport::connect(session) {
                Ok(t) => {
                    transport = Some(t);
                    break;
                }
                Err(e) => {
                    if attempt == 80 {
                        return Err(e.into());
                    }
                    thread::sleep(Duration::from_millis(50));
                }
            }
        }
        let mut transport = transport.expect("connected");
        println!("connected ({})", transport.kind());

        let mut server = StubVoiceServer::default();
        let start = transport.recv_line_blocking()?;
        println!("<- {start:?}");
        server.handle_from_work(start)?;
        for msg in server.channel.take_outbound() {
            println!("-> {msg:?}");
            transport.send(msg)?;
        }
        server.emit_stub_transcript("czesc z pipe")?;
        for msg in server.channel.take_outbound() {
            println!("-> {msg:?}");
            transport.send(msg)?;
        }
        println!("ipc-pipe demo ok");
        Ok(())
    }
}

fn help_text() -> String {
    format!(
        "pq-voice {WORKSPACE_VERSION} — Phase 2 stub (not production STT)\n\n\
         USAGE:\n\
             pq-voice [OPTIONS]\n\n\
         WHAT THIS IS:\n\
             Sketch host for a future whisper.cpp process. No mic capture.\n\
             No whisper.cpp linked. Inference is unwired even if GGML is present.\n\
             Production desktop STT remains Electron Xenova/whisper-tiny\n\
             (src/renderer/src/lib/voiceCommander.ts).\n\n\
         OPTIONS:\n\
             -h, --help              Show this help\n\
             -V, --version           Show version\n\
             --listen                Probe AppData for {ggml} + listen/transcribe SKELETON\n\
                                     No mic. No download (~3.1 GB). Exit 2 if model missing.\n\
                                     Present file still yields a stub transcript (unwired).\n\
             --pipeline              Alias of --listen (same skeleton / same exit codes)\n\
             --ipc-demo              In-process LocalTcpTransport e2e — demo, not production\n\
             --ipc-tcp [ADDR]        Connect to a listening host (JSON-lines spike)\n\
                                     default {addr}; host must listen first\n\
             --ipc-pipe [SESSION]    Connect to \\\\.\\pipe\\pq-voice-{{session}} (Windows only)\n\
                                     Demo ACL (creator DACL). Host must listen first.\n\n\
         STT INTENT (not runtime): {model} language={lang}.\n\
         File: %LOCALAPPDATA%\\pq\\models\\whisper\\{ggml} (~3.1 GB f16).\n\
         Overnight/CI never fetches it. Place the file manually if you need a present-probe.\n\
         Electron spawn of this binary is opt-in (PQ_VOICE_HOST=1) — see docs/VOICE-HOST-BRIDGE.md.",
        ggml = stt::GGML_FILENAME,
        model = stt::MODEL_ID,
        lang = stt::LANGUAGE,
        addr = DEFAULT_TCP_ADDR,
    )
}

fn print_help() {
    println!("{}", help_text());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn help_is_honest_about_skeleton_and_no_download() {
        let h = help_text();
        assert!(h.contains("not production STT"), "{h}");
        assert!(h.contains("No mic"), "{h}");
        assert!(h.contains("whisper.cpp"), "{h}");
        assert!(h.contains("No download") && h.contains("never fetches"), "{h}");
        assert!(h.contains("Exit 2"), "{h}");
        assert!(h.contains("Xenova/whisper-tiny"), "{h}");
        assert!(h.contains("--pipeline"), "{h}");
        assert!(h.contains("Windows only"), "{h}");
        assert!(h.contains("PQ_VOICE_HOST"), "{h}");
        assert!(h.contains(stt::GGML_FILENAME), "{h}");
        assert!(h.contains(stt::MODEL_ID), "{h}");
        assert!(h.contains(stt::LANGUAGE), "{h}");
        assert!(h.contains("demo, not production"), "{h}");
    }
}
