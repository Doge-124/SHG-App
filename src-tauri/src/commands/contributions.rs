//! Tauri commands for member contribution operations.

use std::sync::Mutex;
use tauri::State;

use crate::db::contributions::{record_weekly_contribution as db_record_weekly_contribution, WeeklyContributionInput};
use crate::error::AppError;
use crate::state::AppState;

/// Record a weekly contribution from a member
#[tauri::command]
pub fn record_weekly_contribution_cmd(
    state: State<Mutex<AppState>>,
    input: WeeklyContributionInput,
) -> Result<i64, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;
    
    db_record_weekly_contribution(conn, input)
        .map_err(|e| e.to_string())
}
