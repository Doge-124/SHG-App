use rusqlite::Connection;
use std::fs;
use std::path::Path;

use crate::error::AppError;

/// Open a SQLCipher-encrypted database file and configure safety PRAGMAs.
///
/// - `foreign_keys = ON` enforces relational integrity at the engine level.
/// - `journal_mode = WAL` improves concurrency and crash safety.
/// - `synchronous = NORMAL` balances durability with performance for a desktop app.
pub fn open_db(db_path: &Path, key: &str) -> Result<Connection, AppError> {
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let conn = Connection::open(db_path)?;

    // 🔐 Set SQLCipher key (must be first PRAGMA).
    conn.pragma_update(None, "key", &key)?;

    // Engine configuration for safety and performance.
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    conn.execute_batch("PRAGMA journal_mode = WAL;")?;
    conn.execute_batch("PRAGMA synchronous = NORMAL;")?;

    Ok(conn)
}
