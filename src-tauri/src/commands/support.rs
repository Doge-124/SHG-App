//! Remote support commands — diagnostic report, log export, and update check.

use std::sync::Mutex;
use tauri::{State, Manager};
use serde::Serialize;
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct DiagnosticReport {
    pub app_version: String,
    pub os: String,
    pub arch: String,
    pub db_connected: bool,
    pub member_count: i64,
    pub active_loan_count: i64,
    pub total_loan_outstanding: f64,
    pub chit_group_count: i64,
    pub shg_cash_balance: f64,
    pub shg_bank_balance: f64,
    pub generated_at: String,
    pub log_dir: String,
}

/// Generate a diagnostic snapshot for remote support.
#[tauri::command]
pub fn get_diagnostic_report(
    state: State<Mutex<AppState>>,
    app: tauri::AppHandle,
) -> Result<DiagnosticReport, String> {
    let generated_at = chrono::Utc::now().to_rfc3339();

    let log_dir = app
        .path()
        .app_log_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| "unknown".to_string());

    let os = std::env::consts::OS.to_string();
    let arch = std::env::consts::ARCH.to_string();

    let guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn_opt = guard.db.as_ref();

    if conn_opt.is_none() {
        return Ok(DiagnosticReport {
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            os, arch,
            db_connected: false,
            member_count: 0,
            active_loan_count: 0,
            total_loan_outstanding: 0.0,
            chit_group_count: 0,
            shg_cash_balance: 0.0,
            shg_bank_balance: 0.0,
            generated_at,
            log_dir,
        });
    }

    let conn = conn_opt.unwrap();

    let member_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM members WHERE is_active = 1", [], |r| r.get(0))
        .unwrap_or(0);

    let active_loan_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM loans WHERE status = 'active'", [], |r| r.get(0))
        .unwrap_or(0);

    let total_loan_outstanding: f64 = conn
        .query_row(
            "SELECT COALESCE(SUM(outstanding_amount), 0) FROM loans WHERE status = 'active'",
            [], |r| r.get(0),
        )
        .unwrap_or(0.0);

    let chit_group_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM chit_groups WHERE status = 'ACTIVE'", [], |r| r.get(0))
        .unwrap_or(0);

    let shg_cash_balance: f64 = conn
        .query_row("SELECT COALESCE(balance, 0) FROM shg_balances WHERE method = 'CASH'", [], |r| r.get(0))
        .unwrap_or(0.0);

    let shg_bank_balance: f64 = conn
        .query_row("SELECT COALESCE(balance, 0) FROM shg_balances WHERE method = 'BANK'", [], |r| r.get(0))
        .unwrap_or(0.0);

    Ok(DiagnosticReport {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        os, arch,
        db_connected: true,
        member_count,
        active_loan_count,
        total_loan_outstanding,
        chit_group_count,
        shg_cash_balance,
        shg_bank_balance,
        generated_at,
        log_dir,
    })
}

/// Return the path to the app log directory so the frontend can display it.
#[tauri::command]
pub fn get_log_dir(app: tauri::AppHandle) -> String {
    app.path()
        .app_log_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| "unknown".to_string())
}
