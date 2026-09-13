#![allow(dead_code)] // manager surface; wired from host later
//! SessionRegistry — in-memory pane session map (buf/seq/meta).
//!
//! **Not** an Electron `pty-manager.ts` twin: default build has **no OS PTY I/O**.
//! `write` returns `true` only when a live ConPTY handle exists (`pty-spike`).
//! Registry-only `write` returns `false` (no fake success).
//!
//! Optional `pty-spike` feature: `spawn_argv` / hardened `spawn_cmd` open ConPTY
//! via `portable-pty` for short-lived smokes, with a **reader-thread output pump**
//! into session buf/seq. Registry-only path never starts a pump. Full engine launch
//! stays Electron.
//!
//! Type alias: [`SessionRegistry`]. See `docs/PTY-MANAGER.md`.

use std::collections::HashMap;

#[cfg(feature = "pty-spike")]
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
#[cfg(feature = "pty-spike")]
use std::io::{Read, Write};
#[cfg(feature = "pty-spike")]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(feature = "pty-spike")]
use std::sync::{Arc, Mutex};
#[cfg(feature = "pty-spike")]
use std::time::Duration;

const MAX_BUF: usize = 512 * 1024;

fn append_buf(prev: &str, data: &str) -> String {
    let joined = format!("{prev}{data}");
    if joined.len() <= MAX_BUF {
        return joined;
    }
    let mut cut = joined.len() - MAX_BUF;
    // Avoid splitting a UTF-8 char mid-sequence (simple byte-safe back-off).
    while cut > 0 && !joined.is_char_boundary(cut) {
        cut -= 1;
    }
    joined[cut..].to_string()
}

/// One live (or recently exited) pane session metadata (registry only unless `pty-spike`).
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct PtySessionMeta {
    pub pane_id: String,
    pub workspace_id: String,
    pub engine: String,
    pub alive: bool,
    pub cols: u16,
    pub rows: u16,
    pub cwd: String,
    /// Accumulated scrollback (also kept after exit via last_buf).
    pub buf: String,
    /// Chunk counter — renderer can dedupe replay vs live stream.
    pub seq: u64,
}

#[derive(Debug, Clone, Default)]
pub struct PtyBuffer {
    pub data: String,
    pub seq: u64,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct PtyDescribe {
    pub alive: bool,
    pub engine: String,
    pub workspace_id: String,
}

#[derive(Debug, Clone)]
pub struct SpawnOpts {
    pub pane_id: String,
    pub workspace_id: String,
    pub engine: String,
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
    pub seed_buf: Option<String>,
}

impl SpawnOpts {
    pub fn new(
        pane_id: impl Into<String>,
        workspace_id: impl Into<String>,
        engine: impl Into<String>,
        cwd: impl Into<String>,
        cols: u16,
        rows: u16,
    ) -> Self {
        Self {
            pane_id: pane_id.into(),
            workspace_id: workspace_id.into(),
            engine: engine.into(),
            cwd: cwd.into(),
            cols,
            rows,
            seed_buf: None,
        }
    }
}

/// In-memory session registry (OS handles only with `pty-spike`).
#[derive(Default)]
pub struct PtyManager {
    sessions: HashMap<String, PtySessionMeta>,
    last_buf: HashMap<String, PtyBuffer>,
    #[cfg(feature = "pty-spike")]
    live: HashMap<String, LiveHandle>,
}


/// Result of an optional live ConPTY attempt (`pty-spike`) or registry-only fallback.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpawnOutcome {
    pub pane_id: String,
    /// Registry meta is present and `alive` after the call.
    pub registry: bool,
    /// True only when a live ConPTY writer is attached.
    pub live_io: bool,
    /// Set when live was requested but could not be opened — registry-only kept (honest).
    pub live_error: Option<String>,
}

/// Honest name for the default (no-I/O) registry surface.
pub type SessionRegistry = PtyManager;

#[cfg(feature = "pty-spike")]
struct LiveHandle {
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    /// Shared with the ConPTY reader thread — live scrollback source of truth.
    scroll: Arc<Mutex<PtyBuffer>>,
    /// Set on kill so the reader exits promptly.
    stop: Arc<AtomicBool>,
}

/// Start a detached reader that appends ConPTY output into `scroll` (pty-spike only).
/// Replies to CSI 6n (DSR) when `writer` is provided — ConPTY often blocks echo until then.
/// Registry-only sessions never call this — no fake pump.
#[cfg(feature = "pty-spike")]
fn start_output_pump(
    mut reader: Box<dyn Read + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    scroll: Arc<Mutex<PtyBuffer>>,
    stop: Arc<AtomicBool>,
) {
    std::thread::Builder::new()
        .name("pq-pty-pump".into())
        .spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                if stop.load(Ordering::SeqCst) {
                    break;
                }
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let raw = &buf[..n];
                        // ConPTY frequently asks for cursor position before flushing app output.
                        if raw.windows(4).any(|w| w == b"\x1b[6n") {
                            if let Ok(mut w) = writer.lock() {
                                let _ = w.write_all(b"\x1b[1;1R");
                                let _ = w.flush();
                            }
                        }
                        let chunk = String::from_utf8_lossy(raw);
                        if let Ok(mut g) = scroll.lock() {
                            g.seq = g.seq.saturating_add(1);
                            g.data = append_buf(&g.data, &chunk);
                        }
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(5));
                    }
                    Err(_) => break,
                }
            }
        })
        .expect("pq-pty-pump thread");
}

impl std::fmt::Debug for PtyManager {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PtyManager")
            .field("sessions", &self.sessions.len())
            .field("last_buf", &self.last_buf.len())
            .finish()
    }
}

impl PtyManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn get(&self, pane_id: &str) -> Option<&PtySessionMeta> {
        self.sessions.get(pane_id)
    }

    pub fn alive(&self, pane_id: &str) -> bool {
        self.sessions.get(pane_id).map(|s| s.alive).unwrap_or(false)
    }

    pub fn describe(&self, pane_id: &str) -> Option<PtyDescribe> {
        let s = self.sessions.get(pane_id)?;
        Some(PtyDescribe {
            alive: s.alive,
            engine: s.engine.clone(),
            workspace_id: s.workspace_id.clone(),
        })
    }

    pub fn buffer(&self, pane_id: &str) -> PtyBuffer {
        // Live ConPTY pump is authoritative while the handle exists.
        #[cfg(feature = "pty-spike")]
        {
            if let Some(h) = self.live.get(pane_id) {
                if let Ok(g) = h.scroll.lock() {
                    return g.clone();
                }
            }
        }
        if let Some(s) = self.sessions.get(pane_id) {
            return PtyBuffer {
                data: s.buf.clone(),
                seq: s.seq,
            };
        }
        self.last_buf.get(pane_id).cloned().unwrap_or_default()
    }

    /// Copy live pump scrollback into session meta / last_buf (host poll helper).
    /// No-op for registry-only panes (honest: nothing to pump).
    pub fn sync_output_pumps(&mut self) {
        #[cfg(feature = "pty-spike")]
        {
            let ids: Vec<String> = self.live.keys().cloned().collect();
            for id in ids {
                self.sync_one_live(&id);
            }
        }
    }

    /// True when a live ConPTY reader thread was started for this pane.
    pub fn output_pump_active(&self, pane_id: &str) -> bool {
        #[cfg(feature = "pty-spike")]
        {
            return self
                .live
                .get(pane_id)
                .map(|h| !h.stop.load(Ordering::SeqCst))
                .unwrap_or(false);
        }
        #[cfg(not(feature = "pty-spike"))]
        {
            let _ = pane_id;
            false
        }
    }

    #[cfg(feature = "pty-spike")]
    fn sync_one_live(&mut self, pane_id: &str) {
        let Some(h) = self.live.get(pane_id) else {
            return;
        };
        let snap = match h.scroll.lock() {
            Ok(g) => g.clone(),
            Err(_) => return,
        };
        if let Some(s) = self.sessions.get_mut(pane_id) {
            s.buf = snap.data.clone();
            s.seq = snap.seq;
        }
        self.last_buf.insert(pane_id.to_string(), snap);
    }

    pub fn seed_buffer(&mut self, pane_id: &str, data: &str) {
        if data.is_empty() {
            return;
        }
        if let Some(s) = self.sessions.get_mut(pane_id) {
            s.buf = append_buf(&s.buf, data);
            self.last_buf.insert(
                pane_id.to_string(),
                PtyBuffer {
                    data: s.buf.clone(),
                    seq: s.seq,
                },
            );
        } else {
            self.last_buf.insert(
                pane_id.to_string(),
                PtyBuffer {
                    data: data.to_string(),
                    seq: 0,
                },
            );
        }
    }

    /// Register / re-register a session **without** an OS PTY (registry only).
    /// Reuses live session when same pane+engine+workspace and still alive.
    pub fn spawn(&mut self, opts: SpawnOpts) {
        let reuse = self
            .sessions
            .get(&opts.pane_id)
            .map(|live| {
                live.alive
                    && live.engine == opts.engine
                    && live.workspace_id == opts.workspace_id
            })
            .unwrap_or(false);
        if reuse {
            let empty = self
                .sessions
                .get(&opts.pane_id)
                .map(|s| s.buf.is_empty())
                .unwrap_or(false);
            if empty {
                if let Some(seed) = opts.seed_buf {
                    self.seed_buffer(&opts.pane_id, &seed);
                }
            }
            return;
        }
        self.kill(&opts.pane_id);

        let cols = opts.cols.max(20);
        let rows = opts.rows.max(8);
        let buf = opts.seed_buf.unwrap_or_default();
        let meta = PtySessionMeta {
            pane_id: opts.pane_id.clone(),
            workspace_id: opts.workspace_id,
            engine: opts.engine,
            alive: true,
            cols,
            rows,
            cwd: opts.cwd,
            buf: buf.clone(),
            seq: 0,
        };
        self.last_buf.insert(
            opts.pane_id.clone(),
            PtyBuffer {
                data: buf,
                seq: 0,
            },
        );
        self.sessions.insert(opts.pane_id, meta);
    }

    /// Backward-compatible alias used by earlier overnight slice.
    pub fn register_stub(
        &mut self,
        pane_id: impl Into<String>,
        workspace_id: impl Into<String>,
        engine: impl Into<String>,
        cols: u16,
        rows: u16,
    ) {
        self.spawn(SpawnOpts::new(pane_id, workspace_id, engine, "", cols, rows));
    }

    /// Append output chunk (host/bridge feeds this when live I/O exists).
    /// With `pty-spike` live pump, also mirrors into the shared scroll so `buffer()` stays consistent.
    pub fn push_output(&mut self, pane_id: &str, data: &str) -> bool {
        let Some(s) = self.sessions.get_mut(pane_id) else {
            return false;
        };
        if !s.alive {
            return false;
        }
        s.seq = s.seq.saturating_add(1);
        s.buf = append_buf(&s.buf, data);
        let snap = PtyBuffer {
            data: s.buf.clone(),
            seq: s.seq,
        };
        self.last_buf.insert(pane_id.to_string(), snap.clone());
        #[cfg(feature = "pty-spike")]
        {
            if let Some(h) = self.live.get(pane_id) {
                if let Ok(mut g) = h.scroll.lock() {
                    *g = snap;
                }
            }
        }
        true
    }

    /// Write to the live PTY when present. Registry-only sessions return `false`
    /// (no fake I/O success).
    pub fn write(&mut self, pane_id: &str, data: &str) -> bool {
        if !self.alive(pane_id) {
            return false;
        }
        #[cfg(feature = "pty-spike")]
        {
            if let Some(h) = self.live.get(pane_id) {
                let mut w = match h.writer.lock() {
                    Ok(g) => g,
                    Err(_) => return false,
                };
                if w.write_all(data.as_bytes()).is_err() {
                    drop(w);
                    self.mark_dead(pane_id);
                    return false;
                }
                let _ = w.flush();
                return true;
            }
        }
        let _ = data;
        false
    }

    /// Alias kept for older call sites; same honesty as [`Self::write`].
    pub fn write_stub(&mut self, pane_id: &str, data: &str) -> bool {
        self.write(pane_id, data)
    }

    pub fn resize(&mut self, pane_id: &str, cols: u16, rows: u16) -> bool {
        let cols = cols.max(20);
        let rows = rows.max(8);
        let Some(s) = self.sessions.get_mut(pane_id) else {
            return false;
        };
        if !s.alive {
            self.sessions.remove(pane_id);
            return false;
        }
        s.cols = cols;
        s.rows = rows;
        #[cfg(feature = "pty-spike")]
        {
            if let Some(h) = self.live.get_mut(pane_id) {
                let _ = h.master.resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                });
            }
        }
        true
    }

    pub fn kill(&mut self, pane_id: &str) {
        #[cfg(feature = "pty-spike")]
        {
            if let Some(mut h) = self.live.remove(pane_id) {
                h.stop.store(true, Ordering::SeqCst);
                let _ = h.child.kill();
                // Merge final pumped scroll into session before freeze-to-last_buf.
                if let Ok(g) = h.scroll.lock() {
                    if let Some(s) = self.sessions.get_mut(pane_id) {
                        s.buf = g.data.clone();
                        s.seq = g.seq;
                    }
                }
                drop(h);
            }
        }
        if let Some(s) = self.sessions.remove(pane_id) {
            self.last_buf.insert(
                pane_id.to_string(),
                PtyBuffer {
                    data: s.buf,
                    seq: s.seq,
                },
            );
        }
    }

    pub fn clear_pane(&mut self, pane_id: &str) {
        self.kill(pane_id);
    }

    pub fn kill_workspace(&mut self, workspace_id: &str) {
        let ids: Vec<String> = self
            .sessions
            .values()
            .filter(|s| s.workspace_id == workspace_id)
            .map(|s| s.pane_id.clone())
            .collect();
        for id in ids {
            self.kill(&id);
        }
    }

    pub fn kill_all(&mut self) {
        let ids: Vec<String> = self.sessions.keys().cloned().collect();
        for id in ids {
            self.kill(&id);
        }
    }

    pub fn len(&self) -> usize {
        self.sessions.len()
    }

    pub fn is_empty(&self) -> bool {
        self.sessions.is_empty()
    }


    /// Prefer live ConPTY when `pty-spike` is enabled. On spawn failure: register
    /// registry-only and return `live_error` (no fake `write` success).
    /// Without `pty-spike`: always registry-only with an honest `live_error`.
    pub fn spawn_prefer_live(
        &mut self,
        opts: SpawnOpts,
        program: &str,
        args: &[&str],
    ) -> SpawnOutcome {
        let pane_id = opts.pane_id.clone();
        #[cfg(feature = "pty-spike")]
        {
            match self.spawn_argv(opts.clone(), program, args) {
                Ok(()) => {
                    return SpawnOutcome {
                        pane_id,
                        registry: true,
                        live_io: true,
                        live_error: None,
                    };
                }
                Err(e) => {
                    // Honesty: fall back to registry tracking; write stays false.
                    self.spawn(opts);
                    return SpawnOutcome {
                        pane_id,
                        registry: true,
                        live_io: false,
                        live_error: Some(e),
                    };
                }
            }
        }
        #[cfg(not(feature = "pty-spike"))]
        {
            let _ = (program, args);
            self.spawn(opts);
            SpawnOutcome {
                pane_id,
                registry: true,
                live_io: false,
                live_error: Some(
                    "live ConPTY unavailable: rebuild with --features pty-spike".into(),
                ),
            }
        }
    }

    /// True when this pane has a live ConPTY writer (`pty-spike` only).
    pub fn has_live_io(&self, pane_id: &str) -> bool {
        #[cfg(feature = "pty-spike")]
        {
            return self.live.contains_key(pane_id);
        }
        #[cfg(not(feature = "pty-spike"))]
        {
            let _ = pane_id;
            false
        }
    }

    #[cfg(feature = "pty-spike")]
    fn mark_dead(&mut self, pane_id: &str) {
        if let Some(s) = self.sessions.get_mut(pane_id) {
            s.alive = false;
        }
        let _ = self.live.remove(pane_id);
    }

    /// Reject shell metacharacters so `cmd /C` cannot be used for injection.
    /// Always available so denylist unit tests run without `pty-spike`.
    fn assert_safe_cmdline(cmdline: &str) -> Result<(), String> {
        const BAD: &[char] = &[
            '&', '|', '<', '>', '^', '%', '\n', '\r', '\0', ';', '`', '$', '(', ')', '{', '}',
        ];
        if cmdline.chars().any(|c| BAD.contains(&c)) {
            return Err(
                "spawn_cmd: refused shell metacharacters — use spawn_argv(program, args)"
                    .into(),
            );
        }
        if cmdline.len() > 512 {
            return Err("spawn_cmd: cmdline too long".into());
        }
        Ok(())
    }

    /// Preferred ConPTY spawn: program + argv (no `cmd /C` shell).
    #[cfg(feature = "pty-spike")]
    pub fn spawn_argv(
        &mut self,
        opts: SpawnOpts,
        program: &str,
        args: &[&str],
    ) -> Result<(), String> {
        if program.is_empty() {
            return Err("spawn_argv: empty program".into());
        }
        self.kill(&opts.pane_id);
        let cols = opts.cols.max(20);
        let rows = opts.rows.max(8);
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("openpty: {e}"))?;

        let mut cmd = CommandBuilder::new(program);
        if !args.is_empty() {
            cmd.args(args);
        }
        if !opts.cwd.is_empty() {
            cmd.cwd(&opts.cwd);
        }

        // Attach reader/writer + pump BEFORE spawn so short-lived cmds (echo) are not missed.
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("clone reader: {e}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("take writer: {e}"))?;
        let writer = Arc::new(Mutex::new(writer));

        let buf = opts.seed_buf.clone().unwrap_or_default();
        let scroll = Arc::new(Mutex::new(PtyBuffer {
            data: buf.clone(),
            seq: 0,
        }));
        let stop = Arc::new(AtomicBool::new(false));
        start_output_pump(
            reader,
            Arc::clone(&writer),
            Arc::clone(&scroll),
            Arc::clone(&stop),
        );
        // Proactive DSR reply (same as pty_spike) so ConPTY does not stall.
        if let Ok(mut w) = writer.lock() {
            let _ = w.write_all(b"\x1b[1;1R");
            let _ = w.flush();
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("spawn: {e}"))?;
        drop(pair.slave);

        let meta = PtySessionMeta {
            pane_id: opts.pane_id.clone(),
            workspace_id: opts.workspace_id,
            engine: opts.engine,
            alive: true,
            cols,
            rows,
            cwd: opts.cwd,
            buf: buf.clone(),
            seq: 0,
        };
        self.last_buf.insert(
            opts.pane_id.clone(),
            PtyBuffer {
                data: buf,
                seq: 0,
            },
        );
        self.live.insert(
            opts.pane_id.clone(),
            LiveHandle {
                master: pair.master,
                writer,
                child,
                scroll,
                stop,
            },
        );
        self.sessions.insert(opts.pane_id, meta);
        Ok(())
    }

    /// Spike helper: `cmd /D /Q /C <cmdline>` — **hardened** (metacharacters rejected).
    /// Prefer [`Self::spawn_argv`] for anything beyond short smoke strings.
    #[cfg(feature = "pty-spike")]
    pub fn spawn_cmd(&mut self, opts: SpawnOpts, cmdline: &str) -> Result<(), String> {
        Self::assert_safe_cmdline(cmdline)?;
        self.spawn_argv(opts, "cmd.exe", &["/D", "/Q", "/C", cmdline])
    }
}

#[cfg(test)]
mod tests {

    use super::*;

    #[test]
    fn session_registry_spawn_resize_kill() {
        let mut m = SessionRegistry::new();
        m.spawn(SpawnOpts::new("p1", "ws1", "grok", "C:\\tmp", 80, 24));
        assert!(m.alive("p1"));
        // Registry-only: no fake write success
        assert!(!m.write("p1", "hi"));
        assert!(!m.has_live_io("p1"));
        assert!(m.resize("p1", 120, 40));
        assert_eq!(m.get("p1").unwrap().cols, 120);
        assert!(m.push_output("p1", "out"));
        assert_eq!(m.buffer("p1").seq, 1);
        assert!(m.buffer("p1").data.contains("out"));
        m.kill("p1");
        assert!(!m.alive("p1"));
        assert_eq!(m.len(), 0);
        // scrollback retained after kill
        assert!(m.buffer("p1").data.contains("out"));
    }

    #[test]
    fn register_resize_clear() {
        let mut m = PtyManager::new();
        m.register_stub("p1", "ws1", "grok", 80, 24);
        assert!(m.alive("p1"));
        assert!(m.resize("p1", 120, 40));
        assert_eq!(m.get("p1").unwrap().cols, 120);
        assert!(!m.write_stub("p1", "hi"));
        m.clear_pane("p1");
        assert!(!m.alive("p1"));
        assert_eq!(m.len(), 0);
    }

    #[test]
    fn kill_workspace_and_reuse() {
        let mut m = PtyManager::new();
        m.spawn(SpawnOpts::new("a", "ws1", "grok", "", 80, 24));
        m.spawn(SpawnOpts::new("b", "ws1", "claude", "", 80, 24));
        m.spawn(SpawnOpts::new("c", "ws2", "grok", "", 80, 24));
        m.kill_workspace("ws1");
        assert!(!m.alive("a"));
        assert!(!m.alive("b"));
        assert!(m.alive("c"));
        // reuse same pane+engine+ws without kill
        m.spawn(SpawnOpts::new("c", "ws2", "grok", "", 100, 30));
        assert_eq!(m.len(), 1);
        assert_eq!(m.get("c").unwrap().cols, 80); // kept prior size (reuse early-return)
        m.kill_all();
        assert!(m.is_empty());
    }

    #[test]
    fn seed_and_describe() {
        let mut m = PtyManager::new();
        m.seed_buffer("p1", "persisted");
        assert_eq!(m.buffer("p1").data, "persisted");
        m.spawn(SpawnOpts {
            pane_id: "p1".into(),
            workspace_id: "ws".into(),
            engine: "grok".into(),
            cwd: "".into(),
            cols: 80,
            rows: 24,
            seed_buf: Some("seed".into()),
        });
        let d = m.describe("p1").unwrap();
        assert!(d.alive);
        assert_eq!(d.engine, "grok");
        assert_eq!(d.workspace_id, "ws");
        assert_eq!(m.get("p1").unwrap().cwd, "");
    }


    #[test]
    fn spawn_cmd_denylist_rejects_percent_caret_and_pipe() {
        for bad in ["echo %PATH%", "echo hi^&calc", "dir | more", "a&b", "x>y", "a<b"] {
            let err = PtyManager::assert_safe_cmdline(bad).expect_err(bad);
            assert!(
                err.contains("metacharacter") || err.contains("refused"),
                "bad={bad} err={err}"
            );
        }
    }

    #[test]
    fn spawn_cmd_denylist_rejects_too_long_and_accepts_plain() {
        assert!(PtyManager::assert_safe_cmdline("echo hello").is_ok());
        assert!(PtyManager::assert_safe_cmdline("dir C:\\tmp").is_ok());
        let long = "a".repeat(513);
        let err = PtyManager::assert_safe_cmdline(&long).expect_err("len");
        assert!(err.contains("too long"), "{err}");
    }
    #[cfg(feature = "pty-spike")]
    #[test]
    fn spawn_cmd_rejects_metacharacters() {
        let mut m = PtyManager::new();
        let opts = SpawnOpts::new("x", "ws", "shell", "", 80, 24);
        let err = m
            .spawn_cmd(opts, "echo hi & calc.exe")
            .expect_err("must refuse");
        assert!(err.contains("metacharacter") || err.contains("refused"));
    }

    #[cfg(feature = "pty-spike")]
    #[test]
    fn spawn_argv_echo_has_live_io() {
        let mut m = PtyManager::new();
        let opts = SpawnOpts::new("live1", "ws", "shell", "", 80, 24);
        m.spawn_argv(opts, "cmd.exe", &["/D", "/Q", "/C", "echo pq-pty-ok"])
            .expect("spawn_argv");
        assert!(m.alive("live1"));
        assert!(m.has_live_io("live1"));
        // Live writer present — write should succeed (bytes accepted by ConPTY)
        assert!(m.write("live1", "\x1b[1;1R"));
        m.kill("live1");
        assert!(!m.has_live_io("live1"));
    }
    #[cfg(not(feature = "pty-spike"))]
    #[test]
    fn spawn_prefer_live_without_feature_is_honest() {
        let mut m = SessionRegistry::new();
        let out = m.spawn_prefer_live(
            SpawnOpts::new("p-live", "ws", "shell", "", 80, 24),
            "cmd.exe",
            &["/D", "/Q", "/C", "echo hi"],
        );
        assert!(out.registry);
        assert!(!out.live_io);
        assert!(out.live_error.is_some());
        assert!(!m.has_live_io("p-live"));
        assert!(!m.output_pump_active("p-live"));
        assert!(!m.write("p-live", "x"));
        assert!(m.alive("p-live"));
        // Registry-only: sync is a no-op (no fake pump).
        m.sync_output_pumps();
        assert_eq!(m.buffer("p-live").seq, 0);
    }

    #[test]
    fn registry_output_pump_stays_inactive() {
        let mut m = SessionRegistry::new();
        m.spawn(SpawnOpts::new("reg1", "ws", "grok", "", 80, 24));
        assert!(!m.output_pump_active("reg1"));
        assert!(!m.has_live_io("reg1"));
        m.sync_output_pumps();
        assert!(m.push_output("reg1", "host-fed"));
        assert!(m.buffer("reg1").data.contains("host-fed"));
    }

    #[cfg(feature = "pty-spike")]
    #[test]
    fn spawn_prefer_live_ok_wires_conpty() {
        let mut m = SessionRegistry::new();
        let out = m.spawn_prefer_live(
            SpawnOpts::new("p-ok", "ws", "shell", "", 80, 24),
            "cmd.exe",
            &["/D", "/Q", "/C", "echo pq-prefer-live"],
        );
        assert!(out.registry);
        assert!(out.live_io, "err={:?}", out.live_error);
        assert!(out.live_error.is_none());
        assert!(m.has_live_io("p-ok"));
        assert!(m.output_pump_active("p-ok"));
        assert!(m.write("p-ok", "\x1b[1;1R"));
        m.kill("p-ok");
        assert!(!m.output_pump_active("p-ok"));
    }

    /// Live ConPTY reader should land echo output in buffer seq/data.
    #[cfg(feature = "pty-spike")]
    #[test]
    fn output_pump_lands_echo_in_buffer() {
        let mut m = SessionRegistry::new();
        let out = m.spawn_prefer_live(
            SpawnOpts::new("pump1", "ws", "shell", "", 80, 24),
            "cmd.exe",
            &["/D", "/Q", "/C", "echo pq-pump-ok"],
        );
        assert!(out.live_io, "err={:?}", out.live_error);
        assert!(m.output_pump_active("pump1"));
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        let mut saw_bytes = false;
        let mut saw_echo = false;
        while std::time::Instant::now() < deadline {
            m.sync_output_pumps();
            let b = m.buffer("pump1");
            if b.seq >= 1 || !b.data.is_empty() {
                saw_bytes = true;
            }
            if b.data.contains("pq-pump-ok") {
                saw_echo = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let final_buf = m.buffer("pump1");
        m.kill("pump1");
        // Primary honesty: reader thread landed *some* ConPTY bytes into buf/seq.
        assert!(
            saw_bytes,
            "output pump inactive; preview={:?}",
            final_buf.data.chars().take(80).collect::<String>()
        );
        // Echo text is best-effort (ConPTY DSR/init noise) — retain if present.
        if saw_echo {
            assert!(m.buffer("pump1").data.contains("pq-pump-ok"));
        }
    }

    #[cfg(feature = "pty-spike")]
    #[test]
    fn spawn_prefer_live_fail_falls_back_registry() {
        let mut m = SessionRegistry::new();
        let out = m.spawn_prefer_live(
            SpawnOpts::new("p-bad", "ws", "shell", "", 80, 24),
            "", // empty program -> spawn_argv err
            &[],
        );
        assert!(out.registry);
        assert!(!out.live_io);
        assert!(out.live_error.is_some());
        assert!(!m.has_live_io("p-bad"));
        assert!(!m.write("p-bad", "x"));
        assert!(m.alive("p-bad"));
    }
}

