#![allow(dead_code)] // manager surface; wired from host later
//! PtyManager — session map + spawn/write/resize/kill (Electron `pty-manager.ts` twin).
//!
//! Default build: registry + scrollback seq/buf, no OS handles (Electron remains production).
//! Optional `pty-spike` feature: `spawn_cmd` opens a real ConPTY via `portable-pty`
//! for short-lived command smoke (full engine launch still Electron).

use std::collections::HashMap;

#[cfg(feature = "pty-spike")]
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
#[cfg(feature = "pty-spike")]
use std::io::Write;
#[cfg(feature = "pty-spike")]
use std::sync::{Arc, Mutex};

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

/// One live (or recently exited) pane PTY session metadata.
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

/// In-memory PTY session registry (OS handles only with `pty-spike`).
#[derive(Default)]
pub struct PtyManager {
    sessions: HashMap<String, PtySessionMeta>,
    last_buf: HashMap<String, PtyBuffer>,
    #[cfg(feature = "pty-spike")]
    live: HashMap<String, LiveHandle>,
}

#[cfg(feature = "pty-spike")]
struct LiveHandle {
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
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
        if let Some(s) = self.sessions.get(pane_id) {
            return PtyBuffer {
                data: s.buf.clone(),
                seq: s.seq,
            };
        }
        self.last_buf.get(pane_id).cloned().unwrap_or_default()
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

    /// Register / re-register a session without an OS PTY (Electron parity spawn surface).
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
    pub fn push_output(&mut self, pane_id: &str, data: &str) -> bool {
        let Some(s) = self.sessions.get_mut(pane_id) else {
            return false;
        };
        if !s.alive {
            return false;
        }
        s.seq = s.seq.saturating_add(1);
        s.buf = append_buf(&s.buf, data);
        self.last_buf.insert(
            pane_id.to_string(),
            PtyBuffer {
                data: s.buf.clone(),
                seq: s.seq,
            },
        );
        true
    }

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
        // Registry-only mode: accept write as success when alive (Electron twin stub).
        true
    }

    /// Stub write alias (older tests / call sites).
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
        if let Some(s) = self.sessions.remove(pane_id) {
            self.last_buf.insert(
                pane_id.to_string(),
                PtyBuffer {
                    data: s.buf,
                    seq: s.seq,
                },
            );
        }
        #[cfg(feature = "pty-spike")]
        {
            if let Some(mut h) = self.live.remove(pane_id) {
                let _ = h.child.kill();
            }
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

    #[cfg(feature = "pty-spike")]
    fn mark_dead(&mut self, pane_id: &str) {
        if let Some(s) = self.sessions.get_mut(pane_id) {
            s.alive = false;
        }
        let _ = self.live.remove(pane_id);
    }

    /// Spike: spawn `cmd /D /Q /C <cmdline>` under ConPTY and register the pane.
    #[cfg(feature = "pty-spike")]
    pub fn spawn_cmd(&mut self, opts: SpawnOpts, cmdline: &str) -> Result<(), String> {
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

        let mut cmd = CommandBuilder::new("cmd.exe");
        cmd.args(["/D", "/Q", "/C", cmdline]);
        if !opts.cwd.is_empty() {
            cmd.cwd(&opts.cwd);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("spawn: {e}"))?;
        drop(pair.slave);

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("take writer: {e}"))?;
        let writer = Arc::new(Mutex::new(writer));

        let buf = opts.seed_buf.clone().unwrap_or_default();
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
            },
        );
        self.sessions.insert(opts.pane_id, meta);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spawn_write_resize_kill() {
        let mut m = PtyManager::new();
        m.spawn(SpawnOpts::new("p1", "ws1", "grok", "C:\\tmp", 80, 24));
        assert!(m.alive("p1"));
        assert!(m.write("p1", "hi"));
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
        assert!(m.write_stub("p1", "hi"));
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
}
