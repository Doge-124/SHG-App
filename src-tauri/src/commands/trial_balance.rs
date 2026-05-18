use std::sync::Mutex;
use tauri::State;
use crate::db::trial_balance::{TrialBalance, get_trial_balance, get_available_financial_years};
use crate::db::balance_sheet::{BalanceSheet, get_balance_sheet};
use crate::db::income_expenditure::{IncomeExpenditureAccount, get_income_expenditure};
use crate::error::AppError;
use crate::state::AppState;

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
