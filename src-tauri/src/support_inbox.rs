//! Remote support inbox — desktop side.
//!
//! After auth, the frontend invokes `run_support_inbox` once. We fetch any
//! pending commands queued for this install, execute them locally (against
//! the unlocked DB), and POST each result back. All read-only.
//!
//! Supported commands:
//!   - "collect_diagnostic" → renders the same payload as get_diagnostic_report
//!   - "collect_integrity"  → runs the same integrity check exposed in Settings

use std::sync::Mutex;
use std::time::Duration;
use serde::{Serialize, Deserialize};
use serde_json::Value;

use crate::installation;
use crate::state::AppState;
use crate::db::integrity;

#[derive(Debug, Deserialize)]
struct PollResponse {
    ok: bool,
    #[serde(default)]
    commands: Vec<PendingCommand>,
}

#[derive(Debug, Deserialize)]
struct PendingCommand {
    id: i64,
    command: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SupportRunReport {
    pub fetched: usize,
    pub completed: usize,
    pub failed: usize,
    pub skipped: usize,
}

fn endpoint() -> Option<String> {
    let url = option_env!("TELEMETRY_ENDPOINT_URL").unwrap_or("").trim();
    if url.is_empty() { None } else { Some(url.trim_end_matches('/').to_string()) }
}

/// Public entry-point. Returns a small summary the frontend can log.
pub async fn run(state: &Mutex<AppState>) -> Result<SupportRunReport, String> {
    let Some(base) = endpoint() else {
        return Ok(SupportRunReport { fetched: 0, completed: 0, failed: 0, skipped: 0 });
    };
    let installation_id = installation::get_or_create_pre_app_for_telemetry()
        .map_err(|e| format!("installation id: {e}"))?
        .installation_id;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("http client: {e}"))?;

    let poll: PollResponse = client
        .post(format!("{base}/support/poll"))
        .json(&serde_json::json!({ "installationId": installation_id }))
        .send().await.map_err(|e| format!("poll send: {e}"))?
        .json().await.map_err(|e| format!("poll decode: {e}"))?;

    if !poll.ok {
        return Ok(SupportRunReport { fetched: 0, completed: 0, failed: 0, skipped: 0 });
    }

    let mut report = SupportRunReport {
        fetched: poll.commands.len(),
        completed: 0,
        failed: 0,
        skipped: 0,
    };

    for cmd in poll.commands {
        let (ok, payload, error) = execute(state, &cmd.command);
        match (ok, &error) {
            (true,  _) => report.completed += 1,
            (false, Some(e)) if e == "unsupported_command" => report.skipped += 1,
            (false, _) => report.failed += 1,
        }

        // Upload the result. Don't fail the whole run if one upload fails.
        let upload_body = serde_json::json!({
            "id":             cmd.id,
            "installationId": installation_id,
            "ok":             ok,
            "payload":        payload,
            "error":          error,
        });
        if let Err(e) = client.post(format!("{base}/support/result"))
            .json(&upload_body)
            .send().await
        {
            log::warn!("support: result upload failed for cmd #{} ({e})", cmd.id);
        }
    }

    Ok(report)
}

fn execute(state: &Mutex<AppState>, command: &str) -> (bool, Option<Value>, Option<String>) {
    match command {
        "collect_diagnostic" => collect_diagnostic(state),
        "collect_integrity"  => collect_integrity(state),
        _ => (false, None, Some("unsupported_command".to_string())),
    }
}

fn collect_diagnostic(state: &Mutex<AppState>) -> (bool, Option<Value>, Option<String>) {
    // Build a payload mirroring the diagnostic the user sees in Settings,
    // but without app-handle-specific bits (log_dir). Anything that needs
    // the DB will only work after the user has unlocked it.
    let guard = match state.lock() {
        Ok(g) => g,
        Err(_) => return (false, None, Some("state lock poisoned".to_string())),
    };
    let Some(conn) = guard.db.as_ref() else {
        return (false, None, Some("db_locked".to_string()));
    };

    let member_count: i64 = conn.query_row("SELECT COUNT(*) FROM members", [], |r| r.get(0)).unwrap_or(0);
    let active_loans: i64 = conn.query_row(
        "SELECT COUNT(*) FROM loans WHERE status = 'active'", [], |r| r.get(0)
    ).unwrap_or(0);
    let total_outstanding: f64 = conn.query_row(
        "SELECT COALESCE(SUM(outstanding_amount), 0) FROM loans WHERE status = 'active'", [], |r| r.get(0)
    ).unwrap_or(0.0);
    let chit_count: i64 = conn.query_row("SELECT COUNT(*) FROM chit_groups", [], |r| r.get(0)).unwrap_or(0);
    let shg_cash: f64 = conn.query_row(
        "SELECT COALESCE(balance, 0) FROM shg_balances WHERE method = 'CASH'", [], |r| r.get(0)
    ).unwrap_or(0.0);
    let shg_bank: f64 = conn.query_row(
        "SELECT COALESCE(balance, 0) FROM shg_balances WHERE method = 'BANK'", [], |r| r.get(0)
    ).unwrap_or(0.0);
    let schema_version: i64 = conn.query_row(
        "SELECT COALESCE(MAX(id), 0) FROM audit_log", [], |r| r.get(0)
    ).unwrap_or(0);

    let payload = serde_json::json!({
        "appVersion":         env!("CARGO_PKG_VERSION"),
        "os":                 std::env::consts::OS,
        "arch":               std::env::consts::ARCH,
        "memberCount":        member_count,
        "activeLoanCount":    active_loans,
        "totalLoanOutstanding": total_outstanding,
        "chitGroupCount":     chit_count,
        "shgCashBalance":     shg_cash,
        "shgBankBalance":     shg_bank,
        "auditLogRowCount":   schema_version,
        "generatedAt":        chrono::Utc::now().to_rfc3339(),
    });
    (true, Some(payload), None)
}

fn collect_integrity(state: &Mutex<AppState>) -> (bool, Option<Value>, Option<String>) {
    let guard = match state.lock() {
        Ok(g) => g,
        Err(_) => return (false, None, Some("state lock poisoned".to_string())),
    };
    let Some(conn) = guard.db.as_ref() else {
        return (false, None, Some("db_locked".to_string()));
    };
    match integrity::check_integrity(conn) {
        Ok(report) => match serde_json::to_value(&report) {
            Ok(v) => (true, Some(v), None),
            Err(e) => (false, None, Some(format!("serialize: {e}"))),
        },
        Err(e) => (false, None, Some(e.to_string())),
    }
}
