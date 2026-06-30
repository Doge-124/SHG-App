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
    // member_type is a role set; SHG or LOAN grants loan privileges.
    Ok(crate::db::members::roles_allow_loan(&mt))
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
#[allow(clippy::too_many_arguments)]
pub fn create_loan(
    conn: &mut Connection,
    member_id: i64,
    amount: f64,
    daily_interest_rate: f64,
    payment_method: &str,           // CASH | BANK | MIXED
    loan_type: &str,
    note: &str,
    created_at: &str,
    cash_amount: Option<f64>,       // required when MIXED
    bank_amount: Option<f64>,       // required when MIXED
    bank_txn_id: Option<&str>,      // bank reference / cheque no. (BANK or mixed bank half)
) -> Result<i64, AppError> {
    if !can_take_loans(conn, member_id)? {
        return Err(AppError::business(
            "Only SHG and LOAN members can take loans. CHIT members cannot take loans."
        ));
    }
    validation::validate_money_amount(amount)?;

    // Resolve the disbursement split. For MIXED the gross principal voucher is
    // split into a cash half + a bank half that must sum to `amount`.
    let (cash_part, bank_part) = match payment_method {
        "MIXED" => {
            let c = cash_amount.unwrap_or(0.0);
            let b = bank_amount.unwrap_or(0.0);
            if c <= 0.005 || b <= 0.005 {
                return Err(AppError::validation("A mixed disbursement needs a positive amount in both cash and bank"));
            }
            if (c + b - amount).abs() > 0.01 {
                return Err(AppError::validation("Cash + bank must equal the loan amount"));
            }
            (Some(c), Some(b))
        }
        "CASH" | "BANK" => (None, None),
        _ => return Err(AppError::validation("payment_method must be CASH, BANK, or MIXED")),
    };
    // loans.payment_method is constrained to CASH/BANK on some DBs; the
    // authoritative cash/bank split for a MIXED loan lives on the ledger
    // (shg_transactions voucher rows). Store the larger half as the indicative
    // method so the loan record passes the CHECK without a schema migration.
    let loan_method: &str = match payment_method {
        "MIXED" => if cash_part.unwrap_or(0.0) >= bank_part.unwrap_or(0.0) { "CASH" } else { "BANK" },
        other => other,
    };
    // For a MIXED disbursement the upfront interest (income) is always collected
    // in CASH, not split with the bank portion. Single-method loans book it under
    // that same method.
    let income_method: &str = if payment_method == "MIXED" { "CASH" } else { loan_method };

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

    // The SHG upfront interest covers the first upfront_days, so interest is
    // settled through issued_at + upfront_days from the start.
    let paid_through_init = parse_iso_date(created_at)
        .map(|d| (d + chrono::Duration::days(upfront_days as i64)).to_string());

    let loan_id: i64 = if has_legacy {
        tx.query_row(
            "INSERT INTO loans
             (member_id, amount, outstanding_amount, interest_rate, daily_interest_rate,
              total_repayable, interest_amount, upfront_interest_amount,
              payment_method, loan_type, note, status, issued_at, created_at,
              interest_paid_through, principal, due_date)
             VALUES (?1,?2,?3,0,?4,?5,?6,?7,?8,?9,?10,'active',?11,?12,?13,?14,?15)
             RETURNING id",
            (member_id, amount, outstanding, daily_interest_rate, amount,
             upfront_interest, upfront_interest, loan_method, loan_type, note,
             created_at, created_at, &paid_through_init, amount, created_at),
            |row| row.get(0),
        )?
    } else {
        tx.query_row(
            "INSERT INTO loans
             (member_id, amount, outstanding_amount, interest_rate, daily_interest_rate,
              total_repayable, interest_amount, upfront_interest_amount,
              payment_method, loan_type, note, status, issued_at, created_at,
              interest_paid_through)
             VALUES (?1,?2,?3,0,?4,?5,?6,?7,?8,?9,?10,'active',?11,?12,?13)
             RETURNING id",
            (member_id, amount, outstanding, daily_interest_rate, amount,
             upfront_interest, upfront_interest, loan_method, loan_type, note,
             created_at, created_at, &paid_through_init),
            |row| row.get(0),
        )?
    };

    // Loan-side bookkeeping lives ENTIRELY on the loans + loan_payments
    // tables. We deliberately do NOT touch member_balances or write a LOAN
    // row to member_transactions: those represent member SAVINGS (what the
    // SHG owes the member). Mixing loans in there would silently treat
    // borrowed cash as deposited savings.

    // Upfront interest is income, not a principal reduction. Record it as a
    // SHG receipt and a loan_payments row (principal=0, interest=full upfront).
    // Order matters: receipt FIRST so the checked voucher below sees the
    // inflated balance and the net-outflow check is atomic.
    if upfront_interest > 0.0 {
        let upfront_note = "Upfront Interest";
        // Upfront interest is collected in cash for mixed disbursements (income_method).
        ledger::record_receipt(
            &mut tx,
            upfront_interest,
            upfront_note,
            income_method,
            Some("MEMBER_PAYMENT"),
            Some(member_id),
            created_at,
        )?;

        tx.execute(
            "INSERT INTO loan_payments
               (loan_id, member_id, amount, principal_amount, interest_amount,
                payment_method, note, created_at)
             VALUES (?1, ?2, ?3, 0, ?3, ?4, ?5, ?6)",
            (loan_id, member_id, upfront_interest, income_method, upfront_note, created_at),
        )?;
    }

    // Voucher: full principal disbursed. record_voucher (checked) enforces
    // sufficient balance inside the same transaction. The transaction reason is
    // always "Loan disbursement" (its nature); the loan's purpose, if given, is
    // appended so it shows on the printed voucher without masking the category.
    let voucher_note = if note.trim().is_empty() {
        "Loan disbursement".to_string()
    } else {
        format!("Loan disbursement — Purpose: {}", note.trim())
    };
    if payment_method == "MIXED" {
        ledger::record_voucher_mixed(
            &mut tx,
            cash_part.unwrap_or(0.0),
            bank_part.unwrap_or(0.0),
            &voucher_note,
            Some("MEMBER_LOAN"),
            Some(member_id),
            created_at,
            bank_txn_id,
        )?;
    } else {
        let bank_txn = if payment_method == "BANK" { bank_txn_id } else { None };
        ledger::record_voucher_ex(
            &mut tx,
            amount,
            &voucher_note,
            payment_method,
            Some("MEMBER_LOAN"),
            Some(member_id),
            created_at,
            bank_txn,
            None,
        )?;
    }

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

    // 2-3. Loan-side bookkeeping is tracked on loans + loan_payments only.
    // No member_balances or member_transactions writes — savings and loans
    // are separate ledgers.

    // 4. Past data entry: no SHG voucher — disbursement is reference-only.
    // The SHG opening balance (set in Settings) already accounts for historical funds.

    // 4b. Record upfront interest as a loan_payments row only (reference for
    // the interest collected at disbursement). It does NOT touch member
    // balances — the borrower's principal owed isn't reduced by interest.
    if upfront_interest > 0.0 {
        tx.execute(
            "INSERT INTO loan_payments
               (loan_id, member_id, amount, principal_amount, interest_amount,
                payment_method, note, created_at, is_past_entry)
             VALUES (?1, ?2, ?3, 0, ?3, ?4, 'Upfront Interest', ?5, 1)",
            (loan_id, member_id, upfront_interest, payment_method, issued_at),
        )?;
    }

    // 5. Process each repayment in chronological order using interest-first
    // allocation. The paid-through marker starts at issued_at + upfront_days
    // and advances to each repayment's date as interest is settled.
    let issued_date = parse_iso_date(issued_at)
        .ok_or_else(|| AppError::validation("Invalid loan issued_at"))?;
    let mut paid_through = interest_start_date(issued_date, loan_type);

    // Sort defensively so the iterative accrual is order-independent.
    let mut sorted_reps: Vec<(f64, &str, &str)> = repayments.iter().copied().collect();
    sorted_reps.sort_by(|a, b| a.2.cmp(b.2));

    let mut outstanding = outstanding_start;
    let mut unpaid_interest: f64 = 0.0;

    for (rep_amount, rep_method, rep_date) in sorted_reps {
        validation::validate_money_amount(rep_amount)?;
        validation::validate_payment_method(rep_method)?;

        let paid_date = parse_iso_date(rep_date)
            .ok_or_else(|| AppError::validation(&format!("Invalid repayment date: {rep_date}")))?;

        let interest_due = interest_due_for(
            outstanding, unpaid_interest, daily_interest_rate,
            paid_through, paid_date,
        );

        let (interest_paid, principal_paid, new_unpaid) =
            split_payment_interest_first(rep_amount, interest_due, outstanding)?;

        outstanding -= principal_paid;
        unpaid_interest = new_unpaid;
        paid_through = paid_date.max(paid_through);

        // loan_payments row with the computed split.
        tx.execute(
            "INSERT INTO loan_payments
               (loan_id, member_id, amount, principal_amount, interest_amount,
                payment_method, note, created_at, is_past_entry)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'Loan Repayment', ?7, 1)",
            (loan_id, member_id, rep_amount, principal_paid, interest_paid, rep_method, rep_date),
        )?;
        // No member_balances / member_transactions writes — past repayments
        // only touch the loan ledger. SHG balance untouched (reference-only).
    }

    // Final loan state.
    let final_status = if outstanding <= 0.01 && unpaid_interest <= 0.01 { "paid" } else { "active" };
    tx.execute(
        "UPDATE loans
         SET outstanding_amount = ?1, unpaid_interest_balance = ?2, status = ?3,
             interest_paid_through = ?4
         WHERE id = ?5",
        (outstanding, unpaid_interest, final_status, paid_through.to_string(), loan_id),
    )?;

    tx.commit()?;
    Ok(loan_id)
}

// ─── Interest accrual helpers ────────────────────────────────────────────

/// Parse the date prefix of an ISO timestamp ("2024-04-15..." or "2024-04-15").
/// Returns None on garbage so callers can fall back gracefully.
fn parse_iso_date(s: &str) -> Option<chrono::NaiveDate> {
    if s.len() < 10 { return None; }
    chrono::NaiveDate::parse_from_str(&s[..10], "%Y-%m-%d").ok()
}

/// Days the upfront interest covers — 30 for monthly, 100 for weekly.
fn upfront_days_for(loan_type: &str) -> i64 {
    if loan_type.to_lowercase() == "weekly" { 100 } else { 30 }
}

/// Date when daily interest accrual begins for a loan (issued_at + upfront_days).
fn interest_start_date(issued_at: chrono::NaiveDate, loan_type: &str) -> chrono::NaiveDate {
    issued_at + chrono::Duration::days(upfront_days_for(loan_type))
}


/// Compute total interest due as of `as_of` for a loan that currently has the
/// given outstanding principal and unpaid-interest carry-over balance.
///
/// Accrual only counts days strictly after `paid_through` (the date interest is
/// settled through — covers the SHG upfront period and any voluntary prepaid
/// months). `as_of <= paid_through` returns just the carry-over balance.
fn interest_due_for(
    outstanding: f64,
    unpaid_balance: f64,
    daily_rate: f64,
    paid_through: chrono::NaiveDate,
    as_of: chrono::NaiveDate,
) -> f64 {
    let days = (as_of - paid_through).num_days().max(0) as f64;
    let new_accrual = outstanding * daily_rate / 100.0 * days;
    let total = unpaid_balance + new_accrual;
    (total * 100.0).round() / 100.0
}

/// The accrual floor for a loan: the later of its stored `interest_paid_through`
/// and the upfront-covered start date (issued_at + upfront_days). Older loans
/// without the column fall back to the upfront start.
fn paid_through_floor(
    interest_paid_through: Option<&str>,
    issued_at: chrono::NaiveDate,
    loan_type: &str,
) -> chrono::NaiveDate {
    let upfront_start = interest_start_date(issued_at, loan_type);
    match interest_paid_through.and_then(parse_iso_date) {
        Some(d) => d.max(upfront_start),
        None => upfront_start,
    }
}

/// Pure split function: allocate `amount` to interest first, then principal.
/// Returns (interest_paid, principal_paid, new_unpaid_interest_balance).
/// Returns an error if amount would exceed interest + outstanding.
fn split_payment_interest_first(
    amount: f64,
    interest_due: f64,
    outstanding: f64,
) -> Result<(f64, f64, f64), AppError> {
    if amount <= interest_due + 0.005 {
        // Entirely covers (or partially covers) interest, principal untouched.
        let interest_paid = amount;
        let new_unpaid = (interest_due - amount).max(0.0);
        return Ok((interest_paid, 0.0, new_unpaid));
    }
    // Pay all interest, then principal.
    let interest_paid = interest_due;
    let principal_paid = amount - interest_due;
    if principal_paid > outstanding + 0.005 {
        return Err(AppError::business(format!(
            "Payment of {amount:.2} exceeds interest due ({interest_due:.2}) + outstanding principal ({outstanding:.2}). Reduce the amount or split into two payments.",
        )));
    }
    let principal_paid = principal_paid.min(outstanding);
    Ok((interest_paid, principal_paid, 0.0))
}

/// Public: how much interest does this loan owe right now (as of `as_of`)?
/// Used by the preview command and the repayment UI.
pub fn current_interest_due(
    conn: &Connection,
    loan_id: i64,
    as_of: chrono::NaiveDate,
) -> Result<f64, AppError> {
    let (outstanding, unpaid_balance, daily_rate, issued_at_str, loan_type, paid_through):
        (f64, f64, f64, String, String, Option<String>) =
        conn.query_row(
            "SELECT outstanding_amount, COALESCE(unpaid_interest_balance, 0),
                    COALESCE(daily_interest_rate, 0), issued_at, loan_type, interest_paid_through
             FROM loans WHERE id = ?1",
            [loan_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
        ).map_err(|_| AppError::business("Loan not found"))?;

    let issued_at = parse_iso_date(&issued_at_str)
        .ok_or_else(|| AppError::business("Invalid loan issued_at"))?;
    let floor = paid_through_floor(paid_through.as_deref(), issued_at, &loan_type);

    Ok(interest_due_for(outstanding, unpaid_balance, daily_rate, floor, as_of))
}

/// Preview the split of a payment without committing. Returns
/// (interest_due, interest_portion, principal_portion, new_outstanding, new_unpaid_interest).
pub fn preview_loan_payment(
    conn: &Connection,
    loan_id: i64,
    amount: f64,
    as_of: chrono::NaiveDate,
) -> Result<(f64, f64, f64, f64, f64), AppError> {
    validation::validate_money_amount(amount)?;

    let (outstanding, unpaid_balance, daily_rate, issued_at_str, loan_type, status, paid_through):
        (f64, f64, f64, String, String, String, Option<String>) =
        conn.query_row(
            "SELECT outstanding_amount, COALESCE(unpaid_interest_balance, 0),
                    COALESCE(daily_interest_rate, 0), issued_at, loan_type, status, interest_paid_through
             FROM loans WHERE id = ?1",
            [loan_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
        ).map_err(|_| AppError::business("Loan not found"))?;

    if status == "paid" {
        return Err(AppError::business("This loan has already been fully repaid"));
    }

    let issued_at = parse_iso_date(&issued_at_str)
        .ok_or_else(|| AppError::business("Invalid loan issued_at"))?;
    let floor = paid_through_floor(paid_through.as_deref(), issued_at, &loan_type);

    let interest_due = interest_due_for(outstanding, unpaid_balance, daily_rate, floor, as_of);
    let (interest_paid, principal_paid, new_unpaid) =
        split_payment_interest_first(amount, interest_due, outstanding)?;

    Ok((interest_due, interest_paid, principal_paid, outstanding - principal_paid, new_unpaid))
}

// ─── Public write paths ──────────────────────────────────────────────────

/// Record a payment towards a specific loan. The backend splits the payment
/// interest-first: any unpaid interest (carry-over + newly accrued since the
/// last payment) is paid first; the remainder reduces principal. Overpayment
/// beyond interest + outstanding is rejected. The borrower may pay any
/// positive amount, including less than the interest due (the shortfall
/// carries over via `loans.unpaid_interest_balance`).
#[allow(clippy::too_many_arguments)]
pub fn record_loan_payment(
    conn: &mut Connection,
    loan_id: i64,
    amount: f64,
    payment_method: &str,           // CASH | BANK | MIXED
    note: &str,
    created_at: &str,
    cash_amount: Option<f64>,       // required when MIXED
    bank_amount: Option<f64>,       // required when MIXED
    bank_txn_id: Option<&str>,      // optional bank reference
) -> Result<(), AppError> {
    validation::validate_money_amount(amount)?;
    // Allow CASH, BANK, or MIXED. For MIXED the split must reconcile to amount.
    let (cash_part, bank_part) = match payment_method {
        "MIXED" => {
            let c = cash_amount.unwrap_or(0.0);
            let b = bank_amount.unwrap_or(0.0);
            if c <= 0.005 || b <= 0.005 {
                return Err(AppError::validation("A mixed payment needs a positive amount in both cash and bank"));
            }
            if (c + b - amount).abs() > 0.01 {
                return Err(AppError::validation("Cash + bank must equal the payment amount"));
            }
            (Some(c), Some(b))
        }
        "CASH" | "BANK" => (None, None),
        _ => return Err(AppError::validation("payment_method must be CASH, BANK, or MIXED")),
    };

    let paid_date = parse_iso_date(created_at)
        .ok_or_else(|| AppError::validation("Invalid created_at date"))?;

    let mut tx = conn.transaction()?;

    let (member_id, outstanding, unpaid_balance, daily_rate, issued_at_str, loan_type, status, paid_through):
        (i64, f64, f64, f64, String, String, String, Option<String>) = tx.query_row(
            "SELECT member_id, outstanding_amount, COALESCE(unpaid_interest_balance, 0),
                    COALESCE(daily_interest_rate, 0), issued_at, loan_type, status, interest_paid_through
             FROM loans WHERE id = ?1",
            [loan_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?)),
        )?;

    if status == "paid" {
        return Err(AppError::business("This loan has already been fully repaid"));
    }

    let issued_at = parse_iso_date(&issued_at_str)
        .ok_or_else(|| AppError::business("Invalid loan issued_at"))?;
    let floor = paid_through_floor(paid_through.as_deref(), issued_at, &loan_type);

    let interest_due = interest_due_for(outstanding, unpaid_balance, daily_rate, floor, paid_date);
    let (interest_paid, principal_paid, new_unpaid) =
        split_payment_interest_first(amount, interest_due, outstanding)?;

    let new_outstanding = outstanding - principal_paid;
    let new_status = if new_outstanding <= 0.01 && new_unpaid <= 0.01 { "paid" } else { "active" };

    // A normal payment settles interest up to the payment date. Advance the
    // paid-through marker to max(payment date, current floor) so it never moves
    // backward and any voluntarily-prepaid future interest is preserved.
    let new_paid_through = paid_date.max(floor);

    tx.execute(
        "UPDATE loans
         SET outstanding_amount = ?1, unpaid_interest_balance = ?2, status = ?3,
             interest_paid_through = ?4
         WHERE id = ?5",
        (new_outstanding, new_unpaid, new_status, new_paid_through.to_string(), loan_id),
    )?;

    let receipt_note = note.to_string();

    // No writes to member_balances / member_transactions — loan repayment
    // is tracked on loan_payments and on the loan's outstanding/unpaid
    // interest balance. The borrower's savings balance is not affected.

    tx.execute(
        "INSERT INTO loan_payments
           (loan_id, member_id, amount, principal_amount, interest_amount,
            payment_method, note, created_at, cash_amount, bank_amount)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        (loan_id, member_id, amount, principal_paid, interest_paid,
         payment_method, &receipt_note, created_at, cash_part, bank_part),
    )?;

    if payment_method == "MIXED" {
        ledger::record_receipt_mixed(
            &mut tx,
            cash_part.unwrap_or(0.0),
            bank_part.unwrap_or(0.0),
            &receipt_note,
            Some("MEMBER_PAYMENT"),
            Some(member_id),
            created_at,
            bank_txn_id,
        )?;
    } else {
        let bank_txn = if payment_method == "BANK" { bank_txn_id } else { None };
        ledger::record_receipt_ex(
            &mut tx,
            amount,
            &receipt_note,
            payment_method,
            Some("MEMBER_PAYMENT"),
            Some(member_id),
            created_at,
            bank_txn,
            None,
        )?;
    }

    tx.commit()?;
    Ok(())
}

/// Result of a voluntary interest prepayment.
pub struct PrepayResult {
    pub arrears_cleared: f64,        // interest accrued up to today that this settled
    pub month_interest: f64,         // 30 days of interest prepaid
    pub total_paid: f64,             // arrears_cleared + month_interest
    pub new_paid_through: String,    // date interest is now covered through
}

/// Voluntarily prepay one month (flat 30 days) of interest. Settles any
/// interest accrued up to `paid_date`, then advances the paid-through marker
/// 30 days beyond the later of today or the current paid-through. No principal
/// is touched. Records a single MEMBER_PAYMENT receipt + a loan_payments row
/// (all interest), with note "Interest Payment".
#[allow(clippy::too_many_arguments)]
pub fn prepay_loan_interest(
    conn: &mut Connection,
    loan_id: i64,
    payment_method: &str,
    created_at: &str,
    cash_amount: Option<f64>,
    bank_amount: Option<f64>,
    bank_txn_id: Option<&str>,
) -> Result<PrepayResult, AppError> {
    let paid_date = parse_iso_date(created_at)
        .ok_or_else(|| AppError::validation("Invalid created_at date"))?;

    let mut tx = conn.transaction()?;

    let (member_id, outstanding, unpaid_balance, daily_rate, issued_at_str, loan_type, status, paid_through):
        (i64, f64, f64, f64, String, String, String, Option<String>) = tx.query_row(
            "SELECT member_id, outstanding_amount, COALESCE(unpaid_interest_balance, 0),
                    COALESCE(daily_interest_rate, 0), issued_at, loan_type, status, interest_paid_through
             FROM loans WHERE id = ?1",
            [loan_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?)),
        ).map_err(|_| AppError::business("Loan not found"))?;

    if status == "paid" {
        return Err(AppError::business("This loan has already been fully repaid"));
    }
    if daily_rate <= 0.0 {
        return Err(AppError::business("This loan has no interest rate — nothing to prepay."));
    }

    let issued_at = parse_iso_date(&issued_at_str)
        .ok_or_else(|| AppError::business("Invalid loan issued_at"))?;
    let floor = paid_through_floor(paid_through.as_deref(), issued_at, &loan_type);

    // Arrears = interest accrued up to today (carry-over + accrual since floor).
    let arrears = interest_due_for(outstanding, unpaid_balance, daily_rate, floor, paid_date);

    // One flat month of interest on the outstanding principal.
    let month_interest = (outstanding * daily_rate / 100.0 * 30.0 * 100.0).round() / 100.0;

    let total = ((arrears + month_interest) * 100.0).round() / 100.0;
    validation::validate_money_amount(total)?;

    // Validate the cash/bank split if MIXED.
    let (cash_part, bank_part) = match payment_method {
        "MIXED" => {
            let c = cash_amount.unwrap_or(0.0);
            let b = bank_amount.unwrap_or(0.0);
            if c <= 0.005 || b <= 0.005 {
                return Err(AppError::validation("A mixed payment needs a positive amount in both cash and bank"));
            }
            if (c + b - total).abs() > 0.01 {
                return Err(AppError::validation(&format!(
                    "Cash + bank must equal the prepayment total of {total:.2}"
                )));
            }
            (Some(c), Some(b))
        }
        "CASH" | "BANK" => (None, None),
        _ => return Err(AppError::validation("payment_method must be CASH, BANK, or MIXED")),
    };

    // New paid-through: 30 days past the later of today and the current floor.
    // (If they're already prepaid into the future, this stacks another month on.)
    let base = paid_date.max(floor);
    let new_paid_through = base + chrono::Duration::days(30);

    // Arrears are now settled and the future month is prepaid → no carry-over.
    tx.execute(
        "UPDATE loans
         SET unpaid_interest_balance = 0, interest_paid_through = ?1
         WHERE id = ?2",
        (new_paid_through.to_string(), loan_id),
    )?;

    let note = "Interest Payment";
    tx.execute(
        "INSERT INTO loan_payments
           (loan_id, member_id, amount, principal_amount, interest_amount,
            payment_method, note, created_at, cash_amount, bank_amount)
         VALUES (?1, ?2, ?3, 0, ?3, ?4, ?5, ?6, ?7, ?8)",
        (loan_id, member_id, total, payment_method, note, created_at, cash_part, bank_part),
    )?;

    if payment_method == "MIXED" {
        ledger::record_receipt_mixed(
            &mut tx,
            cash_part.unwrap_or(0.0),
            bank_part.unwrap_or(0.0),
            note,
            Some("MEMBER_PAYMENT"),
            Some(member_id),
            created_at,
            bank_txn_id,
        )?;
    } else {
        let bank_txn = if payment_method == "BANK" { bank_txn_id } else { None };
        ledger::record_receipt_ex(
            &mut tx,
            total,
            note,
            payment_method,
            Some("MEMBER_PAYMENT"),
            Some(member_id),
            created_at,
            bank_txn,
            None,
        )?;
    }

    tx.commit()?;

    Ok(PrepayResult {
        arrears_cleared: arrears,
        month_interest,
        total_paid: total,
        new_paid_through: new_paid_through.to_string(),
    })
}

/// Preview a one-month interest prepayment. Returns
/// (arrears, month_interest, total, new_paid_through). Read-only.
pub fn preview_prepay_interest(
    conn: &Connection,
    loan_id: i64,
    as_of: chrono::NaiveDate,
) -> Result<(f64, f64, f64, String), AppError> {
    let (outstanding, unpaid_balance, daily_rate, issued_at_str, loan_type, status, paid_through):
        (f64, f64, f64, String, String, String, Option<String>) =
        conn.query_row(
            "SELECT outstanding_amount, COALESCE(unpaid_interest_balance, 0),
                    COALESCE(daily_interest_rate, 0), issued_at, loan_type, status, interest_paid_through
             FROM loans WHERE id = ?1",
            [loan_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
        ).map_err(|_| AppError::business("Loan not found"))?;

    if status == "paid" {
        return Err(AppError::business("This loan has already been fully repaid"));
    }

    let issued_at = parse_iso_date(&issued_at_str)
        .ok_or_else(|| AppError::business("Invalid loan issued_at"))?;
    let floor = paid_through_floor(paid_through.as_deref(), issued_at, &loan_type);

    let arrears = interest_due_for(outstanding, unpaid_balance, daily_rate, floor, as_of);
    let month_interest = (outstanding * daily_rate / 100.0 * 30.0 * 100.0).round() / 100.0;
    let total = ((arrears + month_interest) * 100.0).round() / 100.0;
    let base = as_of.max(floor);
    let new_through = (base + chrono::Duration::days(30)).to_string();

    Ok((arrears, month_interest, total, new_through))
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

    // 3. SHG voucher (money goes out). Reason is always "Loan disbursement";
    // the purpose (if any) is appended for the printed voucher.
    let voucher_note = if note.trim().is_empty() {
        "Loan disbursement".to_string()
    } else {
        format!("Loan disbursement — Purpose: {}", note.trim())
    };
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
    // Exclude the upfront-interest row: it's the interest collected at
    // disbursement (shown on the "Loan Issued" row), not a repayment, so it
    // must not appear as a payment line or count toward total_repaid.
    let mut pay_stmt = conn.prepare(
        "SELECT amount, payment_method, created_at FROM loan_payments
         WHERE loan_id = ?1 AND COALESCE(note, '') <> 'Upfront Interest'
         ORDER BY created_at ASC"
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

    // Payment events. Also build a per-date queue so multiple payments on the
    // same day map to their own amounts (matching by date alone would show the
    // first payment's amount on every same-day row).
    let mut pay_queue: std::collections::HashMap<chrono::NaiveDate, std::collections::VecDeque<(f64, String)>> =
        std::collections::HashMap::new();
    for (amt, method, date) in &payments {
        events.push((*date, "payment",
            format!("Repayment ({})", method.to_lowercase())));
        pay_queue.entry(*date).or_default().push_back((*amt, method.clone()));
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
            // Dequeue the next payment recorded on this date.
            pay_queue.get_mut(date)
                .and_then(|q| q.pop_front())
                .unwrap_or((0.0, String::new()))
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

