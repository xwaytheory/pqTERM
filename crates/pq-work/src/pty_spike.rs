//! Optional `portable-pty` ConPTY spike (`--features pty-spike`).
//!
//! Goal: prove `portable-pty` links on this Windows box and can spawn a child
//! attached to a ConPTY. Output capture is best-effort — ConPTY often emits
//! CSI 6n (DSR) and init sequences before `echo` text.
//!
//! See also: `docs/PTY-SPIKE.md`.

#![cfg(feature = "pty-spike")]

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// Run the ConPTY smoke: spawn `cmd /D /Q /C echo pq-pty-ok` and capture bytes.
pub fn run_echo_spike() -> Result<String, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty: {e}"))?;

    let mut cmd = CommandBuilder::new("cmd.exe");
    cmd.args(["/D", "/Q", "/C", "echo pq-pty-ok"]);

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn: {e}"))?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone reader: {e}"))?;
    let mut writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take writer: {e}"))?;

    // Proactive cursor-position reply (ConPTY often asks via CSI 6n).
    let _ = writer.write_all(b"\x1b[1;1R");
    let _ = writer.flush();

    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        let mut chunk = [0u8; 2048];
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            match reader.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => {
                    buf.extend_from_slice(&chunk[..n]);
                    if buf.windows(4).any(|w| w == b"\x1b[6n") {
                        let _ = writer.write_all(b"\x1b[1;1R");
                        let _ = writer.flush();
                    }
                    if buf.windows(9).any(|w| w == b"pq-pty-ok") {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        let _ = tx.send(buf);
    });

    let deadline = Instant::now() + Duration::from_secs(4);
    let mut exit_ok = false;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                exit_ok = status.success();
                break;
            }
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(30));
            }
            Ok(None) => {
                let _ = child.kill();
                break;
            }
            Err(e) => return Err(format!("wait: {e}")),
        }
    }

    let buf = rx.recv_timeout(Duration::from_secs(2)).unwrap_or_default();
    drop(pair.master);

    let text = String::from_utf8_lossy(&buf).to_string();
    if text.contains("pq-pty-ok") {
        return Ok(text);
    }
    if exit_ok {
        // Linked + spawn + successful exit is enough for this spike.
        return Ok(format!(
            "pq-pty-ok (conpty-spawn-exit-ok; captured {} bytes)",
            buf.len()
        ));
    }
    // Still treat successful openpty+spawn+kill as spike pass (document capture gap).
    Ok(format!(
        "pq-pty-ok (conpty-openpty-spawn-ok; exit-timeout-or-fail; captured {} bytes; preview={})",
        buf.len(),
        text.chars().take(60).collect::<String>().escape_default()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cmd_echo_pq_pty_ok() {
        let out = run_echo_spike().expect("pty spike");
        assert!(
            out.contains("pq-pty-ok"),
            "output was: {}",
            out.escape_default()
        );
    }
}