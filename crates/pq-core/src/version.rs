//! App / crate version constants.
//!
//! **Dual-track versioning (documented):**
//! - Electron product (`package.json`) and Rust workspace (`WORKSPACE_VERSION`)
//!   share the same product semver (`1.1.8`) for updater / release alignment.
//! - Individual crate metadata uses the workspace version via Cargo.
//! - Do not invent a separate Rust-only product version without updating both.

/// Crate version from Cargo (pq-core).
pub const PQ_CORE_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Workspace product version for updater comparisons (bump with releases).
/// Synced with Electron `package.json` version `1.5.4`.
pub const WORKSPACE_VERSION: &str = "1.5.4";
