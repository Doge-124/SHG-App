//! Tauri commands for member contribution operations.

use std::sync::Mutex;
use tauri::State;

use crate::db::contributions::{
    record_weekly_contribution as db_record_weekly_contribution,
    payout_member_savings as db_payout_member_savings,
    get_weekly_contribution_status, WeeklyContributionInput, WeeklyContributionSummary,
};
use crate::db::audit;
use crate::db::settings::{get_installment_status, set_installment_number, InstallmentStatus};
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

/// Pay out (withdraw) a member's accrued savings as a voucher.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn payout_member_savings_cmd(
    state: State<Mutex<AppState>>,
    member_id: i64,
    amount: f64,
    payment_method: String,
    bank_txn_id: Option<String>,
    created_at: String,
    cash_amount: Option<f64>,
    bank_amount: Option<f64>,
) -> Result<i64, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    let voucher_id = db_payout_member_savings(
        conn,
        member_id,
        amount,
        &payment_method,
        bank_txn_id.as_deref(),
        &created_at,
        cash_amount,
        bank_amount,
    )
    .map_err(|e: AppError| e.to_string())?;

    audit::log_audit(conn, "SAVINGS_PAYOUT", "contribution", Some(voucher_id),
        &format!("₹{amount} savings payout to member {member_id}"));
    Ok(voucher_id)
}

/// Get the current expected installment number (auto-increments weekly).
#[tauri::command]
pub fn get_installment_status_cmd(
    state: State<Mutex<AppState>>,
) -> Result<InstallmentStatus, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard.db.as_mut().ok_or_else(|| "DB not unlocked".to_string())?;
    get_installment_status(conn).map_err(|e: AppError| e.to_string())
}

/// Set the current installment number. It will keep incrementing weekly from here.
#[tauri::command]
pub fn set_installment_number_cmd(
    state: State<Mutex<AppState>>,
    number: i64,
) -> Result<(), String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard.db.as_mut().ok_or_else(|| "DB not unlocked".to_string())?;
    set_installment_number(conn, number).map_err(|e: AppError| e.to_string())?;
    audit::log_audit(conn, "INSTALLMENT_NUMBER_SET", "settings", None,
        &format!("Current installment number set to {number}"));
    Ok(())
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
