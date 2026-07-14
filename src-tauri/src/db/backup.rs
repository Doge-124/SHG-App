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

    // Bound local disk growth: keep the most recent routine backups, drop older
    // ones. Safety snapshots are preserved. Best-effort; never fails the backup.
    prune_old_backups(90);
    prune_stale_backup_info(conn);

    Ok(backup_info)
}

/// Keep the most recent `keep_recent` routine backup files and delete older ones.
/// Safety snapshots (pre-upgrade / pre-migration / pre-restore) are NEVER deleted.
/// Best-effort — failures are logged, not propagated.
pub fn prune_old_backups(keep_recent: usize) {
    let dir = match get_backup_directory() {
        Ok(d) => d,
        Err(_) => return,
    };
    let read = match std::fs::read_dir(&dir) {
        Ok(r) => r,
        Err(_) => return,
    };
    let mut routine: Vec<(std::path::PathBuf, std::time::SystemTime)> = Vec::new();
    for entry in read.flatten() {
        let path = entry.path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
        if !name.ends_with(".db") {
            continue;
        }
        // Never prune safety snapshots.
        if name.contains("pre-upgrade") || name.contains("pre-migration") || name.contains("pre_restore") {
            continue;
        }
        let mtime = entry
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        routine.push((path, mtime));
    }
    if routine.len() <= keep_recent {
        return;
    }
    routine.sort_by(|a, b| b.1.cmp(&a.1)); // newest first
    for (path, _) in routine.into_iter().skip(keep_recent) {
        if let Err(e) = std::fs::remove_file(&path) {
            log::warn!("Failed to prune old backup {}: {e}", path.display());
        }
    }
}

/// Drop backup_info rows whose file no longer exists (e.g. pruned or deleted).
fn prune_stale_backup_info(conn: &Connection) {
    let dir = match get_backup_directory() {
        Ok(d) => d,
        Err(_) => return,
    };
    let rows: Vec<(String, String)> = match conn.prepare("SELECT id, file_name FROM backup_info") {
        Ok(mut stmt) => stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map(|it| it.filter_map(|r| r.ok()).collect())
            .unwrap_or_default(),
        Err(_) => return,
    };
    for (id, file_name) in rows {
        if !dir.join(&file_name).exists() {
            let _ = conn.execute("DELETE FROM backup_info WHERE id = ?1", [id]);
        }
    }
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

/// Import an EXTERNAL `.db` file (chosen via a file picker) as the live database.
///
/// Unlike `restore_backup_file`, the source is an absolute path anywhere on disk,
/// not a name inside the backup folder. Returns the path of the pre-restore safety
/// snapshot so the caller can roll back if the imported file fails to open (e.g. it
/// was encrypted with a different PIN). The caller must drop the live connection
/// before calling and reopen afterwards.
pub fn restore_backup_from_path(source_path: &str) -> Result<String, AppError> {
    let source = std::path::Path::new(source_path);
    if !source.exists() {
        return Err(AppError::database(format!(
            "The selected file no longer exists: {}",
            source_path
        )));
    }

    let db_path = get_current_database_path()?;
    let backup_dir = get_backup_directory()?;

    // Safety snapshot of the current DB before we overwrite it.
    let safety = backup_dir.join(format!(
        "pre_restore_{}.db",
        Utc::now().format("%Y%m%d_%H%M%S")
    ));
    std::fs::copy(&db_path, &safety)
        .map_err(|e| AppError::database(format!("Failed to create safety copy: {}", e)))?;

    // Replace the live DB file with the chosen file.
    std::fs::copy(source, &db_path)
        .map_err(|e| AppError::database(format!("Failed to import the selected file: {}", e)))?;

    // Remove stale WAL/SHM so SQLite starts fresh with the imported file.
    let _ = std::fs::remove_file(db_path.with_extension("db-wal"));
    let _ = std::fs::remove_file(db_path.with_extension("db-shm"));

    Ok(safety.to_string_lossy().to_string())
}

/// Roll back a failed import by copying the pre-restore safety snapshot back over
/// the live DB. Used when an imported file cannot be opened with the current key.
pub fn rollback_from_safety(safety_path: &str) -> Result<(), AppError> {
    let db_path = get_current_database_path()?;
    std::fs::copy(safety_path, &db_path)
        .map_err(|e| AppError::database(format!("Failed to roll back to previous data: {}", e)))?;
    let _ = std::fs::remove_file(db_path.with_extension("db-wal"));
    let _ = std::fs::remove_file(db_path.with_extension("db-shm"));
    Ok(())
}

/// List available backups by scanning the backup directory (the source of truth),
/// enriching the type/date from `backup_info` when known. Scanning the folder means
/// the automatic safety snapshots (pre-upgrade / pre-migration / pre-restore) are
/// restorable from the UI too — not just manual/cloud backups.
pub fn get_backup_list(conn: &Connection) -> Result<Vec<BackupInfo>, AppError> {
    let dir = get_backup_directory()?;

    // Known type + creation time for app-registered backups, keyed by file_name.
    let mut known: std::collections::HashMap<String, (String, String)> = std::collections::HashMap::new();
    if let Ok(mut stmt) = conn.prepare("SELECT file_name, backup_type, created_at FROM backup_info") {
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
        }) {
            for r in rows.flatten() {
                known.insert(r.0, (r.1, r.2));
            }
        }
    }

    let read = std::fs::read_dir(&dir)
        .map_err(|e| AppError::database(format!("Failed to read backups directory: {e}")))?;

    let mut out: Vec<BackupInfo> = Vec::new();
    for entry in read.flatten() {
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        if !name.ends_with(".db") {
            continue;
        }
        let meta = entry.metadata().ok();
        let file_size = meta.as_ref().map(|m| m.len() as i64).unwrap_or(0);
        let mtime = meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339());

        let (backup_type, created_at) = classify_backup(&name, known.get(&name), mtime);
        out.push(BackupInfo { id: name.clone(), file_name: name, file_size, created_at, backup_type });
    }

    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(out)
}

/// Determine a backup's type + creation time from its filename, the stored
/// backup_info entry (if any), and the file mtime as a fallback.
fn classify_backup(
    name: &str,
    stored: Option<&(String, String)>,
    mtime: Option<String>,
) -> (String, String) {
    let created = stored
        .map(|(_, c)| c.clone())
        .or(mtime)
        .unwrap_or_else(|| Utc::now().to_rfc3339());
    let ty = if name.contains("pre-upgrade") {
        "pre-upgrade".to_string()
    } else if name.contains("pre-migration") {
        "pre-migration".to_string()
    } else if name.contains("pre_restore") {
        "pre-restore".to_string()
    } else {
        stored.map(|(t, _)| t.clone()).unwrap_or_else(|| "manual".to_string())
    };
    (ty, created)
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

/// Clear all data from the database and reset settings to defaults.
pub fn clear_all_data(conn: &mut Connection) -> Result<(), AppError> {
    let tx = conn.transaction()?;

    // Temporarily disable foreign key constraints to avoid deletion order issues
    tx.execute("PRAGMA foreign_keys = OFF", [])?;

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

    // Re-enable foreign key constraints
    tx.execute("PRAGMA foreign_keys = ON", [])?;

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
         (id, general_settings, notification_settings, data_settings, appearance_settings, updated_at, past_data_locked)
         VALUES (1, ?1, ?2, ?3, ?4, CURRENT_TIMESTAMP, 0)",
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

/// Clear all transactional data but KEEP the member directory and each member's
/// savings opening balance. Intended for the testing → production handover: after
/// trialling the app you wipe the test loans/chits/receipts but keep the 150+
/// members and their entered opening savings, so they don't have to be re-keyed.
///
/// Retained: members, their OPENING savings entries, past_installments, and all
/// settings (group info etc.).
/// Cleared: loans, chits, the SHG ledger + balances, contributions/payouts, and
/// the SHG opening balance (so it can be re-set). Member savings balances are
/// recomputed from the kept opening entries; current_installments is reset.
pub fn clear_data_keep_members(conn: &mut Connection) -> Result<(), AppError> {
    let tx = conn.transaction()?;
    tx.execute("PRAGMA foreign_keys = OFF", [])?;

    // Chit data (child tables first).
    tx.execute("DELETE FROM chit_payments", [])?;
    let _ = tx.execute("DELETE FROM chit_cycle_winners", []);
    let _ = tx.execute("DELETE FROM chit_member_eligibility", []);
    tx.execute("DELETE FROM chit_cycles", [])?;
    tx.execute("DELETE FROM chit_members", [])?;
    tx.execute("DELETE FROM chit_groups", [])?;

    // Loan data.
    tx.execute("DELETE FROM loan_payments", [])?;
    tx.execute("DELETE FROM loans", [])?;
    let _ = tx.execute("DELETE FROM payments", []);
    let _ = tx.execute("DELETE FROM receipts", []);

    // SHG ledger + balances → fresh.
    tx.execute("DELETE FROM shg_transactions", [])?;
    tx.execute(
        "INSERT OR REPLACE INTO shg_balances (method, balance) VALUES ('CASH', 0), ('BANK', 0)",
        [],
    )?;

    // Member transactions: keep only OPENING (the entered savings opening
    // balances); drop test contributions / payouts / etc.
    tx.execute("DELETE FROM member_transactions WHERE txn_type != 'OPENING'", [])?;

    // Recompute each member's savings balance from the kept OPENING rows.
    tx.execute(
        "UPDATE member_balances SET balance = COALESCE(
            (SELECT SUM(amount) FROM member_transactions mt WHERE mt.member_id = member_balances.member_id), 0)",
        [],
    )?;

    // Ongoing installment counter resets (contributions cleared); the locked
    // past_installments seed stays.
    tx.execute("UPDATE members SET current_installments = 0", [])?;

    // Reset the SHG opening balance setup so it can be entered fresh (we just
    // cleared the SHG ledger + balances). Other settings (group info, etc.) stay.
    let _ = tx.execute(
        "UPDATE settings SET shg_opening_cash = 0, shg_opening_bank = 0, shg_opening_locked = 0 WHERE id = 1",
        [],
    );

    tx.execute("DELETE FROM audit_log", [])?;
    let _ = tx.execute("DELETE FROM backup_info", []);

    tx.execute("PRAGMA foreign_keys = ON", [])?;

    // Reset autoincrement for the cleared tables only — members and their
    // transactions/balances keep their ids.
    let tables_to_reset = [
        "shg_transactions", "loans", "loan_payments",
        "chit_groups", "chit_members", "chit_cycles", "chit_payments",
        "chit_cycle_winners", "chit_member_eligibility",
        "payments", "receipts", "audit_log", "backup_info",
    ];
    for table in tables_to_reset {
        let _ = tx.execute("DELETE FROM sqlite_sequence WHERE name = ?1", [table]);
    }

    tx.commit()?;
    Ok(())
}

/// Resolve the absolute path of a backup file by name (within the backup dir).
pub fn backup_path(file_name: &str) -> Result<std::path::PathBuf, AppError> {
    Ok(get_backup_directory()?.join(file_name))
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
