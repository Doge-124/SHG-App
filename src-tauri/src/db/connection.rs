use rusqlite::{Connection, Result};
use std::fs;
use std::path::Path;

pub fn open_db(db_path: &Path, key: &str) -> Result<Connection> {
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent).expect("Failed to create data directory");
    }

    let conn = Connection::open(db_path)?;

    // 🔐 CRITICAL: set encryption key
    conn.pragma_update(None, "key", &key)?;

    conn.execute_batch("PRAGMA journal_mode = WAL;")?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;

    Ok(conn)
}
