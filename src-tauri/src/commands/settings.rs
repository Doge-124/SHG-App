//! Tauri commands for settings management.

use tauri::{State, Manager};
use std::sync::Mutex;
use crate::state::AppState;
use crate::db::{self, settings, backup};
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
    
    // Force settings reload on frontend by emitting an event
    // This will trigger the SettingsContext to refresh
    Ok(())
}
