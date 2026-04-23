//! Tauri commands for reporting over the SHG ledger.

use std::sync::Mutex;
use tauri::State;

use crate::db::{self, reports};
use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
pub fn daily_transactions(
    state: State<Mutex<AppState>>,
    date: String,
    payment_method: Option<String>,
    transaction_type: Option<String>,
    member_id: Option<i64>,
) -> Result<Vec<db::ShgTransaction>, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    reports::get_daily_transactions(
        conn,
        &date,
        &date,
        payment_method.as_deref(),
        transaction_type.as_deref(),
        member_id,
    )
    .map_err(|e: AppError| e.to_string())
}

#[tauri::command]
pub fn weekly_transactions(
    state: State<Mutex<AppState>>,
    start_date: String,
    payment_method: Option<String>,
    transaction_type: Option<String>,
    member_id: Option<i64>,
) -> Result<Vec<db::ShgTransaction>, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    reports::get_weekly_transactions(
        conn,
        &start_date,
        &start_date,
        payment_method.as_deref(),
        transaction_type.as_deref(),
        member_id,
    )
    .map_err(|e: AppError| e.to_string())
}

#[tauri::command]
pub fn monthly_transactions(
    state: State<Mutex<AppState>>,
    month: String,
    payment_method: Option<String>,
    transaction_type: Option<String>,
    member_id: Option<i64>,
) -> Result<Vec<db::ShgTransaction>, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    reports::get_monthly_transactions(
        conn,
        &month,
        &month,
        payment_method.as_deref(),
        transaction_type.as_deref(),
        member_id,
    )
    .map_err(|e: AppError| e.to_string())
}
