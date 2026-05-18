//! SHG-wide ledger operations (receipts, vouchers, and balances).
//!
//! Every movement of SHG money must pass through this module to ensure a
//! complete audit trail and consistent `shg_balances`.

use rusqlite::{Connection, Transaction};
use serde::Serialize;

use crate::error::AppError;
use crate::db::validation;

#[derive(Serialize)]
pub struct ShgTransaction {
    pub id: i64,
    pub txn_type: String,
    pub amount: f64,
    pub description: String,
    pub payment_method: String,
    pub reference_type: Option<String>,
    pub reference_id: Option<i64>,
    pub created_at: String,
    pub member_name: Option<String>,
}

/// Get the current SHG balance for a given method (`CASH` or `BANK`).
pub fn get_shg_balance(conn: &Connection, method: &str) -> Result<f64, AppError> {
    validation::validate_payment_method(method)?;

    let balance = conn.query_row(
        "SELECT balance FROM shg_balances WHERE method = ?1",
        [method],
        |row| row.get::<_, f64>(0),
    )?;

    Ok(balance)
}

/// Convenience wrapper for the SHG cash balance.
pub fn get_cash_balance(conn: &Connection) -> Result<f64, AppError> {
    get_shg_balance(conn, "CASH")
}

/// Convenience wrapper for the SHG bank balance.
pub fn get_bank_balance(conn: &Connection) -> Result<f64, AppError> {
    get_shg_balance(conn, "BANK")
}

/// Record a RECEIPT in the SHG ledger and update the balance.
pub fn record_receipt(
    tx: &mut Transaction,
    amount: f64,
    reason: &str,
    payment_method: &str,
    reference_type: Option<&str>,
    reference_id: Option<i64>,
    created_at: &str,
) -> Result<(), AppError> {
    validation::validate_money_amount(amount)?;
    validation::validate_payment_method(payment_method)?;

    tx.execute(
        "INSERT INTO shg_transactions
         (txn_type, amount, reason, payment_method, reference_type, reference_id, created_at)
         VALUES ('RECEIPT', ?1, ?2, ?3, ?4, ?5, ?6)",
        (amount, reason, payment_method, reference_type, reference_id, created_at),
    )?;

    tx.execute(
        "UPDATE shg_balances SET balance = balance + ?1 WHERE method = ?2",
        (amount, payment_method),
    )?;

    Ok(())
}

/// Record a VOUCHER in the SHG ledger and update the balance.
///
/// Ensures sufficient balance exists before allowing the voucher.
pub fn record_voucher(
    tx: &mut Transaction,
    amount: f64,
    reason: &str,
    payment_method: &str,
    reference_type: Option<&str>,
    reference_id: Option<i64>,
    created_at: &str,
) -> Result<(), AppError> {
    validation::validate_money_amount(amount)?;
    validation::validate_payment_method(payment_method)?;

    // Check if sufficient balance exists
    let current_balance = tx.query_row(
        "SELECT balance FROM shg_balances WHERE method = ?1",
        [payment_method],
        |row| row.get::<_, f64>(0),
    )?;
    
    // 0.005 tolerance absorbs f64 rounding noise (half a paisa).
    if current_balance + 0.005 < amount {
        return Err(AppError::business(format!(
            "Insufficient {} balance: available {:.2}, required {:.2}",
            payment_method, current_balance, amount
        )));
    }

    tx.execute(
        "INSERT INTO shg_transactions
         (txn_type, amount, reason, payment_method, reference_type, reference_id, created_at)
         VALUES ('VOUCHER', ?1, ?2, ?3, ?4, ?5, ?6)",
        (amount, reason, payment_method, reference_type, reference_id, created_at),
    )?;

    tx.execute(
        "UPDATE shg_balances SET balance = balance - ?1 WHERE method = ?2",
        (amount, payment_method),
    )?;

    Ok(())
}

/// Record a VOUCHER without checking balance (for special cases like chit payouts).
///
/// This should only be used when the funds were just collected and are immediately
/// being paid out, bypassing the normal balance verification.
pub fn record_voucher_unchecked(
    tx: &mut Transaction,
    amount: f64,
    reason: &str,
    payment_method: &str,
    reference_type: Option<&str>,
    reference_id: Option<i64>,
    created_at: &str,
) -> Result<(), AppError> {
    validation::validate_money_amount(amount)?;
    validation::validate_payment_method(payment_method)?;

    tx.execute(
        "INSERT INTO shg_transactions
         (txn_type, amount, reason, payment_method, reference_type, reference_id, created_at)
         VALUES ('VOUCHER', ?1, ?2, ?3, ?4, ?5, ?6)",
        (amount, reason, payment_method, reference_type, reference_id, created_at),
    )?;

    tx.execute(
        "UPDATE shg_balances SET balance = balance - ?1 WHERE method = ?2",
        (amount, payment_method),
    )?;

    Ok(())
}

