//! Auto-update stubs: check-on-launch flow + manifest types + fixture fetch.
//!
//! # Check-on-launch flow (documented; not fully wired in Phase 1)
//!
//! 1. `pq-work` / `pq-voice` starts and reads embedded `WORKSPACE_VERSION`.
//! 2. Call `fetch_manifest(url)` against GitHub Releases JSON (or static CDN).
//! 3. `compare_semver(current, manifest.latest)` — if remote is newer, prompt/apply.
//! 4. Download asset URL for the current platform; verify checksum when present.
//! 5. Stage replace + relaunch (platform-specific; TBD Phase 2+).
//!
//! Phase 1: types + semver compare + [`ManifestFetch`] impls (mock / file / GitHub shape).
//! No network required — use [`FileManifestFetch`] + `fixtures/update-manifest.json`.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use thiserror::Error;

/// Sketch of the GitHub Releases / CDN manifest consumed on launch.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UpdateManifest {
    /// Latest semver string, e.g. `"1.2.0"`.
    pub latest: String,
    /// Optional release notes / channel tag.
    #[serde(default)]
    pub channel: Option<String>,
    /// ISO-ish publish time (opaque string for now).
    #[serde(default)]
    pub published_at: Option<String>,
    /// Platform assets.
    #[serde(default)]
    pub assets: Vec<UpdateAsset>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UpdateAsset {
    /// e.g. `windows-x64`, `linux-x64`, `darwin-arm64`
    pub platform: String,
    pub url: String,
    #[serde(default)]
    pub sha256: Option<String>,
    #[serde(default)]
    pub size: Option<u64>,
}

/// Minimal GitHub Releases API list/item shape (subset) for fixture parsing.
/// See <https://docs.github.com/en/rest/releases/releases>.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GitHubReleaseFixture {
    pub tag_name: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub published_at: Option<String>,
    #[serde(default)]
    pub prerelease: bool,
    #[serde(default)]
    pub assets: Vec<GitHubReleaseAsset>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GitHubReleaseAsset {
    pub name: String,
    pub browser_download_url: String,
    #[serde(default)]
    pub size: Option<u64>,
}

#[derive(Debug, Error)]
pub enum UpdaterError {
    #[error("invalid semver: {0}")]
    InvalidSemver(String),
    #[error("manifest fetch failed: {0}")]
    Fetch(String),
    #[error("manifest parse failed: {0}")]
    Parse(String),
}

/// How binaries should behave on launch (documentation + default plan).
#[derive(Debug, Clone)]
pub struct CheckOnLaunchPlan {
    pub manifest_url: String,
    pub current_version: String,
    pub check_enabled: bool,
}

/// Fake remote latest used only by Phase-1/2 stubs so `compare_semver` is not a tautology
/// (`current == current`). Replace with real `fetch_manifest` when networking is wired.
pub const STUB_REMOTE_LATEST: &str = "1.1.2";

impl Default for CheckOnLaunchPlan {
    fn default() -> Self {
        Self {
            // Placeholder; real Releases URL decided when first Rust channel ships.
            manifest_url: "https://github.com/xwaytheory/pq/releases/latest/download/pq-update-manifest.json"
                .into(),
            current_version: crate::version::WORKSPACE_VERSION.into(),
            check_enabled: true,
        }
    }
}

impl CheckOnLaunchPlan {
    /// Demo compare against [`STUB_REMOTE_LATEST`] (not a real network check).
    pub fn stub_remote_delta(&self) -> Result<i32, UpdaterError> {
        compare_semver(&self.current_version, STUB_REMOTE_LATEST)
    }
}

/// Abstraction so Phase 1 builds without reqwest; swap for HTTP later.
pub trait ManifestFetch {
    fn fetch(&self, url: &str) -> Result<String, UpdaterError>;
}

/// Mock fetch used in tests / stubs.
#[derive(Debug, Default)]
pub struct MockManifestFetch {
    pub body: String,
}

impl ManifestFetch for MockManifestFetch {
    fn fetch(&self, _url: &str) -> Result<String, UpdaterError> {
        Ok(self.body.clone())
    }
}

/// Read manifest JSON from a local file (no network).
///
/// `url` may be a filesystem path, or `file:///...`, or ignored when [`Self::path`] is set.
#[derive(Debug, Clone)]
pub struct FileManifestFetch {
    pub path: PathBuf,
}

impl FileManifestFetch {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }
}

impl ManifestFetch for FileManifestFetch {
    fn fetch(&self, url: &str) -> Result<String, UpdaterError> {
        let path = if self.path.as_os_str().is_empty() {
            PathBuf::from(url.trim_start_matches("file://"))
        } else {
            self.path.clone()
        };
        std::fs::read_to_string(&path).map_err(|e| {
            UpdaterError::Fetch(format!("{}: {e}", path.display()))
        })
    }
}

/// Fetch + parse pq [`UpdateManifest`] via any [`ManifestFetch`] impl.
pub fn fetch_manifest(
    fetcher: &dyn ManifestFetch,
    url: &str,
) -> Result<UpdateManifest, UpdaterError> {
    let raw = fetcher.fetch(url)?;
    serde_json::from_str(&raw).map_err(|e| UpdaterError::Parse(e.to_string()))
}

/// Parse a GitHub Releases JSON object into our lean [`UpdateManifest`].
pub fn manifest_from_github_release(rel: &GitHubReleaseFixture) -> UpdateManifest {
    let latest = rel.tag_name.trim().trim_start_matches('v').to_string();
    let assets = rel
        .assets
        .iter()
        .map(|a| UpdateAsset {
            platform: guess_platform_from_name(&a.name),
            url: a.browser_download_url.clone(),
            sha256: None,
            size: a.size,
        })
        .collect();
    UpdateManifest {
        latest,
        channel: if rel.prerelease {
            Some("prerelease".into())
        } else {
            Some("stable".into())
        },
        published_at: rel.published_at.clone(),
        assets,
    }
}

fn guess_platform_from_name(name: &str) -> String {
    let n = name.to_lowercase();
    if n.contains("win") || n.ends_with(".msi") || n.contains("setup") {
        "windows-x64".into()
    } else if n.contains("darwin") || n.contains("mac") {
        if n.contains("arm") {
            "darwin-arm64".into()
        } else {
            "darwin-x64".into()
        }
    } else if n.contains("linux") {
        "linux-x64".into()
    } else {
        "unknown".into()
    }
}

/// Load GitHub-shaped fixture from disk and convert.
pub fn fetch_github_fixture(
    path: impl AsRef<Path>,
) -> Result<UpdateManifest, UpdaterError> {
    let raw = std::fs::read_to_string(path.as_ref()).map_err(|e| {
        UpdaterError::Fetch(format!("{}: {e}", path.as_ref().display()))
    })?;
    let rel: GitHubReleaseFixture =
        serde_json::from_str(&raw).map_err(|e| UpdaterError::Parse(e.to_string()))?;
    Ok(manifest_from_github_release(&rel))
}

/// Minimal semver compare: `major.minor.patch` (pre-release ignored / rejected).
/// Returns `Ordering`-like: -1 if a < b, 0 if equal, 1 if a > b.
pub fn compare_semver(a: &str, b: &str) -> Result<i32, UpdaterError> {
    let pa = parse_triple(a)?;
    let pb = parse_triple(b)?;
    Ok(match pa.cmp(&pb) {
        std::cmp::Ordering::Less => -1,
        std::cmp::Ordering::Equal => 0,
        std::cmp::Ordering::Greater => 1,
    })
}

fn parse_triple(v: &str) -> Result<(u64, u64, u64), UpdaterError> {
    let core = v.trim().trim_start_matches('v');
    let core = core.split('-').next().unwrap_or(core);
    let core = core.split('+').next().unwrap_or(core);
    let mut parts = core.split('.');
    let major = parts
        .next()
        .ok_or_else(|| UpdaterError::InvalidSemver(v.into()))?
        .parse()
        .map_err(|_| UpdaterError::InvalidSemver(v.into()))?;
    let minor = parts
        .next()
        .unwrap_or("0")
        .parse()
        .map_err(|_| UpdaterError::InvalidSemver(v.into()))?;
    let patch = parts
        .next()
        .unwrap_or("0")
        .parse()
        .map_err(|_| UpdaterError::InvalidSemver(v.into()))?;
    if parts.next().is_some() {
        return Err(UpdaterError::InvalidSemver(v.into()));
    }
    Ok((major, minor, patch))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn semver_ordering() {
        assert_eq!(compare_semver("1.0.0", "1.0.1").unwrap(), -1);
        assert_eq!(compare_semver("1.2.0", "1.1.9").unwrap(), 1);
        assert_eq!(compare_semver("0.1.0", "0.1.0").unwrap(), 0);
    }

    #[test]
    fn mock_manifest_roundtrip() {
        let body = r#"{
            "latest": "1.2.0",
            "channel": "stable",
            "assets": [
                {"platform": "windows-x64", "url": "https://example.com/pq-work.exe"}
            ]
        }"#;
        let fetcher = MockManifestFetch {
            body: body.into(),
        };
        let m = fetch_manifest(&fetcher, "mock://").unwrap();
        assert_eq!(m.latest, "1.2.0");
        assert_eq!(m.assets.len(), 1);
    }

    #[test]
    fn file_manifest_fetch_roundtrip() {
        let dir = std::env::temp_dir().join("pq-updater-fixture-test");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("pq-update-manifest.json");
        std::fs::write(
            &path,
            r#"{"latest":"1.1.2","channel":"stable","assets":[{"platform":"windows-x64","url":"file:///fake/pq.msi","size":1}]}"#,
        )
        .unwrap();
        let fetcher = FileManifestFetch::new(&path);
        let m = fetch_manifest(&fetcher, "ignored").unwrap();
        assert_eq!(m.latest, "1.1.2");
        assert_eq!(compare_semver("1.1.1", &m.latest).unwrap(), -1);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn github_release_fixture_shape() {
        let raw = r#"{
          "tag_name": "v1.1.2",
          "name": "pq 1.1.2",
          "published_at": "2026-09-13T00:00:00Z",
          "prerelease": false,
          "assets": [
            {
              "name": "pq Setup 1.1.2.exe",
              "browser_download_url": "https://example.com/pq-Setup-1.1.2.exe",
              "size": 177000000
            },
            {
              "name": "pq 1.1.2.msi",
              "browser_download_url": "https://example.com/pq-1.1.2.msi",
              "size": 194000000
            }
          ]
        }"#;
        let rel: GitHubReleaseFixture = serde_json::from_str(raw).unwrap();
        let m = manifest_from_github_release(&rel);
        assert_eq!(m.latest, "1.1.2");
        assert_eq!(m.channel.as_deref(), Some("stable"));
        assert_eq!(m.assets.len(), 2);
        assert!(m.assets.iter().all(|a| a.platform == "windows-x64"));
    }
}
