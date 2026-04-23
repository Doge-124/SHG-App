//! Tauri commands for authentication / database unlock.

use std::sync::Mutex;
use tauri::State;
use tauri::Manager;

use crate::db;
use crate::error::AppError;
use crate::security::{key, store};
use crate::state::AppState;

/// Unlock (or initialise) the encrypted database using the user's PIN.
#[tauri::command]
pub fn unlock_db(
    pin: String,
    state: State<Mutex<AppState>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|_| "state lock poisoned".to_string())?;

    if state.db.is_some() {
        return Ok(());
    }

    db::init_db_with_pin(&app, &pin)
        .map(|(conn, key)| {
            state.db = Some(conn);
            state.db_key = Some(key);
        })
        .map_err(|e: AppError| e.to_string())
}

/// Initial DB setup when no database exists yet.
/// Sets both the main PIN and an admin (recovery) PIN.
#[tauri::command]
pub fn setup_db(
    pin: String,
    admin_pin: String,
    state: State<Mutex<AppState>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    if pin.len() < 4 {
        return Err("PIN must be at least 4 characters".to_string());
    }
    if admin_pin.len() < 4 {
        return Err("Admin PIN must be at least 4 characters".to_string());
    }
    if pin == admin_pin {
        return Err("Admin PIN must be different from the main PIN".to_string());
    }

    let mut state = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    if state.db.is_some() {
        return Ok(()); // already unlocked
    }

    // Create the database with the main PIN.
    let (conn, db_key_hex) = db::init_db_with_pin(&app, &pin)
        .map_err(|e: AppError| e.to_string())?;

    // Store the recovery blob: XOR(db_key, admin_key) — keyed by admin PIN.
    let app_dir = app.path().app_data_dir()
        .map_err(|_| "app_data_dir not available".to_string())?;
    let sec_path = app_dir.join("data").join("security.json");

    let admin_salt = key::generate_salt();
    let admin_key = key::derive_key(&admin_pin, &admin_salt)
        .map_err(|e: AppError| e.to_string())?;

    let db_key_bytes: [u8; 32] = hex::decode(&db_key_hex)
        .map_err(|_| "key encoding error".to_string())?
        .try_into()
        .map_err(|_| "unexpected key length".to_string())?;

    let recovery = key::xor_keys(&db_key_bytes, &admin_key);

    // Load the existing security.json (created by init_db_with_pin) and add admin fields.
    let mut sec = store::load(&sec_path)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "security.json not created".to_string())?;

    sec.admin_salt = Some(hex::encode(admin_salt));
    sec.recovery_blob = Some(hex::encode(recovery));
    store::save(&sec_path, &sec).map_err(|e| e.to_string())?;

    state.db = Some(conn);
    state.db_key = Some(db_key_hex);
    Ok(())
}

/// Reset the main PIN using the admin (recovery) PIN.
#[tauri::command]
pub fn reset_pin(
    admin_pin: String,
    new_pin: String,
    state: State<Mutex<AppState>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    if new_pin.len() < 4 {
        return Err("New PIN must be at least 4 characters".to_string());
    }
    if admin_pin == new_pin {
        return Err("New PIN must be different from the admin PIN".to_string());
    }

    let app_dir = app.path().app_data_dir()
        .map_err(|_| "app_data_dir not available".to_string())?;
    let data_dir = app_dir.join("data");
    let sec_path = data_dir.join("security.json");
    let db_path  = data_dir.join("shg.db");

    // Load security data.
    let sec = store::load(&sec_path)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No security data found".to_string())?;

    let admin_salt_bytes = hex::decode(
        sec.admin_salt.as_deref().ok_or_else(|| "No admin PIN configured".to_string())?
    ).map_err(|_| "Invalid admin salt".to_string())?;

    let recovery_bytes = hex::decode(
        sec.recovery_blob.as_deref().ok_or_else(|| "No recovery blob found".to_string())?
    ).map_err(|_| "Invalid recovery data".to_string())?;

    // Derive admin key and recover the original db_key.
    let admin_key = key::derive_key(&admin_pin, &admin_salt_bytes)
        .map_err(|e: AppError| e.to_string())?;

    let recovery_arr: [u8; 32] = recovery_bytes
        .try_into()
        .map_err(|_| "Corrupt recovery blob".to_string())?;
    let db_key_bytes = key::xor_keys(&recovery_arr, &admin_key);
    let db_key_hex = hex::encode(db_key_bytes);

    // Verify the recovered key by opening the database.
    let mut conn = db::connection::open_db(&db_path, &db_key_hex)
        .map_err(|_| "Incorrect admin PIN".to_string())?;

    // Derive the new key from new_pin.
    let new_salt = key::generate_salt();
    let new_key_bytes = key::derive_key(&new_pin, &new_salt)
        .map_err(|e: AppError| e.to_string())?;
    let new_key_hex = hex::encode(new_key_bytes);

    // Re-encrypt the database with the new key.
    conn.pragma_update(None, "rekey", &new_key_hex)
        .map_err(|e| format!("Failed to rekey database: {e}"))?;

    // Run migrations on the newly rekeyed connection.
    db::schema::apply_migrations(&mut conn)
        .map_err(|e: AppError| e.to_string())?;

    // Regenerate recovery_blob with new db_key.
    // Keep the same admin PIN (same admin_salt and admin_key).
    let new_recovery = key::xor_keys(&new_key_bytes, &admin_key);

    let new_sec = store::SecurityData {
        salt: hex::encode(new_salt),
        admin_salt: Some(hex::encode(admin_salt_bytes)),
        recovery_blob: Some(hex::encode(new_recovery)),
    };
    store::save(&sec_path, &new_sec).map_err(|e| e.to_string())?;

    // Update AppState with the new connection and key.
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    guard.db = Some(conn);
    guard.db_key = Some(new_key_hex);
    Ok(())
}

/// Returns `true` when a `security.json` file already exists (i.e. the DB has
/// been set up before and a PIN was chosen).
#[tauri::command]
pub fn has_security(app: tauri::AppHandle) -> bool {
    let Some(app_dir) = app.path().app_data_dir().ok() else {
        return false;
    };
    let data_dir = app_dir.join("data");
    let sec_path = data_dir.join("security.json");
    sec_path.exists()
}

/// Verify the master password without unlocking the database
#[tauri::command]
pub fn verify_master_password(
    password: String,
    app: tauri::AppHandle,
) -> Result<bool, String> {
    // Try to open database with the provided password
    // If successful, password is correct
    match db::init_db_with_pin(&app, &password) {
        Ok((conn, _)) => {
            drop(conn); // explicitly close so WAL/SHM files are released immediately
            Ok(true)
        }
        Err(_) => Ok(false),
    }
}
