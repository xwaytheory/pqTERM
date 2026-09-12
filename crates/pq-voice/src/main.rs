//! pq-voice — voice assistant process (Phase 1 stub).
//!
//! STT target (LOCKED): Whisper Large v3 for Polish.
//! Model: openai/whisper-large-v3 (GGML: ggml-large-v3.bin), language=pl.
//! Electron today still uses Xenova/whisper-tiny in voiceCommander.ts — upgrade on port.

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

    println!("pq-voice {WORKSPACE_VERSION} (Phase 1 stub)");
    println!("STT target: {} ({})", stt::MODEL_ID, stt::GGML_FILENAME);
    println!("language: {}", stt::LANGUAGE);
    println!("{}", stt::RATIONALE);
    println!("IPC with pq-work: TBD (named pipe / localhost WS) — see docs/MIGRATION-RUST.md");
}

fn print_help() {
    println!(
        "pq-voice {WORKSPACE_VERSION}\n\n\
         USAGE:\n\
             pq-voice [OPTIONS]\n\n\
         OPTIONS:\n\
             -h, --help       Show help\n\
             -V, --version    Show version\n\n\
         STT: Whisper Large v3 (Polish). See docs/MIGRATION-RUST.md."
    );
}
