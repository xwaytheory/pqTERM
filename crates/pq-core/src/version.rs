//! App / crate version constants.

/// Crate version from Cargo (pq-core).
pub const PQ_CORE_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Workspace product version for updater comparisons (bump with releases).
/// Align with Electron package.json when cutting a Rust release channel.
pub const WORKSPACE_VERSION: &str = "0.1.0";
