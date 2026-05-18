//! Versioned database migration system.
//!
//! All schema changes after the initial release MUST be added as a `Migration`
//! entry in `MIGRATIONS` (never edit existing migrations, never bypass the
//! tracking table). Each migration runs in its own transaction and is recorded
//! in `schema_migrations` only on success.
//!
//! ## Architecture
//! - Version 1 is the "baseline" — everything that existed in the legacy
//!   schema.rs (`SCHEMA_SQL` + `apply_migrations`). It is marked applied
//!   automatically (no SQL is run for it under this system because it's
//!   already idempotent in the legacy path).
//! - Versions ≥ 2 are NEW migrations going forward.
//! - On startup: existing legacy schema is established first (idempotent),
//!   then `schema_migrations` is initialised, then any version > current is
//!   applied — with a backup taken first if any migration is pending.

use std::path::{Path, PathBuf};
use rusqlite::{Connection, Transaction};
use crate::error::AppError;

pub const CURRENT_SCHEMA_VERSION: i64 = 1;

pub struct Migration {
    pub version: i64,
    pub name: &'static str,
    pub up: fn(&Transaction) -> Result<(), AppError>,
}

/// Add new migrations here. NEVER modify an existing migration —
/// instead, add a new one that fixes the issue.
pub const MIGRATIONS: &[Migration] = &[
    // Example for the future:
    // Migration { version: 2, name: "add_member_email_column", up: m002_add_member_email },
];

/// Initialise the schema_migrations tracking table.
pub fn init_schema_migrations_table(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version     INTEGER PRIMARY KEY,
            name        TEXT NOT NULL,
            applied_at  TEXT NOT NULL,
            duration_ms INTEGER NOT NULL DEFAULT 0
        );
        "#,
    )?;
    Ok(())
}

/// Highest migration version that has been applied to this DB.
pub fn current_version(conn: &Connection) -> Result<i64, AppError> {
    let v: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);
    Ok(v)
}

/// Mark all migrations up to and including `version` as applied without running them.
/// Used to baseline an existing DB that pre-dates this migration system.
pub fn baseline_to(conn: &Connection, version: i64) -> Result<(), AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    for v in 1..=version {
        conn.execute(
            "INSERT OR IGNORE INTO schema_migrations (version, name, applied_at, duration_ms)
             VALUES (?1, ?2, ?3, 0)",
            rusqlite::params![v, format!("baseline_v{v}"), now],
        )?;
    }
    Ok(())
}

/// Return the list of pending migrations (version > current).
pub fn pending_migrations(conn: &Connection) -> Result<Vec<&'static Migration>, AppError> {
    let current = current_version(conn)?;
    Ok(MIGRATIONS.iter().filter(|m| m.version > current).collect())
}

/// Run a single migration inside its own transaction; record it on success.
fn run_migration(conn: &mut Connection, m: &Migration) -> Result<u128, AppError> {
    let start = std::time::Instant::now();
    let tx = conn.transaction()?;
    (m.up)(&tx)?;
    tx.commit()?;
    let elapsed = start.elapsed().as_millis();

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO schema_migrations (version, name, applied_at, duration_ms)
         VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![m.version, m.name, now, elapsed as i64],
    )?;
    Ok(elapsed)
}

/// Apply all pending migrations. Takes a pre-migration backup first if anything is pending.
/// Returns a vector of versions that were applied.
pub fn run_pending_migrations(
    conn: &mut Connection,
    db_path: &Path,
    backup_dir: &Path,
) -> Result<Vec<i64>, AppError> {
    let pending = pending_migrations(conn)?;
    if pending.is_empty() {
        return Ok(vec![]);
    }

    let target_version = pending.iter().map(|m| m.version).max().unwrap_or(0);
    log::info!(
        "{} pending migration(s); creating pre-migration backup before running",
        pending.len()
    );

    // Pre-migration backup using VACUUM INTO (preserves encryption for SQLCipher).
    let backup_path = create_pre_migration_backup(conn, db_path, backup_dir, target_version)?;
    log::info!("Pre-migration backup written to {}", backup_path.display());

    let mut applied = Vec::new();
    for m in pending {
        log::info!("Applying migration v{} '{}'", m.version, m.name);
        match run_migration(conn, m) {
            Ok(ms) => {
                log::info!("Migration v{} applied in {} ms", m.version, ms);
                applied.push(m.version);
            }
            Err(e) => {
                log::error!(
                    "Migration v{} '{}' FAILED: {}. Restore from backup at: {}",
                    m.version, m.name, e, backup_path.display()
                );
                return Err(e);
            }
        }
    }
    Ok(applied)
}

/// Create a backup of the DB before running migrations.
/// Uses `VACUUM INTO` so it works with the encrypted SQLCipher DB and produces
/// a clean copy (no WAL/journal involvement).
fn create_pre_migration_backup(
    conn: &Connection,
    db_path: &Path,
    backup_dir: &Path,
    target_version: i64,
) -> Result<PathBuf, AppError> {
    std::fs::create_dir_all(backup_dir)?;
    let ts = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    let from_version = current_version(conn)?;
    let filename = format!("auto-pre-migration_v{from_version}-to-v{target_version}_{ts}.db");
    let out_path = backup_dir.join(filename);

    // VACUUM INTO requires a fresh path — fail if it exists.
    if out_path.exists() {
        std::fs::remove_file(&out_path)?;
    }

    let _ = db_path; // db_path captured in case we ever switch to a file-copy strategy
    let sql = format!("VACUUM INTO '{}'", out_path.to_string_lossy().replace('\'', "''"));
    conn.execute_batch(&sql)?;
    Ok(out_path)
}

#[derive(Debug, serde::Serialize)]
pub struct MigrationStatus {
    pub version: i64,
    pub name: String,
    pub applied_at: String,
    pub duration_ms: i64,
}

/// All migrations that have been applied, for support reporting.
pub fn applied_migrations(conn: &Connection) -> Result<Vec<MigrationStatus>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT version, name, applied_at, duration_ms
         FROM schema_migrations ORDER BY version ASC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(MigrationStatus {
            version: r.get(0)?,
            name: r.get(1)?,
            applied_at: r.get(2)?,
            duration_ms: r.get(3)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}
