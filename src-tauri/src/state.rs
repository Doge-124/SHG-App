use rusqlite::Connection;

pub struct AppState {
    pub db: Option<Connection>,
    /// Hex-encoded SQLCipher key — kept so restore_backup can reopen the DB
    /// without requiring the user to re-enter their PIN.
    pub db_key: Option<String>,
}
