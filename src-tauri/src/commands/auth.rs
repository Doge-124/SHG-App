use tauri::State;
use std::sync::Mutex;

use crate::db;
use crate::AppState;

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
