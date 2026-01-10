use rusqlite::Connection;

pub struct AppState {
    pub db: Option<Connection>,
}
