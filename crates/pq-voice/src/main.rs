//! pq-voice — voice assistant process (Phase 2 stub).
//!
//! STT INTENT (not runtime lock): Whisper Large v3 for Polish when ported.
//! Model: openai/whisper-large-v3 (GGML: ggml-large-v3.bin), language=pl.
//! Electron today still uses Xenova/whisper-tiny in voiceCommander.ts — upgrade on port.
//!
//! IPC: owns StubVoiceServer (handles StartListen / Cancel; emits Transcript / Status).

use pq_core::ipc::{IpcMessage, StubVoiceServer, PROTOCOL_VERSION};
use pq_core::stt;
use pq_core::WORKSPACE_VERSION;

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

    println!("pq-voice {WORKSPACE_VERSION} (Phase 2 stub)");
    println!("STT target: {} ({})", stt::MODEL_ID, stt::GGML_FILENAME);
    println!("language: {}", stt::LANGUAGE);
    println!("{}", stt::RATIONALE);
    println!("IPC protocol v{PROTOCOL_VERSION}: StubVoiceServer ready");

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

fn print_help() {
    println!(
        "pq-voice {WORKSPACE_VERSION}\n\n\
         USAGE:\n\
             pq-voice [OPTIONS]\n\n\
         OPTIONS:\n\
             -h, --help       Show help\n\
             -V, --version    Show version\n\n\
         STT INTENT: Whisper Large v3 (Polish). CURRENT Electron: Xenova/whisper-tiny.
         IPC: MemoryChannelStub + Transport trait — docs/PORT-MAP.md / pq_core::ipc."
    );
}
