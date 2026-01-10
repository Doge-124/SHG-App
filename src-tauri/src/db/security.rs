use rusqlite::{Connection, Result};

pub fn is_initialized(conn: &Connection) -> Result<bool> {
    let mut stmt = conn.prepare("SELECT COUNT(*) FROM security")?;
    let count: i64 = stmt.query_row([], |row| row.get(0))?;
    Ok(count > 0)
}

pub fn save_security(conn: &Connection, salt: &str, verifier: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO security (id, salt, verifier) VALUES (1, ?, ?)",
        (salt, verifier),
    )?;
    Ok(())
}

pub fn load_security(conn: &Connection) -> Result<(String, String)> {
    let mut stmt = conn.prepare("SELECT salt, verifier FROM security WHERE id = 1")?;
    stmt.query_row([], |row| {
        Ok((row.get(0)?, row.get(1)?))
    })
}
