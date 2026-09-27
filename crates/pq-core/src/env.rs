//! Product mode and Windows user-data paths (Electron `env.ts` / `app.getPath('userData')` twin).
//!
//! Electron: `runningDev()` via `ELECTRON_RENDERER_URL` or `PQ_MODE=dev`;
//! `productName()` → `pq-dev` | `pq`.
//! User data: `%APPDATA%\{pq|pq-dev}` (AppData\Roaming on Windows).

use std::env;
use std::path::PathBuf;

/// True when running in the development product profile.
///
/// Mirrors Electron `src/main/env.ts`:
/// - `ELECTRON_RENDERER_URL` is set (Vite renderer in Electron), **or**
/// - `PQ_MODE=dev` (explicit override for Rust binaries / CI).
pub fn running_dev() -> bool {
    if env::var_os("ELECTRON_RENDERER_URL").is_some() {
        return true;
    }
    matches!(env::var("PQ_MODE").ok().as_deref(), Some("dev"))
}

/// Product directory name under `%APPDATA%`: `pq-dev` in dev, `pq` otherwise.
pub fn product_name() -> &'static str {
    if running_dev() {
        "pq-dev"
    } else {
        "pq"
    }
}

/// Windows roaming AppData root (`%APPDATA%`), typically
/// `C:\Users\<user>\AppData\Roaming`.
///
/// Falls back to `{HOME|USERPROFILE}/AppData/Roaming` when `APPDATA` is unset
/// (non-Windows or stripped env — still useful for unit tests).
pub fn appdata_roaming() -> PathBuf {
    if let Ok(p) = env::var("APPDATA") {
        if !p.is_empty() {
            return PathBuf::from(p);
        }
    }
    let home = env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    home.join("AppData").join("Roaming")
}

/// `%APPDATA%\{product_name}` — Electron `app.getPath('userData')` twin.
pub fn user_data_dir() -> PathBuf {
    appdata_roaming().join(product_name())
}

/// `%APPDATA%\{product}` for an explicit product label (`pq` or `pq-dev`).
pub fn user_data_dir_for(product: &str) -> PathBuf {
    appdata_roaming().join(product)
}

/// Old product directory `%APPDATA%\pq`. Startup does not read it.
pub fn prod_user_data_dir() -> PathBuf {
    user_data_dir_for("pq")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// Serialize env-mutating tests (process-global env).
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn clear_mode_vars() {
        env::remove_var("PQ_MODE");
        env::remove_var("ELECTRON_RENDERER_URL");
    }

    #[test]
    fn product_name_prod_by_default() {
        let _g = ENV_LOCK.lock().unwrap();
        clear_mode_vars();
        assert!(!running_dev());
        assert_eq!(product_name(), "pq");
    }

    #[test]
    fn running_dev_via_pq_mode() {
        let _g = ENV_LOCK.lock().unwrap();
        clear_mode_vars();
        env::set_var("PQ_MODE", "dev");
        assert!(running_dev());
        assert_eq!(product_name(), "pq-dev");
        clear_mode_vars();
    }

    #[test]
    fn running_dev_via_electron_renderer_url() {
        let _g = ENV_LOCK.lock().unwrap();
        clear_mode_vars();
        env::set_var("ELECTRON_RENDERER_URL", "http://localhost:5173");
        assert!(running_dev());
        assert_eq!(product_name(), "pq-dev");
        clear_mode_vars();
    }

    #[test]
    fn user_data_dir_respects_appdata() {
        let _g = ENV_LOCK.lock().unwrap();
        clear_mode_vars();
        let prev = env::var_os("APPDATA");
        env::set_var("APPDATA", r"C:\Temp\FakeAppData");
        assert_eq!(
            user_data_dir(),
            PathBuf::from(r"C:\Temp\FakeAppData\pq")
        );
        env::set_var("PQ_MODE", "dev");
        assert_eq!(
            user_data_dir(),
            PathBuf::from(r"C:\Temp\FakeAppData\pq-dev")
        );
        clear_mode_vars();
        match prev {
            Some(v) => env::set_var("APPDATA", v),
            None => env::remove_var("APPDATA"),
        }
    }

    #[test]
    fn prod_user_data_dir_ignores_dev_mode() {
        let _g = ENV_LOCK.lock().unwrap();
        clear_mode_vars();
        let prev = env::var_os("APPDATA");
        env::set_var("APPDATA", r"D:\Roaming");
        env::set_var("PQ_MODE", "dev");
        assert_eq!(prod_user_data_dir(), PathBuf::from(r"D:\Roaming\pq"));
        clear_mode_vars();
        match prev {
            Some(v) => env::set_var("APPDATA", v),
            None => env::remove_var("APPDATA"),
        }
    }
}