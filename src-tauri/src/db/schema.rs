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
    -- Comma-separated role set (e.g. "SHG" or "CHIT,LOAN"); validated in code.
    member_type TEXT NOT NULL DEFAULT 'SHG'
);

-- (Legacy minimal loans/payments/receipts tables removed — superseded by the
-- richer `loans` and `loan_payments` definitions below. They were unreachable
-- because `CREATE TABLE IF NOT EXISTS` skipped the second definition on fresh
-- installs, leaving the wrong schema. Old installs still have these tables
-- around (untouched, ignored) — they hold no data the app reads.)

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
    created_at TEXT NOT NULL,
    voided_at INTEGER,
    voided_reason TEXT,
    reversal_of_id INTEGER,
    bank_txn_id TEXT,
    group_id TEXT,
    member_ref_id INTEGER
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
    reference_loan_id INTEGER,
    reference_chit_cycle_id INTEGER,
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
    total_members INTEGER NOT NULL DEFAULT 0,
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
    payment_method TEXT NOT NULL CHECK (payment_method IN ('CASH', 'BANK', 'MIXED')),
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
    principal_amount REAL NOT NULL DEFAULT 0,
    interest_amount  REAL NOT NULL DEFAULT 0,
    payment_method TEXT NOT NULL CHECK (payment_method IN ('CASH', 'BANK', 'MIXED')),
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    is_past_entry INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (loan_id) REFERENCES loans(id),
    FOREIGN KEY (member_id) REFERENCES members(id)
);

-- Fixed-asset register (office, computer, furniture, etc.). funding_method
-- 'OPENING' = already owned before using the app (no cash movement). Purchases
-- (CASH/BANK) create an ASSET_PURCHASE voucher recorded in voucher_ref_id.
CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Other',
    purchase_date TEXT NOT NULL,
    cost REAL NOT NULL,
    supplier TEXT,
    location TEXT,
    reference_no TEXT,
    note TEXT,
    funding_method TEXT NOT NULL DEFAULT 'OPENING' CHECK (funding_method IN ('CASH','BANK','OPENING')),
    is_opening INTEGER NOT NULL DEFAULT 0,
    voucher_ref_id INTEGER,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISPOSED')),
    disposed_at TEXT,
    disposal_amount REAL,
    disposal_method TEXT,
    created_at TEXT NOT NULL
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
    // Pre-transaction repairs (parent-table surgery needs foreign_keys OFF, which
    // is a no-op inside a transaction, so these run before the main tx):
    // 1) Repair any child foreign keys left dangling at `members_old` by an
    //    earlier interrupted rebuild.
    repair_members_old_refs(conn)?;
    // 2) Drop the legacy single-role CHECK on members.member_type if present.
    drop_member_type_check_pre_tx(conn)?;

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

    // 4) Add member_type column to members table. member_type is now a
    // comma-separated ROLE SET (e.g. "CHIT,LOAN"), validated in code — no CHECK.
    add_column_if_missing(&tx, "members", "member_type", "TEXT NOT NULL DEFAULT 'SHG'")?;
    // (The legacy single-role CHECK, if any, was already dropped pre-transaction
    // by drop_member_type_check_pre_tx above.)

    // 5) Drop member_roles table if it exists (replaced by member_type column)
    tx.execute_batch("DROP TABLE IF EXISTS member_roles;")?;

    // 6a) Add past_data_locked flag to settings table — only if the table already
    //     exists (on a brand-new DB, init_settings_table hasn't run yet so the
    //     column is added there instead; see db/settings.rs CREATE TABLE).
    let settings_exists: bool = tx.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='settings'",
        [],
        |row| row.get(0),
    ).unwrap_or(0) > 0;
    if settings_exists {
        add_column_if_missing(&tx, "settings", "past_data_locked", "INTEGER NOT NULL DEFAULT 0")?;
    }

    // 6b) Add details column to audit_log (may not exist on older DBs).
    add_column_if_missing(&tx, "audit_log", "details", "TEXT")?;
    tx.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log(timestamp);"
    )?;

    // 6c) Add total_members to chit_groups — independent from `months` (cycles).
    // For old rows where it doesn't exist, default to the same value as months
    // so existing chits keep working.
    add_column_if_missing(&tx, "chit_groups", "total_members", "INTEGER NOT NULL DEFAULT 0")?;
    tx.execute_batch(
        "UPDATE chit_groups SET total_members = months WHERE total_members = 0;"
    )?;

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

    // 8) Configurable chit fund: winners per cycle, commission, fixed prize, eligibility tracking.
    add_column_if_missing(&tx, "chit_groups", "winners_per_cycle", "INTEGER NOT NULL DEFAULT 1")?;
    add_column_if_missing(&tx, "chit_groups", "commission_per_winner", "REAL NOT NULL DEFAULT 0")?;
    add_column_if_missing(&tx, "chit_groups", "fixed_prize_amount", "REAL NOT NULL DEFAULT 0")?;
    add_column_if_missing(&tx, "chit_cycles", "auction_discount_per_member", "REAL NOT NULL DEFAULT 0")?;
    add_column_if_missing(&tx, "chit_cycles", "total_bid_discounts", "REAL NOT NULL DEFAULT 0")?;
    add_column_if_missing(&tx, "chit_cycles", "admin_discount_override", "REAL")?;

    tx.execute_batch(r#"
        CREATE TABLE IF NOT EXISTS chit_cycle_winners (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chit_id INTEGER NOT NULL,
            cycle_id INTEGER NOT NULL,
            member_id INTEGER NOT NULL,
            winner_type TEXT NOT NULL CHECK (winner_type IN ('FIXED','AUCTION')),
            bid_discount REAL NOT NULL DEFAULT 0,
            commission REAL NOT NULL DEFAULT 0,
            payout_amount REAL NOT NULL,
            payment_method TEXT NOT NULL CHECK (payment_method IN ('CASH','BANK')),
            paid_at TEXT NOT NULL,
            FOREIGN KEY (chit_id) REFERENCES chit_groups(id),
            FOREIGN KEY (cycle_id) REFERENCES chit_cycles(id),
            FOREIGN KEY (member_id) REFERENCES members(id),
            UNIQUE (chit_id, member_id)
        );
        CREATE TABLE IF NOT EXISTS chit_member_eligibility (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chit_id INTEGER NOT NULL,
            cycle_id INTEGER NOT NULL,
            member_id INTEGER NOT NULL,
            is_eligible INTEGER NOT NULL DEFAULT 1,
            admin_override INTEGER NOT NULL DEFAULT 0,
            override_reason TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (chit_id) REFERENCES chit_groups(id),
            FOREIGN KEY (cycle_id) REFERENCES chit_cycles(id),
            FOREIGN KEY (member_id) REFERENCES members(id),
            UNIQUE (chit_id, cycle_id, member_id)
        );
        CREATE INDEX IF NOT EXISTS idx_chit_winners_cycle ON chit_cycle_winners(cycle_id);
        CREATE INDEX IF NOT EXISTS idx_chit_eligibility ON chit_member_eligibility(chit_id, cycle_id);
    "#)?;

    // 9) SHG opening balance columns on the settings table.
    if settings_exists {
        add_column_if_missing(&tx, "settings", "shg_opening_cash", "REAL NOT NULL DEFAULT 0")?;
        add_column_if_missing(&tx, "settings", "shg_opening_bank", "REAL NOT NULL DEFAULT 0")?;
        add_column_if_missing(&tx, "settings", "shg_opening_locked", "INTEGER NOT NULL DEFAULT 0")?;
        // 18) Weekly installment tracker. The "current installment number" is the
        // expected count as of today; it equals the anchor number plus the number
        // of whole weeks elapsed since it was set, so it auto-increments by one
        // per week without any scheduled job. 0 = not configured.
        add_column_if_missing(&tx, "settings", "installment_anchor_number", "INTEGER NOT NULL DEFAULT 0")?;
        add_column_if_missing(&tx, "settings", "installment_anchor_date", "TEXT")?;
        // Automatic cloud backup (email) config — JSON blob, NULL until set up.
        add_column_if_missing(&tx, "settings", "cloud_backup_settings", "TEXT")?;
    }

    // 9) Daily interest rate and upfront interest for new loan logic.
    add_column_if_missing(&tx, "loans", "daily_interest_rate", "REAL NOT NULL DEFAULT 0")?;
    add_column_if_missing(&tx, "loans", "upfront_interest_amount", "REAL NOT NULL DEFAULT 0")?;

    // 9b) interest_paid_through — the date (YYYY-MM-DD) up to which interest is
    // settled. Daily accrual only counts days AFTER this date. The SHG's
    // upfront interest covers the first `upfront_days`, so for a fresh loan
    // this starts at issued_at + upfront_days (matching interest_start_date).
    // Borrowers can voluntarily prepay a month, which pushes this forward and
    // stops interest accruing until then. Backfill existing loans to that same
    // baseline (30d monthly / 100d weekly after issue) so behaviour is
    // unchanged for in-flight loans.
    let added_paid_through = add_column_if_missing(&tx, "loans", "interest_paid_through", "TEXT")?;
    if added_paid_through {
        tx.execute_batch(r#"
            UPDATE loans
            SET interest_paid_through = date(substr(issued_at,1,10), '+' ||
                CASE WHEN lower(loan_type) = 'weekly' THEN 100 ELSE 30 END || ' days')
            WHERE interest_paid_through IS NULL;
        "#)?;
    }

    // 10) Split loan_payments.amount into principal_amount + interest_amount so
    // financial reports can compute interest income correctly. Legacy rows
    // backfilled as principal=amount, interest=0 (matches the prior buggy
    // behaviour where reports showed Rs 0 interest historically). Upfront
    // interest rows are detected by note and corrected to principal=0.
    let added_principal = add_column_if_missing(&tx, "loan_payments", "principal_amount", "REAL NOT NULL DEFAULT 0")?;
    let added_interest  = add_column_if_missing(&tx, "loan_payments", "interest_amount",  "REAL NOT NULL DEFAULT 0")?;
    if added_principal || added_interest {
        tx.execute_batch(r#"
            UPDATE loan_payments SET principal_amount = amount, interest_amount = 0;
            UPDATE loan_payments SET principal_amount = 0, interest_amount = amount
                WHERE note = 'Upfront Interest';
        "#)?;
    }

    // 11) Reference columns on member_transactions so past-data deletions can
    // cleanly reverse derived ledger rows without fragile (member+date+amount)
    // matching. Populated by all loan/chit write paths going forward;
    // legacy rows backfilled by best-effort matching below.
    let added_loan_ref = add_column_if_missing(&tx, "member_transactions", "reference_loan_id",       "INTEGER")?;
    let added_chit_ref = add_column_if_missing(&tx, "member_transactions", "reference_chit_cycle_id", "INTEGER")?;

    if added_loan_ref {
        // LOAN entries: one per loan, identified by member_id + amount + created_at.
        tx.execute_batch(r#"
            UPDATE member_transactions AS mt
            SET reference_loan_id = (
                SELECT l.id FROM loans l
                WHERE l.member_id = mt.member_id
                  AND ABS(l.amount - mt.amount) < 0.005
                  AND l.issued_at = mt.created_at
                LIMIT 1
            )
            WHERE mt.txn_type = 'LOAN' AND mt.reference_loan_id IS NULL;
        "#)?;
        // PAYMENT entries: match by loan_payments row via member+created_at+amount.
        // member_transactions stores -principal_amount; loan_payments stores principal_amount.
        tx.execute_batch(r#"
            UPDATE member_transactions AS mt
            SET reference_loan_id = (
                SELECT lp.loan_id FROM loan_payments lp
                WHERE lp.member_id = mt.member_id
                  AND lp.created_at = mt.created_at
                  AND ABS(lp.principal_amount + mt.amount) < 0.005
                LIMIT 1
            )
            WHERE mt.txn_type = 'PAYMENT' AND mt.reference_loan_id IS NULL;
        "#)?;
    }

    if added_chit_ref {
        // Chit installments and payouts haven't been touching member_transactions yet
        // (chits are reference-only on the member ledger), so no backfill needed.
        // The column exists for future use and consistency.
    }

    // 15) Recompute member_balances as SAVINGS only (OPENING + CONTRIBUTION).
    // Prior loan write-paths added LOAN principal to member_balances and
    // subtracted PAYMENT principal, conflating debt with savings. This one-shot
    // recompute rewrites the cache to match the live integrity invariant
    // (which now also excludes LOAN/PAYMENT). Idempotent — running again on
    // already-correct data is a no-op.
    tx.execute_batch(r#"
        INSERT INTO member_balances (member_id, balance)
            SELECT m.id, 0 FROM members m
            WHERE NOT EXISTS (SELECT 1 FROM member_balances WHERE member_id = m.id);
        UPDATE member_balances
        SET balance = COALESCE((
            SELECT SUM(amount) FROM member_transactions mt
            WHERE mt.member_id = member_balances.member_id
              AND mt.txn_type IN ('OPENING','CONTRIBUTION')
        ), 0);
    "#)?;

    // 14) Voiding for shg_transactions. Cancellation marks the original
    // row voided and inserts a paired reversing entry (txn_type flipped,
    // reversal_of_id pointing back). Both rows remain in the ledger for
    // audit; balance queries sum normally and the pair nets to zero.
    add_column_if_missing(&tx, "shg_transactions", "voided_at",      "INTEGER")?;
    add_column_if_missing(&tx, "shg_transactions", "voided_reason",  "TEXT")?;
    add_column_if_missing(&tx, "shg_transactions", "reversal_of_id", "INTEGER")?;
    tx.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_shg_tx_reversal ON shg_transactions(reversal_of_id);"
    )?;

    // 16) Bank transaction IDs + mixed-payment grouping.
    //  - bank_txn_id: optional bank reference (UTR/cheque no.) captured for any
    //    BANK-method row, used later for bank reconciliation + the Bank Book
    //    "print transaction IDs" report.
    //  - group_id: a shared UUID linking the CASH + BANK halves of one mixed
    //    payment so the UI can present them as a single logical receipt and
    //    cancellation can reverse both halves together.
    add_column_if_missing(&tx, "shg_transactions", "bank_txn_id", "TEXT")?;
    add_column_if_missing(&tx, "shg_transactions", "group_id",    "TEXT")?;
    tx.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_shg_tx_group ON shg_transactions(group_id);"
    )?;
    // member_ref_id: the specific member a row is FOR, when reference_id can't
    // identify them. Chit payout/commission rows reference the cycle (reference_id
    // = cycle_id, relied on by cancellation), but a cycle can have several winners
    // (multi-winner + closing cycles), so the member name can't be derived from
    // the cycle alone. This pins the exact member for name resolution. NULL on
    // older rows, which fall back to the cycle's winning_member_id.
    add_column_if_missing(&tx, "shg_transactions", "member_ref_id", "INTEGER")?;
    // Mixed-payment split recorded on the derived rows (display only — the
    // authoritative cash/bank split lives on the two shg_transactions rows).
    add_column_if_missing(&tx, "loan_payments", "cash_amount", "REAL")?;
    add_column_if_missing(&tx, "loan_payments", "bank_amount", "REAL")?;
    add_column_if_missing(&tx, "chit_payments", "cash_amount", "REAL")?;
    add_column_if_missing(&tx, "chit_payments", "bank_amount", "REAL")?;

    // 16b) Mixed payments write a single derived row with payment_method='MIXED'
    // (the authoritative cash/bank split lives on the two shg_transactions rows).
    // Older DBs have a CHECK that only allows CASH/BANK, which rejects the insert
    // with a constraint error. Rebuild those tables to widen the CHECK. Runs after
    // the cash_amount/bank_amount columns above so the rebuilt table is complete.
    rebuild_loan_payments_if_needed(&tx)?;
    rebuild_chit_payments_if_needed(&tx)?;

    // Flag loan_payments rows that belong to past-data (reference-only) entries so
    // their interest is never counted as SHG income. Added AFTER the rebuild above
    // (which recreates loan_payments with a fixed column set) so it isn't dropped.
    add_column_if_missing(&tx, "loan_payments", "is_past_entry", "INTEGER NOT NULL DEFAULT 0")?;
    // Flag/repair is_past_entry so ONLY genuine reference-data payments are excluded
    // from income. A payment is "live" (real cash) iff it has a matching MEMBER_PAYMENT
    // receipt (same member + created_at); reference/past-data payments have none.
    //
    // A prior blanket backfill wrongly flagged EVERY payment on a past loan as past —
    // including live repayments made against a past loan, dropping their (real) interest
    // from income and breaking the balance sheet. These two idempotent statements set
    // the flag correctly regardless of history.
    //   1) genuine past-data payments (on a past loan, no receipt) → is_past_entry = 1
    //   2) live repayments (have a receipt) → is_past_entry = 0
    tx.execute_batch(
        "UPDATE loan_payments SET is_past_entry = 1
         WHERE loan_id IN (SELECT id FROM loans WHERE COALESCE(is_past_entry, 0) = 1)
           AND NOT EXISTS (
               SELECT 1 FROM shg_transactions s
               WHERE s.reference_type = 'MEMBER_PAYMENT'
                 AND s.reference_id = loan_payments.member_id
                 AND s.created_at = loan_payments.created_at
                 AND s.voided_at IS NULL AND s.reversal_of_id IS NULL
           );
         UPDATE loan_payments SET is_past_entry = 0
         WHERE is_past_entry = 1
           AND EXISTS (
               SELECT 1 FROM shg_transactions s
               WHERE s.reference_type = 'MEMBER_PAYMENT'
                 AND s.reference_id = loan_payments.member_id
                 AND s.created_at = loan_payments.created_at
                 AND s.voided_at IS NULL AND s.reversal_of_id IS NULL
           );"
    )?;

    // 13) Loan unpaid-interest balance — tracks interest that has accrued
    // but not been paid yet (e.g. when the borrower made a partial payment
    // that didn't cover all due interest). The next payment will eat into
    // this balance first before any principal reduction.
    add_column_if_missing(&tx, "loans", "unpaid_interest_balance", "REAL NOT NULL DEFAULT 0")?;

    // 12) is_past_entry markers — let admin-gated deletes know which rows
    // came from past-data entry (safe to remove) vs live activity (would
    // orphan SHG ledger rows). Backfill: any pre-existing row without a
    // matching SHG ledger entry is assumed to be a past entry.
    let added_loan_past = add_column_if_missing(&tx, "loans", "is_past_entry", "INTEGER NOT NULL DEFAULT 0")?;
    let added_cycle_past = add_column_if_missing(&tx, "chit_cycles", "is_past_entry", "INTEGER NOT NULL DEFAULT 0")?;

    if added_loan_past {
        // A live loan creates an shg_transaction with reference_type='MEMBER_LOAN'
        // at created_at = loan.issued_at and amount = loan.amount. Past loans
        // don't. Match conservatively (member_id implied via amount equality
        // tolerance).
        tx.execute_batch(r#"
            UPDATE loans SET is_past_entry = 1
            WHERE NOT EXISTS (
                SELECT 1 FROM shg_transactions s
                WHERE s.reference_type = 'MEMBER_LOAN'
                  AND s.created_at = loans.issued_at
                  AND ABS(s.amount - loans.amount) < 0.005
            );
        "#)?;
    }

    if added_cycle_past {
        // A live cycle has CHIT_PAYMENT / CHIT_PAYOUT / CHIT_COMMISSION SHG
        // entries referencing its id.
        tx.execute_batch(r#"
            UPDATE chit_cycles SET is_past_entry = 1
            WHERE NOT EXISTS (
                SELECT 1 FROM shg_transactions s
                WHERE s.reference_type IN ('CHIT_PAYMENT','CHIT_PAYOUT','CHIT_COMMISSION')
                  AND s.reference_id = chit_cycles.id
            );
        "#)?;
    }

    // 7) Ensure indexes exist for performance.
    // 17) Per-(member, chit) passbook number. This is the physical chit
    // passbook ID used for drawing lots / selecting winners, distinct from
    // the member_code. One per membership row, manually entered.
    add_column_if_missing(&tx, "chit_members", "passbook_number", "TEXT")?;

    // Guarantors for loans and chit memberships (optional, up to 2 each).
    // scope = 'LOAN' (ref_id = loans.id) or 'CHIT_MEMBER' (ref_id = chit_members.id).
    // guarantor_type: SELF (the borrower/member), MEMBER (another SHG member, by
    // guarantor_member_id), or OTHER (free-text name + details).
    tx.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS guarantors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scope TEXT NOT NULL CHECK (scope IN ('LOAN','CHIT_MEMBER')),
            ref_id INTEGER NOT NULL,
            slot INTEGER NOT NULL CHECK (slot IN (1,2)),
            guarantor_type TEXT NOT NULL CHECK (guarantor_type IN ('SELF','MEMBER','OTHER')),
            guarantor_member_id INTEGER,
            guarantor_name TEXT,
            guarantor_details TEXT,
            created_at TEXT NOT NULL,
            UNIQUE (scope, ref_id, slot)
        );
        CREATE INDEX IF NOT EXISTS idx_guarantors_ref ON guarantors(scope, ref_id);
        "#,
    )?;

    // Fixed-asset register (see SCHEMA_SQL for column docs).
    tx.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS assets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT 'Other',
            purchase_date TEXT NOT NULL,
            cost REAL NOT NULL,
            supplier TEXT,
            location TEXT,
            reference_no TEXT,
            note TEXT,
            funding_method TEXT NOT NULL DEFAULT 'OPENING' CHECK (funding_method IN ('CASH','BANK','OPENING')),
            is_opening INTEGER NOT NULL DEFAULT 0,
            voucher_ref_id INTEGER,
            status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISPOSED')),
            disposed_at TEXT,
            disposal_amount REAL,
            disposal_method TEXT,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
        "#,
    )?;

    tx.execute_batch(
        r#"
        CREATE INDEX IF NOT EXISTS idx_member_code ON members(member_code);
        CREATE INDEX IF NOT EXISTS idx_member_tx_member ON member_transactions(member_id);
        CREATE INDEX IF NOT EXISTS idx_member_tx_loan_ref ON member_transactions(reference_loan_id);
        CREATE INDEX IF NOT EXISTS idx_shg_tx_date ON shg_transactions(created_at);
        CREATE INDEX IF NOT EXISTS idx_chit_cycle ON chit_cycles(chit_id, cycle_no);
        "#,
    )?;

    tx.commit()?;
    Ok(())
}

/// Repair child foreign-key references left dangling at `members_old` by an
/// earlier interrupted members rebuild (which renamed members → members_old,
/// rewriting child FKs, then dropped members_old). Rewrites the stored schema
/// text back to `members` in one shot via writable_schema. No-op when clean.
fn repair_members_old_refs(conn: &Connection) -> Result<(), AppError> {
    let cnt: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE sql LIKE '%members_old%'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if cnt == 0 {
        return Ok(());
    }

    conn.execute_batch("PRAGMA foreign_keys=OFF;")?;
    conn.execute_batch("PRAGMA writable_schema=ON;")?;
    let res = conn.execute_batch(
        "UPDATE sqlite_master SET sql = replace(sql, 'members_old', 'members') \
         WHERE sql LIKE '%members_old%';",
    );
    // Reload the corrected schema into memory.
    let _ = conn.execute_batch("PRAGMA writable_schema=RESET;");
    conn.execute_batch("PRAGMA writable_schema=OFF;")?;
    conn.execute_batch("PRAGMA foreign_keys=ON;")?;
    res?;
    Ok(())
}

/// Drop the legacy single-role CHECK on `members.member_type` so it can hold a
/// comma-separated ROLE SET (e.g. "CHIT,LOAN"). Idempotent: skips when the CHECK
/// is already gone. `members` is a parent table referenced by foreign keys, so the
/// rebuild must run with foreign-key enforcement OFF (otherwise the RENAME/DROP
/// fail). foreign_keys can only be toggled outside a transaction, so this runs in
/// its own explicit transaction before the main migration tx. All columns and the
/// member_code index are preserved; rows (and ids) are copied verbatim.
fn drop_member_type_check_pre_tx(conn: &Connection) -> Result<(), AppError> {
    let sql: String = match conn.query_row(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='members'",
        [],
        |r| r.get(0),
    ) {
        Ok(s) => s,
        Err(_) => return Ok(()), // members table doesn't exist yet (fresh DB)
    };
    if !sql.contains("member_type IN ('SHG', 'CHIT', 'LOAN')") {
        return Ok(());
    }

    let new_create = sql
        .replace(" CHECK(member_type IN ('SHG', 'CHIT', 'LOAN'))", "")
        .replace("CHECK(member_type IN ('SHG', 'CHIT', 'LOAN'))", "");

    let cols: Vec<String> = {
        let mut stmt = conn.prepare("PRAGMA table_info(members)")?;
        let v = stmt
            .query_map([], |r| r.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect();
        v
    };
    let col_list = cols.join(", ");

    // foreign_keys OFF: allow renaming/dropping a table other tables reference.
    // legacy_alter_table ON: stop the RENAME from rewriting those child tables'
    // foreign-key references to point at members_old (which would dangle once it's
    // dropped). Together they let us rebuild the parent table cleanly; children
    // keep referencing "members", which we recreate with the same ids.
    conn.execute_batch("PRAGMA foreign_keys=OFF;")?;
    conn.execute_batch("PRAGMA legacy_alter_table=ON;")?;
    let res = conn.execute_batch(&format!(
        "BEGIN;\n\
         ALTER TABLE members RENAME TO members_old;\n\
         {new_create};\n\
         INSERT INTO members ({col_list}) SELECT {col_list} FROM members_old;\n\
         DROP TABLE members_old;\n\
         CREATE INDEX IF NOT EXISTS idx_member_code ON members(member_code);\n\
         COMMIT;"
    ));
    if res.is_err() {
        let _ = conn.execute_batch("ROLLBACK;");
    }
    // Restore defaults for the rest of the session.
    conn.execute_batch("PRAGMA legacy_alter_table=OFF;")?;
    conn.execute_batch("PRAGMA foreign_keys=ON;")?;
    res?;
    Ok(())
}

/// Returns true if the column was added, false if it already existed.
fn add_column_if_missing(
    tx: &rusqlite::Transaction,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<bool, AppError> {
    let mut stmt = tx.prepare(&format!("PRAGMA table_info({table})"))?;
    let cols = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for c in cols {
        if c? == column {
            return Ok(false);
        }
    }

    tx.execute_batch(&format!(
        "ALTER TABLE {table} ADD COLUMN {column} {definition};"
    ))?;
    Ok(true)
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

/// Widen loan_payments.payment_method CHECK to allow 'MIXED'. Idempotent: skips
/// when the table already permits it. Preserves all rows and ids.
fn rebuild_loan_payments_if_needed(tx: &rusqlite::Transaction) -> Result<(), AppError> {
    let sql = table_sql(tx, "loan_payments")?.unwrap_or_default();
    if sql.contains("'MIXED'") {
        return Ok(());
    }

    tx.execute_batch(
        r#"
        ALTER TABLE loan_payments RENAME TO loan_payments_old;

        CREATE TABLE loan_payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            loan_id INTEGER NOT NULL,
            member_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            principal_amount REAL NOT NULL DEFAULT 0,
            interest_amount  REAL NOT NULL DEFAULT 0,
            payment_method TEXT NOT NULL CHECK (payment_method IN ('CASH', 'BANK', 'MIXED')),
            note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            cash_amount REAL,
            bank_amount REAL,
            FOREIGN KEY (loan_id) REFERENCES loans(id),
            FOREIGN KEY (member_id) REFERENCES members(id)
        );

        INSERT INTO loan_payments
            (id, loan_id, member_id, amount, principal_amount, interest_amount,
             payment_method, note, created_at, cash_amount, bank_amount)
        SELECT id, loan_id, member_id, amount, principal_amount, interest_amount,
               payment_method, note, created_at, cash_amount, bank_amount
        FROM loan_payments_old;

        DROP TABLE loan_payments_old;
        "#,
    )?;

    Ok(())
}

/// Widen chit_payments.payment_method CHECK to allow 'MIXED'. Idempotent: skips
/// when the table already permits it. Preserves all rows and ids.
fn rebuild_chit_payments_if_needed(tx: &rusqlite::Transaction) -> Result<(), AppError> {
    let sql = table_sql(tx, "chit_payments")?.unwrap_or_default();
    if sql.contains("'MIXED'") {
        return Ok(());
    }

    tx.execute_batch(
        r#"
        ALTER TABLE chit_payments RENAME TO chit_payments_old;

        CREATE TABLE chit_payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chit_id INTEGER NOT NULL,
            cycle_id INTEGER NOT NULL,
            member_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            payment_method TEXT NOT NULL CHECK (payment_method IN ('CASH', 'BANK', 'MIXED')),
            paid_at TEXT NOT NULL,
            cash_amount REAL,
            bank_amount REAL,
            FOREIGN KEY (chit_id) REFERENCES chit_groups(id),
            FOREIGN KEY (cycle_id) REFERENCES chit_cycles(id),
            FOREIGN KEY (member_id) REFERENCES members(id),
            UNIQUE (cycle_id, member_id)
        );

        INSERT INTO chit_payments
            (id, chit_id, cycle_id, member_id, amount, payment_method, paid_at,
             cash_amount, bank_amount)
        SELECT id, chit_id, cycle_id, member_id, amount, payment_method, paid_at,
               cash_amount, bank_amount
        FROM chit_payments_old;

        DROP TABLE chit_payments_old;
        "#,
    )?;

    Ok(())
}
