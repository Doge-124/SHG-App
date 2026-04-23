//! Backup and restore functionality for the SHG application.
//!
//! This module handles creating backups, restoring from backups,
//! and exporting data for external use.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::fs;
use chrono::Utc;
use crate::error::AppError;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub id: String,
    pub file_name: String,    // → fileName
    pub file_size: i64,       // → fileSize
    pub created_at: String,   // → createdAt
    #[serde(rename = "type")]
    pub backup_type: String,  // → type
}

/// Create a backup of the database.
///
/// Checkpoints the WAL into the main file first so the copy is a complete,
/// consistent snapshot of all committed data.
pub fn create_backup(conn: &Connection, backup_type: &str) -> Result<BackupInfo, AppError> {
    // Flush WAL pages into the main DB file so the file copy is self-contained.
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;

    let timestamp = Utc::now().format("%Y%m%d_%H%M%S").to_string();
    let backup_filename = format!("shg_backup_{}.db", timestamp);

    let backup_dir = get_backup_directory()?;
    let backup_path = backup_dir.join(&backup_filename);
    let db_path = get_current_database_path()?;

    std::fs::copy(&db_path, &backup_path)
        .map_err(|e| AppError::database(format!("Failed to create backup copy: {}", e)))?;

    let backup_info = BackupInfo {
        id: timestamp.clone(),
        file_name: backup_filename.clone(),
        file_size: fs::metadata(&backup_path).map(|m| m.len() as i64).unwrap_or(0),
        created_at: Utc::now().to_rfc3339(),
        backup_type: backup_type.to_string(),
    };

    save_backup_info(conn, &backup_info)?;
    Ok(backup_info)
}

/// Copy a backup file over the live DB file.
///
/// This is the file-level part of restore. The caller is responsible for
/// dropping the live connection before calling this and reopening it afterwards.
pub fn restore_backup_file(backup_filename: &str) -> Result<(), AppError> {
    let backup_dir = get_backup_directory()?;
    let backup_path = backup_dir.join(backup_filename);

    if !backup_path.exists() {
        return Err(AppError::database(format!(
            "Backup file not found: {}",
            backup_filename
        )));
    }

    let db_path = get_current_database_path()?;

    // Safety copy of current DB before overwriting.
    let temp = backup_dir.join(format!(
        "pre_restore_{}.db",
        Utc::now().format("%Y%m%d_%H%M%S")
    ));
    std::fs::copy(&db_path, &temp)
        .map_err(|e| AppError::database(format!("Failed to create safety copy: {}", e)))?;

    // Replace live DB file with backup.
    std::fs::copy(&backup_path, &db_path)
        .map_err(|e| AppError::database(format!("Failed to restore backup: {}", e)))?;

    // Remove stale WAL/SHM files so SQLite starts fresh with the restored file.
    let _ = std::fs::remove_file(db_path.with_extension("db-wal"));
    let _ = std::fs::remove_file(db_path.with_extension("db-shm"));

    Ok(())
}

/// Get list of available backups
pub fn get_backup_list(conn: &Connection) -> Result<Vec<BackupInfo>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, file_name, file_size, created_at, backup_type 
         FROM backup_info 
         ORDER BY created_at DESC"
    )?;
    
    let backups = stmt.query_map([], |row| {
        Ok(BackupInfo {
            id: row.get(0)?,
            file_name: row.get(1)?,
            file_size: row.get(2)?,
            created_at: row.get(3)?,
            backup_type: row.get(4)?,
        })
    })?
    .collect::<Result<Vec<BackupInfo>, _>>()
    .map_err(|e| AppError::database(format!("Failed to get backup list: {}", e)))?;
    
    Ok(backups)
}

/// Save backup information to database
fn save_backup_info(conn: &Connection, backup_info: &BackupInfo) -> Result<(), AppError> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS backup_info (
            id TEXT PRIMARY KEY,
            file_name TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            backup_type TEXT NOT NULL
        )",
        [],
    )?;
    
    conn.execute(
        "INSERT OR REPLACE INTO backup_info (id, file_name, file_size, created_at, backup_type)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        (
            &backup_info.id,
            &backup_info.file_name,
            backup_info.file_size,
            &backup_info.created_at,
            &backup_info.backup_type
        ),
    )?;
    
    Ok(())
}

/// Export all data as JSON (Manual Backup)
pub fn export_all_data(conn: &Connection) -> Result<String, AppError> {
    // Helper function to query any table and return as JSON array
    let query_table = |table_name: &str| -> Result<Vec<serde_json::Value>, AppError> {
        let sql = format!("SELECT * FROM {}", table_name);
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([], |row| {
            let mut obj = serde_json::Map::new();
            for i in 0..row.as_ref().column_count() {
                let name = row.as_ref().column_name(i).unwrap_or("unknown");
                
                // Try to get value with proper type detection
                let value: serde_json::Value = if let Ok(val) = row.get::<_, String>(i) {
                    serde_json::Value::String(val)
                } else if let Ok(val) = row.get::<_, i64>(i) {
                    serde_json::Value::Number(val.into())
                } else if let Ok(val) = row.get::<_, f64>(i) {
                    if let Some(n) = serde_json::Number::from_f64(val) {
                        serde_json::Value::Number(n)
                    } else {
                        serde_json::Value::String(val.to_string())
                    }
                } else if let Ok(val) = row.get::<_, bool>(i) {
                    serde_json::Value::Bool(val)
                } else {
                    serde_json::Value::Null
                };
                
                obj.insert(name.to_string(), value);
            }
            Ok(serde_json::Value::Object(obj))
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| AppError::database(format!("Failed to query {}: {}", table_name, e)))
    };

    // Query all tables — including balance caches so a round-trip is lossless.
    let members = query_table("members")?;
    let member_balances = query_table("member_balances")?;
    let member_transactions = query_table("member_transactions")?;
    let loans = query_table("loans")?;
    let loan_payments = query_table("loan_payments")?;
    let shg_transactions = query_table("shg_transactions")?;
    let shg_balances = query_table("shg_balances")?;
    let chit_groups = query_table("chit_groups")?;
    let chit_members = query_table("chit_members")?;
    let chit_cycles = query_table("chit_cycles")?;
    let chit_payments = query_table("chit_payments")?;
    let audit_log = query_table("audit_log")?;
    let settings = query_table("settings")?;
    let backup_info = query_table("backup_info")?;

    let export_data = serde_json::json!({
        "metadata": {
            "exported_at": Utc::now().to_rfc3339(),
            "version": "1.1.0",
            "application": "SHG Manager",
            "export_type": "manual_backup"
        },
        "data": {
            "members": members,
            "member_balances": member_balances,
            "member_transactions": member_transactions,
            "loans": loans,
            "loan_payments": loan_payments,
            "shg_transactions": shg_transactions,
            "shg_balances": shg_balances,
            "chit_groups": chit_groups,
            "chit_members": chit_members,
            "chit_cycles": chit_cycles,
            "chit_payments": chit_payments,
            "audit_log": audit_log,
            "settings": settings,
            "backup_info": backup_info
        }
    });
    
    let json_string = serde_json::to_string_pretty(&export_data)
        .map_err(|e| AppError::database(format!("Failed to serialize export data: {}", e)))?;
    
    Ok(json_string)
}

/// Import all data from JSON (Manual Restore)
pub fn import_all_data(conn: &mut Connection, json_data: &str) -> Result<(), AppError> {
    // Parse the JSON data
    let import_data: serde_json::Value = serde_json::from_str(json_data)
        .map_err(|e| AppError::validation(format!("Failed to parse JSON data: {}", e)))?;
    
    // Validate metadata
    let metadata = import_data.get("metadata")
        .ok_or_else(|| AppError::validation("Missing metadata in import data".to_string()))?;
    
    let version = metadata.get("version")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    
    // Get the data object
    let data = import_data.get("data")
        .ok_or_else(|| AppError::validation("Missing data section in import".to_string()))?;
    
    // Start transaction
    let tx = conn.transaction()?;
    
    // Clear all existing data (child tables first to satisfy FK constraints).
    let _ = tx.execute("DELETE FROM chit_payments", []);
    let _ = tx.execute("DELETE FROM chit_cycles", []);
    let _ = tx.execute("DELETE FROM chit_members", []);
    let _ = tx.execute("DELETE FROM chit_groups", []);
    let _ = tx.execute("DELETE FROM loan_payments", []);
    let _ = tx.execute("DELETE FROM member_transactions", []);
    let _ = tx.execute("DELETE FROM loans", []);
    let _ = tx.execute("DELETE FROM shg_transactions", []);
    let _ = tx.execute("DELETE FROM member_balances", []);
    let _ = tx.execute("DELETE FROM shg_balances", []);
    let _ = tx.execute("DELETE FROM members", []);
    let _ = tx.execute("DELETE FROM backup_info", []);
    
    // Allowed column names per table — prevents SQL injection from crafted backup files.
    let allowed_columns: std::collections::HashMap<&str, std::collections::HashSet<&str>> = [
        ("members",             vec!["id","member_code","name","phone","address","joined_at","is_active","opening_balance","opening_balance_method","opening_balance_set_at","past_installments","current_installments","member_type"].into_iter().collect()),
        ("member_balances",     vec!["member_id","balance"].into_iter().collect()),
        ("member_transactions", vec!["id","member_id","amount","txn_type","reason","reference_txn_id","created_at"].into_iter().collect()),
        ("loans",               vec!["id","member_id","principal","interest_rate","issued_at","due_date","status","amount","outstanding_amount","total_repayable","interest_amount","payment_method","loan_type","note","created_at"].into_iter().collect()),
        ("loan_payments",       vec!["id","loan_id","member_id","amount","payment_method","note","created_at"].into_iter().collect()),
        ("shg_transactions",    vec!["id","txn_type","amount","reason","payment_method","reference_type","reference_id","created_at"].into_iter().collect()),
        ("shg_balances",        vec!["method","balance"].into_iter().collect()),
        ("chit_groups",         vec!["id","name","total_amount","months","monthly_contribution","commission_percent","start_date","status"].into_iter().collect()),
        ("chit_members",        vec!["id","chit_id","member_id","joined_at"].into_iter().collect()),
        ("chit_cycles",         vec!["id","chit_id","cycle_no","auction_date","winning_member_id","bid_discount","payout_amount"].into_iter().collect()),
        ("chit_payments",       vec!["id","chit_id","cycle_id","member_id","amount","payment_method","paid_at"].into_iter().collect()),
        ("audit_log",           vec!["id","action","entity","entity_id","timestamp"].into_iter().collect()),
        ("backup_info",         vec!["id","file_name","file_size","created_at","backup_type"].into_iter().collect()),
        ("settings",            vec!["id","general_settings","notification_settings","data_settings","appearance_settings","updated_at"].into_iter().collect()),
    ].into_iter().collect();

    // Helper: inserts rows into a table, failing the whole import on any error.
    let insert_table_data = |table_name: &str, rows: &serde_json::Value| -> Result<(), AppError> {
        let allowed = allowed_columns.get(table_name).ok_or_else(|| {
            AppError::validation(format!("Unknown table in import: {}", table_name))
        })?;

        if let Some(array) = rows.as_array() {
            for (row_idx, row) in array.iter().enumerate() {
                if let Some(obj) = row.as_object() {
                    // Validate every column name against the allowlist.
                    for col in obj.keys() {
                        if !allowed.contains(col.as_str()) {
                            return Err(AppError::validation(format!(
                                "Unexpected column '{}' in table '{}' — import aborted",
                                col, table_name
                            )));
                        }
                    }

                    let columns: Vec<&str> = obj.keys().map(|k| k.as_str()).collect();
                    let placeholders: Vec<String> = (1..=columns.len()).map(|i| format!("?{}", i)).collect();
                    let sql = format!(
                        "INSERT INTO {} ({}) VALUES ({})",
                        table_name,
                        columns.join(", "),
                        placeholders.join(", ")
                    );

                    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
                    for value in obj.values() {
                        let param: Box<dyn rusqlite::ToSql> = match value {
                            serde_json::Value::String(s) => Box::new(s.clone()),
                            serde_json::Value::Number(n) => {
                                if let Some(i) = n.as_i64() { Box::new(i) }
                                else if let Some(f) = n.as_f64() { Box::new(f) }
                                else { Box::new(n.to_string()) }
                            }
                            serde_json::Value::Bool(b) => Box::new(*b),
                            serde_json::Value::Null => Box::new(None::<String>),
                            _ => Box::new(value.to_string()),
                        };
                        params.push(param);
                    }

                    let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
                    tx.execute(&sql, param_refs.as_slice()).map_err(|e| {
                        AppError::database(format!(
                            "Failed to import row {} into '{}': {}",
                            row_idx + 1, table_name, e
                        ))
                    })?;
                }
            }
        }
        Ok(())
    };

    // Import in FK-safe order (parents before children).
    if let Some(v) = data.get("members")             { insert_table_data("members", v)?; }
    if let Some(v) = data.get("member_balances")     { insert_table_data("member_balances", v)?; }
    if let Some(v) = data.get("member_transactions") { insert_table_data("member_transactions", v)?; }
    if let Some(v) = data.get("loans")               { insert_table_data("loans", v)?; }
    if let Some(v) = data.get("loan_payments")       { insert_table_data("loan_payments", v)?; }
    if let Some(v) = data.get("shg_transactions")    { insert_table_data("shg_transactions", v)?; }
    if let Some(v) = data.get("shg_balances")        { insert_table_data("shg_balances", v)?; }
    if let Some(v) = data.get("chit_groups")         { insert_table_data("chit_groups", v)?; }
    if let Some(v) = data.get("chit_members")        { insert_table_data("chit_members", v)?; }
    if let Some(v) = data.get("chit_cycles")         { insert_table_data("chit_cycles", v)?; }
    if let Some(v) = data.get("chit_payments")       { insert_table_data("chit_payments", v)?; }
    if let Some(v) = data.get("audit_log")           { insert_table_data("audit_log", v)?; }
    if let Some(v) = data.get("backup_info")         { insert_table_data("backup_info", v)?; }

    tx.commit()?;
    Ok(())
}

/// Clear all data from the database and reset settings to defaults.
pub fn clear_all_data(conn: &mut Connection) -> Result<(), AppError> {
    let tx = conn.transaction()?;

    // Delete from chit-related tables (child tables first)
    tx.execute("DELETE FROM chit_payments", [])?;
    tx.execute("DELETE FROM chit_cycles", [])?;
    tx.execute("DELETE FROM chit_members", [])?;
    tx.execute("DELETE FROM chit_groups", [])?;

    // Delete from loan-related tables
    tx.execute("DELETE FROM loan_payments", [])?;
    tx.execute("DELETE FROM member_transactions", [])?;
    tx.execute("DELETE FROM loans", [])?;

    // Delete from old loan tables (if they exist)
    let _ = tx.execute("DELETE FROM payments", []);
    let _ = tx.execute("DELETE FROM receipts", []);

    // Delete from balance tables
    tx.execute("DELETE FROM shg_balances", [])?;
    tx.execute("DELETE FROM member_balances", [])?;

    // Delete from main tables
    tx.execute("DELETE FROM shg_transactions", [])?;
    tx.execute("DELETE FROM members", [])?;

    // Delete audit log
    tx.execute("DELETE FROM audit_log", [])?;

    // Delete backup info
    let _ = tx.execute("DELETE FROM backup_info", []);

    // Reset autoincrement counters
    let tables_to_reset = [
        "members", "shg_transactions", "loans", "loan_payments", "member_transactions",
        "chit_groups", "chit_members", "chit_cycles", "chit_payments",
        "payments", "receipts", "audit_log", "backup_info",
    ];
    for table in tables_to_reset {
        let _ = tx.execute("DELETE FROM sqlite_sequence WHERE name = ?1", [table]);
    }

    // Reset shg_balances to zero
    tx.execute(
        "INSERT OR REPLACE INTO shg_balances (method, balance) VALUES ('CASH', 0), ('BANK', 0)",
        [],
    )?;

    // Reset ALL settings to defaults (including group info and appearance)
    let default_general = serde_json::json!({
        "groupName": "",
        "registrationNumber": "",
        "address": "",
        "contactPhone": "",
        "contactEmail": ""
    });
    let default_notifications = serde_json::json!({
        "enableNotifications": true,
        "enableEmailAlerts": false,
        "loanDueReminders": true,
        "chitCycleAlerts": true,
        "newMemberRequests": true,
        "paymentConfirmations": false
    });
    let default_data = serde_json::json!({
        "autoBackup": true,
        "backupFrequency": "daily",
        "lastBackupDate": null
    });
    let default_appearance = serde_json::json!({
        "theme": "light",
        "language": "english"
    });

    tx.execute(
        "INSERT OR REPLACE INTO settings
         (id, general_settings, notification_settings, data_settings, appearance_settings, updated_at)
         VALUES (1, ?1, ?2, ?3, ?4, CURRENT_TIMESTAMP)",
        (
            serde_json::to_string(&default_general)?,
            serde_json::to_string(&default_notifications)?,
            serde_json::to_string(&default_data)?,
            serde_json::to_string(&default_appearance)?,
        ),
    )?;

    tx.commit()?;

    Ok(())
}

/// Get backup directory path
fn get_backup_directory() -> Result<std::path::PathBuf, AppError> {
    let mut path = dirs::data_dir()
        .ok_or_else(|| AppError::database("Could not find data directory".to_string()))?;
    
    path.push("com.shg.manager");
    path.push("backups");
    
    fs::create_dir_all(&path)
        .map_err(|e| AppError::database(format!("Failed to create backup directory: {}", e)))?;
    
    Ok(path)
}

/// Get current database path
fn get_current_database_path() -> Result<std::path::PathBuf, AppError> {
    let mut path = dirs::data_dir()
        .ok_or_else(|| AppError::database("Could not find data directory".to_string()))?;
    
    path.push("com.shg.manager");
    path.push("data");
    path.push("shg.db");
    
    Ok(path)
}
