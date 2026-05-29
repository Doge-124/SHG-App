//! Tauri commands for SHG-wide ledger operations.

use std::sync::Mutex;
use tauri::State;

use crate::db::{self, validation};
use crate::error::AppError;
use crate::state::AppState;

#[derive(serde::Serialize)]
pub struct ShgBalances {
    pub cash: f64,
    pub bank: f64,
}

#[tauri::command]
pub fn record_receipt(
    state: State<Mutex<AppState>>,
    amount: f64,
    reason: String,
    payment_method: String,
    reference_type: Option<String>,
    reference_id: Option<i64>,
    created_at: String,
) -> Result<(), String> {
    validation::validate_money_amount(amount)
        .map_err(|e: AppError| e.to_string())?;
    validation::validate_payment_method(&payment_method)
        .map_err(|e: AppError| e.to_string())?;

    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    let mut tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start transaction: {e}"))?;

    db::record_receipt(
        &mut tx,
        amount,
        &reason,
        &payment_method,
        reference_type.as_deref(),
        reference_id,
        &created_at,
    )
    .map_err(|e: AppError| e.to_string())?;

    // Only savings-type receipts affect member balance.
    // MEMBER_RECEIPT (fines, generic) → SHG balance only; the member's savings are unchanged.
    // MEMBER_CONTRIBUTION / WEEKLY_CONTRIBUTION → also update the member's savings balance.
    if let (Some(ref_type), Some(member_id)) = (reference_type.as_deref(), reference_id) {
        if ref_type == "MEMBER_CONTRIBUTION" || ref_type == "WEEKLY_CONTRIBUTION" {
            tx.execute(
                "INSERT INTO member_transactions (member_id, amount, txn_type, reason, created_at)
                 VALUES (?1, ?2, 'CONTRIBUTION', ?3, ?4)",
                (member_id, amount, &reason, &created_at),
            )
            .map_err(|e| format!("Failed to create member transaction: {e}"))?;

            tx.execute(
                "INSERT INTO member_balances (member_id, balance) VALUES (?1, ?2)
                 ON CONFLICT(member_id) DO UPDATE SET balance = balance + excluded.balance",
                (member_id, amount),
            )
            .map_err(|e| format!("Failed to update member balance: {e}"))?;
        }
    }

    tx.commit()
        .map_err(|e| format!("Failed to commit transaction: {e}"))?;

    db::audit::log_audit(conn, "RECEIPT", "receipt", None,
        &format!("₹{amount} — {reason} ({payment_method})"));
    Ok(())
}

#[tauri::command]
pub fn record_voucher(
    state: State<Mutex<AppState>>,
    amount: f64,
    reason: String,
    payment_method: String,
    reference_type: Option<String>,
    reference_id: Option<i64>,
    created_at: String,
) -> Result<(), String> {
    validation::validate_money_amount(amount)
        .map_err(|e: AppError| e.to_string())?;
    validation::validate_payment_method(&payment_method)
        .map_err(|e: AppError| e.to_string())?;

    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    let mut tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start transaction: {e}"))?;

    db::record_voucher(
        &mut tx,
        amount,
        &reason,
        &payment_method,
        reference_type.as_deref(),
        reference_id,
        &created_at,
    )
    .map_err(|e: AppError| e.to_string())?;

    tx.commit()
        .map_err(|e| format!("Failed to commit transaction: {e}"))?;

    db::audit::log_audit(conn, "VOUCHER", "voucher", None,
        &format!("₹{amount} — {reason} ({payment_method})"));
    Ok(())
}

#[tauri::command]
pub fn get_shg_balances(state: State<Mutex<AppState>>) -> Result<ShgBalances, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    let cash = db::get_cash_balance(conn).map_err(|e: AppError| e.to_string())?;
    let bank = db::get_bank_balance(conn).map_err(|e: AppError| e.to_string())?;

    Ok(ShgBalances { cash, bank })
}

#[tauri::command]
pub fn get_vouchers(
    state: State<Mutex<AppState>>,
    from: Option<String>,
    to: Option<String>,
) -> Result<Vec<serde_json::Value>, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    let mut query = "
        SELECT
            t.id,
            t.txn_type,
            t.amount,
            t.reason,
            t.payment_method,
            t.reference_type,
            t.reference_id,
            t.created_at,
            t.voided_at,
            t.voided_reason,
            t.reversal_of_id,
            CASE
                WHEN t.reference_type = 'CHIT_PAYOUT' AND t.reference_id IS NOT NULL THEN
                    (SELECT m.name FROM members m
                     JOIN chit_cycles cc ON cc.winning_member_id = m.id
                     WHERE cc.id = t.reference_id)
                WHEN t.reference_id IS NOT NULL THEN
                    (SELECT name FROM members WHERE id = t.reference_id)
                ELSE NULL
            END as member_name
        FROM shg_transactions t
        WHERE t.txn_type = 'VOUCHER'
    ".to_string();

    let mut params: Vec<String> = Vec::new();

    if let Some(from_date) = &from {
        query.push_str(" AND t.created_at >= ?");
        params.push(from_date.clone());
    }

    if let Some(to_date) = &to {
        query.push_str(" AND t.created_at <= ?");
        params.push(to_date.clone());
    }

    query.push_str(" ORDER BY t.created_at DESC");

    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params_from_iter(params.iter().map(|s| s.as_str())), |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "txn_type": row.get::<_, String>(1)?,
                "amount": row.get::<_, f64>(2)?,
                "reason": row.get::<_, String>(3)?,
                "payment_method": row.get::<_, String>(4)?,
                "reference_type": row.get::<_, Option<String>>(5)?,
                "reference_id": row.get::<_, Option<i64>>(6)?,
                "created_at": row.get::<_, String>(7)?,
                "voided_at": row.get::<_, Option<i64>>(8)?,
                "voided_reason": row.get::<_, Option<String>>(9)?,
                "reversal_of_id": row.get::<_, Option<i64>>(10)?,
                "member_name": row.get::<_, Option<String>>(11)?,
            }))
        })
        .map_err(|e| e.to_string())?;

    let mut vouchers = Vec::new();
    for row in rows {
        vouchers.push(row.map_err(|e| e.to_string())?);
    }

    Ok(vouchers)
}

#[tauri::command]
pub fn get_receipts(
    state: State<Mutex<AppState>>,
    from: Option<String>,
    to: Option<String>,
) -> Result<Vec<serde_json::Value>, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    let mut query = "
        SELECT
            t.id,
            t.txn_type,
            t.amount,
            t.reason,
            t.payment_method,
            t.reference_type,
            t.reference_id,
            t.created_at,
            t.voided_at,
            t.voided_reason,
            t.reversal_of_id,
            CASE
                WHEN t.reference_type = 'CHIT_COMMISSION' AND t.reference_id IS NOT NULL THEN
                    (SELECT m.name FROM members m
                     JOIN chit_cycles cc ON cc.winning_member_id = m.id
                     WHERE cc.id = t.reference_id)
                WHEN t.reference_type IN (
                    'WEEKLY_CONTRIBUTION', 'MEMBER_RECEIPT', 'MEMBER_CONTRIBUTION',
                    'MEMBER_PAYMENT', 'CHIT_PAYMENT', 'DONATION', 'GRANT'
                ) AND t.reference_id IS NOT NULL THEN
                    (SELECT name FROM members WHERE id = t.reference_id)
                ELSE NULL
            END as member_name,
            CASE
                WHEN t.reference_id IS NOT NULL THEN
                    (SELECT member_code FROM members WHERE id = t.reference_id)
                ELSE NULL
            END as member_code
        FROM shg_transactions t
        WHERE t.txn_type = 'RECEIPT'
    ".to_string();

    let mut params = Vec::new();
    
    if let Some(from_date) = &from {
        query.push_str(" AND t.created_at >= ?");
        params.push(from_date.as_str());
    }
    
    if let Some(to_date) = &to {
        query.push_str(" AND t.created_at <= ?");
        params.push(to_date.as_str());
    }
    
    query.push_str(" ORDER BY t.created_at DESC");

    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
    
    let rows = stmt
        .query_map(rusqlite::params_from_iter(params), |row| {
            let receipt = serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "txn_type": row.get::<_, String>(1)?,
                "amount": row.get::<_, f64>(2)?,
                "reason": row.get::<_, String>(3)?,
                "payment_method": row.get::<_, String>(4)?,
                "reference_type": row.get::<_, Option<String>>(5)?,
                "reference_id": row.get::<_, Option<i64>>(6)?,
                "created_at": row.get::<_, String>(7)?,
                "voided_at": row.get::<_, Option<i64>>(8)?,
                "voided_reason": row.get::<_, Option<String>>(9)?,
                "reversal_of_id": row.get::<_, Option<i64>>(10)?,
                "member_name": row.get::<_, Option<String>>(11)?,
                "member_code": row.get::<_, Option<String>>(12)?,
            });

            // Add memberName for compatibility with existing frontend
            let mut receipt_with_member = receipt;
            if let Ok(Some(member_name)) = row.get::<_, Option<String>>(11) {
                receipt_with_member["memberName"] = serde_json::Value::String(member_name);
            }
            
            Ok(receipt_with_member)
        })
        .map_err(|e| e.to_string())?;

    let mut receipts = Vec::new();
    for row in rows {
        receipts.push(row.map_err(|e| e.to_string())?);
    }

    Ok(receipts)
}
