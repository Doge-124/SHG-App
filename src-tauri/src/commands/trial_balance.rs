use std::sync::Mutex;
use tauri::State;
use crate::db::trial_balance::{TrialBalance, get_trial_balance, get_available_financial_years};
use crate::db::balance_sheet::{BalanceSheet, get_balance_sheet};
use crate::db::income_expenditure::{IncomeExpenditureAccount, get_income_expenditure};
use crate::db::income_ledger::{IncomeLedger, get_income_ledger};
use crate::error::AppError;
use crate::state::AppState;

/// Income ledgers (interest / chit / savings) for an inclusive date range.
/// `from`/`to` are bare ISO dates (YYYY-MM-DD).
#[tauri::command]
pub fn get_income_ledger_cmd(
    state: State<Mutex<AppState>>,
    from: String,
    to: String,
) -> Result<IncomeLedger, String> {
    chrono::NaiveDate::parse_from_str(&from, "%Y-%m-%d")
        .map_err(|_| "Invalid from date — use YYYY-MM-DD".to_string())?;
    chrono::NaiveDate::parse_from_str(&to, "%Y-%m-%d")
        .map_err(|_| "Invalid to date — use YYYY-MM-DD".to_string())?;
    if from > to {
        return Err("From date must be before or equal to to date".to_string());
    }

    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard.db.as_mut().ok_or_else(|| "DB not unlocked".to_string())?;

    // Lower bound is the bare date; upper bound includes the whole day.
    let to_dt = format!("{}T23:59:59", to);
    get_income_ledger(conn, &from, &to_dt).map_err(|e: AppError| e.to_string())
}

#[tauri::command]
pub fn get_trial_balance_cmd(
    state: State<Mutex<AppState>>,
    financial_year: i32,
) -> Result<TrialBalance, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard.db.as_mut().ok_or_else(|| "DB not unlocked".to_string())?;
    get_trial_balance(conn, financial_year).map_err(|e: AppError| e.to_string())
}

#[tauri::command]
pub fn get_balance_sheet_cmd(
    state: State<Mutex<AppState>>,
    as_on_date: String,
) -> Result<BalanceSheet, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard.db.as_mut().ok_or_else(|| "DB not unlocked".to_string())?;
    get_balance_sheet(conn, &as_on_date).map_err(|e: AppError| e.to_string())
}

#[tauri::command]
pub fn get_income_expenditure_cmd(
    state: State<Mutex<AppState>>,
    financial_year: i32,
) -> Result<IncomeExpenditureAccount, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard.db.as_mut().ok_or_else(|| "DB not unlocked".to_string())?;
    get_income_expenditure(conn, financial_year).map_err(|e: AppError| e.to_string())
}

#[tauri::command]
pub fn get_available_financial_years_cmd(
    state: State<Mutex<AppState>>,
) -> Result<Vec<i32>, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard.db.as_mut().ok_or_else(|| "DB not unlocked".to_string())?;
    get_available_financial_years(conn).map_err(|e: AppError| e.to_string())
}
