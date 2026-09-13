use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use portable_pty::PtySize;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri::async_runtime::JoinHandle as TauriJoin;

use crate::shared::millis;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TermDataPayload {
    pub pane_id: String,
    pub data: String,
    pub seq: u32,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TermExitPayload {
    pub pane_id: String,
    pub code: Option<i32>,
}

pub struct PtySize2d {
    pub cols: u16,
    pub rows: u16,
    pub cols_px: u16,
    pub rows_px: u16,
}

struct Session {
    master: Box<dyn portable_pty::MasterPty + Send>,
    child_writer: Box<dyn Write + Send>,
    seq: u32,
    maxbuf: Vec<String>,
    cur_buf_len: usize,
    handle: Option<TauriJoin<()>>,
}

const MAX_BUF: usize = 512 * 1024;

pub struct PtyManager {
    app: AppHandle,
    sessions: Arc<Mutex<HashMap<String, Session>>>,
    active_panes: Arc<Mutex<HashSet<String>>>,
}

impl PtyManager {
    pub fn new(app: AppHandle) -> Self {
        PtyManager {
            app,
            sessions: Arc::new(Mutex::new(HashMap::new())),
            active_panes: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    pub fn set_active_panes(&self, pane_ids: Vec<String>) {
        let mut a = self.active_panes.lock().unwrap();
        a.clear();
        a.extend(pane_ids);
    }

    pub fn set_all_active(&self) {
        let ids: Vec<String> = {
            let s = self.sessions.lock().unwrap();
            s.keys().cloned().collect()
        };
        self.set_active_panes(ids);
    }

    pub fn list_pane_ids(&self) -> Vec<String> {
        self.sessions.lock().unwrap().keys().cloned().collect()
    }

    pub fn spawn(
        &self,
        pane_id: &str,
        spawn_file: &str,
        args: &[String],
        cwd: &str,
        env: HashMap<String, String>,
        size: PtySize2d,
    ) -> bool {
        let svc = self.app.clone();
        let pane_id = pane_id.to_string();
        let spawn_file = spawn_file.to_string();
        let args: Vec<String> = args.to_vec();
        let cwd = cwd.to_string();

        let ptsize = PtySize {
            rows: size.rows,
            cols: size.cols,
            pixel_width: size.cols_px,
            pixel_height: size.rows_px,
        };

        let pty_sys = portable_pty::native_pty_system();
        let pair = match pty_sys.openpty(ptsize) {
            Ok(p) => p,
            Err(e) => {
                eprintln!("[pq] openpty failed: {e}");
                let _ = svc.emit("term:exit", TermExitPayload { pane_id, code: None });
                return false;
            }
        };

        let mut cmd = portable_pty::CommandBuilder::new(&spawn_file);
        cmd.args(args.iter().map(|s| s.as_str()));
        cmd.cwd(&cwd);
        for (k, v) in env {
            cmd.env(k, v);
        }

        let mut child = match pair.slave.spawn_command(cmd) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[pq] spawn failed for {spawn_file}: {e}");
                let _ = svc.emit("term:exit", TermExitPayload { pane_id: pane_id.clone(), code: None });
                return false;
            }
        };

        let mut writer = match pair.master.take_writer() {
            Ok(w) => w,
            Err(e) => {
                eprintln!("[pq] take_writer failed: {e}");
                let _ = svc.emit("term:exit", TermExitPayload { pane_id: pane_id.clone(), code: None });
                return false;
            }
        };
        // reader must be cloned before master is moved into the session map
        let mut reader = match pair.master.try_clone_reader() {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[pq] clone reader failed: {e}");
                let _ = svc.emit("term:exit", TermExitPayload { pane_id: pane_id.clone(), code: None });
                return false;
            }
        };
        let master = pair.master;

        self.sessions.lock().unwrap().insert(
            pane_id.clone(),
            Session {
                master,
                child_writer: writer,
                seq: 0,
                maxbuf: Vec::new(),
                cur_buf_len: 0,
                handle: None,
            },
        );
        let sessions = self.sessions.clone();
        let active = self.active_panes.clone();
        let app = svc.clone();
        let pane_owner = pane_id.clone();
        let handle = tauri::async_runtime::spawn(Box::pin(async move {
            let mut buf = [0u8; 8192];
            loop {
                let n = match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => n,
                    Err(_) => break,
                };
                {
                    let mut s = sessions.lock().unwrap();
                    if let Some(sess) = s.get_mut(&pane_owner) {
                        sess.seq = sess.seq.wrapping_add(1);
                        sess.cur_buf_len += n;
                        while sess.cur_buf_len > MAX_BUF && !sess.maxbuf.is_empty() {
                            let removed = sess.maxbuf.remove(0);
                            sess.cur_buf_len -= removed.len();
                        }
                        sess.maxbuf.push(String::from_utf8_lossy(&buf[..n]).to_string());
                    }
                }
                let data = B64.encode(&buf[..n]);
                if let Some(sess) = sessions.lock().unwrap().get(&pane_owner) {
                    app.emit("term:data", TermDataPayload {
                        pane_id: pane_owner.clone(),
                        data,
                        seq: sess.seq,
                    })
                    .ok();
                }
            }
            drop(reader);
            // wait for child
            let code = child.wait().ok().map(|s| s.exit_code() as i32);
            {
                let mut s = sessions.lock().unwrap();
                s.remove(&pane_owner);
            }
            let _ = app.emit("term:exit", TermExitPayload { pane_id: pane_owner, code });
        }));

        {
            let mut s = self.sessions.lock().unwrap();
            if let Some(sess) = s.get_mut(&pane_id) {
                sess.handle = Some(handle);
            }
        }
        true
    }

    pub fn resize(&self, pane_id: &str, size: PtySize2d) {
        let ptsize = PtySize {
            rows: size.rows,
            cols: size.cols,
            pixel_width: size.cols_px,
            pixel_height: size.rows_px,
        };
        let mut s = self.sessions.lock().unwrap();
        if let Some(sess) = s.get_mut(pane_id) {
            let _ = sess.master.resize(ptsize);
        }
    }

    pub fn write(&self, pane_id: &str, data: &str) -> bool {
        let bytes = match B64.decode(data) {
            Ok(b) => b,
            Err(_) => return false,
        };
        let mut s = self.sessions.lock().unwrap();
        if let Some(sess) = s.get_mut(pane_id) {
            if sess.child_writer.write_all(&bytes).is_ok() {
                let _ = sess.child_writer.flush();
                return true;
            }
        }
        false
    }

    pub fn kill_pane(&self, pane_id: &str) {
        let child_writer = {
            let mut s = self.sessions.lock().unwrap();
            s.get_mut(pane_id).map(|sess| {
                let w = std::mem::replace(&mut sess.child_writer, Box::new(std::io::sink()));
                w
            })
        };
        if let Some(mut w) = child_writer {
            let _ = w.write_all(&[3u8, 28u8]); // Ctrl+C then Ctrl+\
            let _ = w.flush();
        }
        let mut s = self.sessions.lock().unwrap();
        if let Some(sess) = s.get_mut(pane_id) {
            if let Some(h) = sess.handle.take() {
                // best-effort: detached reader owns child wait/exit emit
                drop(h);
            }
        }
    }

    pub fn kill_all(&self) {
        let ids: Vec<String> = self.sessions.lock().unwrap().keys().cloned().collect();
        for id in ids {
            self.kill_pane(&id);
        }
    }

    /// collect everything read by a pane since boot (used by resume/voice context)
    pub fn maxbuf(&self, pane_id: &str) -> Option<String> {
        let s = self.sessions.lock().unwrap();
        s.get(pane_id).map(|sess| sess.maxbuf.join("\n"))
    }
}