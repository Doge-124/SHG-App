//! Settings management for the SHG application.
//!
//! This module handles storage and retrieval of application settings
//! including general information, notifications, data management, and appearance.

use rusqlite::{Connection, params};
use serde::{Serialize, Deserialize};
use crate::error::AppError;
use crate::types::{GeneralSettings, NotificationSettings, DataSettings, AppearanceSettings, CloudBackupSettings};

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize)]
pub struct BackupInfo {
    pub id: String,
    pub file_name: String,
    pub file_size: i64,
    pub created_at: String,
    pub backup_type: String, // 'manual', 'automatic'
}

/// Initialize the settings table
pub fn init_settings_table(conn: &mut Connection) -> Result<(), AppError> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            general_settings TEXT,
            notification_settings TEXT,
            data_settings TEXT,
            appearance_settings TEXT,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            past_data_locked INTEGER NOT NULL DEFAULT 0,
            shg_opening_cash REAL NOT NULL DEFAULT 0,
            shg_opening_bank REAL NOT NULL DEFAULT 0,
            shg_opening_locked INTEGER NOT NULL DEFAULT 0,
            installment_anchor_number INTEGER NOT NULL DEFAULT 0,
            installment_anchor_date TEXT,
            cloud_backup_settings TEXT,
            weekly_contribution_amount REAL NOT NULL DEFAULT 0
        )",
        [],
    )?;

    // Create backup_info table if not exists
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

    // Initialize with default settings if not exists
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM settings",
        [],
        |row| row.get(0),
    ).unwrap_or(0);


    if count == 0 {
        
        let default_general = GeneralSettings {
            group_name: "Shakti Self Help Group".to_string(),
            registration_number: "SHG-2024-001234".to_string(),
            address: "Village Center, Main Road".to_string(),
            contact_phone: "9876543210".to_string(),
            contact_email: "shakti.shg@example.com".to_string(),
        };

        let default_notifications = NotificationSettings {
            enable_notifications: true,
            enable_email_alerts: false,
            loan_due_reminders: true,
            chit_cycle_alerts: true,
            new_member_requests: true,
            payment_confirmations: false,
        };

        let default_data = DataSettings {
            auto_backup: true,
            backup_frequency: "daily".to_string(),
            last_backup_date: None,
        };

        let default_appearance = AppearanceSettings {
            theme: "light".to_string(),
            language: "english".to_string(),
        };

        conn.execute(
            "INSERT INTO settings (id, general_settings, notification_settings, data_settings, appearance_settings)
             VALUES (1, ?1, ?2, ?3, ?4)",
            params![
                serde_json::to_string_pretty(&default_general)?,
                serde_json::to_string_pretty(&default_notifications)?,
                serde_json::to_string_pretty(&default_data)?,
                serde_json::to_string_pretty(&default_appearance)?
            ],
        )?;
        
    } else {
        
        // Check if we need to migrate existing data from snake_case to camelCase
        migrate_settings_to_camelcase(conn)?;
    }

    Ok(())
}

/// Migrate existing settings from snake_case to camelCase field names
pub fn migrate_settings_to_camelcase(conn: &mut Connection) -> Result<(), AppError> {
    // Check if general_settings contains snake_case field names
    let settings_json: String = conn.query_row(
        "SELECT general_settings FROM settings WHERE id = 1",
        [],
        |row| row.get(0),
    ).unwrap_or_default();
    
    if settings_json.contains("group_name") {
        
        // Parse old snake_case data
        #[derive(Deserialize)]
        struct OldGeneralSettings {
            group_name: String,
            registration_number: String,
            address: String,
            contact_phone: String,
            contact_email: String,
        }
        
        #[derive(Deserialize)]
        struct OldNotificationSettings {
            enable_notifications: bool,
            enable_email_alerts: bool,
            loan_due_reminders: bool,
            chit_cycle_alerts: bool,
            new_member_requests: bool,
            payment_confirmations: bool,
        }
        
        #[derive(Deserialize)]
        struct OldDataSettings {
            auto_backup: bool,
            backup_frequency: String,
            last_backup_date: Option<String>,
        }
        
        #[derive(Deserialize)]
        struct OldAppearanceSettings {
            theme: String,
            language: String,
        }
        
        // Get all current settings
        let current_general: OldGeneralSettings = serde_json::from_str(&settings_json)
            .map_err(|e| AppError::database(format!("Failed to parse old general settings: {}", e)))?;
        
        let notifications_json: String = conn.query_row(
            "SELECT notification_settings FROM settings WHERE id = 1",
            [],
            |row| row.get(0),
        ).unwrap_or_default();
        let current_notifications: OldNotificationSettings = serde_json::from_str(&notifications_json)
            .map_err(|e| AppError::database(format!("Failed to parse old notification settings: {}", e)))?;
        
        let data_json: String = conn.query_row(
            "SELECT data_settings FROM settings WHERE id = 1",
            [],
            |row| row.get(0),
        ).unwrap_or_default();
        let current_data: OldDataSettings = serde_json::from_str(&data_json)
            .map_err(|e| AppError::database(format!("Failed to parse old data settings: {}", e)))?;
        
        let appearance_json: String = conn.query_row(
            "SELECT appearance_settings FROM settings WHERE id = 1",
            [],
            |row| row.get(0),
        ).unwrap_or_default();
        let current_appearance: OldAppearanceSettings = serde_json::from_str(&appearance_json)
            .map_err(|e| AppError::database(format!("Failed to parse old appearance settings: {}", e)))?;
        
        // Convert to new structs with camelCase serialization
        let new_general = GeneralSettings {
            group_name: current_general.group_name,
            registration_number: current_general.registration_number,
            address: current_general.address,
            contact_phone: current_general.contact_phone,
            contact_email: current_general.contact_email,
        };
        
        let new_notifications = NotificationSettings {
            enable_notifications: current_notifications.enable_notifications,
            enable_email_alerts: current_notifications.enable_email_alerts,
            loan_due_reminders: current_notifications.loan_due_reminders,
            chit_cycle_alerts: current_notifications.chit_cycle_alerts,
            new_member_requests: current_notifications.new_member_requests,
            payment_confirmations: current_notifications.payment_confirmations,
        };
        
        let new_data = DataSettings {
            auto_backup: current_data.auto_backup,
            backup_frequency: current_data.backup_frequency,
            last_backup_date: current_data.last_backup_date,
        };
        
        let new_appearance = AppearanceSettings {
            theme: current_appearance.theme,
            language: current_appearance.language,
        };
        
        // Update with camelCase JSON
        conn.execute(
            "UPDATE settings SET general_settings = ?1, notification_settings = ?2, data_settings = ?3, appearance_settings = ?4 WHERE id = 1",
            params![
                serde_json::to_string_pretty(&new_general)?,
                serde_json::to_string_pretty(&new_notifications)?,
                serde_json::to_string_pretty(&new_data)?,
                serde_json::to_string_pretty(&new_appearance)?
            ],
        )?;
        
    } else {
    }
    
    Ok(())
}

/// Get general settings
pub fn get_general_settings(conn: &Connection) -> Result<GeneralSettings, AppError> {
    let settings_json: String = conn.query_row(
        "SELECT general_settings FROM settings WHERE id = 1",
        [],
        |row| row.get(0),
    )?;

    let settings: GeneralSettings = serde_json::from_str(&settings_json)
        .map_err(|e| AppError::database(format!("Failed to parse general settings: {}", e)))?;

    Ok(settings)
}

/// Save general settings
pub fn save_general_settings(conn: &mut Connection, settings: &GeneralSettings) -> Result<(), AppError> {
    let settings_json = serde_json::to_string_pretty(settings)
        .map_err(|e| AppError::database(format!("Failed to serialize general settings: {}", e)))?;

    
    let rows_affected = conn.execute(
        "UPDATE settings SET general_settings = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
        params![settings_json],
    )?;
    
    
    Ok(())
}

/// Get notification settings
pub fn get_notification_settings(conn: &Connection) -> Result<NotificationSettings, AppError> {
    let settings_json: String = conn.query_row(
        "SELECT notification_settings FROM settings WHERE id = 1",
        [],
        |row| row.get(0),
    )?;

    let settings: NotificationSettings = serde_json::from_str(&settings_json)
        .map_err(|e| AppError::database(format!("Failed to parse notification settings: {}", e)))?;

    Ok(settings)
}

/// Save notification settings
pub fn save_notification_settings(conn: &mut Connection, settings: &NotificationSettings) -> Result<(), AppError> {
    let settings_json = serde_json::to_string_pretty(settings)
        .map_err(|e| AppError::database(format!("Failed to serialize notification settings: {}", e)))?;

    conn.execute(
        "UPDATE settings SET notification_settings = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
        params![settings_json],
    )?;

    Ok(())
}

/// Get data settings
pub fn get_data_settings(conn: &Connection) -> Result<DataSettings, AppError> {
    let settings_json: String = conn.query_row(
        "SELECT data_settings FROM settings WHERE id = 1",
        [],
        |row| row.get(0),
    )?;

    let settings: DataSettings = serde_json::from_str(&settings_json)
        .map_err(|e| AppError::database(format!("Failed to parse data settings: {}", e)))?;

    Ok(settings)
}

/// Save data settings
pub fn save_data_settings(conn: &mut Connection, settings: &DataSettings) -> Result<(), AppError> {
    let settings_json = serde_json::to_string_pretty(settings)
        .map_err(|e| AppError::database(format!("Failed to serialize data settings: {}", e)))?;

    conn.execute(
        "UPDATE settings SET data_settings = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
        params![settings_json],
    )?;

    Ok(())
}

// ── Cloud backup (email) settings ──────────────────────────────────────────

/// Read the cloud-backup config. Returns defaults when the column is NULL/absent
/// (e.g. never configured) so callers always get a usable struct.
pub fn get_cloud_backup_settings(conn: &Connection) -> Result<CloudBackupSettings, AppError> {
    let json: Option<String> = conn
        .query_row(
            "SELECT cloud_backup_settings FROM settings WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .unwrap_or(None);

    match json {
        Some(s) if !s.trim().is_empty() => serde_json::from_str(&s)
            .map_err(|e| AppError::database(format!("Failed to parse cloud backup settings: {}", e))),
        _ => Ok(CloudBackupSettings::default()),
    }
}

/// Persist the cloud-backup config. `last_backup_at` is managed by the backend
/// (see `update_cloud_backup_timestamp`) and preserved here from the incoming
/// value, so callers should pass the existing timestamp through unchanged.
pub fn save_cloud_backup_settings(
    conn: &mut Connection,
    settings: &CloudBackupSettings,
) -> Result<(), AppError> {
    let json = serde_json::to_string_pretty(settings)
        .map_err(|e| AppError::database(format!("Failed to serialize cloud backup settings: {}", e)))?;

    conn.execute(
        "UPDATE settings SET cloud_backup_settings = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
        params![json],
    )?;
    Ok(())
}

/// Stamp the last successful cloud backup time (RFC3339), leaving all other
/// fields untouched.
pub fn update_cloud_backup_timestamp(conn: &mut Connection, when: &str) -> Result<(), AppError> {
    let mut cfg = get_cloud_backup_settings(conn)?;
    cfg.last_backup_at = Some(when.to_string());
    save_cloud_backup_settings(conn, &cfg)
}

/// Return an error if past data entry is locked. Call this at the top of
/// each past-data command before any write.
pub fn assert_past_data_unlocked(conn: &Connection) -> Result<(), AppError> {
    if get_past_data_locked(conn)? {
        return Err(AppError::business(
            "Past data entry is locked. Go to Settings → Data to unlock.",
        ));
    }
    Ok(())
}

/// Read the past-data lock flag.
pub fn get_past_data_locked(conn: &Connection) -> Result<bool, AppError> {
    let locked: i64 = conn.query_row(
        "SELECT COALESCE(past_data_locked, 0) FROM settings WHERE id = 1",
        [],
        |row| row.get(0),
    ).unwrap_or(0);
    Ok(locked != 0)
}

/// Set the past-data lock flag (true = locked).
pub fn set_past_data_locked(conn: &mut Connection, locked: bool) -> Result<(), AppError> {
    conn.execute(
        "UPDATE settings SET past_data_locked = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
        [locked as i64],
    )?;
    Ok(())
}

/// Get appearance settings
pub fn get_appearance_settings(conn: &Connection) -> Result<AppearanceSettings, AppError> {
    let settings_json: String = conn.query_row(
        "SELECT appearance_settings FROM settings WHERE id = 1",
        [],
        |row| row.get(0),
    )?;

    let settings: AppearanceSettings = serde_json::from_str(&settings_json)
        .map_err(|e| AppError::database(format!("Failed to parse appearance settings: {}", e)))?;

    Ok(settings)
}

/// Save appearance settings
pub fn save_appearance_settings(conn: &mut Connection, settings: &AppearanceSettings) -> Result<(), AppError> {
    let settings_json = serde_json::to_string_pretty(settings)
        .map_err(|e| AppError::database(format!("Failed to serialize appearance settings: {}", e)))?;

    conn.execute(
        "UPDATE settings SET appearance_settings = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
        params![settings_json],
    )?;

    Ok(())
}

// ── Weekly installment tracker ─────────────────────────────────────────────

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallmentStatus {
    /// Expected installment number as of today (anchor + Mondays elapsed).
    pub current_number: i64,
    /// The number last set by the user.
    pub anchor_number: i64,
    /// ISO date the anchor number was set (None if never configured).
    pub anchor_date: Option<String>,
    /// Number of Mondays that have passed since the anchor was set.
    pub weeks_elapsed: i64,
}

/// Compute the current expected installment number. It starts at the anchor
/// number set by the user and steps up by one on every Monday since — regardless
/// of which weekday it was anchored on. Returns the full status so the UI can show
/// both the live number and the anchor.
pub fn get_installment_status(conn: &Connection) -> Result<InstallmentStatus, AppError> {
    let (anchor_number, anchor_date): (i64, Option<String>) = conn
        .query_row(
            "SELECT COALESCE(installment_anchor_number, 0), installment_anchor_date
             FROM settings WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap_or((0, None));

    let weeks_elapsed = match &anchor_date {
        Some(d) if anchor_number > 0 => {
            let anchor = chrono::NaiveDate::parse_from_str(&d[..10.min(d.len())], "%Y-%m-%d");
            match anchor {
                // Count Mondays strictly after the anchor date, using LOCAL time so the
                // roll-over happens at the operator's local Monday midnight.
                Ok(start) => mondays_between(start, chrono::Local::now().date_naive()),
                Err(_) => 0,
            }
        }
        _ => 0,
    };

    let current_number = if anchor_number > 0 { anchor_number + weeks_elapsed } else { 0 };

    Ok(InstallmentStatus { current_number, anchor_number, anchor_date, weeks_elapsed })
}

/// Number of Mondays that fall strictly after `start` and on or before `end`.
/// This is how many times the weekly installment number has ticked over since it
/// was anchored: it holds on the anchor day and increments on each following Monday.
fn mondays_between(start: chrono::NaiveDate, end: chrono::NaiveDate) -> i64 {
    use chrono::Datelike;
    if end <= start {
        return 0;
    }
    // Days from the anchor to the first Monday strictly after it. If the anchor is
    // itself a Monday, the next tick is the following Monday (7 days later).
    let wd = start.weekday().num_days_from_monday() as i64; // 0 = Mon … 6 = Sun
    let to_first_monday = if wd == 0 { 7 } else { 7 - wd };
    let first_monday = start + chrono::Duration::days(to_first_monday);
    if first_monday > end {
        0
    } else {
        (end - first_monday).num_days() / 7 + 1
    }
}

/// Set the current installment number. Anchors it to today (local date) so it
/// resumes stepping up on each following Monday from this value.
pub fn set_installment_number(conn: &mut Connection, number: i64) -> Result<(), AppError> {
    if number < 0 {
        return Err(AppError::validation("Installment number cannot be negative"));
    }
    let today = chrono::Local::now().date_naive().to_string(); // YYYY-MM-DD (local)
    conn.execute(
        "UPDATE settings
         SET installment_anchor_number = ?1, installment_anchor_date = ?2,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = 1",
        (number, today),
    )?;
    Ok(())
}

/// The standard weekly contribution amount. When > 0, a member's installment count
/// is derived as floor(savings / weekly amount) rather than +1 per contribution, so
/// paying multiple weeks at once advances the count proportionally. 0 = not set.
pub fn get_weekly_contribution_amount(conn: &Connection) -> Result<f64, AppError> {
    let amt: f64 = conn.query_row(
        "SELECT COALESCE(weekly_contribution_amount, 0) FROM settings WHERE id = 1",
        [], |r| r.get(0),
    ).unwrap_or(0.0);
    Ok(amt)
}

/// Set the standard weekly contribution amount (0 to clear).
pub fn set_weekly_contribution_amount(conn: &mut Connection, amount: f64) -> Result<(), AppError> {
    if !amount.is_finite() || amount < 0.0 {
        return Err(AppError::validation("Weekly contribution amount cannot be negative"));
    }
    conn.execute(
        "UPDATE settings SET weekly_contribution_amount = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
        [amount],
    )?;
    Ok(())
}

// ── SHG Opening Balance ────────────────────────────────────────────────────

/// Returns whether the SHG opening balance has been locked.
pub fn get_shg_opening_locked(conn: &Connection) -> Result<bool, AppError> {
    let locked: i64 = conn.query_row(
        "SELECT COALESCE(shg_opening_locked, 0) FROM settings WHERE id = 1",
        [],
        |row| row.get(0),
    ).unwrap_or(0);
    Ok(locked != 0)
}

#[derive(serde::Serialize)]
pub struct ShgOpeningStatus {
    pub locked: bool,
    pub cash: f64,
    pub bank: f64,
}

/// Returns the current SHG opening balance status (locked flag + amounts).
pub fn get_shg_opening_status(conn: &Connection) -> Result<ShgOpeningStatus, AppError> {
    let (locked, cash, bank): (i64, f64, f64) = conn.query_row(
        "SELECT COALESCE(shg_opening_locked,0), COALESCE(shg_opening_cash,0), COALESCE(shg_opening_bank,0)
         FROM settings WHERE id = 1",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).unwrap_or((0, 0.0, 0.0));
    Ok(ShgOpeningStatus { locked: locked != 0, cash, bank })
}

/// Set the SHG opening cash and bank balances, then lock them.
///
/// This directly updates `shg_balances` and records OPENING transactions
/// in `shg_transactions`. Can only be called once (locked after first use).
pub fn set_shg_opening_balance(
    conn: &mut Connection,
    cash: f64,
    bank: f64,
) -> Result<(), AppError> {
    if get_shg_opening_locked(conn)? {
        return Err(AppError::business(
            "SHG opening balance has already been set and is locked.",
        ));
    }

    let now = chrono::Utc::now().to_rfc3339();
    let mut tx = conn.transaction()?;

    if cash > 0.0 {
        tx.execute(
            "INSERT INTO shg_transactions
             (txn_type, amount, reason, payment_method, reference_type, reference_id, created_at)
             VALUES ('OPENING', ?1, 'SHG Opening Balance', 'CASH', 'OPENING', NULL, ?2)",
            (cash, &now),
        )?;
        tx.execute(
            "UPDATE shg_balances SET balance = balance + ?1 WHERE method = 'CASH'",
            [cash],
        )?;
    }

    if bank > 0.0 {
        tx.execute(
            "INSERT INTO shg_transactions
             (txn_type, amount, reason, payment_method, reference_type, reference_id, created_at)
             VALUES ('OPENING', ?1, 'SHG Opening Balance', 'BANK', 'OPENING', NULL, ?2)",
            (bank, &now),
        )?;
        tx.execute(
            "UPDATE shg_balances SET balance = balance + ?1 WHERE method = 'BANK'",
            [bank],
        )?;
    }

    tx.execute(
        "UPDATE settings SET shg_opening_cash = ?1, shg_opening_bank = ?2,
         shg_opening_locked = 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
        (cash, bank),
    )?;

    tx.commit()?;
    Ok(())
}
