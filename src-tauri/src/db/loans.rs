//! Member loan issuance and repayments.
//!
//! Financial flows:
//! - Loan issuance: member loan → SHG voucher → member balance increases.
//! - Repayment: member payment → SHG receipt → member balance decreases.

use rusqlite::Connection;
use chrono::Datelike;

use crate::error::AppError;
use crate::db::{ledger, members, validation};

/// Check if a member can participate in loans (SHG or LOAN type)
fn can_take_loans(conn: &Connection, member_id: i64) -> Result<bool, AppError> {
    let mt: String = conn.query_row(
        "SELECT member_type FROM members WHERE id = ?1",
        [member_id],
        |row| row.get(0),
    )?;
    // SHG members can do everything, LOAN members can do loans
    Ok(mt == "SHG" || mt == "LOAN")
}

/// Represents a single repayment recorded against a loan.
#[derive(serde::Serialize)]
pub struct LoanPayment {
    pub id: i64,
    pub loan_id: i64,
    pub member_id: i64,
    pub amount: f64,
    pub payment_method: String,
    pub note: String,
    pub created_at: String,
}

/// Represents an individual loan
#[derive(serde::Serialize)]
pub struct Loan {
    pub id: i64,
    pub member_id: i64,
    pub member_name: Option<String>,
    pub amount: f64,
    pub outstanding_amount: f64,
    pub interest_rate: f64,
    pub daily_interest_rate: f64,
    pub total_repayable: f64,
    pub interest_amount: f64,
    pub upfront_interest_amount: f64,
    pub payment_method: String,
    pub loan_type: String, // 'monthly' or 'weekly'
    pub note: String,
    pub status: String, // 'active', 'paid', 'defaulted'
    pub issued_at: String,
    pub created_at: String,
}

/// Create a new loan.
///
/// The SHG collects the first 30 days of interest at disbursement, but this
/// is income only — it does NOT reduce the principal the borrower owes:
///   upfront_interest = principal × daily_rate% × 30  (monthly)
///                    = principal × daily_rate% × 100 (weekly — full term upfront)
///   outstanding principal = full `amount`
///   cash handed to borrower = `amount − upfront_interest` (they pay the interest immediately)
///   voucher: full principal (money out), receipt: upfront_interest (income).
///
/// Monthly loans are open-ended. Weekly loans have a 100-day term + 20-day grace (120 days total)
/// after which a daily fine accrues (calculated at repayment time, not stored here).
pub fn create_loan(
    conn: &mut Connection,
    member_id: i64,
    amount: f64,
    daily_interest_rate: f64,
    payment_method: &str,
    loan_type: &str,
    note: &str,
    created_at: &str,
) -> Result<i64, AppError> {
    if !can_take_loans(conn, member_id)? {
        return Err(AppError::business(
            "Only SHG and LOAN members can take loans. CHIT members cannot take loans."
        ));
    }
    validation::validate_money_amount(amount)?;

    let upfront_days = if loan_type.to_lowercase() == "weekly" { 100.0 } else { 30.0 };
    let upfront_interest = ((amount * daily_interest_rate / 100.0 * upfront_days) * 100.0).round() / 100.0;
    // Upfront interest is collected as income, NOT deducted from principal.
    // The borrower owes the full principal back, on top of the interest they
    // paid at disbursement.
    let outstanding = amount;

    // Detect whether legacy columns still exist (principal, due_date).
    let has_legacy = {
        let mut stmt = conn.prepare("PRAGMA table_info(loans)")?;
        let cols: Vec<String> = stmt.query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok()).collect();
        cols.contains(&"principal".to_string())
    };

    let mut tx = conn.transaction()?;

    let loan_id: i64 = if has_legacy {
        tx.query_row(
            "INSERT INTO loans
             (member_id, amount, outstanding_amount, interest_rate, daily_interest_rate,
              total_repayable, interest_amount, upfront_interest_amount,
              payment_method, loan_type, note, status, issued_at, created_at,
              principal, due_date)
             VALUES (?1,?2,?3,0,?4,?5,?6,?7,?8,?9,?10,'active',?11,?12,?13,?14)
             RETURNING id",
            (member_id, amount, outstanding, daily_interest_rate, amount,
             upfront_interest, upfront_interest, payment_method, loan_type, note,
             created_at, created_at, amount, created_at),
            |row| row.get(0),
        )?
    } else {
        tx.query_row(
            "INSERT INTO loans
             (member_id, amount, outstanding_amount, interest_rate, daily_interest_rate,
              total_repayable, interest_amount, upfront_interest_amount,
              payment_method, loan_type, note, status, issued_at, created_at)
             VALUES (?1,?2,?3,0,?4,?5,?6,?7,?8,?9,?10,'active',?11,?12)
             RETURNING id",
            (member_id, amount, outstanding, daily_interest_rate, amount,
             upfront_interest, upfront_interest, payment_method, loan_type, note,
             created_at, created_at),
            |row| row.get(0),
        )?
    };

    // Member transaction: loan issued
    tx.execute(
        "INSERT INTO member_transactions (member_id, amount, txn_type, reference_loan_id, created_at)
         VALUES (?1, ?2, 'LOAN', ?3, ?4)",
        (member_id, amount, loan_id, created_at),
    )?;

    // Member balance: +full principal — borrower owes the entire amount.
    tx.execute(
        "INSERT INTO member_balances (member_id, balance) VALUES (?1, ?2)
         ON CONFLICT(member_id) DO UPDATE SET balance = balance + ?2",
        (member_id, amount),
    )?;

    // Upfront interest is income, not a principal reduction. Record it as a
    // SHG receipt and a loan_payments row (principal=0, interest=full upfront).
    // We do NOT touch member_balances or member_transactions for it, because
    // the borrower's principal debt is unchanged by paying interest.
    //
    // Order matters: receipt FIRST so the checked voucher below sees the
    // inflated balance and the net-outflow check is atomic.
    if upfront_interest > 0.0 {
        let upfront_note = "Upfront Interest";
        ledger::record_receipt(
            &mut tx,
            upfront_interest,
            upfront_note,
            payment_method,
            Some("MEMBER_PAYMENT"),
            Some(member_id),
            created_at,
        )?;

        tx.execute(
            "INSERT INTO loan_payments
               (loan_id, member_id, amount, principal_amount, interest_amount,
                payment_method, note, created_at)
             VALUES (?1, ?2, ?3, 0, ?3, ?4, ?5, ?6)",
            (loan_id, member_id, upfront_interest, payment_method, upfront_note, created_at),
        )?;
    }

    // Voucher: full principal disbursed. record_voucher (checked) enforces
    // sufficient balance inside the same transaction.
    let voucher_note = if note.trim().is_empty() { "Loan disbursement".to_string() } else { note.to_string() };
    ledger::record_voucher(
        &mut tx,
        amount,
        &voucher_note,
        payment_method,
        Some("MEMBER_LOAN"),
        Some(member_id),
        created_at,
    )?;

    tx.commit()?;
    Ok(loan_id)
}

/// Get all loans for a member
pub fn get_member_loans(conn: &Connection, member_id: i64) -> Result<Vec<Loan>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, member_id, amount, outstanding_amount, interest_rate,
                COALESCE(daily_interest_rate, 0) as daily_interest_rate,
                total_repayable, interest_amount,
                COALESCE(upfront_interest_amount, 0) as upfront_interest_amount,
                payment_method, loan_type, note, status, issued_at, created_at
         FROM loans
         WHERE member_id = ?1
         ORDER BY issued_at DESC"
    )?;

    let loans = stmt.query_map([member_id], |row| {
        Ok(Loan {
            id: row.get(0)?,
            member_id: row.get(1)?,
            member_name: None,
            amount: row.get(2)?,
            outstanding_amount: row.get(3)?,
            interest_rate: row.get(4)?,
            daily_interest_rate: row.get(5)?,
            total_repayable: row.get(6)?,
            interest_amount: row.get(7)?,
            upfront_interest_amount: row.get(8)?,
            payment_method: row.get(9)?,
            loan_type: row.get(10)?,
            note: row.get(11)?,
            status: row.get(12)?,
            issued_at: row.get(13)?,
            created_at: row.get(14)?,
        })
    })?;

    let mut result = Vec::new();
    for loan in loans {
        result.push(loan?);
    }

    Ok(result)
}

/// Record a historical loan with its full repayment history in one atomic transaction.
/// Used for past data entry (migration from books). Uses unchecked voucher.
pub fn record_past_loan(
    conn: &mut Connection,
    member_id: i64,
    amount: f64,
    daily_interest_rate: f64,
    payment_method: &str,
    loan_type: &str,
    note: &str,
    issued_at: &str,
    repayments: &[(f64, &str, &str)],
) -> Result<i64, AppError> {
    if !can_take_loans(conn, member_id)? {
        return Err(AppError::business("Only SHG and LOAN members can take loans."));
    }
    validation::validate_money_amount(amount)?;
    validation::validate_payment_method(payment_method)?;

    let upfront_days = if loan_type.to_lowercase() == "weekly" { 100.0 } else { 30.0 };
    let upfront_interest = ((amount * daily_interest_rate / 100.0 * upfront_days) * 100.0).round() / 100.0;
    // Outstanding starts at the full principal — upfront interest is income,
    // not a principal reduction. (Matches the live create_loan path.)
    let outstanding_start = amount;

    let has_legacy = {
        let mut stmt = conn.prepare("PRAGMA table_info(loans)")?;
        let cols: Vec<String> = stmt.query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok()).collect();
        cols.contains(&"principal".to_string())
    };

    let mut tx = conn.transaction()?;

    let loan_id: i64 = if has_legacy {
        tx.query_row(
            "INSERT INTO loans
             (member_id, amount, outstanding_amount, interest_rate, daily_interest_rate,
              total_repayable, interest_amount, upfront_interest_amount,
              payment_method, loan_type, note, status, issued_at, created_at,
              is_past_entry, principal, due_date)
             VALUES (?1,?2,?3,0,?4,?5,?6,?7,?8,?9,?10,'active',?11,?12,1,?13,?14)
             RETURNING id",
            (member_id, amount, outstanding_start, daily_interest_rate,
             amount, upfront_interest, upfront_interest,
             payment_method, loan_type, note, issued_at, issued_at, amount, issued_at),
            |row| row.get(0),
        )?
    } else {
        tx.query_row(
            "INSERT INTO loans
             (member_id, amount, outstanding_amount, interest_rate, daily_interest_rate,
              total_repayable, interest_amount, upfront_interest_amount,
              payment_method, loan_type, note, status, issued_at, created_at, is_past_entry)
             VALUES (?1,?2,?3,0,?4,?5,?6,?7,?8,?9,?10,'active',?11,?12,1)
             RETURNING id",
            (member_id, amount, outstanding_start, daily_interest_rate,
             amount, upfront_interest, upfront_interest,
             payment_method, loan_type, note, issued_at, issued_at),
            |row| row.get(0),
        )?
    };

    // 2. Member transaction: LOAN.
    tx.execute(
        "INSERT INTO member_transactions (member_id, amount, txn_type, reference_loan_id, created_at)
         VALUES (?1, ?2, 'LOAN', ?3, ?4)",
        (member_id, amount, loan_id, issued_at),
    )?;

    // 3. Member balance: +amount.
    tx.execute(
        "INSERT INTO member_balances (member_id, balance) VALUES (?1, ?2)
         ON CONFLICT(member_id) DO UPDATE SET balance = balance + ?2",
        (member_id, amount),
    )?;

    // 4. Past data entry: no SHG voucher — disbursement is reference-only.
    // The SHG opening balance (set in Settings) already accounts for historical funds.

    // 4b. Record upfront interest as a loan_payments row only (reference for
    // the interest collected at disbursement). It does NOT touch member
    // balances — the borrower's principal owed isn't reduced by interest.
    if upfront_interest > 0.0 {
        tx.execute(
            "INSERT INTO loan_payments
               (loan_id, member_id, amount, principal_amount, interest_amount,
                payment_method, note, created_at)
             VALUES (?1, ?2, ?3, 0, ?3, ?4, 'Upfront Interest', ?5)",
            (loan_id, member_id, upfront_interest, payment_method, issued_at),
        )?;
    }

    // 5. Process each repayment in chronological order.
    let mut outstanding = outstanding_start;
    for (rep_amount, rep_method, rep_date) in repayments {
        validation::validate_money_amount(*rep_amount)?;
        validation::validate_payment_method(rep_method)?;

        let applied = rep_amount.min(outstanding);
        outstanding -= applied;
        let status = if outstanding <= 0.01 { "paid" } else { "active" };

        // Update loan.
        tx.execute(
            "UPDATE loans SET outstanding_amount = ?1, status = ?2 WHERE id = ?3",
            (outstanding, status, loan_id),
        )?;

        // loan_payments row. Past entries are treated as principal-only —
        // historical interest income was lost in migration anyway.
        tx.execute(
            "INSERT INTO loan_payments
               (loan_id, member_id, amount, principal_amount, interest_amount,
                payment_method, note, created_at)
             VALUES (?1, ?2, ?3, ?3, 0, ?4, ?5, ?6)",
            (loan_id, member_id, applied, rep_method, "Loan Repayment", rep_date),
        )?;

        // Member transaction: PAYMENT.
        tx.execute(
            "INSERT INTO member_transactions (member_id, amount, txn_type, reference_loan_id, created_at)
             VALUES (?1, ?2, 'PAYMENT', ?3, ?4)",
            (member_id, -applied, loan_id, rep_date),
        )?;

        // Member balance: -applied.
        tx.execute(
            "INSERT INTO member_balances (member_id, balance) VALUES (?1, ?2)
             ON CONFLICT(member_id) DO UPDATE SET balance = balance - ?2",
            (member_id, applied),
        )?;
        // No SHG receipt — past repayments are reference-only and do not affect SHG balance.
    }

    tx.commit()?;
    Ok(loan_id)
}

/// Record a payment towards a specific loan.
///
/// `interest_amount` is the accrued daily interest portion of the payment
/// (calculated on the frontend from issued_at, daily_rate, and days elapsed).
/// Only the principal portion (`amount - interest_amount`) reduces outstanding.
/// The full `amount` is received by the SHG and recorded as a receipt.
pub fn record_loan_payment(
    conn: &mut Connection,
    loan_id: i64,
    amount: f64,
    interest_amount: f64,
    payment_method: &str,
    note: &str,
    created_at: &str,
) -> Result<(), AppError> {
    validation::validate_money_amount(amount)?;
    validation::validate_payment_method(payment_method)?;

    // Sanity bounds on the caller-supplied interest split. We don't try to
    // re-derive the "true" interest server-side (that needs days-elapsed
    // logic the frontend owns), but we refuse obviously bad inputs.
    if !interest_amount.is_finite() || interest_amount < 0.0 {
        return Err(AppError::validation("interest_amount must be >= 0"));
    }
    if interest_amount > amount + 0.005 {
        return Err(AppError::validation("interest_amount cannot exceed payment amount"));
    }

    let mut tx = conn.transaction()?;

    let (member_id, outstanding_amount, status): (i64, f64, String) = tx.query_row(
        "SELECT member_id, outstanding_amount, status FROM loans WHERE id = ?1",
        [loan_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;

    if status == "paid" {
        return Err(AppError::business("This loan has already been fully repaid"));
    }

    // Only the principal portion reduces the outstanding balance. Anything
    // beyond outstanding is treated as interest-on-top (overpayment of the
    // declared interest), so the live outstanding stays consistent with
    // SUM(loan_payments.principal_amount).
    let principal_paid    = (amount - interest_amount).max(0.0).min(outstanding_amount);
    let interest_recorded = amount - principal_paid;
    let new_outstanding   = outstanding_amount - principal_paid;
    let new_status        = if new_outstanding <= 0.01 { "paid" } else { "active" };

    tx.execute(
        "UPDATE loans SET outstanding_amount = ?1, status = ?2 WHERE id = ?3",
        (new_outstanding, new_status, loan_id),
    )?;

    let receipt_note = note.to_string();

    tx.execute(
        "INSERT INTO member_transactions (member_id, amount, txn_type, reference_loan_id, created_at)
         VALUES (?1, ?2, 'PAYMENT', ?3, ?4)",
        (member_id, -principal_paid, loan_id, created_at),
    )?;

    tx.execute(
        "INSERT INTO member_balances (member_id, balance) VALUES (?1, ?2)
         ON CONFLICT(member_id) DO UPDATE SET balance = balance - ?2",
        (member_id, principal_paid),
    )?;

    tx.execute(
        "INSERT INTO loan_payments
           (loan_id, member_id, amount, principal_amount, interest_amount,
            payment_method, note, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        (loan_id, member_id, amount, principal_paid, interest_recorded,
         payment_method, &receipt_note, created_at),
    )?;

    ledger::record_receipt(
        &mut tx,
        amount,
        &receipt_note,
        payment_method,
        Some("MEMBER_PAYMENT"),
        Some(member_id),
        created_at,
    )?;

    tx.commit()?;
    Ok(())
}

/// Fetch a single loan by its ID, joining member name.
pub fn get_loan_by_id(conn: &Connection, loan_id: i64) -> Result<Option<Loan>, AppError> {
    let result = conn.query_row(
        "SELECT l.id, l.member_id, l.amount, l.outstanding_amount, l.interest_rate,
                COALESCE(l.daily_interest_rate, 0) as daily_interest_rate,
                l.total_repayable, l.interest_amount,
                COALESCE(l.upfront_interest_amount, 0) as upfront_interest_amount,
                l.payment_method, l.loan_type, l.note, l.status, l.issued_at, l.created_at,
                m.name
         FROM loans l
         JOIN members m ON l.member_id = m.id
         WHERE l.id = ?1",
        [loan_id],
        |row| {
            Ok(Loan {
                id: row.get(0)?,
                member_id: row.get(1)?,
                amount: row.get(2)?,
                outstanding_amount: row.get(3)?,
                interest_rate: row.get(4)?,
                daily_interest_rate: row.get(5)?,
                total_repayable: row.get(6)?,
                interest_amount: row.get(7)?,
                upfront_interest_amount: row.get(8)?,
                payment_method: row.get(9)?,
                loan_type: row.get(10)?,
                note: row.get(11)?,
                status: row.get(12)?,
                issued_at: row.get(13)?,
                created_at: row.get(14)?,
                member_name: row.get(15)?,
            })
        },
    );
    match result {
        Ok(loan) => Ok(Some(loan)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::database(e.to_string())),
    }
}

/// Get all repayments recorded for a specific loan.
pub fn get_repayments_for_loan(conn: &Connection, loan_id: i64) -> Result<Vec<LoanPayment>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, loan_id, member_id, amount, payment_method, note, created_at
         FROM loan_payments
         WHERE loan_id = ?1
         ORDER BY created_at ASC",
    )?;

    let rows = stmt.query_map([loan_id], |row| {
        Ok(LoanPayment {
            id: row.get(0)?,
            loan_id: row.get(1)?,
            member_id: row.get(2)?,
            amount: row.get(3)?,
            payment_method: row.get(4)?,
            note: row.get(5)?,
            created_at: row.get(6)?,
        })
    })?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

/// Initialize the loans table if it doesn't exist (for existing databases)
pub fn init_loans_table(conn: &mut Connection) -> Result<(), AppError> {
    // Check if table exists first
    let table_exists: bool = conn.query_row(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='loans'",
        [],
        |_row| Ok(true),
    ).unwrap_or(false);
    
    if !table_exists {
        conn.execute(
            "CREATE TABLE loans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                member_id INTEGER NOT NULL,
                amount REAL NOT NULL,
                outstanding_amount REAL NOT NULL,
                interest_rate REAL NOT NULL DEFAULT 0,
                total_repayable REAL NOT NULL DEFAULT 0,
                interest_amount REAL NOT NULL DEFAULT 0,
                payment_method TEXT NOT NULL CHECK (payment_method IN ('CASH', 'BANK')),
                note TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL CHECK (status IN ('active', 'paid', 'defaulted')) DEFAULT 'active',
                issued_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (member_id) REFERENCES members(id)
            )",
            [],
        )?;
    } else {
        // Check if columns exist and add missing ones
        let mut stmt = conn.prepare("PRAGMA table_info(loans)")?;
        let columns = stmt.query_map([], |row| {
            let name: String = row.get(1)?;
            Ok(name)
        })?;
        
        let mut column_names = Vec::new();
        for column in columns {
            column_names.push(column?);
        }
        
        // Check and add each missing column individually
        let required_columns = vec![
            ("amount", "REAL DEFAULT 0"),
            ("outstanding_amount", "REAL DEFAULT 0"),
            ("interest_rate", "REAL DEFAULT 0"),
            ("total_repayable", "REAL DEFAULT 0"),
            ("interest_amount", "REAL DEFAULT 0"),
            ("payment_method", "TEXT DEFAULT 'CASH'"),
            ("loan_type", "TEXT DEFAULT 'monthly'"),
            ("note", "TEXT DEFAULT ''"),
            ("status", "TEXT DEFAULT 'active'"),
            ("issued_at", "TEXT DEFAULT ''"),
            ("created_at", "TEXT DEFAULT ''"),
        ];
        
        for (column_name, column_def) in required_columns {
            if !column_names.contains(&column_name.to_string()) {
                conn.execute(&format!("ALTER TABLE loans ADD COLUMN {} {}", column_name, column_def), [])?;
            }
        }
    }
    
    Ok(())
}

/// Get all member transactions (loans and payments)
#[allow(dead_code)]
pub fn get_member_transactions(conn: &mut Connection) -> Result<Vec<MemberTransaction>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT mt.id, mt.member_id, mt.amount, mt.txn_type, mt.created_at, m.name as member_name
         FROM member_transactions mt
         JOIN members m ON mt.member_id = m.id
         ORDER BY mt.created_at DESC"
    )?;

    let transactions = stmt.query_map([], |row| {
        Ok(MemberTransaction {
            id: row.get(0)?,
            member_id: row.get(1)?,
            amount: row.get(2)?,
            txn_type: row.get(3)?,
            created_at: row.get(4)?,
            member_name: row.get(5)?,
        })
    })?;

    let mut result = Vec::new();
    for transaction in transactions {
        result.push(transaction?);
    }

    Ok(result)
}

/// Represents a member transaction (loan or payment)
#[derive(serde::Serialize)]
#[allow(dead_code)]
pub struct MemberTransaction {
    pub id: i64,
    pub member_id: i64,
    pub amount: f64,
    pub txn_type: String, // 'LOAN' or 'PAYMENT'
    pub created_at: String,
    pub member_name: String,
}

/// Issue a loan to a member and record all effects atomically.
#[allow(dead_code)]
pub fn issue_member_loan(
    conn: &mut Connection,
    member_id: i64,
    amount: f64,
    payment_method: &str,
    note: &str,
    created_at: &str,
) -> Result<(), AppError> {
    validation::validate_money_amount(amount)?;
    validation::validate_payment_method(payment_method)?;

    // Prevent double-spend: ensure the SHG has enough balance.
    let available = ledger::get_shg_balance(conn, payment_method)?;
    if available + 1e-6 < amount {
        return Err(AppError::business(format!(
            "insufficient SHG {payment_method} balance for loan (available={available}, requested={amount})"
        )));
    }

    let mut tx = conn.transaction()?;

    // 1. Member transaction
    tx.execute(
        "INSERT INTO member_transactions (member_id, amount, txn_type, created_at)
         VALUES (?1, ?2, 'LOAN', ?3)",
        (member_id, amount, created_at),
    )?;

    // 2. Update member balance cache (create entry if it doesn't exist)
    tx.execute(
        "INSERT INTO member_balances (member_id, balance) VALUES (?1, ?2) 
         ON CONFLICT(member_id) DO UPDATE SET balance = balance + ?2",
        (member_id, amount),
    )?;

    // 3. SHG voucher (money goes out)
    ledger::record_voucher(
        &mut tx,
        amount,
        note,
        payment_method,
        Some("MEMBER_LOAN"),
        Some(member_id),
        created_at,
    )?;

    tx.commit()?;

    // Post-condition: balance cache must still match the transaction sum.
    let _ = members::get_member_outstanding(conn, member_id)?;

    Ok(())
}

/// Record a payment towards a member loan and update ledger + balances.
#[allow(dead_code)]
pub fn record_member_payment(
    conn: &mut Connection,
    member_id: i64,
    amount: f64,
    payment_method: &str,
    note: &str,
    created_at: &str,
) -> Result<(), AppError> {
    validation::validate_money_amount(amount)?;
    validation::validate_payment_method(payment_method)?;

    // Prevent over-payment: cannot pay more than outstanding.
    let outstanding = members::get_member_outstanding(conn, member_id)?;
    if amount - outstanding > 0.01 {
        return Err(AppError::business(format!(
            "payment exceeds outstanding balance (outstanding={outstanding}, payment={amount})"
        )));
    }

    let mut tx = conn.transaction()?;

    // 1. Member transaction (payments are stored as negative amounts)
    tx.execute(
        "INSERT INTO member_transactions (member_id, amount, txn_type, created_at)
         VALUES (?1, ?2, 'PAYMENT', ?3)",
        (member_id, -amount, created_at),
    )?;

    // 2. Update member balance cache (create entry if it doesn't exist)
    tx.execute(
        "INSERT INTO member_balances (member_id, balance) VALUES (?1, ?2) 
         ON CONFLICT(member_id) DO UPDATE SET balance = balance - ?2",
        (member_id, amount),
    )?;

    // 3. SHG receipt (money comes in)
    ledger::record_receipt(
        &mut tx,
        amount,
        note,
        payment_method,
        Some("MEMBER_PAYMENT"),
        Some(member_id),
        created_at,
    )?;

    tx.commit()?;

    // Validate the balance invariant after the commit.
    let _ = members::get_member_outstanding(conn, member_id)?;

    Ok(())
}

// ─── Repayment Schedule ───────────────────────────────────────────────────────

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleEntry {
    pub date: String,
    pub label: String,
    pub entry_type: String,  // "issued" | "monthly" | "upfront_end" | "due_date" | "today" | "payment"
    pub days_elapsed: i64,
    pub days_after_upfront: i64,
    pub interest_accrued: f64,   // cumulative since upfront period ended
    pub projected_outstanding: f64,
    pub daily_interest: f64,
    pub is_past: bool,
    pub is_overdue: bool,
    // populated for "payment" entries
    pub payment_amount: f64,
    pub payment_method: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoanRepaymentSchedule {
    pub loan_id: i64,
    pub member_name: String,
    pub principal: f64,
    pub daily_rate: f64,
    pub daily_interest: f64,
    pub loan_type: String,
    pub issued_at: String,
    pub upfront_days: i64,
    pub upfront_end_date: String,
    pub upfront_interest: f64,
    pub outstanding_at_issue: f64,
    pub due_date: Option<String>,
    pub current_outstanding: f64,
    pub total_repaid: f64,
    pub status: String,
    pub entries: Vec<ScheduleEntry>,
}

/// Add N calendar months to a NaiveDate, clamping to the last day of the target month.
fn add_months(date: chrono::NaiveDate, n: u32) -> chrono::NaiveDate {
    let mut month = date.month() + n;
    let mut year  = date.year() + ((month - 1) / 12) as i32;
    month = ((month - 1) % 12) + 1;
    let last_day  = chrono::NaiveDate::from_ymd_opt(year, month + 1, 1)
        .unwrap_or_else(|| chrono::NaiveDate::from_ymd_opt(year + 1, 1, 1).unwrap())
        - chrono::Duration::days(1);
    let day = date.day().min(last_day.day());
    chrono::NaiveDate::from_ymd_opt(year, month, day).unwrap_or(last_day)
}

pub fn get_loan_repayment_schedule(
    conn: &Connection,
    loan_id: i64,
) -> Result<LoanRepaymentSchedule, AppError> {
    // ── Fetch loan ────────────────────────────────────────────────────────
    let loan = get_loan_by_id(conn, loan_id)?
        .ok_or_else(|| AppError::business("Loan not found"))?;

    let principal   = loan.amount;
    let daily_rate  = loan.daily_interest_rate;
    let daily_int   = (principal * daily_rate / 100.0 * 100.0).round() / 100.0;
    let upfront_int = loan.upfront_interest_amount;
    // Upfront interest is income, not a principal reduction — outstanding
    // at issue equals the full principal owed.
    let outstanding_at_issue = principal;

    let upfront_days: i64 = if loan.loan_type == "weekly" { 100 } else { 30 };

    let issued_date = chrono::NaiveDate::parse_from_str(&loan.issued_at[..10], "%Y-%m-%d")
        .map_err(|_| AppError::business("Invalid issued_at date"))?;
    let upfront_end = issued_date + chrono::Duration::days(upfront_days);
    let due_date_nd = if loan.loan_type == "weekly" {
        Some(issued_date + chrono::Duration::days(120))
    } else {
        None
    };
    let today = chrono::Local::now().date_naive();

    // ── Fetch repayments ──────────────────────────────────────────────────
    let mut pay_stmt = conn.prepare(
        "SELECT amount, payment_method, created_at FROM loan_payments
         WHERE loan_id = ?1 ORDER BY created_at ASC"
    )?;
    let payments: Vec<(f64, String, chrono::NaiveDate)> = pay_stmt
        .query_map([loan_id], |r| {
            let date_str: String = r.get(2)?;
            Ok((r.get(0)?, r.get(1)?,
                chrono::NaiveDate::parse_from_str(&date_str[..10], "%Y-%m-%d")
                    .unwrap_or(today)))
        })?
        .filter_map(|r| r.ok())
        .collect();

    let total_repaid: f64 = payments.iter().map(|(a, _, _)| a).sum();

    // ── Build date set ────────────────────────────────────────────────────
    // Monthly snapshots from issued_date for max(today + 3 months, due_date + 3 months, 12 months)
    let horizon = {
        let mut h = add_months(issued_date, 12);
        if let Some(dd) = due_date_nd { h = h.max(dd + chrono::Duration::days(90)); }
        h = h.max(add_months(today, 3));
        h
    };

    // (date, entry_type, label)
    let mut events: Vec<(chrono::NaiveDate, &str, String)> = vec![
        (issued_date, "issued", "Loan Issued".to_string()),
        (upfront_end, "upfront_end",
         format!("Upfront Period Ends ({} days)", upfront_days)),
    ];

    // Monthly markers
    let mut cursor = add_months(issued_date, 1);
    let mut month_n: u32 = 1;
    while cursor <= horizon {
        events.push((cursor, "monthly", format!("Month {}", month_n)));
        cursor = add_months(issued_date, month_n + 1);
        month_n += 1;
    }

    // Due date (weekly only)
    if let Some(dd) = due_date_nd {
        events.push((dd, "due_date", "Due Date".to_string()));
    }

    // Today marker (only if after issued date)
    if today > issued_date {
        events.push((today, "today", "Today".to_string()));
    }

    // Payment events
    for (amt, method, date) in &payments {
        events.push((*date, "payment",
            format!("Repayment ({})", method.to_lowercase())));
    }

    // Sort by date, then by type priority (payments before same-day markers)
    events.sort_by(|(da, ta, _), (db, tb, _)| {
        da.cmp(db).then_with(|| {
            let rank = |t: &&str| match *t {
                "payment" => 0, "issued" => 1, _ => 2
            };
            rank(&ta).cmp(&rank(tb))
        })
    });

    // ── Build entries ──────────────────────────────────────────────────────
    let mut entries: Vec<ScheduleEntry> = Vec::new();

    for (date, entry_type, label) in &events {
        let days_elapsed = (*date - issued_date).num_days();
        let days_after   = (days_elapsed - upfront_days).max(0);
        let accrued      = (days_after as f64 * daily_int * 100.0).round() / 100.0;
        let projected    = outstanding_at_issue + accrued;
        let is_past      = *date <= today;
        let is_overdue   = due_date_nd.map_or(false, |dd| *date > dd && is_past);

        let (pay_amount, pay_method) = if *entry_type == "payment" {
            // Find the corresponding payment
            let p = payments.iter().find(|(_, _, d)| d == date);
            p.map(|(a, m, _)| (*a, m.clone())).unwrap_or((0.0, String::new()))
        } else {
            (0.0, String::new())
        };

        entries.push(ScheduleEntry {
            date: date.to_string(),
            label: label.clone(),
            entry_type: entry_type.to_string(),
            days_elapsed,
            days_after_upfront: days_after,
            interest_accrued: accrued,
            projected_outstanding: projected,
            daily_interest: daily_int,
            is_past,
            is_overdue,
            payment_amount: pay_amount,
            payment_method: pay_method,
        });
    }

    Ok(LoanRepaymentSchedule {
        loan_id,
        member_name: loan.member_name.unwrap_or_default(),
        principal,
        daily_rate,
        daily_interest: daily_int,
        loan_type: loan.loan_type.clone(),
        issued_at: loan.issued_at[..10].to_string(),
        upfront_days,
        upfront_end_date: upfront_end.to_string(),
        upfront_interest: upfront_int,
        outstanding_at_issue,
        due_date: due_date_nd.map(|d| d.to_string()),
        current_outstanding: loan.outstanding_amount,
        total_repaid,
        status: loan.status,
        entries,
    })
}

