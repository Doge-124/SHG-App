//! Tauri commands for Day Book operations.
//!
//! The Day Book is a derived view of all SHG financial transactions.
//! All values are computed from the `shg_transactions` table.

use std::sync::Mutex;
use tauri::State;

use crate::db::daybook::{DayBookSummary, get_day_book_summary, get_cash_book_summary, get_bank_book_summary};
use crate::error::AppError;
use crate::state::AppState;

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

/// Export day book data to CSV format
#[tauri::command]
pub fn export_day_book_csv(
    state: State<Mutex<AppState>>,
    start_date: String,
    end_date: String,
) -> Result<String, String> {
    let summary = get_day_book(state, start_date, end_date)?;
    
    let mut csv = String::new();
    
    // Header
    csv.push_str("Date,Time,Type,Category,Amount,Payment Method,Member,Description,Reference ID\n");
    
    // Data rows
    for entry in &summary.transactions {
        let datetime = chrono::DateTime::parse_from_rfc3339(&entry.date)
            .map(|dt| dt.format("%Y-%m-%d,%H:%M:%S").to_string())
            .unwrap_or_else(|_| format!("{}", entry.date));
        
        let member = entry.member_name.as_deref().unwrap_or("");
        
        csv.push_str(&format!(
            "{},{},{},{:.2},{},{},{},{}",
            datetime,
            entry.txn_type,
            entry.category,
            entry.amount,
            entry.payment_method,
            member,
            entry.description.replace(',', ";"),
            entry.reference_id
        ));
    }
    
    // Summary section
    csv.push_str("\n\nSummary\n");
    csv.push_str(&format!("Opening Balance,{:.2}\n", summary.opening_balance));
    csv.push_str(&format!("Total Receipts,{:.2}\n", summary.total_receipts));
    csv.push_str(&format!("Total Vouchers,{:.2}\n", summary.total_vouchers));
    csv.push_str(&format!("Closing Balance,{:.2}\n", summary.closing_balance));
    
    Ok(csv)
}
