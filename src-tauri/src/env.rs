use std::path::PathBuf;

pub fn running_dev() -> bool {
    if let Ok(v) = std::env::var("PQ_MODE") {
        if v.eq_ignore_ascii_case("dev") {
            return true;
        }
    }
    cfg!(debug_assertions)
}

pub fn product_name() -> &'static str {
    if running_dev() {
        "pq-dev"
    } else {
        "pq"
    }
}

/// `%APPDATA%\pq[-dev]` — userData directory (state, sessions, remote, bin).
pub fn app_data_dir() -> PathBuf {
    let base = std::env::var("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            dirs::config_dir().unwrap_or_else(|| std::path::PathBuf::from("."))
        });
    base.join(product_name())
}

pub fn home_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("."))
}

/// bin dir injected into agent PATH: %APPDATA%\pq[-dev]\bin
pub fn app_bin_dir() -> PathBuf {
    app_data_dir().join("bin")
}