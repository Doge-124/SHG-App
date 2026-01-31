pub const SCHEMA_SQL: &str = r#"
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    joined_at TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1
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
    txn_type TEXT NOT NULL CHECK (txn_type IN ('RECEIPT', 'VOUCHER')),
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
    txn_type TEXT NOT NULL CHECK (txn_type IN ('LOAN', 'PAYMENT')),
    reference_txn_id INTEGER,
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


"#;
