//! Tauri commands for member management.

use std::sync::Mutex;
use tauri::State;

use crate::db::{self, validation, members::{list_members_by_type, MemberType}, settings as db_settings};
use crate::error::AppError;
use crate::state::AppState;

#[derive(serde::Deserialize)]
pub struct OpeningDataInput {
    pub member_id: i64,
    pub opening_balance: f64,
    pub payment_method: Option<String>, // required if opening_balance > 0
    pub past_installments: u32,
}

#[tauri::command]
pub fn add_member(
    state: State<Mutex<AppState>>,
    code: String,
    name: String,
    phone: Option<String>,
    address: Option<String>,
    joined_at: String,
    member_type: String,
) -> Result<(), String> {
    validation::validate_member_code(&code).map_err(|e: AppError| e.to_string())?;
    validation::validate_member_name(&name).map_err(|e: AppError| e.to_string())?;

    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    let member_id = db::add_member(
        conn,
        &code,
        &name,
        phone.as_deref(),
        address.as_deref(),
        &joined_at,
        &member_type,
    )
    .map_err(|e: AppError| e.to_string())?;

    db::audit::log_audit(conn, "MEMBER_ADDED", "member", Some(member_id),
        &format!("{name} ({code}) — type: {member_type}"));
    Ok(())
}

#[tauri::command]
pub fn get_member(code: String, state: State<Mutex<AppState>>) -> Result<db::Member, String> {
    validation::validate_member_code(&code).map_err(|e: AppError| e.to_string())?;

    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;
    db::get_member_by_code(conn, &code).map_err(|e: AppError| e.to_string())
}

#[tauri::command]
pub fn update_member(
    code: String,
    name: String,
    phone: Option<String>,
    address: Option<String>,
    state: State<Mutex<AppState>>,
) -> Result<(), String> {
    validation::validate_member_code(&code).map_err(|e: AppError| e.to_string())?;
    validation::validate_member_name(&name).map_err(|e: AppError| e.to_string())?;

    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    db::update_member(
        conn,
        &code,
        &name,
        phone.as_deref(),
        address.as_deref(),
    )
    .map_err(|e: AppError| e.to_string())?;

    let member_id: Option<i64> = conn
        .query_row("SELECT id FROM members WHERE member_code = ?1", [&code], |r| r.get(0))
        .ok();
    db::audit::log_audit(conn, "MEMBER_UPDATED", "member", member_id,
        &format!("{name} ({code})"));
    Ok(())
}

#[tauri::command]
pub fn list_members(state: State<Mutex<AppState>>) -> Result<Vec<db::Member>, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    db::list_members(conn).map_err(|e: AppError| e.to_string())
}

#[tauri::command]
pub fn get_total_members(state: State<Mutex<AppState>>) -> Result<i64, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;
    
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM members",
        [],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    
    Ok(count)
}

#[tauri::command]
pub fn get_total_loans_outstanding(state: State<Mutex<AppState>>) -> Result<f64, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;
    
    // Try to get from new loans table first, fallback to member_transactions
    let total: f64 = match conn.query_row(
        "SELECT COALESCE(SUM(outstanding_amount), 0) FROM loans WHERE status = 'active'",
        [],
        |row| row.get(0),
    ) {
        Ok(v) => v,
        Err(_) => {
            // Fallback to member_transactions for old data
            conn.query_row(
                "SELECT COALESCE(SUM(amount), 0) FROM member_transactions WHERE txn_type = 'LOAN'",
                [],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?
        }
    };
    
    Ok(total)
}

#[tauri::command]
pub fn get_active_chit_groups(state: State<Mutex<AppState>>) -> Result<i64, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;
    
    let count: i64 = conn
        .query_row(
        "SELECT COUNT(*) FROM chit_groups WHERE status = 'ACTIVE'",
        [],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())?;
    
    Ok(count)
}

#[tauri::command]
pub fn member_balance(state: State<Mutex<AppState>>, member_id: i64) -> Result<f64, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;
    db::get_member_balance(conn, member_id).map_err(|e: AppError|e.to_string())
}

#[tauri::command]
pub fn set_member_opening_data(
    state: State<Mutex<AppState>>,
    input: OpeningDataInput,
) -> Result<(), String> {
    if !input.opening_balance.is_finite() || input.opening_balance < 0.0 {
        return Err("opening_balance must be >= 0.0".to_string());
    }

    // payment_method is optional — opening balance is now member-profile-only,
    // not reflected in SHG cash/bank balances.

    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    db_settings::assert_past_data_unlocked(conn).map_err(|e| e.to_string())?;

    db::set_member_opening_data(
        conn,
        input.member_id,
        input.opening_balance,
        input.payment_method.as_deref(),
        input.past_installments,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_member_profile(
    state: State<Mutex<AppState>>,
    member_id: i64,
) -> Result<db::MemberProfile, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;
    db::get_member_profile(conn, member_id).map_err(|e| e.to_string())
}

/// List members filtered by member type
#[tauri::command]
pub fn list_members_by_type_cmd(
    state: State<Mutex<AppState>>,
    member_type: String,
) -> Result<Vec<db::Member>, String> {
    use std::str::FromStr;
    
    let mt = MemberType::from_str(&member_type)
        .map_err(|e| format!("Invalid member type: {}", e))?;
    
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;
    
    list_members_by_type(conn, mt).map_err(|e: AppError| e.to_string())
}

/// Get savings passbook for a member
#[tauri::command]
pub fn get_member_passbook(
    state: State<Mutex<AppState>>,
    member_id: i64,
    from_date: String,
    to_date: String,
) -> Result<db::MemberPassbook, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard.db.as_mut().ok_or_else(|| "DB not unlocked".to_string())?;
    db::members::get_member_passbook(conn, member_id, &from_date, &to_date)
        .map_err(|e: AppError| e.to_string())
}

/// Update a member's type
#[tauri::command]
pub fn update_member_type(
    state: State<Mutex<AppState>>,
    member_id: i64,
    member_type: String,
) -> Result<(), String> {
    use std::str::FromStr;
    
    let mt = MemberType::from_str(&member_type)
        .map_err(|e| format!("Invalid member type: {}", e))?;
    
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;
    
    conn.execute(
        "UPDATE members SET member_type = ?1 WHERE id = ?2",
        (mt.to_string(), member_id),
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}
