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

/// Return the N most recent SHG transactions regardless of date.
/// Used by the dashboard "Recent Transactions" widget.
#[tauri::command]
pub fn get_recent_transactions(
    state: State<Mutex<AppState>>,
    limit: Option<i64>,
) -> Result<Vec<serde_json::Value>, String> {
    let n = limit.unwrap_or(20).max(1).min(100);

    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    let sql = format!(
        "SELECT
            t.id, t.txn_type, t.amount, t.reason, t.payment_method,
            t.reference_type, t.reference_id, t.created_at,
            {name_expr} AS member_name
         FROM shg_transactions t
         ORDER BY t.created_at DESC
         LIMIT ?1",
        name_expr = crate::db::ledger::MEMBER_NAME_SQL,
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([n], |row| {
            Ok(serde_json::json!({
                "id":             row.get::<_, i64>(0)?,
                "txn_type":       row.get::<_, String>(1)?,
                "amount":         row.get::<_, f64>(2)?,
                "reason":         row.get::<_, String>(3)?,
                "payment_method": row.get::<_, String>(4)?,
                "reference_type": row.get::<_, Option<String>>(5)?,
                "reference_id":   row.get::<_, Option<i64>>(6)?,
                "created_at":     row.get::<_, String>(7)?,
                "member_name":    row.get::<_, Option<String>>(8)?,
            }))
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}
