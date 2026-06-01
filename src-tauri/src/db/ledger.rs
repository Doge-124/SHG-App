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
    record_receipt_ex(tx, amount, reason, payment_method, reference_type,
                      reference_id, created_at, None, None)
}

/// Record a RECEIPT with optional bank transaction id + mixed-payment group id.
pub fn record_receipt_ex(
    tx: &mut Transaction,
    amount: f64,
    reason: &str,
    payment_method: &str,
    reference_type: Option<&str>,
    reference_id: Option<i64>,
    created_at: &str,
    bank_txn_id: Option<&str>,
    group_id: Option<&str>,
) -> Result<(), AppError> {
    validation::validate_money_amount(amount)?;
    validation::validate_payment_method(payment_method)?;

    tx.execute(
        "INSERT INTO shg_transactions
         (txn_type, amount, reason, payment_method, reference_type, reference_id,
          created_at, bank_txn_id, group_id)
         VALUES ('RECEIPT', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        (amount, reason, payment_method, reference_type, reference_id, created_at,
         bank_txn_id, group_id),
    )?;

    tx.execute(
        "UPDATE shg_balances SET balance = balance + ?1 WHERE method = ?2",
        (amount, payment_method),
    )?;

    Ok(())
}

/// Record a MIXED receipt — splits one logical incoming payment into a CASH
/// row and a BANK row, both tagged with the same `group_id`. The bank txn id
/// (if any) is attached to the BANK half. Returns the generated group id.
///
/// Either portion may be zero (then only the non-zero row is written, and no
/// group id is needed). When both are positive a group id ties them together.
pub fn record_receipt_mixed(
    tx: &mut Transaction,
    cash_amount: f64,
    bank_amount: f64,
    reason: &str,
    reference_type: Option<&str>,
    reference_id: Option<i64>,
    created_at: &str,
    bank_txn_id: Option<&str>,
) -> Result<Option<String>, AppError> {
    let has_cash = cash_amount > 0.005;
    let has_bank = bank_amount > 0.005;
    if !has_cash && !has_bank {
        return Err(AppError::validation("Mixed payment must have a positive cash or bank amount"));
    }

    // Only need a group id when both halves exist.
    let group_id: Option<String> = if has_cash && has_bank {
        Some(format!("grp-{}", chrono::Utc::now().timestamp_micros()))
    } else {
        None
    };
    let gid = group_id.as_deref();

    if has_cash {
        record_receipt_ex(tx, cash_amount, reason, "CASH", reference_type,
                          reference_id, created_at, None, gid)?;
    }
    if has_bank {
        record_receipt_ex(tx, bank_amount, reason, "BANK", reference_type,
                          reference_id, created_at, bank_txn_id, gid)?;
    }
    Ok(group_id)
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
    record_voucher_ex(tx, amount, reason, payment_method, reference_type,
                      reference_id, created_at, None)
}

/// Record a VOUCHER with an optional bank transaction id.
pub fn record_voucher_ex(
    tx: &mut Transaction,
    amount: f64,
    reason: &str,
    payment_method: &str,
    reference_type: Option<&str>,
    reference_id: Option<i64>,
    created_at: &str,
    bank_txn_id: Option<&str>,
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
         (txn_type, amount, reason, payment_method, reference_type, reference_id,
          created_at, bank_txn_id)
         VALUES ('VOUCHER', ?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        (amount, reason, payment_method, reference_type, reference_id, created_at, bank_txn_id),
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

