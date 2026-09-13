//! pq-work — workbench host (Phase 2 stub).
//!
//! Future: Tauri UI, ConPTY/portable-pty terminals, auto-update on launch.
//! Electron `src/` remains the production app until a later phase.
//!
//! IPC: owns StubWorkClient (StartListen / Cancel → voice; receives Transcript / Status).
//! Spike: `--ipc-tcp [addr]` listens on localhost TCP JSON-lines (Transport spike, not production IPC).

mod pty_manager;

use std::path::PathBuf;

#[cfg(feature = "pty-spike")]
mod pty_spike;

use pq_core::ipc::{
    local_tcp_ipc_demo, stub_loopback_demo, IpcMessage, IpcSink, LocalTcpTransport, StubWorkClient,
    Transport, VoiceIpcFlow, DEFAULT_TCP_ADDR, PROTOCOL_VERSION,
};
use pq_core::{
    fetch_manifest, offer_from_manifest, CheckOnLaunchPlan, FileManifestFetch,
    STUB_REMOTE_LATEST, WORKSPACE_VERSION,
};

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
    if args.iter().any(|a| a == "--ipc-demo") {
        if let Err(e) = run_ipc_demo() {
            eprintln!("ipc-demo: {e}");
            std::process::exit(1);
        }
        return;
    }
    if let Some(addr) = ipc_tcp_addr(&args) {
        if let Err(e) = run_ipc_tcp_demo(&addr) {
            eprintln!("ipc-tcp: {e}");
            std::process::exit(1);
        }
        return;
    }
    if args.iter().any(|a| a == "--pty-spike") {
        #[cfg(feature = "pty-spike")]
        {
            match pty_spike::run_echo_spike() {
                Ok(out) => {
                    println!("pty-spike ok");
                    print!("{out}");
                }
                Err(e) => {
                    eprintln!("pty-spike: {e}");
                    std::process::exit(1);
                }
            }
            return;
        }
        #[cfg(not(feature = "pty-spike"))]
        {
            eprintln!("pty-spike: rebuild with --features pty-spike");
            std::process::exit(2);
        }
    }

    if let Some(path) = check_update_path(&args) {
        if let Err(e) = run_check_update(&path) {
            eprintln!("check-update: {e}");
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


fn run_ipc_demo() -> Result<(), Box<dyn std::error::Error>> {
    let flow = VoiceIpcFlow::tcp_demo("sess-tcp");
    println!(
        "pq-work {WORKSPACE_VERSION} --ipc-demo protocol={} transport={} session={}",
        flow.protocol, flow.transport, flow.session_id
    );
    println!("expected kinds: {:?}", flow.expected_kinds());
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


fn check_update_path(args: &[String]) -> Option<String> {
    for (i, a) in args.iter().enumerate() {
        if a == "--check-update" {
            let next = args.get(i + 1).filter(|p| !p.starts_with('-'));
            return Some(next.cloned().unwrap_or_else(default_update_fixture_path));
        }
    }
    None
}

fn default_update_fixture_path() -> String {
    let from_manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("pq-core")
        .join("fixtures")
        .join("pq-update-manifest.json");
    if from_manifest.is_file() {
        return from_manifest.to_string_lossy().into_owned();
    }
    "pq-update-manifest.json".into()
}

/// FileManifestFetch fixture check — prints `OfferUpdate` JSON or up-to-date (no network).
fn run_check_update(path: &str) -> Result<(), String> {
    let fetcher = FileManifestFetch::new(path);
    let manifest = fetch_manifest(&fetcher, path).map_err(|e| e.to_string())?;
    let current = WORKSPACE_VERSION;
    match offer_from_manifest(current, &manifest, path).map_err(|e| e.to_string())? {
        Some(offer) => {
            println!("OfferUpdate");
            let raw = serde_json::to_string_pretty(&offer).map_err(|e| e.to_string())?;
            println!("{raw}");
        }
        None => {
            println!(
                "up-to-date: current={current} latest={} source={path}",
                manifest.latest
            );
        }
    }
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
             --ipc-demo              In-process LocalTcpTransport e2e (shared IPC types)\n\
             --ipc-tcp [ADDR]        Listen for voice on localhost TCP JSON-lines\n\
                                     (default {DEFAULT_TCP_ADDR})\n\n\
         Phase 2: IPC stubs + TCP/named-pipe Transport + optional pty-spike. See docs/MIGRATION-RUST.md."
    );
}
