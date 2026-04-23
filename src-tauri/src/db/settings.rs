//! Settings management for the SHG application.
//!
//! This module handles storage and retrieval of application settings
//! including general information, notifications, data management, and appearance.

use rusqlite::{Connection, params};
use serde::{Serialize, Deserialize};
use crate::error::AppError;
use crate::types::{GeneralSettings, NotificationSettings, DataSettings, AppearanceSettings};

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
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
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
