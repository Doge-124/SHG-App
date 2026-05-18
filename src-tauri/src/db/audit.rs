//! Audit log helpers: write events and query the audit_log table.

use rusqlite::Connection;
use chrono::Utc;
use crate::error::AppError;

/// Silently insert one audit log row — never propagates errors to the caller.
pub fn log_audit(conn: &Connection, action: &str, entity: &str, entity_id: Option<i64>, details: &str) {
    let ts = Utc::now().to_rfc3339();
    let _ = conn.execute(
        "INSERT INTO audit_log (action, entity, entity_id, details, timestamp)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![action, entity, entity_id, details, ts],
    );
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub id: i64,
    pub action: String,
    pub entity: String,
    pub entity_id: Option<i64>,
    pub details: Option<String>,
    pub timestamp: String,
}

pub fn query_audit_log(
    conn: &Connection,
    from: Option<&str>,
    to: Option<&str>,
    entity: Option<&str>,
) -> Result<Vec<AuditEntry>, AppError> {
    let mut q = "SELECT id, action, entity, entity_id, details, timestamp \
                 FROM audit_log WHERE 1=1".to_string();
    let mut params: Vec<String> = Vec::new();

    if let Some(f) = from {
        q.push_str(" AND timestamp >= ?");
        params.push(f.to_string());
    }
    if let Some(t) = to {
        q.push_str(" AND timestamp <= ?");
        params.push(format!("{t}T23:59:59Z"));
    }
    if let Some(e) = entity {
        q.push_str(" AND entity = ?");
        params.push(e.to_string());
    }
    q.push_str(" ORDER BY timestamp DESC LIMIT 1000");

    let mut stmt = conn.prepare(&q)?;
    let rows = stmt.query_map(
        rusqlite::params_from_iter(params.iter().map(|s| s.as_str())),
        |row| {
            Ok(AuditEntry {
                id: row.get(0)?,
                action: row.get(1)?,
                entity: row.get(2)?,
                entity_id: row.get(3)?,
                details: row.get(4)?,
                timestamp: row.get(5)?,
            })
        },
    )?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}
