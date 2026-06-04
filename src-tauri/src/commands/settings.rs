//! Tauri commands for settings management.

use tauri::{State, Manager};
use std::sync::Mutex;
use crate::state::AppState;
use crate::db::{self, settings, backup};
use crate::security::{key, store};
use crate::types::{GeneralSettings, NotificationSettings, DataSettings, AppearanceSettings};

#[tauri::command]
pub fn get_general_settings(state: State<Mutex<AppState>>) -> Result<GeneralSettings, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;
    
    settings::get_general_settings(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_general_settings(
    state: State<Mutex<AppState>>,
    settings: GeneralSettings,
) -> Result<(), String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;
    
    settings::save_general_settings(conn, &settings)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_notification_settings(state: State<Mutex<AppState>>) -> Result<NotificationSettings, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;
    
    settings::get_notification_settings(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_notification_settings(
    state: State<Mutex<AppState>>,
    settings: NotificationSettings,
) -> Result<(), String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;
    
    settings::save_notification_settings(conn, &settings)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_data_settings(state: State<Mutex<AppState>>) -> Result<DataSettings, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;
    
    settings::get_data_settings(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_data_settings(
    state: State<Mutex<AppState>>,
    settings: DataSettings,
) -> Result<(), String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;
    
    settings::save_data_settings(conn, &settings)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_appearance_settings(state: State<Mutex<AppState>>) -> Result<AppearanceSettings, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;
    
    settings::get_appearance_settings(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_appearance_settings(
    state: State<Mutex<AppState>>,
    settings: AppearanceSettings,
) -> Result<(), String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;
    
    settings::save_appearance_settings(conn, &settings)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn debug_settings_json(state: State<Mutex<AppState>>) -> Result<String, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;
    
    let settings_json: String = conn.query_row(
        "SELECT general_settings FROM settings WHERE id = 1",
        [],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    
    Ok(settings_json)
}

#[tauri::command]
pub fn force_migrate_settings(state: State<Mutex<AppState>>) -> Result<(), String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;
    
    crate::db::settings::migrate_settings_to_camelcase(conn)
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
pub fn get_all_settings(state: State<Mutex<AppState>>) -> Result<crate::types::AppSettings, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;
    
    let general = settings::get_general_settings(conn)
        .map_err(|e| e.to_string())?;
    
    let notifications = settings::get_notification_settings(conn)
        .map_err(|e| e.to_string())?;
    
    let data = settings::get_data_settings(conn)
        .map_err(|e| e.to_string())?;
    
    let appearance = settings::get_appearance_settings(conn)
        .map_err(|e| e.to_string())?;
    
    Ok(crate::types::AppSettings {
        general,
        notifications,
        data,
        appearance,
    })
}

#[tauri::command]
pub fn save_all_settings(
    state: State<Mutex<AppState>>,
    settings: crate::types::AppSettings,
) -> Result<(), String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;
    
    // Save all settings without transaction for now
    settings::save_general_settings(conn, &settings.general)
        .map_err(|e| e.to_string())?;
    
    settings::save_notification_settings(conn, &settings.notifications)
        .map_err(|e| e.to_string())?;
    
    settings::save_data_settings(conn, &settings.data)
        .map_err(|e| e.to_string())?;
    
    settings::save_appearance_settings(conn, &settings.appearance)
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
pub fn change_database_password(
    _state: State<Mutex<AppState>>,
    current_password: String,
    new_password: String,
) -> Result<(), String> {
    // TODO: Implement database password change
    // This would require SQLCipher rekey functionality
    // For now, return a placeholder implementation
    if current_password.is_empty() || new_password.is_empty() {
        return Err("Passwords cannot be empty".to_string());
    }
    
    if current_password == new_password {
        return Err("New password must be different from current password".to_string());
    }
    
    // Placeholder - would need actual SQLCipher rekey implementation
    Err("Database password change not yet implemented".to_string())
}

#[tauri::command]
pub fn create_backup(state: State<Mutex<AppState>>) -> Result<backup::BackupInfo, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;
    
    backup::create_backup(conn, "manual")
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn restore_backup(
    state: State<Mutex<AppState>>,
    backup_path: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;

    let db_key = guard
        .db_key
        .clone()
        .ok_or_else(|| "DB key not available — please unlock the database first".to_string())?;

    // Checkpoint WAL so the backup contains everything committed.
    if let Some(conn) = &guard.db {
        let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
    }

    // Drop the live connection — required before we can replace the DB file.
    guard.db = None;

    // Replace the DB file on disk with the backup.
    if let Err(e) = backup::restore_backup_file(&backup_path) {
        // Try to re-open the old connection so the app stays usable.
        let _ = reopen_db(&mut guard, &db_key, &app);
        return Err(e.to_string());
    }

    // Reopen the restored DB with the same key.
    reopen_db(&mut guard, &db_key, &app)
        .map_err(|e| e.to_string())
}

fn reopen_db(
    guard: &mut std::sync::MutexGuard<AppState>,
    db_key: &str,
    app: &tauri::AppHandle,
) -> Result<(), crate::error::AppError> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| crate::error::AppError::database("app_data_dir not available".to_string()))?;
    let db_path = app_dir.join("data").join("shg.db");

    let mut conn = db::connection::open_db(&db_path, db_key)?;
    db::schema::apply_migrations(&mut conn)?;
    db::loans::init_loans_table(&mut conn)?;
    db::settings::init_settings_table(&mut conn)?;

    guard.db = Some(conn);
    Ok(())
}

#[tauri::command]
pub fn get_backup_list(state: State<Mutex<AppState>>) -> Result<Vec<backup::BackupInfo>, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;
    
    backup::get_backup_list(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_all_data(state: State<Mutex<AppState>>) -> Result<String, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;
    
    backup::export_all_data(conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_all_data(
    state: State<Mutex<AppState>>,
    json_data: String,
) -> Result<(), String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;
    
    backup::import_all_data(conn, &json_data)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_all_data(state: State<Mutex<AppState>>) -> Result<(), String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    backup::clear_all_data(conn)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Clear all transactional data but keep members and their savings opening
/// balances (for the testing → production handover).
#[tauri::command]
pub fn clear_data_keep_members(state: State<Mutex<AppState>>) -> Result<(), String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    backup::clear_data_keep_members(conn)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Get the current past-data lock status.
#[tauri::command]
pub fn get_past_data_lock_status(state: State<Mutex<AppState>>) -> Result<bool, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard.db.as_mut().ok_or_else(|| "DB not unlocked".to_string())?;
    settings::get_past_data_locked(conn).map_err(|e| e.to_string())
}

/// Lock past data entry permanently. Requires no credential — caller shows confirmation dialog.
#[tauri::command]
pub fn lock_past_data_entry(state: State<Mutex<AppState>>) -> Result<(), String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard.db.as_mut().ok_or_else(|| "DB not unlocked".to_string())?;

    if settings::get_past_data_locked(conn).map_err(|e| e.to_string())? {
        return Err("Past data entry is already locked".to_string());
    }

    settings::set_past_data_locked(conn, true).map_err(|e| e.to_string())
}

/// Unlock past data entry.
/// Verifies using the admin PIN if one is configured, otherwise falls back to
/// the main PIN (for databases created before admin PIN support was added).
#[tauri::command]
pub fn unlock_past_data_entry(
    admin_pin: String,
    state: State<Mutex<AppState>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let app_dir = app.path().app_data_dir()
        .map_err(|_| "app_data_dir not available".to_string())?;
    let sec_path = app_dir.join("data").join("security.json");

    let sec = store::load(&sec_path)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No security data found".to_string())?;

    let pin_verified = if sec.admin_salt.is_some() && sec.recovery_blob.is_some() {
        // Admin PIN is configured — verify against it.
        let admin_salt_bytes = hex::decode(sec.admin_salt.as_deref().unwrap_or(""))
            .map_err(|_| "Invalid admin salt".to_string())?;
        let recovery_bytes = hex::decode(sec.recovery_blob.as_deref().unwrap_or(""))
            .map_err(|_| "Invalid recovery data".to_string())?;

        let admin_key = key::derive_key(&admin_pin, &admin_salt_bytes)
            .map_err(|e: crate::error::AppError| e.to_string())?;
        let recovery_arr: [u8; 32] = recovery_bytes
            .try_into()
            .map_err(|_| "Corrupt recovery blob".to_string())?;
        let recovered_db_key = hex::encode(key::xor_keys(&recovery_arr, &admin_key));

        let guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
        let stored = guard.db_key.as_deref()
            .ok_or_else(|| "Database not unlocked".to_string())?
            .to_string();
        recovered_db_key == stored
    } else {
        // No admin PIN set — fall back to main PIN.
        match db::init_db_with_pin(&app, &admin_pin) {
            Ok((conn, _)) => { drop(conn); true }
            Err(_) => false,
        }
    };

    if !pin_verified {
        return Err("Incorrect PIN".to_string());
    }

    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard.db.as_mut().ok_or_else(|| "DB not unlocked".to_string())?;
    settings::set_past_data_locked(conn, false).map_err(|e| e.to_string())
}

/// Get the SHG opening balance status (locked, cash amount, bank amount).
#[tauri::command]
pub fn get_shg_opening_status(state: State<Mutex<AppState>>) -> Result<settings::ShgOpeningStatus, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard.db.as_mut().ok_or_else(|| "DB not unlocked".to_string())?;
    settings::get_shg_opening_status(conn).map_err(|e| e.to_string())
}

/// Set the SHG opening cash and bank balances and lock them permanently.
#[tauri::command]
pub fn set_shg_opening_balance(
    state: State<Mutex<AppState>>,
    cash: f64,
    bank: f64,
) -> Result<(), String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard.db.as_mut().ok_or_else(|| "DB not unlocked".to_string())?;
    settings::set_shg_opening_balance(conn, cash, bank).map_err(|e| e.to_string())
}

