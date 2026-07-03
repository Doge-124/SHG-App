//! Tauri commands for the fixed-asset register.

use std::sync::Mutex;
use tauri::State;

use crate::db::assets::{self, Asset, AssetSummary, NewAsset};
use crate::state::AppState;

#[tauri::command]
pub fn list_assets(state: State<Mutex<AppState>>) -> Result<Vec<Asset>, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard.db.as_mut().ok_or_else(|| "DB not unlocked".to_string())?;
    assets::list_assets(conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_asset_summary(state: State<Mutex<AppState>>) -> Result<AssetSummary, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard.db.as_mut().ok_or_else(|| "DB not unlocked".to_string())?;
    assets::get_asset_summary(conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_asset(state: State<Mutex<AppState>>, input: NewAsset) -> Result<i64, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard.db.as_mut().ok_or_else(|| "DB not unlocked".to_string())?;
    let id = assets::add_asset(conn, &input).map_err(|e| e.to_string())?;
    crate::db::audit::log_audit(
        conn,
        "ASSET_ADDED",
        "asset",
        Some(id),
        &format!("{} — ₹{} ({})", input.name, input.cost, input.funding_method),
    );
    Ok(id)
}

#[tauri::command]
pub fn update_asset(
    state: State<Mutex<AppState>>,
    id: i64,
    name: String,
    category: String,
    supplier: Option<String>,
    location: Option<String>,
    note: Option<String>,
) -> Result<(), String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard.db.as_mut().ok_or_else(|| "DB not unlocked".to_string())?;
    assets::update_asset(
        conn,
        id,
        &name,
        &category,
        supplier.as_deref(),
        location.as_deref(),
        note.as_deref(),
    )
    .map_err(|e| e.to_string())?;
    crate::db::audit::log_audit(conn, "ASSET_UPDATED", "asset", Some(id), &name);
    Ok(())
}

#[tauri::command]
pub fn dispose_asset(
    state: State<Mutex<AppState>>,
    id: i64,
    proceeds: f64,
    method: Option<String>,
    date: String,
) -> Result<(), String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard.db.as_mut().ok_or_else(|| "DB not unlocked".to_string())?;
    assets::dispose_asset(conn, id, proceeds, method.as_deref(), &date).map_err(|e| e.to_string())?;
    crate::db::audit::log_audit(
        conn,
        "ASSET_DISPOSED",
        "asset",
        Some(id),
        &format!("proceeds ₹{proceeds}"),
    );
    Ok(())
}
