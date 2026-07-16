
//! Database facade module.
//!
//! This module exposes high-level helpers (e.g. `init_db_with_pin`) and
//! re-exports submodules that own specific areas of the financial model:
//!
//! - `members` – member CRUD and balances
//! - `ledger` – SHG receipts, vouchers, and balances
//! - `loans` – member loans and repayments
//! - `chits` – chit group lifecycle and installments
//! - `reports` – reporting queries over the ledger
//! - `validation` – reusable input validation helpers
//! - `settings` – application settings
//! - `backup` – database backup functionality
//! - `contributions` – member contributions
//! - `daybook` – derived view of all financial transactions

use crate::error::AppError;
use hex;
use tauri::Manager;

pub mod schema;
pub mod connection;
pub mod audit;
pub mod members;
pub mod ledger;
pub mod loans;
pub mod chits;
pub mod chits_past_entry;
pub mod reports;
pub mod validation;
pub mod key;
pub mod store;
pub mod daybook;
pub mod settings;
pub mod backup;
pub mod contributions;
pub mod trial_balance;
pub mod balance_sheet;
pub mod income_expenditure;
pub mod income_ledger;
pub mod general_ledger;
pub mod migrations;
pub mod integrity;
pub mod past_edit;
pub mod cancel;
pub mod guarantors;
pub mod assets;

/// Open or create the encrypted SQLCipher database using a PIN-derived key.
///
/// This keeps all filesystem and key-derivation details in one place while the
/// rest of the code works with an already-open `rusqlite::Connection`.
/// Open or create the encrypted SQLCipher database.
/// Returns `(Connection, hex_key)` so callers can store the key for later
/// operations such as restore that need to reopen the DB.
pub fn init_db_with_pin(app: &tauri::AppHandle, pin: &str) -> Result<(rusqlite::Connection, String), AppError> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "app_data_dir not available",
        )))?;

    let data_dir = app_dir.join("data");
    std::fs::create_dir_all(&data_dir)?;

    let db_path = data_dir.join("shg.db");
    let sec_path = data_dir.join("security.json");

    let backup_dir = app_dir.join("backups");

    if !db_path.exists() {
        // ── Fresh install ─────────────────────────────────────────────
        let salt = key::generate_salt();
        let derived_key = key::derive_key(pin, &salt)?;
        let db_key = hex::encode(&derived_key);

        let conn = connection::open_db(&db_path, &db_key)?;
        let mut conn = conn;

        conn.execute_batch(schema::SCHEMA_SQL)?;
        schema::apply_migrations(&mut conn)?;
        settings::init_settings_table(&mut conn)?;

        // Initialise migration tracking and baseline at v1 (everything above).
        migrations::init_schema_migrations_table(&conn)?;
        migrations::baseline_to(&conn, migrations::CURRENT_SCHEMA_VERSION)?;

        // Run any new migrations (versions > 1). On a fresh install there
        // typically aren't any, but if there are they go through the same
        // tracked path with a backup beforehand.
        migrations::run_pending_migrations(&mut conn, &db_path, &backup_dir)?;

        store::save(
            &sec_path,
            &store::SecurityData {
                salt: hex::encode(&salt),
                admin_salt: None,
                recovery_blob: None,
            },
        )?;

        // Record the version this fresh DB was created at so the first unlock
        // doesn't take a redundant "pre-upgrade" safety backup.
        write_app_version_marker(&data_dir, env!("CARGO_PKG_VERSION"));

        return Ok((conn, db_key));
    }

    // ── Existing DB ──────────────────────────────────────────────────
    let sec = store::load(&sec_path)?
        .ok_or_else(|| AppError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "security.json missing",
        )))?;

    let salt = hex::decode(sec.salt)
        .map_err(|e| AppError::Crypto(format!("invalid salt encoding: {e}")))?;

    let derived_key = key::derive_key(pin, &salt)?;
    let db_key = hex::encode(&derived_key);

    let mut conn = connection::open_db(&db_path, &db_key)?;

    // Safety net: the legacy `apply_migrations` below runs schema surgery on EVERY
    // unlock, with no backup of its own. Whenever the app version changes (i.e. a
    // new build that may carry new/changed migration logic), take one encryption-
    // preserving snapshot BEFORE touching the schema. This is the single automatic
    // backup that protects against a bad migration in an update.
    let app_version = env!("CARGO_PKG_VERSION");
    let version_changed = read_app_version_marker(&data_dir).as_deref() != Some(app_version);
    if version_changed {
        match migrations::create_labeled_backup(&conn, &backup_dir, &format!("pre-upgrade-v{app_version}")) {
            Ok(p) => log::info!("Pre-upgrade safety backup written: {}", p.display()),
            Err(e) => log::warn!("Pre-upgrade safety backup failed (continuing): {e}"),
        }
    }

    // Legacy idempotent setup — runs every time, safe to keep.
    schema::apply_migrations(&mut conn)?;
    loans::init_loans_table(&mut conn)?;
    settings::init_settings_table(&mut conn)?;

    // Migration tracking — baseline an existing pre-v1 DB so versioned
    // migrations going forward run only when they should.
    migrations::init_schema_migrations_table(&conn)?;
    if migrations::current_version(&conn)? == 0 {
        log::info!("Existing database detected — baselining at schema v{}", migrations::CURRENT_SCHEMA_VERSION);
        migrations::baseline_to(&conn, migrations::CURRENT_SCHEMA_VERSION)?;
    }

    // Apply any new versioned migrations (these take their own pre-migration backup).
    migrations::run_pending_migrations(&mut conn, &db_path, &backup_dir)?;

    // Idempotent safety repair: complete any mixed-payment cancellation that
    // previously reversed only one half (cash/bank), leaving a stranded sibling.
    match cancel::repair_orphaned_mixed_reversals(&mut conn) {
        Ok(n) if n > 0 => log::warn!("Repaired {n} stranded mixed-payment reversal half(s)"),
        Ok(_) => {}
        Err(e) => log::error!("Mixed-reversal repair failed (non-fatal): {e}"),
    }

    // All schema work for this version succeeded — record it so we don't take
    // another safety backup on the next unlock of the same build.
    if version_changed {
        write_app_version_marker(&data_dir, app_version);
    }

    Ok((conn, db_key))
}

/// Path of the marker recording the app version whose migrations last completed.
fn app_version_marker_path(data_dir: &std::path::Path) -> std::path::PathBuf {
    data_dir.join(".app_version")
}
fn read_app_version_marker(data_dir: &std::path::Path) -> Option<String> {
    std::fs::read_to_string(app_version_marker_path(data_dir))
        .ok()
        .map(|s| s.trim().to_string())
}
fn write_app_version_marker(data_dir: &std::path::Path, version: &str) {
    let _ = std::fs::write(app_version_marker_path(data_dir), version);
}

// Re-export commonly used types and functions from submodules so that
// higher layers (commands) can stay relatively stable.
#[allow(unused_imports)]
pub use members::{
    Member, MemberProfile, MemberTxn, MemberPassbook, PassbookEntry,
    add_member, get_member_by_code, update_member, list_members,
    get_member_balance, get_member_outstanding, get_member_profile, set_member_opening_data,
};
#[allow(unused_imports)]
pub use ledger::{
    ShgTransaction, record_receipt, record_voucher, get_shg_balance, get_cash_balance,
    get_bank_balance,
};
#[allow(unused_imports)]
pub use loans::{
    issue_member_loan, record_member_payment, get_member_transactions, MemberTransaction, Loan,
    create_loan, get_member_loans, record_loan_payment, init_loans_table,
};
#[allow(unused_imports)]
pub use chits::{
    ChitGroup, ChitCycle, create_chit_group, add_member_to_chit, create_chit_cycle, get_chit_cycles,
    record_chit_payment,
    get_current_cycle, advance_to_next_cycle, record_member_payment_with_discount, process_winner_payout,
    get_cycle_payment_summary, CyclePaymentSummary,
};
#[allow(unused_imports)]
pub use chits_past_entry::{
    MemberPaymentStatus, ChitCycleDetail, ChitMigrationStatus,
    record_past_chit_cycle, get_member_payment_status, get_chit_cycles_with_details, get_chit_migration_status,
};
#[allow(unused_imports)]
pub use contributions::{record_weekly_contribution, WeeklyContributionInput};
#[allow(unused_imports)]
pub use daybook::{
    DayBookEntry, DayBookSummary, get_day_book_summary, compute_opening_balance,
    get_day_book_entries, compute_totals, filter_by_category, filter_by_type,
    filter_by_member, get_categories,
};