//! Simple helper functions to manually exercise core financial flows.
//!
//! These are not unit tests, but small scenarios that can be invoked from
//! a REPL or ad-hoc harness to verify the behavior of the backend and its
//! invariants.

use rusqlite::Connection;

use crate::error::AppError;
use crate::db::{chits, ledger, loans, members};

/// Create a couple of members for testing.
pub fn test_create_members(conn: &Connection) -> Result<(), AppError> {
    members::add_member(conn, "M001", "Alice", None, None, "2025-01-01")?;
    members::add_member(conn, "M002", "Bob", None, None, "2025-01-01")?;
    Ok(())
}

/// Issue a test loan to a member and verify balances.
pub fn test_issue_loan(conn: &mut Connection, member_id: i64) -> Result<(), AppError> {
    loans::issue_member_loan(
        conn,
        member_id,
        1000.0,
        "CASH",
        "Test loan",
        "2025-01-02T10:00:00",
    )?;

    let outstanding = members::get_member_outstanding(conn, member_id)?;
    if (outstanding - 1000.0).abs() > 0.01 {
        return Err(AppError::business(format!(
            "expected outstanding loan of 1000 for member {member_id}, got {outstanding}"
        )));
    }

    Ok(())
}

/// Record a test repayment and verify balances.
pub fn test_member_repayment(conn: &mut Connection, member_id: i64) -> Result<(), AppError> {
    loans::record_member_payment(
        conn,
        member_id,
        200.0,
        "CASH",
        "Test repayment",
        "2025-01-03T10:00:00",
    )?;

    let outstanding = members::get_member_outstanding(conn, member_id)?;
    if (outstanding - 800.0).abs() > 0.01 {
        return Err(AppError::business(format!(
            "expected outstanding loan of 800 for member {member_id}, got {outstanding}"
        )));
    }

    Ok(())
}

/// Check high-level ledger invariants for cash and bank balances.
pub fn test_ledger_integrity(conn: &Connection) -> Result<(), AppError> {
    let cash = ledger::get_cash_balance(conn)?;
    let bank = ledger::get_bank_balance(conn)?;

    // Recompute net from shg_transactions for verification.
    let (receipts, vouchers): (f64, f64) = conn.query_row(
        "SELECT
            COALESCE(SUM(CASE WHEN txn_type = 'RECEIPT' THEN amount ELSE 0 END), 0.0) AS receipts,
            COALESCE(SUM(CASE WHEN txn_type = 'VOUCHER' THEN amount ELSE 0 END), 0.0) AS vouchers
         FROM shg_transactions",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    let net = receipts - vouchers;
    if (cash + bank - net).abs() > 0.01 {
        return Err(AppError::business(format!(
            "ledger imbalance: cash+bank={:.2}, receipts-vouchers={:.2}",
            cash + bank,
            net
        )));
    }

    Ok(())
}

