//! Tauri commands for member contribution operations.

use std::sync::Mutex;
use tauri::State;

use crate::db::contributions::{
    record_weekly_contribution as db_record_weekly_contribution,
    get_weekly_contribution_status, WeeklyContributionInput, WeeklyContributionSummary,
};
use crate::db::audit;
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
    
    let member_id = input.member_id;
    let amount = input.amount;
    let txn_id = db_record_weekly_contribution(conn, input)
        .map_err(|e| e.to_string())?;

    audit::log_audit(conn, "CONTRIBUTION", "contribution", Some(txn_id),
        &format!("₹{amount} weekly contribution by member {member_id}"));
    Ok(txn_id)
}

/// Get paid/pending status for all SHG members for a date range.
#[tauri::command]
pub fn get_weekly_contribution_status_cmd(
    state: State<Mutex<AppState>>,
    from_date: String,
    to_date: String,
) -> Result<WeeklyContributionSummary, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard.db.as_mut().ok_or_else(|| "DB not unlocked".to_string())?;
    get_weekly_contribution_status(conn, &from_date, &to_date)
        .map_err(|e: AppError| e.to_string())
}
