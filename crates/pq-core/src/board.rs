//! Board sketch — Electron `src/main/board.ts` (`.pq/board.json` + live pane scrape).
//!
//! Phase 1–2: Electron-parity types + overlap notes + ANSI strip + hub stub. No git porcelain / live scrape timer.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Relative board file under a workspace cwd (Electron writes `.pq/board.json`).
pub const BOARD_REL_PATH: &str = ".pq/board.json";

/// Markdown board twin of Electron `boardPath()` → `.pq/BOARD.md`.
pub const BOARD_MD_REL: &str = ".pq/BOARD.md";
/// File scrape freshness window (Electron `stale = 120000`).
pub const FILE_STALE_MS: i64 = 120_000;

/// Resolve `{cwd}/.pq/BOARD.md`.
pub fn board_md_path(cwd: impl AsRef<Path>) -> PathBuf {
    cwd.as_ref().join(BOARD_MD_REL)
}

/// Minimal ANSI CSI / OSC strip (Electron `stripAnsi` subset — not a full VT parser).
pub fn strip_ansi_basic(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == 0x1b {
            if i + 1 < bytes.len() && bytes[i + 1] == b'[' {
                i += 2;
                while i < bytes.len() {
                    let c = bytes[i];
                    i += 1;
                    if (0x40..=0x7e).contains(&c) {
                        break;
                    }
                }
                continue;
            }
            if i + 1 < bytes.len() && bytes[i + 1] == b']' {
                i += 2;
                while i < bytes.len() {
                    if bytes[i] == 0x07 {
                        i += 1;
                        break;
                    }
                    if bytes[i] == 0x1b && i + 1 < bytes.len() && bytes[i + 1] == 0x5c {
                        i += 2;
                        break;
                    }
                    i += 1;
                }
                continue;
            }
            i += 1;
            continue;
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

/// Pure overlap/related notes (Electron `BoardHub.notes`) — no I/O.
pub fn compute_overlap_notes(panes: &[BoardPane]) -> Vec<BoardNote> {
    let live: Vec<&BoardPane> = panes.iter().filter(|p| p.alive && !p.files.is_empty()).collect();
    let mut notes = Vec::new();
    for i in 0..live.len() {
        for j in (i + 1)..live.len() {
            let a = live[i];
            let b = live[j];
            let share: Vec<&String> = a.files.iter().filter(|f| b.files.contains(f)).collect();
            if !share.is_empty() {
                let detail = format!(
                    "{} i {}: {}",
                    a.title,
                    b.title,
                    share
                        .iter()
                        .take(6)
                        .map(|s| s.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                );
                notes.push(BoardNote {
                    relation: BoardRelation::Overlap,
                    engines: vec![a.engine.clone(), b.engine.clone()],
                    detail,
                });
                continue;
            }
            let tops_a: std::collections::HashSet<&str> = a
                .files
                .iter()
                .filter_map(|f| f.split(['/', '\\']).next())
                .collect();
            let tops_b: std::collections::HashSet<&str> = b
                .files
                .iter()
                .filter_map(|f| f.split(['/', '\\']).next())
                .collect();
            let top_share: Vec<&str> = tops_a.iter().copied().filter(|t| tops_b.contains(t)).collect();
            if !top_share.is_empty() {
                notes.push(BoardNote {
                    relation: BoardRelation::Related,
                    engines: vec![a.engine.clone(), b.engine.clone()],
                    detail: format!("{} i {} w {}", a.title, b.title, top_share.join(", ")),
                });
            }
        }
    }
    notes.truncate(12);
    notes
}

/// In-memory board hub sketch (no timer / git porcelain — Electron remains writer).
#[derive(Debug, Default)]
pub struct BoardHubStub {
    pub cwd: String,
    pub panes: Vec<BoardPane>,
    pub last: Option<BoardSnapshot>,
}

impl BoardHubStub {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn attach(&mut self, cwd: impl Into<String>) {
        self.cwd = cwd.into();
    }

    pub fn detach(&mut self) {
        self.cwd.clear();
        self.panes.clear();
        self.last = None;
    }

    pub fn pane_start(
        &mut self,
        pane_id: impl Into<String>,
        engine: impl Into<String>,
        title: impl Into<String>,
    ) {
        let pane_id = pane_id.into();
        self.panes.retain(|p| p.pane_id != pane_id);
        self.panes.push(BoardPane {
            pane_id,
            engine: engine.into(),
            title: title.into(),
            files: Vec::new(),
            alive: true,
        });
    }

    pub fn pane_end(&mut self, pane_id: &str) {
        if let Some(p) = self.panes.iter_mut().find(|p| p.pane_id == pane_id) {
            p.alive = false;
        }
    }

    pub fn snapshot(&self, updated_at: i64, git: Vec<String>) -> BoardSnapshot {
        let notes = compute_overlap_notes(&self.panes);
        BoardSnapshot {
            cwd: self.cwd.clone(),
            board_path: board_md_path(&self.cwd).to_string_lossy().into_owned(),
            updated_at,
            panes: self.panes.clone(),
            git,
            notes,
        }
    }

    pub fn flush_memory(&mut self, updated_at: i64, git: Vec<String>) -> &BoardSnapshot {
        let snap = self.snapshot(updated_at, git);
        self.last = Some(snap);
        self.last.as_ref().unwrap()
    }
}


#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BoardRelation {
    Independent,
    Related,
    Overlap,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BoardPane {
    pub pane_id: String,
    pub engine: String,
    pub title: String,
    #[serde(default)]
    pub files: Vec<String>,
    pub alive: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BoardNote {
    pub relation: BoardRelation,
    pub engines: Vec<String>,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BoardSnapshot {
    pub cwd: String,
    pub board_path: String,
    pub updated_at: i64,
    pub panes: Vec<BoardPane>,
    pub git: Vec<String>,
    pub notes: Vec<BoardNote>,
}

/// Resolve `{cwd}/.pq/board.json`.
pub fn board_path(cwd: impl AsRef<Path>) -> PathBuf {
    cwd.as_ref().join(BOARD_REL_PATH)
}

/// Empty snapshot for a cwd (no scrape).
pub fn empty_board(cwd: impl AsRef<Path>, updated_at: i64) -> BoardSnapshot {
    let cwd = cwd.as_ref();
    let path = board_path(cwd);
    BoardSnapshot {
        cwd: cwd.to_string_lossy().into_owned(),
        board_path: path.to_string_lossy().into_owned(),
        updated_at,
        panes: Vec::new(),
        git: Vec::new(),
        notes: Vec::new(),
    }
}

/// Load board JSON if present; `Ok(None)` when missing.
pub fn load_board(cwd: impl AsRef<Path>) -> Result<Option<BoardSnapshot>, String> {
    let path = board_path(cwd);
    if !path.is_file() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let snap: BoardSnapshot = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    Ok(Some(snap))
}

/// Write board JSON (creates `.pq` dir). Prefer Electron writer until cutover.
pub fn save_board(snap: &BoardSnapshot) -> Result<(), String> {
    let path = PathBuf::from(&snap.board_path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(snap).map_err(|e| e.to_string())?;
    std::fs::write(&path, raw).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn board_path_joins_pq() {
        let p = board_path("C:\\work\\proj");
        assert!(p.ends_with(".pq/board.json") || p.ends_with(".pq\\board.json"));
    }

    #[test]
    fn empty_and_roundtrip_temp() {
        let dir = std::env::temp_dir().join(format!(
            "pq-board-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let mut snap = empty_board(&dir, 42);
        snap.panes.push(BoardPane {
            pane_id: "p1".into(),
            engine: "grok".into(),
            title: "Grok".into(),
            files: vec!["src/main.rs".into()],
            alive: true,
        });
        snap.notes.push(BoardNote {
            relation: BoardRelation::Independent,
            engines: vec!["grok".into()],
            detail: "solo".into(),
        });
        save_board(&snap).unwrap();
        let loaded = load_board(&dir).unwrap().expect("present");
        assert_eq!(loaded.panes.len(), 1);
        assert_eq!(loaded.notes[0].relation, BoardRelation::Independent);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn strip_ansi_removes_csi() {
        let raw = format!("hi\x1b[31mred\x1b[0m!");
        let s = strip_ansi_basic(&raw);
        assert_eq!(s, "hired!");
    }

    #[test]
    fn overlap_notes_detect_share() {
        let panes = vec![
            BoardPane {
                pane_id: "a".into(),
                engine: "grok".into(),
                title: "Grok".into(),
                files: vec!["src/main.rs".into(), "src/lib.rs".into()],
                alive: true,
            },
            BoardPane {
                pane_id: "b".into(),
                engine: "claude".into(),
                title: "Claude".into(),
                files: vec!["src/main.rs".into()],
                alive: true,
            },
        ];
        let notes = compute_overlap_notes(&panes);
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].relation, BoardRelation::Overlap);
    }

    #[test]
    fn hub_stub_flush() {
        let mut hub = BoardHubStub::new();
        hub.attach(r"C:\work");
        hub.pane_start("p1", "grok", "Grok");
        let snap = hub.flush_memory(1, vec![" M src/a.rs".into()]);
        assert_eq!(snap.panes.len(), 1);
        assert!(snap.board_path.contains("BOARD.md"));
    }
}
