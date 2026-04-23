pub const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    joined_at TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    opening_balance REAL NOT NULL DEFAULT 0.0,
    opening_balance_method TEXT CHECK(opening_balance_method IN ('CASH','BANK')) DEFAULT NULL,
    opening_balance_set_at TEXT DEFAULT NULL,
    past_installments INTEGER NOT NULL DEFAULT 0,
    current_installments INTEGER NOT NULL DEFAULT 0,
    member_type TEXT NOT NULL DEFAULT 'SHG' CHECK(member_type IN ('SHG', 'CHIT', 'LOAN'))
);

CREATE TABLE IF NOT EXISTS loans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    principal REAL NOT NULL,
    interest_rate REAL NOT NULL,
    issued_at TEXT NOT NULL,
    due_date TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    FOREIGN KEY (member_id) REFERENCES members(id)
);

CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    loan_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    paid_at TEXT NOT NULL,
    receipt_no TEXT NOT NULL UNIQUE,
    FOREIGN KEY (loan_id) REFERENCES loans(id)
);

CREATE TABLE IF NOT EXISTS receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_no TEXT NOT NULL UNIQUE,
    member_id INTEGER NOT NULL,
    loan_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    generated_at TEXT NOT NULL,
    FOREIGN KEY (member_id) REFERENCES members(id),
    FOREIGN KEY (loan_id) REFERENCES loans(id)
);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id INTEGER,
    timestamp TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS member_balances (
    member_id INTEGER PRIMARY KEY,
    balance REAL NOT NULL DEFAULT 0,
    FOREIGN KEY (member_id) REFERENCES members(id)
);

CREATE TABLE IF NOT EXISTS shg_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    txn_type TEXT NOT NULL CHECK (txn_type IN ('RECEIPT', 'VOUCHER', 'OPENING')),
    amount REAL NOT NULL,
    reason TEXT NOT NULL,
    payment_method TEXT NOT NULL CHECK (payment_method IN ('CASH', 'BANK')),
    reference_type TEXT,
    reference_id INTEGER,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shg_balances (
    method TEXT PRIMARY KEY CHECK (method IN ('CASH', 'BANK')),
    balance REAL NOT NULL
);

INSERT OR IGNORE INTO shg_balances (method, balance) VALUES
('CASH', 0),
('BANK', 0);


CREATE TABLE IF NOT EXISTS member_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    txn_type TEXT NOT NULL CHECK (txn_type IN ('LOAN', 'PAYMENT', 'OPENING', 'CONTRIBUTION')),
    reason TEXT NOT NULL DEFAULT '',
    reference_txn_id INTEGER,
    created_at TEXT NOT NULL,
    FOREIGN KEY (member_id) REFERENCES members(id)
);

CREATE TABLE IF NOT EXISTS loans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    outstanding_amount REAL NOT NULL,
    interest_rate REAL NOT NULL DEFAULT 0,
    total_repayable REAL NOT NULL,
    interest_amount REAL NOT NULL DEFAULT 0,
    payment_method TEXT NOT NULL CHECK (payment_method IN ('CASH', 'BANK')),
    loan_type TEXT NOT NULL CHECK (loan_type IN ('monthly', 'weekly')) DEFAULT 'monthly',
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('active', 'paid', 'defaulted')) DEFAULT 'active',
    issued_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (member_id) REFERENCES members(id)
);


CREATE TABLE IF NOT EXISTS chit_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    total_amount REAL NOT NULL,
    months INTEGER NOT NULL,
    monthly_contribution REAL NOT NULL,
    commission_percent REAL NOT NULL,
    start_date TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'CLOSED'))
);


CREATE TABLE IF NOT EXISTS chit_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chit_id INTEGER NOT NULL,
    member_id INTEGER NOT NULL,
    joined_at TEXT NOT NULL,
    FOREIGN KEY (chit_id) REFERENCES chit_groups(id),
    FOREIGN KEY (member_id) REFERENCES members(id),
    UNIQUE (chit_id, member_id)
);


CREATE TABLE IF NOT EXISTS chit_cycles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chit_id INTEGER NOT NULL,
    cycle_no INTEGER NOT NULL,
    auction_date TEXT NOT NULL,
    winning_member_id INTEGER,
    bid_discount REAL DEFAULT 0,
    payout_amount REAL NOT NULL,
    FOREIGN KEY (chit_id) REFERENCES chit_groups(id),
    FOREIGN KEY (winning_member_id) REFERENCES members(id),
    UNIQUE (chit_id, cycle_no)
);


CREATE TABLE IF NOT EXISTS chit_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chit_id INTEGER NOT NULL,
    cycle_id INTEGER NOT NULL,
    member_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    payment_method TEXT NOT NULL CHECK (payment_method IN ('CASH', 'BANK')),
    paid_at TEXT NOT NULL,
    FOREIGN KEY (chit_id) REFERENCES chit_groups(id),
    FOREIGN KEY (cycle_id) REFERENCES chit_cycles(id),
    FOREIGN KEY (member_id) REFERENCES members(id),
    UNIQUE (cycle_id, member_id)
);

CREATE TABLE IF NOT EXISTS loan_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    loan_id INTEGER NOT NULL,
    member_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    payment_method TEXT NOT NULL CHECK (payment_method IN ('CASH', 'BANK')),
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    FOREIGN KEY (loan_id) REFERENCES loans(id),
    FOREIGN KEY (member_id) REFERENCES members(id)
);

-- Indexes to support common access patterns
-- Fast lookup of a member by their code (login / search).
CREATE INDEX IF NOT EXISTS idx_member_code ON members(member_code);
-- Efficient retrieval of all transactions for a member.
CREATE INDEX IF NOT EXISTS idx_member_tx_member ON member_transactions(member_id);
-- Support date-range and reporting queries over the ledger.
CREATE INDEX IF NOT EXISTS idx_shg_tx_date ON shg_transactions(created_at);
-- Fast lookup of a specific chit cycle within a group.
CREATE INDEX IF NOT EXISTS idx_chit_cycle ON chit_cycles(chit_id, cycle_no);
-- Fast repayment lookup by loan.
CREATE INDEX IF NOT EXISTS idx_loan_payments_loan ON loan_payments(loan_id);


"#;

use rusqlite::Connection;

use crate::error::AppError;

/// Apply non-destructive migrations to an existing database.
///
/// This is required because `SCHEMA_SQL` only runs on first database creation.
/// Production databases must be migrated forward without data loss.
pub fn apply_migrations(conn: &mut Connection) -> Result<(), AppError> {
    let tx = conn.transaction()?;

    // 1) Add member opening data columns if missing.
    add_column_if_missing(&tx, "members", "opening_balance", "REAL NOT NULL DEFAULT 0.0")?;
    add_column_if_missing(
        &tx,
        "members",
        "opening_balance_method",
        "TEXT CHECK(opening_balance_method IN ('CASH','BANK')) DEFAULT NULL",
    )?;
    add_column_if_missing(&tx, "members", "opening_balance_set_at", "TEXT DEFAULT NULL")?;
    add_column_if_missing(&tx, "members", "past_installments", "INTEGER NOT NULL DEFAULT 0")?;
    add_column_if_missing(&tx, "members", "current_installments", "INTEGER NOT NULL DEFAULT 0")?;

    // 2) Add member_transactions.reason if missing (needed for OPENING entry).
    add_column_if_missing(&tx, "member_transactions", "reason", "TEXT NOT NULL DEFAULT ''")?;

    // 3) Extend CHECK constraints for txn_type to include OPENING by rebuilding tables if needed.
    rebuild_shg_transactions_if_needed(&tx)?;
    rebuild_member_transactions_if_needed(&tx)?;

    // 4) Add member_type column to members table
    add_column_if_missing(&tx, "members", "member_type", "TEXT NOT NULL DEFAULT 'SHG' CHECK(member_type IN ('SHG', 'CHIT', 'LOAN'))")?;
    
    // 5) Drop member_roles table if it exists (replaced by member_type column)
    tx.execute_batch("DROP TABLE IF EXISTS member_roles;")?;

    // 6) Create loan_payments table for per-loan repayment history.
    tx.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS loan_payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            loan_id INTEGER NOT NULL,
            member_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            payment_method TEXT NOT NULL CHECK (payment_method IN ('CASH', 'BANK')),
            note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            FOREIGN KEY (loan_id) REFERENCES loans(id),
            FOREIGN KEY (member_id) REFERENCES members(id)
        );
        CREATE INDEX IF NOT EXISTS idx_loan_payments_loan ON loan_payments(loan_id);
        "#,
    )?;

    // 7) Ensure indexes exist for performance.
    tx.execute_batch(
        r#"
        CREATE INDEX IF NOT EXISTS idx_member_code ON members(member_code);
        CREATE INDEX IF NOT EXISTS idx_member_tx_member ON member_transactions(member_id);
        CREATE INDEX IF NOT EXISTS idx_shg_tx_date ON shg_transactions(created_at);
        CREATE INDEX IF NOT EXISTS idx_chit_cycle ON chit_cycles(chit_id, cycle_no);
        "#,
    )?;

    tx.commit()?;
    Ok(())
}

fn add_column_if_missing(
    tx: &rusqlite::Transaction,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), AppError> {
    let mut stmt = tx.prepare(&format!("PRAGMA table_info({table})"))?;
    let cols = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for c in cols {
        if c? == column {
            return Ok(());
        }
    }

    tx.execute_batch(&format!(
        "ALTER TABLE {table} ADD COLUMN {column} {definition};"
    ))?;
    Ok(())
}

fn table_sql(tx: &rusqlite::Transaction, table: &str) -> Result<Option<String>, AppError> {
    let sql: Option<String> = tx.query_row(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [table],
        |row| row.get(0),
    )?;
    Ok(sql)
}

fn rebuild_shg_transactions_if_needed(tx: &rusqlite::Transaction) -> Result<(), AppError> {
    let sql = table_sql(tx, "shg_transactions")?.unwrap_or_default();
    if sql.contains("'OPENING'") {
        return Ok(());
    }

    tx.execute_batch(
        r#"
        ALTER TABLE shg_transactions RENAME TO shg_transactions_old;

        CREATE TABLE shg_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            txn_type TEXT NOT NULL CHECK (txn_type IN ('RECEIPT', 'VOUCHER', 'OPENING')),
            amount REAL NOT NULL,
            reason TEXT NOT NULL,
            payment_method TEXT NOT NULL CHECK (payment_method IN ('CASH', 'BANK')),
            reference_type TEXT,
            reference_id INTEGER,
            created_at TEXT NOT NULL
        );

        INSERT INTO shg_transactions (id, txn_type, amount, reason, payment_method, reference_type, reference_id, created_at)
        SELECT id, txn_type, amount, reason, payment_method, reference_type, reference_id, created_at
        FROM shg_transactions_old;

        DROP TABLE shg_transactions_old;
        "#,
    )?;

    Ok(())
}

fn rebuild_member_transactions_if_needed(tx: &rusqlite::Transaction) -> Result<(), AppError> {
    let sql = table_sql(tx, "member_transactions")?.unwrap_or_default();
    if sql.contains("'OPENING'") && sql.contains("reason") {
        return Ok(());
    }

    // We rebuild both to update txn_type CHECK and ensure `reason` exists.
    tx.execute_batch(
        r#"
        ALTER TABLE member_transactions RENAME TO member_transactions_old;

        CREATE TABLE member_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            member_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            txn_type TEXT NOT NULL CHECK (txn_type IN ('LOAN', 'PAYMENT', 'OPENING', 'CONTRIBUTION')),
            reason TEXT NOT NULL DEFAULT '',
            reference_txn_id INTEGER,
            created_at TEXT NOT NULL,
            FOREIGN KEY (member_id) REFERENCES members(id)
        );

        INSERT INTO member_transactions (id, member_id, amount, txn_type, reason, reference_txn_id, created_at)
        SELECT id,
               member_id,
               amount,
               txn_type,
               COALESCE(reason, ''),
               reference_txn_id,
               created_at
        FROM member_transactions_old;

        DROP TABLE member_transactions_old;
        "#,
    )?;

    Ok(())
}
