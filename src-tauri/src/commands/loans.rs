//! Tauri commands for member loan operations.

use std::sync::Mutex;
use tauri::State;

use crate::db::{self, validation};
use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
pub fn get_member_loans(state: State<Mutex<AppState>>, member_id: i64) -> Result<Vec<db::loans::Loan>, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;
    db::loans::get_member_loans(conn, member_id).map_err(|e: AppError| e.to_string())
}

#[tauri::command]
pub fn get_loan(state: State<Mutex<AppState>>, loan_id: i64) -> Result<Option<db::loans::Loan>, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;
    db::loans::get_loan_by_id(conn, loan_id).map_err(|e: AppError| e.to_string())
}

#[tauri::command]
pub fn get_loan_repayments(state: State<Mutex<AppState>>, loan_id: i64) -> Result<Vec<db::loans::LoanPayment>, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;
    db::loans::get_repayments_for_loan(conn, loan_id).map_err(|e: AppError| e.to_string())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PastRepaymentInput {
    pub amount: f64,
    pub payment_method: String,
    pub paid_at: String,
}

#[tauri::command]
pub fn record_past_loan(
    state: State<Mutex<AppState>>,
    member_id: i64,
    amount: f64,
    interest_rate: f64,
    payment_method: String,
    loan_type: String,
    note: String,
    issued_at: String,
    repayments: Vec<PastRepaymentInput>,
) -> Result<i64, String> {
    validation::validate_money_amount(amount).map_err(|e: AppError| e.to_string())?;
    validation::validate_payment_method(&payment_method).map_err(|e: AppError| e.to_string())?;

    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    let rep_tuples: Vec<(f64, &str, &str)> = repayments
        .iter()
        .map(|r| (r.amount, r.payment_method.as_str(), r.paid_at.as_str()))
        .collect();

    db::loans::record_past_loan(
        conn,
        member_id,
        amount,
        interest_rate,
        &payment_method,
        &loan_type,
        &note,
        &issued_at,
        &rep_tuples,
    )
    .map_err(|e: AppError| e.to_string())
}

#[tauri::command]
pub fn get_all_loans(state: State<Mutex<AppState>>) -> Result<Vec<db::loans::Loan>, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;
    
    // Check table structure
    let mut stmt = conn.prepare("PRAGMA table_info(loans)").map_err(|e| e.to_string())?;
    let columns = stmt.query_map([], |row| {
        let name: String = row.get(1)?;
        Ok(name)
    }).map_err(|e| e.to_string())?;
    
    let mut column_names = Vec::new();
    for column in columns {
        column_names.push(column.map_err(|e| e.to_string())?);
    }
    
    // Use new-structure query when the outstanding_amount column exists (added by migration).
    // Do NOT rely on the absence of `principal` — the initial schema always creates loans
    // with principal, then apply_migrations adds the new columns alongside it.
    let has_new_columns = column_names.contains(&"outstanding_amount".to_string());

    let query = if has_new_columns {
        // New table structure — reads the live outstanding_amount column
        "SELECT l.id, l.member_id, l.amount, l.outstanding_amount, l.interest_rate, l.total_repayable, l.interest_amount, l.payment_method, l.loan_type, l.note, l.status, l.issued_at, l.created_at, m.name as member_name
         FROM loans l
         JOIN members m ON l.member_id = m.id
         ORDER BY l.issued_at DESC"
    } else {
        // Legacy table structure (only principal column, no outstanding_amount yet)
        "SELECT l.id, l.member_id, l.principal as amount,
                l.principal as outstanding_amount,
                0.0 as interest_rate,
                l.principal as total_repayable,
                0.0 as interest_amount,
                'CASH' as payment_method,
                'monthly' as loan_type,
                '' as note,
                l.status, l.issued_at, l.issued_at as created_at,
                m.name as member_name
         FROM loans l
         JOIN members m ON l.member_id = m.id
         ORDER BY l.issued_at DESC"
    };
    
    let mut stmt = conn.prepare(query).map_err(|e| e.to_string())?;

    let loans = stmt.query_map([], |row| {
        Ok(db::loans::Loan {
            id: row.get(0)?,
            member_id: row.get(1)?,
            member_name: row.get(13)?, // member_name is now the 14th column (index 13)
            amount: row.get(2)?,
            outstanding_amount: row.get(3)?,
            interest_rate: row.get(4)?,
            total_repayable: row.get(5)?,
            interest_amount: row.get(6)?,
            payment_method: row.get(7)?,
            loan_type: row.get(8)?,
            note: row.get(9)?,
            status: row.get(10)?,
            issued_at: row.get(11)?,
            created_at: row.get(12)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for loan in loans {
        result.push(loan.map_err(|e| e.to_string())?);
    }

    Ok(result)
}

#[tauri::command]
pub fn issue_member_loan(
    state: State<Mutex<AppState>>,
    member_id: i64,
    amount: f64,
    interest_rate: f64,
    payment_method: String,
    loan_type: String,
    note: String,
    created_at: String,
) -> Result<i64, String> {
    validation::validate_money_amount(amount).map_err(|e: AppError| e.to_string())?;
    validation::validate_payment_method(&payment_method).map_err(|e: AppError| e.to_string())?;

    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    db::loans::create_loan(
        conn,
        member_id,
        amount,
        interest_rate,
        &payment_method,
        &loan_type,
        &note,
        &created_at,
    ).map_err(|e: AppError| e.to_string())
}

#[tauri::command]
pub fn record_member_payment(
    state: State<Mutex<AppState>>,
    loan_id: i64,
    amount: f64,
    payment_method: String,
    note: String,
    created_at: String,
) -> Result<(), String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    db::loans::record_loan_payment(
        conn,
        loan_id,
        amount,
        &payment_method,
        &note,
        &created_at,
    ).map_err(|e: AppError| e.to_string())
}
