//! Tauri command bindings for the version-policy gate.

use crate::version_policy::{self, VersionPolicy};

#[tauri::command]
pub async fn get_version_policy() -> Result<VersionPolicy, String> {
    Ok(version_policy::fetch().await)
}
