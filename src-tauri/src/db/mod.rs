
use tauri::Manager;
use std::fs;
use crate::security::{key, store};
use hex;


mod schema;
mod connection;
mod security;

pub fn init_db_with_pin(app: &tauri::AppHandle, pin: &str) -> Result<rusqlite::Connection, ()> {
    let app_dir = app.path().app_data_dir().unwrap();
    let data_dir = app_dir.join("data");
    fs::create_dir_all(&data_dir).unwrap();

    let db_path = data_dir.join("shg.db");
    let sec_path = data_dir.join("security.json");


    // FIRST RUN
    if !db_path.exists() {
        let salt = key::generate_salt();
        let derived_key = key::derive_key(pin, &salt);
        let db_key = hex::encode(&derived_key);

        let conn = connection::open_db(&db_path, &db_key)
            .expect("Failed to create encrypted DB");

        conn.execute_batch(schema::SCHEMA_SQL)
            .expect("Failed to apply schema");

        store::save(&sec_path, &store::SecurityData {
            salt: hex::encode(&salt),
        });

        return Ok(conn);
    }

    // SUBSEQUENT RUN
    let sec = store::load(&sec_path)
        .expect("Security file missing");

    let salt = hex::decode(sec.salt).expect("Invalid salt");
    let derived_key = key::derive_key(pin, &salt);
    let db_key = hex::encode(&derived_key);

    Ok(connection::open_db(&db_path, &db_key)
        .expect("Failed to open encrypted DB"))
}