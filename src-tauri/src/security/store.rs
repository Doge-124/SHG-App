use serde::{Serialize, Deserialize};
use std::fs;
use std::path::Path;

#[derive(Serialize, Deserialize)]
pub struct SecurityData {
    pub salt: String,
}

pub fn load(path: &Path) -> Option<SecurityData> {
    let data = fs::read_to_string(path).ok()?;
    serde_json::from_str(&data).ok()
}

pub fn save(path: &Path, data: &SecurityData) {
    let json = serde_json::to_string(data).unwrap();
    fs::write(path, json).unwrap();
}
