use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::{Message, Utf8Bytes};
use futures_util::{SinkExt as _, StreamExt as _};

use crate::shared::{TunnelStatus, millis};
use crate::sync::SyncEvent;

pub const DEFAULT_PORT: u16 = 4747;

#[derive(Clone)]
pub struct RelayHandle {
    inner: Arc<RelayInner>,
}

struct RelayInner {
    tx: tokio::sync::broadcast::Sender<String>,
    msgs: std::sync::Mutex<std::collections::VecDeque<SyncEvent>>,
    count: std::sync::Mutex<u32>,
}

impl RelayHandle {
    pub fn new() -> Self {
        let (tx, _) = tokio::sync::broadcast::channel(256);
        RelayHandle {
            inner: Arc::new(RelayInner {
                tx,
                msgs: std::sync::Mutex::new(std::collections::VecDeque::new()),
                count: std::sync::Mutex::new(0),
            }),
        }
    }

    pub fn subscribe(&self) -> tokio::sync::broadcast::Receiver<String> {
        self.inner.tx.subscribe()
    }

    /// queue + broadcast a local event to every connected remote device
    pub fn ev(&self, ev: SyncEvent) {
        let json = serde_json::to_string(&ev).unwrap_or_default();
        {
            let mut q = self.inner.msgs.lock().unwrap();
            q.push_back(ev);
            while q.len() > 500 {
                q.pop_front();
            }
        }
        *self.inner.count.lock().unwrap() = self.inner.count.lock().unwrap().wrapping_add(1);
        let _ = self.inner.tx.send(json);
    }

    pub fn queued(&self, limit: usize) -> Vec<String> {
        let q = self.inner.msgs.lock().unwrap();
        q.iter().rev().take(limit).map(|e| serde_json::to_string(e).unwrap_or_default()).collect()
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub status: TunnelStatus,
    pub device_count: u32,
    pub addr: Option<String>,
    pub relay: Option<String>,
    pub error: Option<String>,
}

pub struct RemoteManager {
    pub app: AppHandle,
    pub port: u16,
    pub relay: RelayHandle,
    pub status: Mutex<TunnelStatus>,
    pub running: Mutex<bool>,
    pub device_count: Mutex<u32>,
    tunnel_child: Mutex<Option<std::process::Child>>,
}

impl RemoteManager {
    pub fn new(app: AppHandle) -> Self {
        RemoteManager {
            app,
            port: DEFAULT_PORT,
            relay: RelayHandle::new(),
            status: Mutex::new(TunnelStatus::Off),
            running: Mutex::new(false),
            device_count: Mutex::new(0),
            tunnel_child: Mutex::new(None),
        }
    }

    pub fn info(&self) -> RemoteInfo {
        RemoteInfo {
            status: self.status.lock().unwrap().clone(),
            device_count: *self.device_count.lock().unwrap(),
            addr: Some(format!("http://127.0.0.1:{}", self.port)),
            relay: Some("ws://127.0.0.1:{port}/relay".replace("{port}", &self.port.to_string())),
            error: None,
        }
    }

    fn set_status(&self, s: TunnelStatus) {
        *self.status.lock().unwrap() = s;
        let _ = self.app.emit("remote:status", serde_json::to_string(&self.info()).unwrap_or_default());
    }

    pub fn bump_devices(&self, delta: i32) {
        let mut c = self.device_count.lock().unwrap();
        *c = ((*c as i32) + delta).max(0) as u32;
    }

    /// bind + accept loop. runs forever in a tokio task.
    pub async fn listen(&self) -> std::io::Result<()> {
        {
            let mut r = self.running.lock().unwrap();
            *r = true;
        }
        self.set_status(TunnelStatus::LocalOnly);

        let listener = TcpListener::bind(format!("0.0.0.0:{}", self.port)).await?;
        self.app
            .emit("remote:status", serde_json::to_string(&self.info()).unwrap_or_default())
            .ok();

        loop {
            let (stream, _peer) = match listener.accept().await {
                Ok(x) => x,
                Err(_) => continue,
            };
            let relay = self.relay.clone();
            let app = self.app.clone();
            let mgr = self.clone_for_conn();
            tauri::async_runtime::spawn(async move {
                mgr.on_conn(stream, relay, app).await;
            });
        }
    }

    async fn on_conn(&self, stream: TcpStream, relay: RelayHandle, app: AppHandle) {
        let mut stream = stream;

        // peek request head without consuming (TcpStream::peek)
        let mut buf = [0u8; 4096];
        let _ = match tokio::time::timeout(Duration::from_millis(1500), stream.peek(&mut buf)).await {
            Ok(Ok(n)) => n,
            _ => return,
        };
        let head = String::from_utf8_lossy(&buf);
        let req_line = head.lines().next().unwrap_or("").to_string();
        let mut is_ws = false;
        for line in head.lines() {
            let l = line.to_ascii_lowercase();
            if l.starts_with("upgrade:") && l.contains("websocket") {
                is_ws = true;
            }
        }
        let method = req_line.split_whitespace().next().unwrap_or("GET");
        let path = req_line.split_whitespace().nth(1).unwrap_or("/").to_string();

        if is_ws {
            // full stream handed to tungstenite; it reads the (unconsumed) request
            // and writes the 101 reply itself
            let ws_path = path.clone();
            let ws = match tokio_tungstenite::accept_async(stream).await {
                Ok(ws) => ws,
                Err(_) => return,
            };
            self.serve_ws(ws, ws_path, relay, app).await;
            return;
        }

        // --- plain HTTP (pair / ping / phone ui) ---
        let mut resp: Vec<u8>;
        if path == "/pair" && method == "GET" {
            let body = br#"{"paired":true,"product":"pq","port":4747}"#;
            resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            )
            .into_bytes();
            resp.extend_from_slice(body);
        } else if path == "/ping" || path == "/health" {
            let body = "pq";
            resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            )
            .into_bytes();
            resp.extend_from_slice(body.as_bytes());
        } else {
            // bundled phone UI
            let root = app
                .path()
                .resolve("ui", tauri::path::BaseDirectory::Resource)
                .unwrap_or_default();
            let rel = if path.starts_with('/') { path.trim_start_matches('/') } else { &path };
            let rel = if rel.is_empty() || rel == "ui" {
                "index.html"
            } else if let Some(stripped) = rel.strip_prefix("ui/") {
                stripped
            } else {
                rel
            };
            let file = root.join(rel);
            match std::fs::read(&file) {
                Ok(body) => {
                    let mime = mime_of(&file);
                    resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    )
                    .into_bytes();
                    resp.extend_from_slice(&body);
                }
                Err(_) => {
                    resp = b"HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nContent-Length: 2\r\nConnection: close\r\n\r\nNO"
                        .to_vec();
                }
            }
        }
        let _ = stream.write_all(&resp).await;
    }

    async fn serve_ws(
        &self,
        ws: tokio_tungstenite::WebSocketStream<TcpStream>,
        _path: String,
        relay: RelayHandle,
        app: AppHandle,
    ) {
        self.bump_devices(1);
        let (mut write, mut read) = ws.split();
        let mut rx = relay.subscribe();

        for json in relay.queued(200) {
            if write.send(Message::Text(Utf8Bytes::from(json))).await.is_err() {
                break;
            }
        }

        let fwd = tauri::async_runtime::spawn(async move {
            while let Ok(json) = rx.recv().await {
                if write.send(Message::Text(Utf8Bytes::from(json))).await.is_err() {
                    break;
                }
            }
        });

        while let Some(Ok(msg)) = read.next().await {
            match msg {
                Message::Text(t) => {
                    let text = t.to_string();
                    let app2 = app.clone();
                    tauri::async_runtime::spawn(async move {
                        remote_dispatch(&app2, &text).await;
                    });
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
        fwd.abort();
        self.bump_devices(-1);
    }

    pub fn clone_for_conn(&self) -> RemoteManager {
        RemoteManager {
            app: self.app.clone(),
            port: self.port,
            relay: RelayHandle {
                inner: Arc::clone(&self.relay.inner),
            },
            status: Mutex::new(self.status.lock().unwrap().clone()),
            running: Mutex::new(*self.running.lock().unwrap()),
            device_count: Mutex::new(*self.device_count.lock().unwrap()),
            tunnel_child: Mutex::new(None),
        }
    }
}

/// forward inbound remote JSON into renderer as remote:relay
async fn remote_dispatch(app: &AppHandle, text: &str) {
    match serde_json::from_str::<SyncEvent>(text) {
        Ok(ev) => {
            let _ = app.emit("remote:relay", serde_json::to_string(&ev).unwrap_or_default());
        }
        Err(_) => {
            let _ = app.emit("remote:relay", text.to_string());
        }
    }
}

pub fn mime_of(file: &std::path::Path) -> &'static str {
    match file.extension().and_then(|e| e.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "application/javascript; charset=utf-8",
        Some("mjs") => "application/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("wasm") => "application/wasm",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("ico") => "image/x-icon",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        _ => "application/octet-stream",
    }
}

// minimal in-memory TcpStream used only to plumb buffered HTTP handshake bytes
// ---- tunnel helpers -------------------------------------------------------

pub fn bin_dir() -> PathBuf {
    crate::env::app_bin_dir()
}

pub fn cloudflared_path() -> PathBuf {
    let d = bin_dir();
    let direct = d.join("cloudflared.exe");
    if direct.exists() {
        return direct;
    }
    // PATH fallback
    if let Ok(path) = std::env::var("PATH") {
        for p in path.split(';') {
            let cand = std::path::Path::new(p).join("cloudflared.exe");
            if cand.exists() {
                return cand;
            }
        }
    }
    direct
}

pub async fn ensure_cloudflared() -> Result<PathBuf, String> {
    let p = cloudflared_path();
    if p.exists() {
        return Ok(p);
    }
    let url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";
    let _ = std::fs::create_dir_all(&crate::env::app_bin_dir());
    let tmp = crate::env::app_bin_dir().join("cloudflared.exe.download");
    let bytes = reqwest::Client::new()
        .get(url)
        .send()
        .await
        .map_err(|e| format!("download failed: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("download failed: {e}"))?;
    std::fs::write(&tmp, &bytes).map_err(|e| format!("write failed: {e}"))?;
    std::fs::rename(&tmp, &p).map_err(|e| format!("rename failed: {e}"))?;
    Ok(p)
}

pub async fn spawn_tunnel(mgr: &RemoteManager, name: &str) -> Result<String, String> {
    {
        let mut c = mgr.tunnel_child.lock().unwrap();
        if let Some(child) = c.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
        *c = None;
    }
    mgr.set_status(TunnelStatus::Restarting);

    let this = mgr.app.clone();
    let exe = cloudflared_path();

    let full = name.to_string();
    let mut child = std::process::Command::new(&exe)
        .args(["tunnel", "--no-autoupdate", "--url", &format!("http://127.0.0.1:{}", mgr.port)])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("cloudflared failed to start: {e}"))?;

    // scrape the public hostname from logs
    let public = tunnel_hostname(&mut child, Duration::from_secs(15)).await;

    *mgr.tunnel_child.lock().unwrap() = Some(child);

    let status = match &public {
        Some(host) => TunnelStatus::Tunneled {
            name: full,
            addr: host.clone(),
            online_at: millis(),
        },
        None => TunnelStatus::Restarting,
    };
    mgr.set_status(status);
    let _ = this.emit(
        "remote:status",
        serde_json::to_string(&mgr.info()).unwrap_or_default(),
    );

    public.ok_or_else(|| "cloudflared start failed (no tunnel URL within 15s)".to_string())
}

/// poll cloudflared stdout/stderr for the assigned public hostname
async fn tunnel_hostname(child: &mut std::process::Child, timeout: Duration) -> Option<String> {
    use std::io::Read as _;

    let acc = Arc::new(Mutex::new(String::new()));

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let mut threads = Vec::new();
    if let Some(pipe) = stdout {
        let acc = Arc::clone(&acc);
        threads.push(std::thread::spawn(move || {
            let mut f = pipe;
            let mut chunk = [0u8; 1024];
            loop {
                match f.read(&mut chunk) {
                    Ok(0) => break,
                    Ok(n) => {
                        acc.lock().unwrap().push_str(&String::from_utf8_lossy(&chunk[..n]));
                        if acc.lock().unwrap().contains("trycloudflare.com") {
                            break;
                        }
                    }
                    Err(_) => std::thread::sleep(Duration::from_millis(40)),
                }
            }
        }));
    }
    if let Some(pipe) = stderr {
        let acc = Arc::clone(&acc);
        threads.push(std::thread::spawn(move || {
            let mut f = pipe;
            let mut chunk = [0u8; 1024];
            loop {
                match f.read(&mut chunk) {
                    Ok(0) => break,
                    Ok(n) => {
                        acc.lock().unwrap().push_str(&String::from_utf8_lossy(&chunk[..n]));
                        if acc.lock().unwrap().contains("trycloudflare.com") {
                            break;
                        }
                    }
                    Err(_) => std::thread::sleep(Duration::from_millis(40)),
                }
            }
        }));
    }

    let deadline = std::time::Instant::now() + timeout;
    loop {
        if std::time::Instant::now() > deadline {
            return None;
        }
        {
            let text = acc.lock().unwrap().clone();
            if let Some(idx) = text.find("trycloudflare.com") {
                let start = text[..idx]
                    .rfind(|c: char| !(c.is_alphanumeric() || c == '-' || c == '.'))
                    .map(|i| i + 1)
                    .unwrap_or(0);
                let sub = &text[start..idx + "trycloudflare.com".len()];
                if sub.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '.') {
                    return Some(format!("https://{sub}"));
                }
            }
        }
        std::thread::sleep(Duration::from_millis(80));
    }
}

pub fn stop_tunnel(mgr: &RemoteManager) {
    let mut c = mgr.tunnel_child.lock().unwrap();
    if let Some(child) = c.as_mut() {
        let _ = child.kill();
        let _ = child.wait();
    }
    *c = None;
    mgr.set_status(TunnelStatus::Off);
}

// module-level registry used by sync to locate any RemoteManager
pub mod reg {
    use std::sync::Mutex;
    use crate::sync::SyncEvent;

    static RELAY: Mutex<Option<crate::remote::RelayHandle>> = Mutex::new(None);

    pub fn set(handle: crate::remote::RelayHandle) {
        *RELAY.lock().unwrap() = Some(handle);
    }

    pub fn get() -> Option<crate::remote::RelayHandle> {
        RELAY.lock().unwrap().clone()
    }

    pub fn ev(ev: SyncEvent) {
        if let Some(h) = RELAY.lock().unwrap().clone() {
            h.ev(ev);
        }
    }
}