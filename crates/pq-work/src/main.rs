//! pq-work — workbench host (Phase 1 stub).
//!
//! Future: Tauri UI, ConPTY/portable-pty terminals, auto-update on launch.
//! Electron `src/` remains the production app until a later phase.

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

    println!("pq-work {WORKSPACE_VERSION} (Phase 1 stub)");
    println!("Electron app under src/ is still the production UI.");
    let plan = CheckOnLaunchPlan::default();
    println!(
        "updater: check_on_launch={} manifest={}",
        plan.check_enabled, plan.manifest_url
    );
    // Demo compare against itself (stub).
    match compare_semver(WORKSPACE_VERSION, &plan.current_version) {
        Ok(0) => println!("updater: current version is up to date vs embedded plan"),
        Ok(n) => println!("updater: semver delta={n}"),
        Err(e) => eprintln!("updater: {e}"),
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
         Phase 1 scaffold only. See docs/MIGRATION-RUST.md."
    );
}
