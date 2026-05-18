//! Day Book - Derived view of SHG financial transactions
//!
//! All values are computed from shg_transactions table.
//! No separate daybook table is maintained.

use rusqlite::{Connection, Row};
use serde::Serialize;
use chrono::{DateTime, Utc};

use crate::error::AppError;

/// Transaction entry in day book
#[derive(Serialize, Debug, Clone)]
pub struct DayBookEntry {
    pub id: i64,
    pub date: String,
    pub txn_type: String, // "RECEIPT" or "VOUCHER"
    pub amount: f64,
    pub category: String,
    pub payment_method: String,
    pub member_id: Option<i64>,
    pub member_name: Option<String>,
    pub reference_id: i64,
    pub reference_type: Option<String>,
    pub description: String,
}

/// Day book summary for a date range
#[derive(Serialize, Debug)]
pub struct DayBookSummary {
    pub opening_balance: f64,
    pub total_receipts: f64,
    pub total_vouchers: f64,
    pub closing_balance: f64,
    pub transactions: Vec<DayBookEntry>,
}

/// Category mapping for transactions based on reference_type and reason
fn categorize_transaction(reference_type: Option<&str>, reason: &str) -> String {
    match reference_type {
        Some("WEEKLY_CONTRIBUTION") => "Savings Collection".to_string(),
        Some("MEMBER_RECEIPT") => "Member Receipt".to_string(),
        Some("LOAN_DISBURSEMENT") => "Loan Disbursement".to_string(),
        Some("CHIT_PAYOUT") => "Chit Fund Payout".to_string(),
        Some("EXPENSE") => "Expense".to_string(),
        Some("DONATION") => "Donation".to_string(),
        Some("OPENING") => "Opening Balance".to_string(),
        _ => {
            // Infer from reason text
            let reason_lower = reason.to_lowercase();
            if reason_lower.contains("savings") || reason_lower.contains("contribution") {
                "Savings Collection".to_string()
            } else if reason_lower.contains("loan") {
                if reason_lower.contains("repayment") || reason_lower.contains("payment") {
                    "Loan Repayment".to_string()
                } else {
                    "Loan".to_string()
                }
            } else if reason_lower.contains("chit") {
                "Chit Fund".to_string()
            } else if reason_lower.contains("expense") || reason_lower.contains("purchase") {
                "Expense".to_string()
            } else if reason_lower.contains("donation") || reason_lower.contains("donor") {
                "Donation".to_string()
            } else if reason_lower.contains("interest") || reason_lower.contains("income") {
                "Interest Income".to_string()
            } else if reason_lower.contains("fee") || reason_lower.contains("fine") {
                "Fee Collection".to_string()
            } else {
                "Other".to_string()
            }
        }
    }
}

/// Compute total SHG funds (current balance from shg_balances table)
/// This shows the actual total funds the SHG has across all payment methods
pub fn compute_total_shg_funds(conn: &Connection) -> Result<f64, AppError> {
    // Get sum of all balances from shg_balances table (CASH + BANK)
    let total: f64 = conn.query_row(
        "SELECT COALESCE(SUM(balance), 0.0) FROM shg_balances",
        [],
        |row| row.get(0),
    )?;
    
    // Also compute from transactions for verification
    let opening: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0.0) FROM shg_transactions WHERE txn_type = 'OPENING'",
        [], |row| row.get(0),
    )?;
    let receipts: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0.0) FROM shg_transactions WHERE txn_type = 'RECEIPT'",
        [], |row| row.get(0),
    )?;
    let vouchers: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0.0) FROM shg_transactions WHERE txn_type = 'VOUCHER'",
        [], |row| row.get(0),
    )?;
    Ok(total)
}

/// Compute the opening balance for a period starting at `as_of_date`.
///
/// Logic:
/// - OPENING transactions (member opening-balance migrations) represent money
///   that existed BEFORE the app was adopted — they always count toward the
///   opening balance regardless of when they were entered into the app.
/// - RECEIPT and VOUCHER transactions are time-bound: they're included in the
///   opening only if their `created_at` is strictly before the period starts.
pub fn compute_opening_balance(conn: &Connection, as_of_date: &str) -> Result<f64, AppError> {
    let balance: f64 = conn.query_row(
        "SELECT COALESCE(
            SUM(CASE
                WHEN txn_type = 'OPENING' THEN amount
                WHEN txn_type = 'RECEIPT' AND created_at < ?1 THEN amount
                WHEN txn_type = 'VOUCHER' AND created_at < ?1 THEN -amount
                ELSE 0
            END), 0.0)
         FROM shg_transactions",
        [as_of_date],
        |row| row.get(0),
    )?;
    Ok(balance)
}

/// Get day book entries for a date range
pub fn get_day_book_entries(
    conn: &Connection,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<DayBookEntry>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT 
            t.id,
            t.created_at,
            t.txn_type,
            t.amount,
            t.reason,
            t.payment_method,
            t.reference_type,
            t.reference_id,
            m.id as member_id,
            m.name as member_name
         FROM shg_transactions t
         LEFT JOIN members m ON (
             (t.reference_type = 'WEEKLY_CONTRIBUTION' OR t.reference_type = 'MEMBER_RECEIPT')
             AND t.reference_id = m.id
         )
         WHERE t.created_at >= ?1 
           AND t.created_at <= ?2
           AND t.txn_type IN ('RECEIPT', 'VOUCHER')
         ORDER BY t.created_at ASC, t.id ASC"
    )?;

    let rows = stmt.query_map([start_date, end_date], |row: &Row| {
        let reference_type: Option<String> = row.get(6)?;
        let reason: String = row.get(4)?;
        let category = categorize_transaction(reference_type.as_deref(), &reason);
        
        Ok(DayBookEntry {
            id: row.get(0)?,
            date: row.get(1)?,
            txn_type: row.get(2)?,
            amount: row.get(3)?,
            category,
            payment_method: row.get(5)?,
            member_id: row.get(7)?, // reference_id is the member_id for member-related transactions
            member_name: row.get(9)?,
            reference_id: row.get(0)?, // Use transaction ID as reference
            reference_type,
            description: reason,
        })
    })?;

    let mut entries = Vec::new();
    for row in rows {
        entries.push(row?);
    }

    Ok(entries)
}

/// Compute totals for a date range
pub fn compute_totals(
    conn: &Connection,
    start_date: &str,
    end_date: &str,
) -> Result<(f64, f64), AppError> {
    let total_receipts: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0.0) 
         FROM shg_transactions 
         WHERE txn_type = 'RECEIPT' 
         AND created_at >= ?1 
         AND created_at <= ?2",
        [start_date, end_date],
        |row| row.get(0),
    )?;

    let total_vouchers: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0.0) 
         FROM shg_transactions 
         WHERE txn_type = 'VOUCHER' 
         AND created_at >= ?1 
         AND created_at <= ?2",
        [start_date, end_date],
        |row| row.get(0),
    )?;

    Ok((total_receipts, total_vouchers))
}

/// Get cash-only book summary — receipts and vouchers where payment_method = 'CASH'.
pub fn get_cash_book_summary(
    conn: &Connection,
    start_date: &str,
    end_date: &str,
) -> Result<DayBookSummary, AppError> {
    let mut stmt = conn.prepare(
        "SELECT
            t.id, t.created_at, t.txn_type, t.amount, t.reason,
            t.payment_method, t.reference_type, t.reference_id,
            m.id as member_id, m.name as member_name
         FROM shg_transactions t
         LEFT JOIN members m ON (
             t.reference_type IN (
                 'WEEKLY_CONTRIBUTION','MEMBER_RECEIPT','MEMBER_CONTRIBUTION',
                 'MEMBER_PAYMENT','CHIT_PAYMENT','CHIT_COMMISSION'
             ) AND t.reference_id = m.id
         )
         WHERE t.created_at >= ?1
           AND t.created_at <= ?2
           AND t.txn_type IN ('RECEIPT', 'VOUCHER')
           AND t.payment_method = 'CASH'
         ORDER BY t.created_at ASC, t.id ASC",
    )?;

    let rows = stmt.query_map([start_date, end_date], |row| {
        let reference_type: Option<String> = row.get(6)?;
        let reason: String = row.get(4)?;
        let category = categorize_transaction(reference_type.as_deref(), &reason);
        Ok(DayBookEntry {
            id: row.get(0)?,
            date: row.get(1)?,
            txn_type: row.get(2)?,
            amount: row.get(3)?,
            category,
            payment_method: row.get(5)?,
            member_id: row.get(7)?,
            member_name: row.get(9)?,
            reference_id: row.get(0)?,
            reference_type,
            description: reason,
        })
    })?;

    let mut transactions = Vec::new();
    for row in rows {
        transactions.push(row?);
    }

    let total_receipts: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0.0) FROM shg_transactions
         WHERE txn_type = 'RECEIPT' AND payment_method = 'CASH'
           AND created_at >= ?1 AND created_at <= ?2",
        [start_date, end_date],
        |row| row.get(0),
    )?;

    let total_vouchers: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0.0) FROM shg_transactions
         WHERE txn_type = 'VOUCHER' AND payment_method = 'CASH'
           AND created_at >= ?1 AND created_at <= ?2",
        [start_date, end_date],
        |row| row.get(0),
    )?;

    // Opening cash balance = current SHG cash balance minus the period's net cash activity.
    // Using shg_balances (always in sync) avoids date-string comparison issues.
    let current_cash: f64 = conn.query_row(
        "SELECT COALESCE(balance, 0.0) FROM shg_balances WHERE method = 'CASH'",
        [],
        |row| row.get(0),
    ).unwrap_or(0.0);

    let opening_balance = current_cash - total_receipts + total_vouchers;
    let closing_balance = current_cash;

    Ok(DayBookSummary {
        opening_balance,
        total_receipts,
        total_vouchers,
        closing_balance,
        transactions,
    })
}

/// Get bank-only book summary — receipts and vouchers where payment_method = 'BANK'.
pub fn get_bank_book_summary(
    conn: &Connection,
    start_date: &str,
    end_date: &str,
) -> Result<DayBookSummary, AppError> {
    let mut stmt = conn.prepare(
        "SELECT
            t.id, t.created_at, t.txn_type, t.amount, t.reason,
            t.payment_method, t.reference_type, t.reference_id,
            m.id as member_id, m.name as member_name
         FROM shg_transactions t
         LEFT JOIN members m ON (
             t.reference_type IN (
                 'WEEKLY_CONTRIBUTION','MEMBER_RECEIPT','MEMBER_CONTRIBUTION',
                 'MEMBER_PAYMENT','CHIT_PAYMENT','CHIT_COMMISSION'
             ) AND t.reference_id = m.id
         )
         WHERE t.created_at >= ?1
           AND t.created_at <= ?2
           AND t.txn_type IN ('RECEIPT', 'VOUCHER')
           AND t.payment_method = 'BANK'
         ORDER BY t.created_at ASC, t.id ASC",
    )?;

    let rows = stmt.query_map([start_date, end_date], |row| {
        let reference_type: Option<String> = row.get(6)?;
        let reason: String = row.get(4)?;
        let category = categorize_transaction(reference_type.as_deref(), &reason);
        Ok(DayBookEntry {
            id: row.get(0)?,
            date: row.get(1)?,
            txn_type: row.get(2)?,
            amount: row.get(3)?,
            category,
            payment_method: row.get(5)?,
            member_id: row.get(7)?,
            member_name: row.get(9)?,
            reference_id: row.get(0)?,
            reference_type,
            description: reason,
        })
    })?;

    let mut transactions = Vec::new();
    for row in rows {
        transactions.push(row?);
    }

    let total_receipts: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0.0) FROM shg_transactions
         WHERE txn_type = 'RECEIPT' AND payment_method = 'BANK'
           AND created_at >= ?1 AND created_at <= ?2",
        [start_date, end_date],
        |row| row.get(0),
    )?;

    let total_vouchers: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0.0) FROM shg_transactions
         WHERE txn_type = 'VOUCHER' AND payment_method = 'BANK'
           AND created_at >= ?1 AND created_at <= ?2",
        [start_date, end_date],
        |row| row.get(0),
    )?;

    let current_bank: f64 = conn.query_row(
        "SELECT COALESCE(balance, 0.0) FROM shg_balances WHERE method = 'BANK'",
        [],
        |row| row.get(0),
    ).unwrap_or(0.0);

    let opening_balance = current_bank - total_receipts + total_vouchers;
    let closing_balance = current_bank;

    Ok(DayBookSummary {
        opening_balance,
        total_receipts,
        total_vouchers,
        closing_balance,
        transactions,
    })
}

/// Get complete day book summary for a date range
pub fn get_day_book_summary(
    conn: &Connection,
    start_date: &str,
    end_date: &str,
) -> Result<DayBookSummary, AppError> {
    // Get all transactions in the date range
    let transactions = get_day_book_entries(conn, start_date, end_date)?;

    // Compute totals for the period (RECEIPT and VOUCHER only)
    let (total_receipts, total_vouchers) = compute_totals(conn, start_date, end_date)?;

    // Opening balance = sum of all transactions BEFORE this period started.
    // This is fixed for any given period — it never changes while you add
    // new transactions to the current period, only when you change the date filter.
    let opening_balance = compute_opening_balance(conn, start_date)?;

    // Closing balance = opening + period activity. Updates as transactions
    // are added during the period (since total_receipts/vouchers do).
    let closing_balance = opening_balance + total_receipts - total_vouchers;

    Ok(DayBookSummary {
        opening_balance,
        total_receipts,
        total_vouchers,
        closing_balance,
        transactions,
    })
}

/// Filter day book entries by category
pub fn filter_by_category(entries: &[DayBookEntry], category: &str) -> Vec<DayBookEntry> {
    entries.iter()
        .filter(|e| e.category == category)
        .cloned()
        .collect()
}

/// Filter day book entries by transaction type
pub fn filter_by_type(entries: &[DayBookEntry], txn_type: &str) -> Vec<DayBookEntry> {
    entries.iter()
        .filter(|e| e.txn_type == txn_type)
        .cloned()
        .collect()
}

/// Filter day book entries by member
pub fn filter_by_member(entries: &[DayBookEntry], member_id: i64) -> Vec<DayBookEntry> {
    entries.iter()
        .filter(|e| e.member_id == Some(member_id))
        .cloned()
        .collect()
}

/// Get all available categories from transactions
pub fn get_categories(entries: &[DayBookEntry]) -> Vec<String> {
    let mut categories: Vec<String> = entries.iter()
        .map(|e| e.category.clone())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    categories.sort();
    categories
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_categorize_transaction() {
        assert_eq!(
            categorize_transaction(Some("WEEKLY_CONTRIBUTION"), "Weekly contribution"),
            "Savings Collection"
        );
        assert_eq!(
            categorize_transaction(Some("EXPENSE"), "Office supplies"),
            "Expense"
        );
        assert_eq!(
            categorize_transaction(None, "Savings deposit from member"),
            "Savings Collection"
        );
        assert_eq!(
            categorize_transaction(None, "Loan repayment"),
            "Loan Repayment"
        );
    }
}
