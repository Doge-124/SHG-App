#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;
mod security;
mod state;

use state::AppState;
use std::sync::Mutex;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            Ok(())
        })
        .manage(std::sync::Mutex::new(AppState { db: None }))
        .invoke_handler(tauri::generate_handler![
            commands::auth::unlock_db,
            commands::auth::has_security
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
