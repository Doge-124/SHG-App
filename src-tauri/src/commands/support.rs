//! Remote support commands — diagnostic report, log export, update check,
//! integrity check, installation ID, and schema version.

use std::sync::Mutex;
use tauri::{State, Manager};
use serde::Serialize;
use crate::state::AppState;
use crate::installation;
use crate::crash_reporting;
use crate::db::{integrity, migrations};

#[derive(Debug, Serialize)]
pub struct DiagnosticReport {
    pub app_version: String,
    pub installation_id: String,
    pub installation_created_at: String,
    pub os: String,
    pub arch: String,
    pub db_connected: bool,
    pub schema_version: i64,
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

    // Installation ID — created on first run, persists across reinstalls (in app data dir).
    let install = installation::get_or_create(&app)
        .map_err(|e| format!("installation ID error: {e}"))?;

    let guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn_opt = guard.db.as_ref();

    if conn_opt.is_none() {
        return Ok(DiagnosticReport {
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            installation_id: install.installation_id,
            installation_created_at: install.created_at,
            os, arch,
            db_connected: false,
            schema_version: 0,
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
    let schema_version = migrations::current_version(conn).unwrap_or(0);

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
        installation_id: install.installation_id,
        installation_created_at: install.created_at,
        os, arch,
        db_connected: true,
        schema_version,
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

/// Run the full database integrity check and return a structured report.
#[tauri::command]
pub fn check_db_integrity(
    state: State<Mutex<AppState>>,
) -> Result<integrity::IntegrityReport, String> {
    let guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard.db.as_ref().ok_or_else(|| "DB not unlocked".to_string())?;
    integrity::check_integrity(conn).map_err(|e| e.to_string())
}

/// Return the installation ID (and creation info).
#[tauri::command]
pub fn get_installation_id(app: tauri::AppHandle) -> Result<installation::InstallationInfo, String> {
    installation::get_or_create(&app).map_err(|e| e.to_string())
}

/// Return current schema version and applied migration history.
#[tauri::command]
pub fn get_schema_info(
    state: State<Mutex<AppState>>,
) -> Result<SchemaInfo, String> {
    let guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard.db.as_ref().ok_or_else(|| "DB not unlocked".to_string())?;
    let version = migrations::current_version(conn).map_err(|e| e.to_string())?;
    let applied = migrations::applied_migrations(conn).map_err(|e| e.to_string())?;
    Ok(SchemaInfo { version, applied })
}

#[derive(Serialize)]
pub struct SchemaInfo {
    pub version: i64,
    pub applied: Vec<migrations::MigrationStatus>,
}

/// Toggle the crash-reporting opt-in. Persists to installation.json and
/// updates the in-memory flag so Sentry honours it immediately.
#[tauri::command]
pub fn set_crash_reporting_enabled(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<(), String> {
    installation::set_crash_reporting(&app, enabled).map_err(|e| e.to_string())?;
    // Re-tag installation_id on the scope if we just turned it on.
    if enabled {
        if let Ok(info) = installation::get_or_create(&app) {
            crash_reporting::set_installation_id(&info.installation_id);
        }
    }
    Ok(())
}

#[derive(Serialize)]
pub struct CrashReportingStatus {
    pub configured: bool,        // SENTRY_DSN was baked in at build time
    pub enabled: bool,           // user has toggled it on
}

#[tauri::command]
pub fn get_crash_reporting_status(app: tauri::AppHandle) -> Result<CrashReportingStatus, String> {
    let configured = option_env!("SENTRY_DSN").map(|s| !s.trim().is_empty()).unwrap_or(false);
    let info = installation::get_or_create(&app).map_err(|e| e.to_string())?;
    Ok(CrashReportingStatus {
        configured,
        enabled: info.crash_reporting_enabled,
    })
}

/// Send a test event to Sentry so you can verify the pipeline end-to-end.
/// Returns a short description of what was sent.
#[tauri::command]
pub fn send_test_crash_event(app: tauri::AppHandle) -> Result<String, String> {
    let info = installation::get_or_create(&app).map_err(|e| e.to_string())?;
    crash_reporting::set_installation_id(&info.installation_id);

    let dsn_configured = option_env!("SENTRY_DSN").map(|s| !s.trim().is_empty()).unwrap_or(false);
    if !dsn_configured {
        return Err("Crash reporting is not configured (SENTRY_DSN was not set at build time). No event was sent.".to_string());
    }
    if !info.crash_reporting_enabled {
        return Err("Crash reporting is disabled in Settings. Toggle it on first, then test.".to_string());
    }

    let id = sentry::capture_message(
        &format!(
            "Test event from SHG Manager v{} (installation {})",
            env!("CARGO_PKG_VERSION"),
            info.installation_id,
        ),
        sentry::Level::Info,
    );

    Ok(format!("Test event sent. Sentry event ID: {}", id))
}

/// Return the path to the app log directory so the frontend can display it.
#[tauri::command]
pub fn get_log_dir(app: tauri::AppHandle) -> String {
    app.path()
        .app_log_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| "unknown".to_string())
}
