//! Reporting helpers over the SHG ledger.
//!
//! These functions are read-only and support filtering by date window,
//! payment method, transaction type, and (indirectly) member_id where
//! applicable.

use rusqlite::Connection;

use crate::error::AppError;
use crate::db::{ledger::ShgTransaction, validation};

/// Core query helper used by the specific daily/weekly/monthly report
/// functions. All filters are optional; if `None` the filter is not applied.
fn get_transactions_in_range(
    conn: &Connection,
    from: &str,
    to: &str,
    payment_method: Option<&str>,
    transaction_type: Option<&str>,
    member_id: Option<i64>,
) -> Result<Vec<ShgTransaction>, AppError> {
    let mut sql = format!(
        "SELECT t.id, t.txn_type, t.amount, t.reason as description,
                t.payment_method, t.reference_type, t.reference_id, t.created_at,
                {name_expr} as member_name
         FROM shg_transactions t
         WHERE t.created_at BETWEEN ?1 AND ?2
         AND t.txn_type != 'OPENING'",
        name_expr = crate::db::ledger::MEMBER_NAME_SQL,
    );

    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    
    // Add time component to make the range inclusive for the entire day
    let from_with_time = if from.len() == 10 { // YYYY-MM-DD format
        format!("{}T00:00:00.000Z", from)
    } else {
        from.to_string()
    };
    
    let to_with_time = if to.len() == 10 { // YYYY-MM-DD format
        format!("{}T23:59:59.999Z", to)
    } else {
        to.to_string()
    };
    
    params.push(Box::new(from_with_time));
    params.push(Box::new(to_with_time));

    let mut next_index = 3;

    if let Some(pm) = payment_method {
        validation::validate_payment_method(pm)?;
        sql.push_str(&format!(" AND payment_method = ?{next_index}"));
        params.push(Box::new(pm.to_string()));
        next_index += 1;
    }

    if let Some(tt) = transaction_type {
        // Handle different transaction types
        match tt {
            "RECEIPT" | "VOUCHER" => {
                sql.push_str(&format!(" AND txn_type = ?{next_index}"));
                params.push(Box::new(tt.to_string()));
                next_index += 1;
            }
            "LOAN" => {
                // Loans are identified by reference_type = 'MEMBER_LOAN'
                sql.push_str(&format!(" AND reference_type = ?{next_index}"));
                params.push(Box::new("MEMBER_LOAN".to_string()));
                next_index += 1;
            }
            "REPAYMENT" => {
                // Repayments are identified by reference_type = 'MEMBER_PAYMENT'
                sql.push_str(&format!(" AND reference_type = ?{next_index}"));
                params.push(Box::new("MEMBER_PAYMENT".to_string()));
                next_index += 1;
            }
            _ => {
                return Err(AppError::validation(
                    "transaction_type must be 'RECEIPT', 'VOUCHER', 'LOAN', or 'REPAYMENT'",
                ))
            }
        }
    }

    if let Some(mid) = member_id {
        // Member-scoped flows are encoded via reference_type / reference_id.
        sql.push_str(&format!(
            " AND reference_type IN ('MEMBER_LOAN','MEMBER_PAYMENT') AND reference_id = ?{next_index}"
        ));
        params.push(Box::new(mid));
    }

    let mut stmt = conn.prepare(&sql)?;

    let rows = stmt.query_map(
        rusqlite::params_from_iter(params.iter().map(|b| &**b)),
        |row| {
            Ok(ShgTransaction {
                id: row.get(0)?,
                txn_type: row.get(1)?,
                amount: row.get(2)?,
                description: row.get(3)?,
                payment_method: row.get(4)?,
                reference_type: row.get(5)?,
                reference_id: row.get(6)?,
                created_at: row.get(7)?,
                member_name: row.get(8)?,
            })
        },
    )?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }

    Ok(out)
}

/// Get all transactions for a single calendar day (`date` in ISO string),
/// with optional filters.
pub fn get_daily_transactions(
    conn: &Connection,
    from: &str,
    to: &str,
    payment_method: Option<&str>,
    transaction_type: Option<&str>,
    member_id: Option<i64>,
) -> Result<Vec<ShgTransaction>, AppError> {
    get_transactions_in_range(conn, from, to, payment_method, transaction_type, member_id)
}

/// Get all transactions for a weekly window (inclusive start and end strings).
pub fn get_weekly_transactions(
    conn: &Connection,
    from: &str,
    to: &str,
    payment_method: Option<&str>,
    transaction_type: Option<&str>,
    member_id: Option<i64>,
) -> Result<Vec<ShgTransaction>, AppError> {
    get_transactions_in_range(conn, from, to, payment_method, transaction_type, member_id)
}

/// Get all transactions for a monthly window (start/end supplied by caller).
pub fn get_monthly_transactions(
    conn: &Connection,
    from: &str,
    to: &str,
    payment_method: Option<&str>,
    transaction_type: Option<&str>,
    member_id: Option<i64>,
) -> Result<Vec<ShgTransaction>, AppError> {
    get_transactions_in_range(conn, from, to, payment_method, transaction_type, member_id)
}

