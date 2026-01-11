use tauri::State;
use std::sync::Mutex;

use crate::db;
use crate::state::AppState;
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

#[tauri::command]
pub fn add_member(
    state: tauri::State<Mutex<AppState>>,
    code: String,
    name: String,
    phone: Option<String>,
    address: Option<String>,
    joined_at: String,
) -> Result<(), String> {
    let guard = state.lock().unwrap();
    let conn = guard.db.as_ref().ok_or("DB not unlocked")?;
    db::add_member(conn, &code, &name, phone.as_deref(), address.as_deref(), &joined_at)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_member(code: String, state: tauri::State<Mutex<AppState>>) -> Result<db::Member, String> {
    let guard = state.lock().unwrap();
    let conn = guard.db.as_ref().ok_or("DB not unlocked")?;
    db::get_member_by_code(conn, &code).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_members(state: tauri::State<Mutex<AppState>>) -> Result<Vec<db::Member>, String> {
    let guard = state.lock().unwrap();
    let conn = guard.db.as_ref().ok_or("DB not unlocked")?;
    db::list_members(conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn member_balance(
    state: tauri::State<Mutex<AppState>>,
    member_id: i64,
) -> Result<f64, String> {
    let guard = state.lock().unwrap();
    let conn = guard.db.as_ref().ok_or("DB not unlocked")?;
    db::get_member_balance(conn, member_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dump_members(state: tauri::State<std::sync::Mutex<AppState>>) -> Result<String, String> {
    let guard = state.lock().unwrap();
    let conn = guard.db.as_ref().ok_or("DB not unlocked")?;

    let mut stmt = conn
        .prepare("SELECT id, member_code, name FROM members")
        .map_err(|e| e.to_string())?;

    let mut out = String::new();

    let rows = stmt.query_map([], |r| {
        Ok(format!(
            "{} | {} | {}",
            r.get::<_, i64>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?
        ))
    }).map_err(|e| e.to_string())?;

    for r in rows {
        out.push_str(&r.map_err(|e| e.to_string())?);
        out.push('\n');
    }

    Ok(out)
}

