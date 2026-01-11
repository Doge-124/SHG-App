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

"#;
