use tauri::State;
use std::sync::Mutex;

use crate::db;
use crate::AppState;
use tauri::Manager;


#[tauri::command]
pub fn unlock_db(pin: String, state: State<Mutex<AppState>>, app: tauri::AppHandle) -> Result<(), String> {
    let mut state = state.lock().unwrap();

    if state.db.is_some() {
        return Ok(());
    }

    match db::init_db_with_pin(&app, &pin) {
        Ok(conn) => {
            state.db = Some(conn);
            Ok(())
        }
        Err(_) => Err("Invalid PIN".into()),
    }
}

#[tauri::command]
pub fn has_security(app: tauri::AppHandle) -> bool {
    let app_dir = app.path().app_data_dir().unwrap();
    let data_dir = app_dir.join("data");
    let sec_path = data_dir.join("security.json");
    sec_path.exists()
}

