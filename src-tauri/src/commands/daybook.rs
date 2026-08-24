//! Tauri commands for Day Book operations.
//!
//! The Day Book is a derived view of all SHG financial transactions.
//! All values are computed from the `shg_transactions` table.

use std::sync::Mutex;
use tauri::State;
use serde::Serialize;

use crate::db::daybook::{DayBookSummary, get_day_book_summary, get_cash_book_summary, get_bank_book_summary};
use crate::error::AppError;
use crate::state::AppState;

/// One bank transaction-ID record for the Bank Book reconciliation report.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BankTxnIdEntry {
    pub id: i64,
    pub date: String,
    pub txn_type: String,       // RECEIPT | VOUCHER
    pub amount: f64,
    pub reason: String,
    pub member_name: Option<String>,
    pub bank_txn_id: String,
}

/// List every BANK-method transaction in the period that has a transaction ID
/// recorded. Used for the "Print Transaction IDs" report the secretary takes
/// to the bank. Voided rows and reversal rows are excluded.
#[tauri::command]
pub fn get_bank_transaction_ids(
    state: State<Mutex<AppState>>,
    start_date: String,
    end_date: String,
) -> Result<Vec<BankTxnIdEntry>, String> {
    chrono::NaiveDate::parse_from_str(&start_date, "%Y-%m-%d")
        .map_err(|_| "Invalid start date".to_string())?;
    chrono::NaiveDate::parse_from_str(&end_date, "%Y-%m-%d")
        .map_err(|_| "Invalid end date".to_string())?;

    let guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard.db.as_ref().ok_or_else(|| "DB not unlocked".to_string())?;

    let end_dt = format!("{}T23:59:59", end_date);
    let sql = format!(
        "SELECT t.id, t.created_at, t.txn_type, t.amount, t.reason,
                {name_expr} AS member_name,
                t.bank_txn_id
         FROM shg_transactions t
         WHERE t.payment_method = 'BANK'
           AND t.bank_txn_id IS NOT NULL AND t.bank_txn_id != ''
           AND t.voided_at IS NULL AND t.reversal_of_id IS NULL
           AND t.created_at >= ?1 AND t.created_at <= ?2
         ORDER BY t.created_at ASC",
        name_expr = crate::db::ledger::MEMBER_NAME_SQL,
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let rows = stmt.query_map((start_date.as_str(), end_dt.as_str()), |r| {
        Ok(BankTxnIdEntry {
            id: r.get(0)?,
            date: r.get(1)?,
            txn_type: r.get(2)?,
            amount: r.get(3)?,
            reason: r.get(4)?,
            member_name: r.get(5)?,
            bank_txn_id: r.get(6)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for row in rows { out.push(row.map_err(|e| e.to_string())?); }
    Ok(out)
}

/// Get the Day Book summary for a date range
///
/// # Arguments
/// * `start_date` - Start date in ISO format (YYYY-MM-DD)
/// * `end_date` - End date in ISO format (YYYY-MM-DD)
///
/// # Returns
/// DayBookSummary with opening balance, transactions, and closing balance
#[tauri::command]
pub fn get_day_book(
    state: State<Mutex<AppState>>,
    start_date: String,
    end_date: String,
) -> Result<DayBookSummary, String> {
    // Validate date format with actual parsing (rejects nonsense like "99999-99-99").
    let parsed_start = chrono::NaiveDate::parse_from_str(&start_date, "%Y-%m-%d")
        .map_err(|_| "Invalid start date — use YYYY-MM-DD format".to_string())?;
    let parsed_end = chrono::NaiveDate::parse_from_str(&end_date, "%Y-%m-%d")
        .map_err(|_| "Invalid end date — use YYYY-MM-DD format".to_string())?;

    if parsed_start > parsed_end {
        return Err("Start date must be before or equal to end date".to_string());
    }

    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    // Build comparison boundaries that handle mixed timestamp formats in the DB:
    //   - Live transactions store full RFC3339:  "2026-04-28T10:30:00+00:00"
    //   - Past-data entries store date-only:     "2026-04-28"
    //
    // Using the bare date as the lower bound means "2026-04-28" >= "2026-04-28" (equal,
    // so it IS included). Appending T23:59:59 as the upper bound works for both formats
    // because date-only strings are lexicographically less than any "date + T..." string
    // with the same date prefix.
    let start_datetime = start_date.clone();
    let end_datetime = format!("{}T23:59:59", end_date);

    let summary = get_day_book_summary(conn, &start_datetime, &end_datetime)
        .map_err(|e: AppError| e.to_string())?;

    Ok(summary)
}

/// Get cash book — CASH-only receipts and vouchers for a date range
#[tauri::command]
pub fn get_cash_book(
    state: State<Mutex<AppState>>,
    start_date: String,
    end_date: String,
) -> Result<DayBookSummary, String> {
    let parsed_start = chrono::NaiveDate::parse_from_str(&start_date, "%Y-%m-%d")
        .map_err(|_| "Invalid start date — use YYYY-MM-DD format".to_string())?;
    let parsed_end = chrono::NaiveDate::parse_from_str(&end_date, "%Y-%m-%d")
        .map_err(|_| "Invalid end date — use YYYY-MM-DD format".to_string())?;

    if parsed_start > parsed_end {
        return Err("Start date must be before or equal to end date".to_string());
    }

    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard.db.as_mut().ok_or_else(|| "DB not unlocked".to_string())?;

    let start_datetime = start_date.clone();
    let end_datetime = format!("{}T23:59:59", end_date);

    let summary = get_cash_book_summary(conn, &start_datetime, &end_datetime)
        .map_err(|e: AppError| e.to_string())?;

    Ok(summary)
}

/// Get bank book — BANK-only receipts and vouchers for a date range
#[tauri::command]
pub fn get_bank_book(
    state: State<Mutex<AppState>>,
    start_date: String,
    end_date: String,
) -> Result<DayBookSummary, String> {
    let parsed_start = chrono::NaiveDate::parse_from_str(&start_date, "%Y-%m-%d")
        .map_err(|_| "Invalid start date — use YYYY-MM-DD format".to_string())?;
    let parsed_end = chrono::NaiveDate::parse_from_str(&end_date, "%Y-%m-%d")
        .map_err(|_| "Invalid end date — use YYYY-MM-DD format".to_string())?;

    if parsed_start > parsed_end {
        return Err("Start date must be before or equal to end date".to_string());
    }

    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard.db.as_mut().ok_or_else(|| "DB not unlocked".to_string())?;

    let start_datetime = start_date.clone();
    let end_datetime = format!("{}T23:59:59", end_date);

    let summary = get_bank_book_summary(conn, &start_datetime, &end_datetime)
        .map_err(|e: AppError| e.to_string())?;

    Ok(summary)
}

/// Get day book entries for a single day (convenience command)
#[tauri::command]
pub fn get_day_book_for_date(
    state: State<Mutex<AppState>>,
    date: String,
) -> Result<DayBookSummary, String> {
    get_day_book(state, date.clone(), date)
}

/// Escape a single CSV field per RFC 4180: wrap in double quotes and double
/// any embedded quotes whenever the value contains a comma, quote, or newline.
fn csv_field(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') || s.contains('\r') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

/// Export day book data to CSV format.
///
/// Uses CRLF line endings and a UTF-8 BOM so Excel opens it cleanly with
/// each record on its own row. Every field is RFC-4180 escaped.
#[tauri::command]
pub fn export_day_book_csv(
    state: State<Mutex<AppState>>,
    start_date: String,
    end_date: String,
) -> Result<String, String> {
    let summary = get_day_book(state, start_date, end_date)?;

    // UTF-8 BOM — makes Excel detect the encoding instead of mangling it.
    let mut csv = String::from("\u{FEFF}");

    // Header (9 columns)
    csv.push_str("Date,Time,Type,Category,Amount,Payment Method,Member,Description,Reference ID\r\n");

    for entry in &summary.transactions {
        // Split date + time into two fields (matching the two header columns).
        let (date_part, time_part) = chrono::DateTime::parse_from_rfc3339(&entry.date)
            .map(|dt| (dt.format("%Y-%m-%d").to_string(), dt.format("%H:%M:%S").to_string()))
            .unwrap_or_else(|_| (entry.date.clone(), String::new()));

        let member = entry.member_name.as_deref().unwrap_or("");

        // Note the explicit \r\n terminator — the previous version omitted it,
        // collapsing every record onto a single line in Excel.
        csv.push_str(&format!(
            "{},{},{},{},{:.2},{},{},{},{}\r\n",
            csv_field(&date_part),
            csv_field(&time_part),
            csv_field(&entry.txn_type),
            csv_field(&entry.category),
            entry.amount,
            csv_field(&entry.payment_method),
            csv_field(member),
            csv_field(&entry.description),
            entry.reference_id,
        ));
    }

    // Summary section
    csv.push_str("\r\n");
    csv.push_str("Summary\r\n");
    csv.push_str(&format!("Opening Balance,{:.2}\r\n", summary.opening_balance));
    csv.push_str(&format!("Total Receipts,{:.2}\r\n", summary.total_receipts));
    csv.push_str(&format!("Total Vouchers,{:.2}\r\n", summary.total_vouchers));
    csv.push_str(&format!("Closing Balance,{:.2}\r\n", summary.closing_balance));

    Ok(csv)
}
