//! Tauri commands for audit log access.

use std::sync::Mutex;
use tauri::State;

use crate::db;
use crate::state::AppState;

#[tauri::command]
pub fn get_audit_log(
    state: State<Mutex<AppState>>,
    from: Option<String>,
    to: Option<String>,
    entity: Option<String>,
) -> Result<Vec<db::audit::AuditEntry>, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    db::audit::query_audit_log(conn, from.as_deref(), to.as_deref(), entity.as_deref())
        .map_err(|e| e.to_string())
}
