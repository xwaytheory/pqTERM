//! pq-work — workbench host (Phase 2 stub).
//!
//! Future: Tauri UI, ConPTY/portable-pty terminals, auto-update on launch.
//! Electron `src/` remains the production app until a later phase.
//!
//! IPC: owns StubWorkClient (StartListen / Cancel → voice; receives Transcript / Status).
//! Spike: `--ipc-tcp [addr]` listens on localhost TCP JSON-lines (Transport spike, not production IPC).

use pq_core::ipc::{
    stub_loopback_demo, IpcMessage, IpcSink, LocalTcpTransport, StubWorkClient, Transport,
    DEFAULT_TCP_ADDR, PROTOCOL_VERSION,
};
use pq_core::{CheckOnLaunchPlan, STUB_REMOTE_LATEST, WORKSPACE_VERSION};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "-h" || a == "--help") {
        print_help();
        return;
    }
    if args.iter().any(|a| a == "-V" || a == "--version") {
        println!("pq-work {WORKSPACE_VERSION}");
        return;
    }
    if let Some(addr) = ipc_tcp_addr(&args) {
        if let Err(e) = run_ipc_tcp_demo(&addr) {
            eprintln!("ipc-tcp: {e}");
            std::process::exit(1);
        }
        return;
    }

    println!("pq-work {WORKSPACE_VERSION} (Phase 2 stub)");
    println!("Electron app under src/ is still the production UI.");
    println!(
        "IPC protocol v{PROTOCOL_VERSION}: StubWorkClient + MemoryChannelStub (not production Transport)"
    );
    println!("Tip: pq-work --ipc-tcp  (then pq-voice --ipc-tcp) for localhost TCP Transport spike (demo only)");

    let plan = CheckOnLaunchPlan::default();
    println!(
        "updater: check_on_launch={} manifest={}",
        plan.check_enabled, plan.manifest_url
    );
    // Stub only: compares embedded current vs fake remote STUB_REMOTE_LATEST (not network).
    match plan.stub_remote_delta() {
        Ok(n) if n < 0 => println!(
            "updater stub: current {} < fake remote {} (would offer update)",
            plan.current_version, STUB_REMOTE_LATEST
        ),
        Ok(0) => println!(
            "updater stub: current {} == fake remote {}",
            plan.current_version, STUB_REMOTE_LATEST
        ),
        Ok(_) => println!(
            "updater stub: current {} > fake remote {}",
            plan.current_version, STUB_REMOTE_LATEST
        ),
        Err(e) => eprintln!("updater stub: {e}"),
    }

    let mut client = StubWorkClient::default();
    if let Err(e) = client.start_listen("boot-probe") {
        eprintln!("ipc stub: {e}");
    } else {
        println!(
            "ipc stub: queued StartListen ({} outbound)",
            client.channel.outbound.len()
        );
    }
    match stub_loopback_demo() {
        Ok((_out, transcripts)) => {
            let preview = transcripts
                .first()
                .map(|t| t.text.as_str())
                .unwrap_or("(none)");
            println!(
                "ipc stub: loopback ok, transcripts={} last={preview:?}",
                transcripts.len()
            );
        }
        Err(e) => eprintln!("ipc stub loopback: {e}"),
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

/// Listen as work side; wait for voice to connect; StartListen → print Transcript.
fn run_ipc_tcp_demo(addr: &str) -> Result<(), Box<dyn std::error::Error>> {
    println!("pq-work {WORKSPACE_VERSION} ipc-tcp listen on {addr}");
    println!("waiting for pq-voice --ipc-tcp {addr} …");
    let mut transport = LocalTcpTransport::listen_once(addr)?;
    println!("peer connected ({})", transport.kind());

    let mut work = StubWorkClient::default();
    work.start_listen("sess-tcp-demo")?;
    for msg in work.channel.take_outbound() {
        transport.send(msg)?;
        println!("→ StartListen");
    }

    loop {
        let msg = transport.recv_line_blocking()?;
        match &msg {
            IpcMessage::Transcript(t) => {
                println!(
                    "← Transcript final={} text={:?}",
                    t.is_final, t.text
                );
            }
            IpcMessage::Status(s) => {
                println!("← Status {:?} {:?}", s.state, s.detail);
            }
            other => println!("← {other:?}"),
        }
        work.handle_from_voice(msg)?;
        if work.transcripts.iter().any(|t| t.is_final) {
            break;
        }
    }
    println!("ipc-tcp demo ok");
    Ok(())
}

fn print_help() {
    println!(
        "pq-work {WORKSPACE_VERSION}\n\n\
         USAGE:\n\
             pq-work [OPTIONS]\n\n\
         OPTIONS:\n\
             -h, --help              Show help\n\
             -V, --version           Show version\n\
             --ipc-tcp [ADDR]        Listen for voice on localhost TCP JSON-lines\n\
                                     (default {DEFAULT_TCP_ADDR})\n\n\
         Phase 2: IPC stubs + TCP Transport spike. See docs/MIGRATION-RUST.md, docs/PORT-MAP.md."
    );
}
