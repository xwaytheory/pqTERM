//! Board sketch — Electron `src/main/board.ts` (`.pq/board.json` + live pane scrape).
//!
//! Phase 1–2: serde types + path helper + empty snapshot. No git porcelain / ANSI scrape yet.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Relative board file under a workspace cwd (Electron writes `.pq/board.json`).
pub const BOARD_REL_PATH: &str = ".pq/board.json";

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
}
