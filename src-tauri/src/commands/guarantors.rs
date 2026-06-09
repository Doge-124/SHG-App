//! Tauri commands for managing loan / chit-membership guarantors.

use std::sync::Mutex;
use tauri::State;

use crate::db;
use crate::db::guarantors::{Guarantor, GuarantorInput};
use crate::error::AppError;
use crate::state::AppState;

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[tauri::command]
pub fn set_loan_guarantors(
    state: State<Mutex<AppState>>,
    loan_id: i64,
    guarantors: Vec<GuarantorInput>,
) -> Result<(), String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard.db.as_ref().ok_or_else(|| "DB not unlocked".to_string())?;
    db::guarantors::save_guarantors(conn, "LOAN", loan_id, &guarantors, &now_iso())
        .map_err(|e: AppError| e.to_string())
}

#[tauri::command]
pub fn get_loan_guarantors(
    state: State<Mutex<AppState>>,
    loan_id: i64,
) -> Result<Vec<Guarantor>, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard.db.as_ref().ok_or_else(|| "DB not unlocked".to_string())?;
    db::guarantors::get_guarantors(conn, "LOAN", loan_id).map_err(|e: AppError| e.to_string())
}

#[tauri::command]
pub fn set_chit_member_guarantors(
    state: State<Mutex<AppState>>,
    chit_id: i64,
    member_id: i64,
    guarantors: Vec<GuarantorInput>,
) -> Result<(), String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard.db.as_ref().ok_or_else(|| "DB not unlocked".to_string())?;
    let ref_id = db::guarantors::chit_member_ref(conn, chit_id, member_id)
        .map_err(|e: AppError| e.to_string())?;
    db::guarantors::save_guarantors(conn, "CHIT_MEMBER", ref_id, &guarantors, &now_iso())
        .map_err(|e: AppError| e.to_string())
}

#[tauri::command]
pub fn get_chit_member_guarantors(
    state: State<Mutex<AppState>>,
    chit_id: i64,
    member_id: i64,
) -> Result<Vec<Guarantor>, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard.db.as_ref().ok_or_else(|| "DB not unlocked".to_string())?;
    let ref_id = db::guarantors::chit_member_ref(conn, chit_id, member_id)
        .map_err(|e: AppError| e.to_string())?;
    db::guarantors::get_guarantors(conn, "CHIT_MEMBER", ref_id).map_err(|e: AppError| e.to_string())
}
