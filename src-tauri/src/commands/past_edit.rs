//! Admin-gated commands for fixing mistakes in past-data entries.
//!
//! Every command here re-verifies the admin PIN before touching any data, so
//! a stolen unlocked app can't silently rewrite history.

use std::sync::Mutex;
use tauri::State;

use crate::state::AppState;
use crate::db::past_edit;
use crate::commands::auth::verify_admin_pin_internal;

fn require_admin(
    pin: &str,
    app: &tauri::AppHandle,
    state: &Mutex<AppState>,
) -> Result<(), String> {
    let ok = verify_admin_pin_internal(pin, app, state)?;
    if !ok { return Err("Incorrect admin PIN.".to_string()); }
    Ok(())
}

#[tauri::command]
pub fn edit_member_opening_data(
    member_id: i64,
    opening_balance: f64,
    payment_method: Option<String>,
    past_installments: u32,
    admin_pin: String,
    state: State<Mutex<AppState>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    require_admin(&admin_pin, &app, state.inner())?;
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard.db.as_mut().ok_or_else(|| "DB not unlocked".to_string())?;
    past_edit::edit_member_opening_data(
        conn,
        member_id,
        opening_balance,
        payment_method.as_deref(),
        past_installments,
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_past_loan(
    loan_id: i64,
    admin_pin: String,
    state: State<Mutex<AppState>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    require_admin(&admin_pin, &app, state.inner())?;
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard.db.as_mut().ok_or_else(|| "DB not unlocked".to_string())?;
    past_edit::delete_past_loan(conn, loan_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cancel_shg_transaction(
    txn_id: i64,
    reason: String,
    admin_pin: String,
    state: State<Mutex<AppState>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    require_admin(&admin_pin, &app, state.inner())?;
    if reason.trim().is_empty() {
        return Err("A reason is required for cancellation.".to_string());
    }
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard.db.as_mut().ok_or_else(|| "DB not unlocked".to_string())?;
    crate::db::cancel::cancel_shg_transaction(conn, txn_id, &reason)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_past_chit_cycle(
    cycle_id: i64,
    admin_pin: String,
    state: State<Mutex<AppState>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    require_admin(&admin_pin, &app, state.inner())?;
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard.db.as_mut().ok_or_else(|| "DB not unlocked".to_string())?;
    past_edit::delete_past_chit_cycle(conn, cycle_id).map_err(|e| e.to_string())
}
