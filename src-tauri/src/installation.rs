//! Installation identifier + per-installation persistent settings that need
//! to be available BEFORE the encrypted DB is unlocked (e.g. crash-reporting
//! opt-in, which must be checked at app start).
//!
//! Stored at `%APPDATA%/com.shg.manager/installation.json`. Survives upgrades;
//! a full uninstall+wipe generates a new ID.

use std::path::PathBuf;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};
use serde::{Serialize, Deserialize};
use rand::RngCore;
use crate::error::AppError;

/// Crash reporting flag — checked from Sentry's `before_send` so the user can
/// toggle without restarting. Initialised on first read from `installation.json`.
pub static CRASH_REPORTING_ENABLED: AtomicBool = AtomicBool::new(true);

/// Cached app data dir so we don't need an AppHandle for early-startup file IO.
static APP_DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InstallationInfo {
    pub installation_id: String,
    pub created_at: String,
    pub first_version: String,
    #[serde(default = "default_true")]
    pub crash_reporting_enabled: bool,
}

fn default_true() -> bool { true }

/// One-time call from `main()` BEFORE Tauri builder so Sentry init has access
/// to the data dir without needing an AppHandle.
pub fn bootstrap() -> Result<(), AppError> {
    let dir = dirs::data_dir()
        .ok_or_else(|| AppError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "data_dir unavailable",
        )))?
        .join("com.shg.manager");

    std::fs::create_dir_all(&dir)?;
    let _ = APP_DATA_DIR.set(dir);

    // Load (or create) installation info, mirror crash_reporting flag into atomic.
    if let Ok(info) = load_or_create_pre_app() {
        CRASH_REPORTING_ENABLED.store(info.crash_reporting_enabled, Ordering::Relaxed);
    }
    Ok(())
}

fn file_path_pre_app() -> Result<PathBuf, AppError> {
    let dir = APP_DATA_DIR.get().ok_or_else(|| AppError::Io(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        "bootstrap() not called",
    )))?;
    Ok(dir.join("installation.json"))
}

/// Load installation info using the bootstrap-cached path. Creates if missing.
fn load_or_create_pre_app() -> Result<InstallationInfo, AppError> {
    let path = file_path_pre_app()?;
    if path.exists() {
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Ok(info) = serde_json::from_str::<InstallationInfo>(&content) {
                return Ok(info);
            }
            log::warn!("installation.json corrupt, regenerating");
        }
    }
    let info = InstallationInfo {
        installation_id: generate_uuid_v4(),
        created_at: chrono::Utc::now().to_rfc3339(),
        first_version: env!("CARGO_PKG_VERSION").to_string(),
        crash_reporting_enabled: true,
    };
    std::fs::write(&path, serde_json::to_string_pretty(&info)?)?;
    log::info!("New installation ID generated: {}", info.installation_id);
    Ok(info)
}

fn file_path(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "app_data_dir unavailable",
        )))?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("installation.json"))
}

pub fn get_or_create(app: &tauri::AppHandle) -> Result<InstallationInfo, AppError> {
    let path = file_path(app)?;
    if path.exists() {
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Ok(info) = serde_json::from_str::<InstallationInfo>(&content) {
                // Mirror current flag into the atomic in case it was toggled
                CRASH_REPORTING_ENABLED.store(info.crash_reporting_enabled, Ordering::Relaxed);
                return Ok(info);
            }
            log::warn!("installation.json corrupt, regenerating");
        }
    }
    let info = InstallationInfo {
        installation_id: generate_uuid_v4(),
        created_at: chrono::Utc::now().to_rfc3339(),
        first_version: env!("CARGO_PKG_VERSION").to_string(),
        crash_reporting_enabled: true,
    };
    std::fs::write(&path, serde_json::to_string_pretty(&info)?)?;
    log::info!("New installation ID generated: {}", info.installation_id);
    Ok(info)
}

pub fn set_crash_reporting(app: &tauri::AppHandle, enabled: bool) -> Result<(), AppError> {
    let mut info = get_or_create(app)?;
    info.crash_reporting_enabled = enabled;
    let path = file_path(app)?;
    std::fs::write(&path, serde_json::to_string_pretty(&info)?)?;
    CRASH_REPORTING_ENABLED.store(enabled, Ordering::Relaxed);
    log::info!("Crash reporting {}", if enabled { "enabled" } else { "disabled" });
    Ok(())
}

fn generate_uuid_v4() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3],
        bytes[4], bytes[5],
        bytes[6], bytes[7],
        bytes[8], bytes[9],
        bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15],
    )
}
