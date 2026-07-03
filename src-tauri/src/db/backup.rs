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
