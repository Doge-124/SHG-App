//! Tauri command bindings for the license module.

use crate::license::{self, LicenseStatus};

/// Returns the current license status. Performs a live server check (with
/// offline fallback) so the UI can decide whether to gate the app.
#[tauri::command]
pub async fn get_license_status() -> Result<LicenseStatus, String> {
    Ok(license::get_status().await)
}

/// Activate a license key on this machine. Returns the resulting status on
/// success, or a user-facing error message on failure.
#[tauri::command]
pub async fn activate_license(license_key: String) -> Result<LicenseStatus, String> {
    license::activate(&license_key).await
}

/// Wipe the locally stored license. Used for testing or to allow a fresh
/// activation after a transfer (server-side binding must be cleared by admin).
#[tauri::command]
pub fn deactivate_license_local() -> Result<(), String> {
    license::deactivate_local()
}
