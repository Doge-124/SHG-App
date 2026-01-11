
use tauri::Manager;
use std::fs;
use crate::security::{key, store};
use hex;
use serde::Serialize;


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

#[derive(Serialize)]
pub struct Member {
    pub id: i64,
    pub member_code: String,
    pub name: String,
    pub phone: Option<String>,
    pub address: Option<String>,
    pub joined_at: String,
    pub is_active: bool,
}

pub fn add_member(
    conn: &rusqlite::Connection,
    code: &str,
    name: &str,
    phone: Option<&str>,
    address: Option<&str>,
    joined_at: &str,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO members (member_code, name, phone, address, joined_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        (code, name, phone, address, joined_at),
    )?;
    Ok(())
}

pub fn get_member_by_code(
    conn: &rusqlite::Connection,
    code: &str,
) -> Result<Member, rusqlite::Error> {
    conn.query_row(
        "SELECT id, member_code, name, phone, address, joined_at, is_active FROM members WHERE member_code = ?1",
        [code],
        |row| {
            Ok(Member {
                id: row.get(0)?,
                member_code: row.get(1)?,
                name: row.get(2)?,
                phone: row.get(3)?,
                address: row.get(4)?,
                joined_at: row.get(5)?,
                is_active: row.get::<_, i64>(6)? == 1,
            })
        },
    )
}

pub fn list_members(conn: &rusqlite::Connection) -> Result<Vec<Member>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, member_code, name, phone, address, joined_at, is_active FROM members ORDER BY name"
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(Member {
            id: row.get(0)?,
            member_code: row.get(1)?,
            name: row.get(2)?,
            phone: row.get(3)?,
            address: row.get(4)?,
            joined_at: row.get(5)?,
            is_active: row.get::<_, i64>(6)? == 1,
        })
    })?;

    let mut out = vec![];
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn get_member_balance(
    conn: &rusqlite::Connection,
    member_id: i64,
) -> Result<f64, rusqlite::Error> {
    conn.query_row(
        "SELECT balance FROM member_balances WHERE member_id = ?1",
        [member_id],
        |row| row.get(0),
    )
}
