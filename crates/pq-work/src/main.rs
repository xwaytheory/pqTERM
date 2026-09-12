//! pq-work — workbench host (Phase 2 stub).
//!
//! Future: Tauri UI, ConPTY/portable-pty terminals, auto-update on launch.
//! Electron `src/` remains the production app until a later phase.
//!
//! IPC: owns StubWorkClient (StartListen / Cancel → voice; receives Transcript / Status).

use pq_core::ipc::{stub_loopback_demo, StubWorkClient, PROTOCOL_VERSION};
use pq_core::{compare_semver, CheckOnLaunchPlan, WORKSPACE_VERSION};

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

    println!("pq-work {WORKSPACE_VERSION} (Phase 2 stub)");
    println!("Electron app under src/ is still the production UI.");
    println!("IPC protocol v{PROTOCOL_VERSION}: StubWorkClient + MemoryChannelStub (not production Transport)");

    let plan = CheckOnLaunchPlan::default();
    println!(
        "updater: check_on_launch={} manifest={}",
        plan.check_enabled, plan.manifest_url
    );
    match compare_semver(WORKSPACE_VERSION, &plan.current_version) {
        Ok(0) => println!("updater: current version is up to date vs embedded plan"),
        Ok(n) => println!("updater: semver delta={n}"),
        Err(e) => eprintln!("updater: {e}"),
    }

    // Compile-time + runtime smoke: stub client exists; full loopback demo.
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
            println!("ipc stub: loopback ok, transcripts={} last={preview:?}", transcripts.len());
        }
        Err(e) => eprintln!("ipc stub loopback: {e}"),
    }
}

fn print_help() {
    println!(
        "pq-work {WORKSPACE_VERSION}\n\n\
         USAGE:\n\
             pq-work [OPTIONS]\n\n\
         OPTIONS:\n\
             -h, --help       Show help\n\
             -V, --version    Show version\n\n\
         Phase 2: IPC stubs + port map. See docs/MIGRATION-RUST.md, docs/PORT-MAP.md."
    );
}
