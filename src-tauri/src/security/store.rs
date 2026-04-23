use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::Path;

#[derive(Serialize, Deserialize)]
pub struct SecurityData {
    /// Salt used to derive the main PIN key.
    pub salt: String,
    /// Salt used to derive the admin (recovery) PIN key.
    /// Present only when an admin PIN has been set.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub admin_salt: Option<String>,
    /// XOR of db_key and admin_key — allows recovering db_key if main PIN is lost.
    /// Never exposed to the frontend; never logged.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recovery_blob: Option<String>,
}

pub fn load(path: &Path) -> Result<Option<SecurityData>, io::Error> {
    if !path.exists() {
        return Ok(None);
    }
    let data = fs::read_to_string(path)?;
    let parsed = serde_json::from_str(&data)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, format!("invalid security.json: {e}")))?;
    Ok(Some(parsed))
}

pub fn save(path: &Path, data: &SecurityData) -> Result<(), io::Error> {
    let json = serde_json::to_string(data)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("failed to serialize security data: {e}")))?;
    fs::write(path, json)?;
    Ok(())
}
