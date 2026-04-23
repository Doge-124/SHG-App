//! Member loan issuance and repayments.
//!
//! Financial flows:
//! - Loan issuance: member loan → SHG voucher → member balance increases.
//! - Repayment: member payment → SHG receipt → member balance decreases.

use rusqlite::Connection;

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
    pub total_repayable: f64,
    pub interest_amount: f64,
    pub payment_method: String,
    pub loan_type: String, // 'monthly' or 'weekly'
    pub note: String,
    pub status: String, // 'active', 'paid', 'defaulted'
    pub issued_at: String,
    pub created_at: String,
}

/// Create a new loan record with interest calculation
/// 
/// Interest calculation:
/// - Weekly loans: 12 week term, interest = amount * (rate/100) * (12/52)
/// - Monthly loans: 12 month term, interest = amount * (rate/100) * (12/12) = amount * (rate/100)
pub fn create_loan(
    conn: &mut Connection,
    member_id: i64,
    amount: f64,
    interest_rate: f64,
    payment_method: &str,
    loan_type: &str,
    note: &str,
    created_at: &str,
) -> Result<i64, AppError> {
    // Check if member can take loans (must be SHG or LOAN type)
    if !can_take_loans(conn, member_id)? {
        return Err(AppError::business(
            "Only SHG and LOAN members can take loans. CHIT members cannot take loans."
        ));
    }

    // Calculate interest based on loan type
    // Standard term: 12 weeks for weekly loans, 12 months for monthly loans
    let interest_amount = if loan_type == "weekly" {
        // Weekly: 12 week term, interest = principal * rate * (12/52)
        amount * (interest_rate / 100.0) * (12.0 / 52.0)
    } else {
        // Monthly: 12 month term, interest = principal * rate * (12/12) = principal * rate
        amount * (interest_rate / 100.0)
    };

    let total_repayable = amount + interest_amount;

    // Check if the table has the old structure (principal, interest_rate, due_date) before transaction
    let (has_old_structure, has_loan_type, has_principal) = {
        let mut stmt = conn.prepare("PRAGMA table_info(loans)")?;
        let columns = stmt.query_map([], |row| {
            let name: String = row.get(1)?;
            Ok(name)
        })?;
        
        let mut column_names = Vec::new();
        for column in columns {
            column_names.push(column?);
        }
        
        // Check if loan_type column exists (new structure) or if it's truly old structure
        let has_loan_type = column_names.contains(&"loan_type".to_string());
        let has_principal = column_names.contains(&"principal".to_string());
        
        // Use new structure if loan_type column exists, even if principal also exists
        // Only use old structure if loan_type doesn't exist but principal does
        let has_old_structure = has_principal && !has_loan_type;
        
        (has_old_structure, has_loan_type, has_principal)
    };
    
    // Check if principal column exists before starting transaction
    let principal_exists = {
        let mut stmt = conn.prepare("PRAGMA table_info(loans)")?;
        let columns = stmt.query_map([], |row| {
            let name: String = row.get(1)?;
            Ok(name)
        })?;
        
        let mut column_names = Vec::new();
        for column in columns {
            column_names.push(column?);
        }
        
        column_names.contains(&"principal".to_string())
    };
    
    let mut tx = conn.transaction()?;

    // Create the loan record based on table structure
    let loan_id = if has_old_structure {
        // Old table structure - provide values for old columns
        tx.query_row(
            "INSERT INTO loans (member_id, principal, interest_rate, issued_at, due_date, status, amount, outstanding_amount, payment_method, loan_type, note, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?7, ?8, ?9, ?10, ?11) RETURNING id",
            (member_id, amount, interest_rate, created_at, created_at, amount, total_repayable, payment_method, loan_type, note, created_at),
            |row| row.get(0),
        )?
    } else {
        // New table structure - check if principal column still exists and provide value if needed
        if principal_exists {
            // Hybrid structure - new columns plus old principal column with NOT NULL constraint
            tx.query_row(
                "INSERT INTO loans (member_id, amount, outstanding_amount, interest_rate, total_repayable, interest_amount, payment_method, loan_type, note, status, issued_at, created_at, principal, due_date)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'active', ?10, ?11, ?12, ?13) RETURNING id",
                (member_id, amount, total_repayable, interest_rate, total_repayable, interest_amount, payment_method, loan_type, note, created_at, created_at, amount, created_at),
                |row| row.get(0),
            )?
        } else {
            // Pure new structure
            tx.query_row(
                "INSERT INTO loans (member_id, amount, outstanding_amount, interest_rate, total_repayable, interest_amount, payment_method, loan_type, note, status, issued_at, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'active', ?10, ?11) RETURNING id",
                (member_id, amount, total_repayable, interest_rate, total_repayable, interest_amount, payment_method, loan_type, note, created_at, created_at),
                |row| row.get(0),
            )?
        }
    };

    // 2. Create member transaction
    tx.execute(
        "INSERT INTO member_transactions (member_id, amount, txn_type, created_at)
         VALUES (?1, ?2, 'LOAN', ?3)",
        (member_id, amount, created_at),
    )?;

    // 3. Update member balance cache
    tx.execute(
        "INSERT INTO member_balances (member_id, balance) VALUES (?1, ?2) 
         ON CONFLICT(member_id) DO UPDATE SET balance = balance + ?2",
        (member_id, amount),
    )?;

    // 4. SHG voucher (money goes out)
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
    Ok(loan_id)
}

/// Get all loans for a member
pub fn get_member_loans(conn: &Connection, member_id: i64) -> Result<Vec<Loan>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, member_id, amount, outstanding_amount, interest_rate, total_repayable, interest_amount, payment_method, loan_type, note, status, issued_at, created_at
         FROM loans 
         WHERE member_id = ?1 
         ORDER BY issued_at DESC"
    )?;

    let loans = stmt.query_map([member_id], |row| {
        Ok(Loan {
            id: row.get(0)?,
            member_id: row.get(1)?,
            member_name: None, // This function doesn't join with members table
            amount: row.get(2)?,
            outstanding_amount: row.get(3)?,
            interest_rate: row.get(4)?,
            total_repayable: row.get(5)?,
            interest_amount: row.get(6)?,
            payment_method: row.get(7)?,
            loan_type: row.get(8)?,
            note: row.get(9)?,
            status: row.get(10)?,
            issued_at: row.get(11)?,
            created_at: row.get(12)?,
        })
    })?;

    let mut result = Vec::new();
    for loan in loans {
        result.push(loan?);
    }

    Ok(result)
}

/// Record a historical loan with its full repayment history in one atomic transaction.
///
/// Used for past data entry (migration from books). Uses unchecked voucher so the
/// SHG balance check is bypassed for the historical disbursement.
///
/// Interest calculation is identical to create_loan:
/// - Weekly  (12-week term): interest = amount × (rate/100) × (12/52)
/// - Monthly (12-month term): interest = amount × (rate/100)
pub fn record_past_loan(
    conn: &mut Connection,
    member_id: i64,
    amount: f64,
    interest_rate: f64,
    payment_method: &str,
    loan_type: &str,
    note: &str,
    issued_at: &str,
    repayments: &[(f64, &str, &str)], // (amount, payment_method, paid_at)
) -> Result<i64, AppError> {
    if !can_take_loans(conn, member_id)? {
        return Err(AppError::business(
            "Only SHG and LOAN members can take loans.",
        ));
    }

    validation::validate_money_amount(amount)?;
    validation::validate_payment_method(payment_method)?;

    let interest_amount = if loan_type.to_lowercase() == "weekly" {
        amount * (interest_rate / 100.0) * (12.0 / 52.0)
    } else {
        amount * (interest_rate / 100.0)
    };
    let total_repayable = amount + interest_amount;

    // Detect table structure (same logic as create_loan).
    let (has_new_columns, principal_exists) = {
        let mut stmt = conn.prepare("PRAGMA table_info(loans)")?;
        let cols: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect();
        (
            cols.contains(&"outstanding_amount".to_string()),
            cols.contains(&"principal".to_string()),
        )
    };

    let mut tx = conn.transaction()?;

    // 1. Insert loan record.
    let loan_id: i64 = if has_new_columns {
        if principal_exists {
            tx.query_row(
                "INSERT INTO loans
                 (member_id, amount, outstanding_amount, interest_rate, total_repayable,
                  interest_amount, payment_method, loan_type, note, status, issued_at, created_at,
                  principal, due_date)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'active',?10,?11,?12,?13)
                 RETURNING id",
                (member_id, amount, total_repayable, interest_rate, total_repayable,
                 interest_amount, payment_method, loan_type, note, issued_at, issued_at,
                 amount, issued_at),
                |row| row.get(0),
            )?
        } else {
            tx.query_row(
                "INSERT INTO loans
                 (member_id, amount, outstanding_amount, interest_rate, total_repayable,
                  interest_amount, payment_method, loan_type, note, status, issued_at, created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'active',?10,?11)
                 RETURNING id",
                (member_id, amount, total_repayable, interest_rate, total_repayable,
                 interest_amount, payment_method, loan_type, note, issued_at, issued_at),
                |row| row.get(0),
            )?
        }
    } else {
        tx.query_row(
            "INSERT INTO loans
             (member_id, principal, interest_rate, issued_at, due_date, status,
              amount, outstanding_amount, payment_method, loan_type, note, created_at)
             VALUES (?1,?2,?3,?4,?5,'active',?6,?7,?8,?9,?10,?11)
             RETURNING id",
            (member_id, amount, interest_rate, issued_at, issued_at,
             amount, total_repayable, payment_method, loan_type, note, issued_at),
            |row| row.get(0),
        )?
    };

    // 2. Member transaction: LOAN.
    tx.execute(
        "INSERT INTO member_transactions (member_id, amount, txn_type, created_at)
         VALUES (?1, ?2, 'LOAN', ?3)",
        (member_id, amount, issued_at),
    )?;

    // 3. Member balance: +amount.
    tx.execute(
        "INSERT INTO member_balances (member_id, balance) VALUES (?1, ?2)
         ON CONFLICT(member_id) DO UPDATE SET balance = balance + ?2",
        (member_id, amount),
    )?;

    // 4. SHG voucher (unchecked — historical disbursement).
    ledger::record_voucher_unchecked(
        &mut tx,
        amount,
        &format!("{} (past data entry)", note),
        payment_method,
        Some("MEMBER_LOAN"),
        Some(member_id),
        issued_at,
    )?;

    // 5. Process each repayment in chronological order.
    let mut outstanding = total_repayable;
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

        // loan_payments row.
        tx.execute(
            "INSERT INTO loan_payments (loan_id, member_id, amount, payment_method, note, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            (loan_id, member_id, applied, rep_method, "Past loan repayment", rep_date),
        )?;

        // Member transaction: PAYMENT.
        tx.execute(
            "INSERT INTO member_transactions (member_id, amount, txn_type, created_at)
             VALUES (?1, ?2, 'PAYMENT', ?3)",
            (member_id, -applied, rep_date),
        )?;

        // Member balance: -applied.
        tx.execute(
            "INSERT INTO member_balances (member_id, balance) VALUES (?1, ?2)
             ON CONFLICT(member_id) DO UPDATE SET balance = balance - ?2",
            (member_id, applied),
        )?;

        // SHG receipt.
        ledger::record_receipt(
            &mut tx,
            applied,
            "Past loan repayment",
            rep_method,
            Some("MEMBER_PAYMENT"),
            Some(member_id),
            rep_date,
        )?;
    }

    tx.commit()?;
    Ok(loan_id)
}

/// Record a payment towards a specific loan and update its outstanding amount
pub fn record_loan_payment(
    conn: &mut Connection,
    loan_id: i64,
    amount: f64,
    payment_method: &str,
    note: &str,
    created_at: &str,
) -> Result<(), AppError> {
    validation::validate_money_amount(amount)?;
    validation::validate_payment_method(payment_method)?;

    let mut tx = conn.transaction()?;

    // 1. Get loan details and check outstanding amount
    let (member_id, outstanding_amount): (i64, f64) = tx.query_row(
        "SELECT member_id, outstanding_amount FROM loans WHERE id = ?1",
        [loan_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    if amount > outstanding_amount + 0.01 {
        return Err(AppError::business(format!(
            "payment exceeds outstanding balance (outstanding={outstanding_amount}, payment={amount})"
        )));
    }

    // 2. Update loan outstanding amount
    let new_outstanding = outstanding_amount - amount;
    let new_status = if new_outstanding <= 0.01 { "paid" } else { "active" };
    
    tx.execute(
        "UPDATE loans SET outstanding_amount = ?1, status = ?2 WHERE id = ?3",
        (new_outstanding, new_status, loan_id),
    )?;

    // 3. Create member transaction (payments are stored as negative amounts)
    tx.execute(
        "INSERT INTO member_transactions (member_id, amount, txn_type, created_at)
         VALUES (?1, ?2, 'PAYMENT', ?3)",
        (member_id, -amount, created_at),
    )?;

    // 4. Update member balance cache
    tx.execute(
        "INSERT INTO member_balances (member_id, balance) VALUES (?1, ?2) 
         ON CONFLICT(member_id) DO UPDATE SET balance = balance - ?2",
        (member_id, amount),
    )?;

    // 5. Record in loan_payments for per-loan repayment history.
    tx.execute(
        "INSERT INTO loan_payments (loan_id, member_id, amount, payment_method, note, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        (loan_id, member_id, amount, payment_method, note, created_at),
    )?;

    // 6. SHG receipt (money comes in)
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
    Ok(())
}

/// Fetch a single loan by its ID, joining member name.
pub fn get_loan_by_id(conn: &Connection, loan_id: i64) -> Result<Option<Loan>, AppError> {
    let result = conn.query_row(
        "SELECT l.id, l.member_id, l.amount, l.outstanding_amount, l.interest_rate,
                l.total_repayable, l.interest_amount, l.payment_method, l.loan_type,
                l.note, l.status, l.issued_at, l.created_at, m.name
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
                total_repayable: row.get(5)?,
                interest_amount: row.get(6)?,
                payment_method: row.get(7)?,
                loan_type: row.get(8)?,
                note: row.get(9)?,
                status: row.get(10)?,
                issued_at: row.get(11)?,
                created_at: row.get(12)?,
                member_name: row.get(13)?,
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

