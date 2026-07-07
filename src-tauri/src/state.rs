use rusqlite::Connection;

pub struct AppState {
    pub db: Option<Connection>,
    /// Hex-encoded SQLCipher key — kept so restore_backup can reopen the DB
    /// without requiring the user to re-enter their PIN.
    pub db_key: Option<String>,
    /// Set by the startup integrity check when the DB shows corruption or
    /// foreign-key violations; the UI surfaces it after unlock. None = healthy.
    pub integrity_warning: Option<String>,
}
