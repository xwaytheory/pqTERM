//! Auto-update stubs: check-on-launch flow + manifest types.
//!
//! # Check-on-launch flow (documented; not fully wired in Phase 1)
//!
//! 1. `pq-work` / `pq-voice` starts and reads embedded `WORKSPACE_VERSION`.
//! 2. Call `fetch_manifest(url)` against GitHub Releases JSON (or static CDN).
//! 3. `compare_semver(current, manifest.latest)` — if remote is newer, prompt/apply.
//! 4. Download asset URL for the current platform; verify checksum when present.
//! 5. Stage replace + relaunch (platform-specific; TBD Phase 2+).
//!
//! Phase 1: types + semver compare + trait/mock fetch only (no network required to build).

use serde::{Deserialize, Serialize};
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

/// Fetch + parse manifest via any [`ManifestFetch`] impl.
pub fn fetch_manifest(
    fetcher: &dyn ManifestFetch,
    url: &str,
) -> Result<UpdateManifest, UpdaterError> {
    let raw = fetcher.fetch(url)?;
    serde_json::from_str(&raw).map_err(|e| UpdaterError::Parse(e.to_string()))
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
}
