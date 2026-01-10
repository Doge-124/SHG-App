use rusqlite::Connection;
use tauri::Manager;
use std::path::PathBuf;

mod schema;
mod connection;

pub fn init_db(app_handle: &tauri::AppHandle) -> Connection {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .expect("Failed to resolve app data directory");

    let db_path: PathBuf = app_dir.join("data").join("shg.db");

    let conn = connection::open_db(&db_path)
        .expect("Failed to open database");

    conn.execute_batch(schema::SCHEMA_SQL)
        .expect("Failed to apply DB schema");

    conn
}
