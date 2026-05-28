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

/// Change the admin (recovery) PIN without touching the main DB key.
#[tauri::command]
pub fn change_admin_pin(
    current_admin_pin: String,
    new_admin_pin: String,
    state: State<Mutex<AppState>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    if new_admin_pin.len() < 4 {
        return Err("New admin PIN must be at least 4 characters".to_string());
    }
    if current_admin_pin == new_admin_pin {
        return Err("New admin PIN must be different from the current one".to_string());
    }

    let app_dir = app.path().app_data_dir()
        .map_err(|_| "app_data_dir not available".to_string())?;
    let sec_path = app_dir.join("data").join("security.json");

    let sec = store::load(&sec_path)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No security data found".to_string())?;

    let admin_salt_bytes = hex::decode(
        sec.admin_salt.as_deref().ok_or_else(|| "No admin PIN configured".to_string())?
    ).map_err(|_| "Invalid admin salt".to_string())?;

    let recovery_bytes = hex::decode(
        sec.recovery_blob.as_deref().ok_or_else(|| "No recovery blob found".to_string())?
    ).map_err(|_| "Invalid recovery data".to_string())?;

    // Recover db_key using the current admin PIN.
    let current_admin_key = key::derive_key(&current_admin_pin, &admin_salt_bytes)
        .map_err(|e: AppError| e.to_string())?;

    let recovery_arr: [u8; 32] = recovery_bytes
        .try_into()
        .map_err(|_| "Corrupt recovery blob".to_string())?;
    let recovered_db_key = key::xor_keys(&recovery_arr, &current_admin_key);
    let recovered_db_key_hex = hex::encode(recovered_db_key);

    // Verify the recovered key matches the in-memory db_key.
    let guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let stored_db_key = guard
        .db_key
        .as_deref()
        .ok_or_else(|| "Database not unlocked".to_string())?;

    if recovered_db_key_hex != stored_db_key {
        return Err("Incorrect current admin PIN".to_string());
    }
    drop(guard);

    // Generate new admin salt + key and recompute recovery blob.
    let new_admin_salt = key::generate_salt();
    let new_admin_key = key::derive_key(&new_admin_pin, &new_admin_salt)
        .map_err(|e: AppError| e.to_string())?;
    let new_recovery = key::xor_keys(&recovered_db_key, &new_admin_key);

    let new_sec = store::SecurityData {
        salt: sec.salt,
        admin_salt: Some(hex::encode(new_admin_salt)),
        recovery_blob: Some(hex::encode(new_recovery)),
    };
    store::save(&sec_path, &new_sec).map_err(|e| e.to_string())?;

    Ok(())
}

/// Verify the admin PIN against the stored recovery blob. Returns true if it
/// matches. Used both by the public Tauri command and by other commands that
/// need to gate sensitive operations behind admin re-auth.
pub fn verify_admin_pin_internal(
    pin: &str,
    app: &tauri::AppHandle,
    state: &Mutex<AppState>,
) -> Result<bool, String> {
    let app_dir = app.path().app_data_dir()
        .map_err(|_| "app_data_dir not available".to_string())?;
    let sec_path = app_dir.join("data").join("security.json");

    let sec = match store::load(&sec_path).map_err(|e| e.to_string())? {
        Some(s) => s,
        None => return Ok(false),
    };

    let admin_salt_bytes = match sec.admin_salt.as_deref() {
        Some(s) => hex::decode(s).map_err(|_| "Invalid admin salt".to_string())?,
        None => return Ok(false),
    };

    let recovery_bytes = match sec.recovery_blob.as_deref() {
        Some(r) => hex::decode(r).map_err(|_| "Invalid recovery blob".to_string())?,
        None => return Ok(false),
    };

    let admin_key = key::derive_key(pin, &admin_salt_bytes)
        .map_err(|e: AppError| e.to_string())?;

    let recovery_arr: [u8; 32] = recovery_bytes
        .try_into()
        .map_err(|_| "Corrupt recovery blob".to_string())?;
    let candidate_db_key = key::xor_keys(&recovery_arr, &admin_key);
    let candidate_hex = hex::encode(candidate_db_key);

    let guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let stored = match guard.db_key.as_deref() {
        Some(k) => k.to_string(),
        None => return Ok(false),
    };
    Ok(candidate_hex == stored)
}

/// Verify the admin PIN (set during app setup) — used to authorise destructive operations.
/// Derives the admin key from the provided PIN and checks it against the stored recovery blob.
#[tauri::command]
pub fn verify_master_password(
    password: String,
    state: State<Mutex<AppState>>,
    app: tauri::AppHandle,
) -> Result<bool, String> {
    verify_admin_pin_internal(&password, &app, state.inner())
}

