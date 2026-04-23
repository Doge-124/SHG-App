//! Tauri commands for Day Book operations.
//!
//! The Day Book is a derived view of all SHG financial transactions.
//! All values are computed from the `shg_transactions` table.

use std::sync::Mutex;
use tauri::State;

use crate::db::daybook::{DayBookSummary, get_day_book_summary};
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
    // Validate date format
    if start_date.len() != 10 || end_date.len() != 10 {
        return Err("Invalid date format. Use YYYY-MM-DD".to_string());
    }

    // Validate date range
    if start_date > end_date {
        return Err("Start date must be before or equal to end date".to_string());
    }

    // Prevent future date queries (optional restriction)
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    if start_date > today {
        return Err("Cannot query future dates".to_string());
    }

    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    // Set time boundaries for the date range
    // Start: beginning of start_date (00:00:00)
    // End: end of end_date (23:59:59)
    let start_datetime = format!("{}T00:00:00", start_date);
    let end_datetime = format!("{}T23:59:59", end_date);

    let summary = get_day_book_summary(conn, &start_datetime, &end_datetime)
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
