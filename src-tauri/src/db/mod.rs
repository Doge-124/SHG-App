
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
    std::fs::create_dir_all(&data_dir).unwrap();

    let db_path = data_dir.join("shg.db");
    let sec_path = data_dir.join("security.json");

    println!("DB PATH = {:?}", db_path);

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

    let sec = store::load(&sec_path).expect("Security file missing");
    let salt = hex::decode(sec.salt).expect("Invalid salt");
    let derived_key = key::derive_key(pin, &salt);
    let db_key = hex::encode(&derived_key);

    let conn = connection::open_db(&db_path, &db_key)
        .expect("Failed to open encrypted DB");

    Ok(conn)
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

    let member_id: i64 = conn.query_row(
        "SELECT id FROM members WHERE member_code = ?1",
        [code],
        |r| r.get(0),
    )?;

    conn.execute(
        "INSERT INTO member_balances (member_id, balance) VALUES (?1, 0)",
        [member_id],
    )?;

    Ok(())
}


pub fn get_member_by_code(
    conn: &rusqlite::Connection,
    code: &str,
) -> Result<Member, rusqlite::Error> {
    println!("Searching for member_code = {}", code);
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
        |row| {
        let v: Option<f64> = row.get(0)?;
        Ok(v.unwrap_or(0.0))
    },
    )
}

pub fn record_receipt(
    tx: &mut rusqlite::Transaction,
    amount: f64,
    reason: &str,
    payment_method: &str,
    reference_type: Option<&str>,
    reference_id: Option<i64>,
    created_at: &str,
) -> Result<(), rusqlite::Error> {

    tx.execute(
        "INSERT INTO shg_transactions
         (txn_type, amount, reason, payment_method, reference_type, reference_id, created_at)
         VALUES ('RECEIPT', ?1, ?2, ?3, ?4, ?5, ?6)",
        (amount, reason, payment_method, reference_type, reference_id, created_at),
    )?;

    tx.execute(
        "UPDATE shg_balances SET balance = balance + ?1 WHERE method = ?2",
        (amount, payment_method),
    )?;

    Ok(())
}



pub fn record_voucher(
    tx: &mut rusqlite::Transaction,
    amount: f64,
    reason: &str,
    payment_method: &str,
    reference_type: Option<&str>,
    reference_id: Option<i64>,
    created_at: &str,
) -> Result<(), rusqlite::Error> {

    tx.execute(
        "INSERT INTO shg_transactions
         (txn_type, amount, reason, payment_method, reference_type, reference_id, created_at)
         VALUES ('VOUCHER', ?1, ?2, ?3, ?4, ?5, ?6)",
        (amount, reason, payment_method, reference_type, reference_id, created_at),
    )?;

    tx.execute(
        "UPDATE shg_balances SET balance = balance - ?1 WHERE method = ?2",
        (amount, payment_method),
    )?;

    Ok(())
}


pub fn issue_member_loan(
    conn: &mut rusqlite::Connection,
    member_id: i64,
    amount: f64,
    payment_method: &str,
    note: &str,
    created_at: &str,
) -> Result<(), rusqlite::Error> {

    let mut tx = conn.transaction()?;

    // 1. Member transaction
    tx.execute(
        "INSERT INTO member_transactions (member_id, amount, txn_type, created_at)
         VALUES (?1, ?2, 'LOAN', ?3)",
        (member_id, amount, created_at),
    )?;

    // 2. Update member balance
    tx.execute(
        "UPDATE member_balances SET balance = balance + ?1 WHERE member_id = ?2",
        (amount, member_id),
    )?;

    // 3. SHG voucher (money goes out)
    record_voucher(
        &mut tx,
        amount,
        note,
        payment_method,
        Some("MEMBER_LOAN"),
        Some(member_id),
        created_at,
    )?;

    tx.commit()?;
    Ok(())
}


pub fn record_member_payment(
    conn: &mut rusqlite::Connection,
    member_id: i64,
    amount: f64,
    payment_method: &str,
    note: &str,
    created_at: &str,
) -> Result<(), rusqlite::Error> {

    let mut tx = conn.transaction()?;

    // 1. Member transaction
    tx.execute(
        "INSERT INTO member_transactions (member_id, amount, txn_type, created_at)
         VALUES (?1, ?2, 'PAYMENT', ?3)",
        (member_id, -amount, created_at),
    )?;

    // 2. Update member balance
    tx.execute(
        "UPDATE member_balances SET balance = balance - ?1 WHERE member_id = ?2",
        (amount, member_id),
    )?;

    // 3. SHG receipt (money comes in)
    record_receipt(
        &mut tx,
        amount,
        note,
        payment_method,
        Some("MEMBER_PAYMENT"),
        Some(member_id),
        created_at,
    )?;

    tx.commit()?;
    Ok(())
}


pub fn create_chit_group(
    conn: &mut rusqlite::Connection,
    name: &str,
    total_amount: f64,
    months: i64,
    commission_percent: f64,
    start_date: &str,
) -> Result<(), rusqlite::Error> {
    let monthly = total_amount / months as f64;

    conn.execute(
        "INSERT INTO chit_groups 
         (name, total_amount, months, monthly_contribution, commission_percent, start_date, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'ACTIVE')",
        (name, total_amount, months, monthly, commission_percent, start_date),
    )?;

    Ok(())
}


