//! Tauri commands for member loan operations.

use std::sync::Mutex;
use tauri::State;

use crate::db::{self, validation, settings as db_settings};
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
    daily_interest_rate: f64,
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

    db_settings::assert_past_data_unlocked(conn).map_err(|e| e.to_string())?;

    let rep_tuples: Vec<(f64, &str, &str)> = repayments
        .iter()
        .map(|r| (r.amount, r.payment_method.as_str(), r.paid_at.as_str()))
        .collect();

    let loan_id = db::loans::record_past_loan(
        conn,
        member_id,
        amount,
        daily_interest_rate,
        &payment_method,
        &loan_type,
        &note,
        &issued_at,
        &rep_tuples,
    )
    .map_err(|e: AppError| e.to_string())?;

    db::audit::log_audit(conn, "LOAN_PAST_ENTRY", "loan", Some(loan_id),
        &format!("Rs.{amount} past loan for member {member_id}, {repayments_len} repayments",
            repayments_len = rep_tuples.len()));
    Ok(loan_id)
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
        "SELECT l.id, l.member_id, l.amount, l.outstanding_amount, l.interest_rate,
                COALESCE(l.daily_interest_rate, 0) as daily_interest_rate,
                l.total_repayable, l.interest_amount,
                COALESCE(l.upfront_interest_amount, 0) as upfront_interest_amount,
                l.payment_method, l.loan_type, l.note, l.status, l.issued_at, l.created_at,
                m.name as member_name
         FROM loans l
         JOIN members m ON l.member_id = m.id
         ORDER BY l.issued_at DESC"
    } else {
        "SELECT l.id, l.member_id, l.principal as amount,
                l.principal as outstanding_amount,
                0.0 as interest_rate,
                0.0 as daily_interest_rate,
                l.principal as total_repayable,
                0.0 as interest_amount,
                0.0 as upfront_interest_amount,
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
            amount: row.get(2)?,
            outstanding_amount: row.get(3)?,
            interest_rate: row.get(4)?,
            daily_interest_rate: row.get(5)?,
            total_repayable: row.get(6)?,
            interest_amount: row.get(7)?,
            upfront_interest_amount: row.get(8)?,
            payment_method: row.get(9)?,
            loan_type: row.get(10)?,
            note: row.get(11)?,
            status: row.get(12)?,
            issued_at: row.get(13)?,
            created_at: row.get(14)?,
            member_name: row.get(15)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for loan in loans {
        result.push(loan.map_err(|e| e.to_string())?);
    }

    Ok(result)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn issue_member_loan(
    state: State<Mutex<AppState>>,
    member_id: i64,
    amount: f64,
    daily_interest_rate: f64,
    payment_method: String,
    loan_type: String,
    note: String,
    created_at: String,
    cash_amount: Option<f64>,
    bank_amount: Option<f64>,
    bank_txn_id: Option<String>,
) -> Result<i64, String> {
    validation::validate_money_amount(amount).map_err(|e: AppError| e.to_string())?;
    // payment_method (CASH | BANK | MIXED) is validated inside create_loan.

    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    let loan_id = db::loans::create_loan(
        conn,
        member_id,
        amount,
        daily_interest_rate,
        &payment_method,
        &loan_type,
        &note,
        &created_at,
        cash_amount,
        bank_amount,
        bank_txn_id.as_deref(),
    ).map_err(|e: AppError| e.to_string())?;

    db::audit::log_audit(conn, "LOAN_ISSUED", "loan", Some(loan_id),
        &format!("Rs.{amount} to member {member_id} ({loan_type}, {daily_interest_rate}%/day)"));
    Ok(loan_id)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn record_member_payment(
    state: State<Mutex<AppState>>,
    loan_id: i64,
    amount: f64,
    payment_method: String,
    note: String,
    created_at: String,
    cash_amount: Option<f64>,
    bank_amount: Option<f64>,
    bank_txn_id: Option<String>,
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
        cash_amount,
        bank_amount,
        bank_txn_id.as_deref(),
    ).map_err(|e: AppError| e.to_string())?;

    db::audit::log_audit(conn, "LOAN_REPAYMENT", "loan", Some(loan_id),
        &format!("₹{amount} repaid on loan {loan_id}"));
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoanPaymentPreview {
    pub interest_due: f64,
    pub interest_portion: f64,
    pub principal_portion: f64,
    pub new_outstanding: f64,
    pub new_unpaid_interest: f64,
}

/// Preview how a payment of `amount` on `paid_at` would be split between
/// interest and principal. Pure query — does not write.
#[tauri::command]
pub fn preview_loan_payment(
    state: State<Mutex<AppState>>,
    loan_id: i64,
    amount: f64,
    paid_at: String,
) -> Result<LoanPaymentPreview, String> {
    let guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard.db.as_ref().ok_or_else(|| "DB not unlocked".to_string())?;

    let paid_date = if paid_at.len() >= 10 {
        chrono::NaiveDate::parse_from_str(&paid_at[..10], "%Y-%m-%d")
            .map_err(|_| "Invalid paid_at date".to_string())?
    } else {
        return Err("Invalid paid_at date".to_string());
    };

    let (interest_due, interest_portion, principal_portion, new_outstanding, new_unpaid_interest) =
        db::loans::preview_loan_payment(conn, loan_id, amount, paid_date)
            .map_err(|e: AppError| e.to_string())?;

    Ok(LoanPaymentPreview {
        interest_due,
        interest_portion,
        principal_portion,
        new_outstanding,
        new_unpaid_interest,
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepayResult {
    pub arrears_cleared: f64,
    pub month_interest: f64,
    pub total_paid: f64,
    pub new_paid_through: String,
}

/// Voluntarily prepay one flat month (30 days) of interest. Clears any
/// outstanding interest accrued to date, then advances the loan's
/// interest-paid-through date 30 days forward so no further interest accrues
/// until then. Records a single "Interest Payment" receipt.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn prepay_loan_interest(
    state: State<Mutex<AppState>>,
    loan_id: i64,
    payment_method: String,
    created_at: String,
    cash_amount: Option<f64>,
    bank_amount: Option<f64>,
    bank_txn_id: Option<String>,
) -> Result<PrepayResult, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard.db.as_mut().ok_or_else(|| "DB not unlocked".to_string())?;

    let r = db::loans::prepay_loan_interest(
        conn,
        loan_id,
        &payment_method,
        &created_at,
        cash_amount,
        bank_amount,
        bank_txn_id.as_deref(),
    ).map_err(|e: AppError| e.to_string())?;

    db::audit::log_audit(conn, "LOAN_INTEREST_PREPAID", "loan", Some(loan_id),
        &format!("₹{} prepaid (arrears ₹{}, month ₹{}), covered through {}",
            r.total_paid, r.arrears_cleared, r.month_interest, r.new_paid_through));

    Ok(PrepayResult {
        arrears_cleared: r.arrears_cleared,
        month_interest: r.month_interest,
        total_paid: r.total_paid,
        new_paid_through: r.new_paid_through,
    })
}

/// Preview a one-month interest prepayment without writing. Returns the same
/// shape as the actual prepay so the UI can show the amount + covered-through.
#[tauri::command]
pub fn preview_prepay_interest(
    state: State<Mutex<AppState>>,
    loan_id: i64,
    paid_at: String,
) -> Result<PrepayResult, String> {
    let guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard.db.as_ref().ok_or_else(|| "DB not unlocked".to_string())?;

    let paid_date = if paid_at.len() >= 10 {
        chrono::NaiveDate::parse_from_str(&paid_at[..10], "%Y-%m-%d")
            .map_err(|_| "Invalid paid_at date".to_string())?
    } else {
        return Err("Invalid paid_at date".to_string());
    };

    let (arrears, month_interest, total, new_through) =
        db::loans::preview_prepay_interest(conn, loan_id, paid_date)
            .map_err(|e: AppError| e.to_string())?;

    Ok(PrepayResult {
        arrears_cleared: arrears,
        month_interest,
        total_paid: total,
        new_paid_through: new_through,
    })
}

#[tauri::command]
pub fn get_loan_repayment_schedule(
    state: State<Mutex<AppState>>,
    loan_id: i64,
) -> Result<db::loans::LoanRepaymentSchedule, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard.db.as_mut().ok_or_else(|| "DB not unlocked".to_string())?;
    db::loans::get_loan_repayment_schedule(conn, loan_id)
        .map_err(|e: AppError| e.to_string())
}
