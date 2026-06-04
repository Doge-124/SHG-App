//! Member contribution operations for weekly installments.
//!
//! `shg_transactions` stores each contribution with:
//!   txn_type = 'RECEIPT', reference_type = 'WEEKLY_CONTRIBUTION', reference_id = member_id

use rusqlite::Connection;
use crate::error::AppError;
use crate::db::{self, validation, ledger};
use chrono::Utc;

/// Input for recording a weekly contribution
#[derive(Debug, serde::Deserialize)]
pub struct WeeklyContributionInput {
    pub member_id: i64,
    pub amount: f64,
    pub payment_method: String,          // CASH | BANK | MIXED
    pub note: Option<String>,
    #[serde(default)]
    pub cash_amount: Option<f64>,        // required when MIXED
    #[serde(default)]
    pub bank_amount: Option<f64>,        // required when MIXED
    #[serde(default)]
    pub bank_txn_id: Option<String>,     // optional bank reference
}

/// Record a weekly contribution atomically
pub fn record_weekly_contribution(
    conn: &mut Connection,
    input: WeeklyContributionInput,
) -> Result<i64, AppError> {
    // Validation
    if !input.amount.is_finite() || input.amount <= 0.0 {
        return Err(AppError::validation("amount must be > 0"));
    }

    // Allow CASH / BANK / MIXED. For MIXED the split must reconcile to amount.
    let (cash_part, bank_part): (Option<f64>, Option<f64>) = match input.payment_method.as_str() {
        "MIXED" => {
            let c = input.cash_amount.unwrap_or(0.0);
            let b = input.bank_amount.unwrap_or(0.0);
            if c <= 0.005 || b <= 0.005 {
                return Err(AppError::validation("A mixed payment needs a positive amount in both cash and bank"));
            }
            if (c + b - input.amount).abs() > 0.01 {
                return Err(AppError::validation("Cash + bank must equal the contribution amount"));
            }
            (Some(c), Some(b))
        }
        "CASH" | "BANK" => (None, None),
        _ => return Err(AppError::validation("payment_method must be CASH, BANK, or MIXED")),
    };

    let now = Utc::now().to_rfc3339();

    // Load and validate the member state outside the write transaction
    let (member_code, member_name, is_active, _opening_set_at): (String, String, i64, Option<String>) = conn.query_row(
        "SELECT member_code, name, is_active, opening_balance_set_at
         FROM members
         WHERE id = ?1",
        [input.member_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    ).map_err(|_| AppError::business("Member not found"))?;

    if is_active != 1 {
        return Err(AppError::business("Member is not active"));
    }

    // Check if member is SHG type for savings participation
    let is_shg = db::members::is_member_type(conn, input.member_id, db::members::MemberType::SHG)?;
    if !is_shg {
        return Err(AppError::business(
            "Only SHG members can record savings contributions. This member is not an SHG type member."
        ));
    }

    let mut tx = conn.transaction()?;

    // 1) SHG receipt transaction (handles CASH / BANK / MIXED + bank txn id).
    let mut reason = format!("Weekly contribution from {} ({})", member_name, member_code);
    if let Some(note) = &input.note {
        reason.push_str(&format!(" - {}", note));
    }

    if input.payment_method == "MIXED" {
        ledger::record_receipt_mixed(
            &mut tx,
            cash_part.unwrap_or(0.0),
            bank_part.unwrap_or(0.0),
            &reason,
            Some("WEEKLY_CONTRIBUTION"),
            Some(input.member_id),
            &now,
            input.bank_txn_id.as_deref(),
        )?;
    } else {
        let bank_txn = if input.payment_method == "BANK" { input.bank_txn_id.as_deref() } else { None };
        ledger::record_receipt_ex(
            &mut tx,
            input.amount,
            &reason,
            &input.payment_method,
            Some("WEEKLY_CONTRIBUTION"),
            Some(input.member_id),
            &now,
            bank_txn,
            None,
        )?;
    }
    let shg_txn_id = tx.last_insert_rowid();

    // 3) Member transaction with CONTRIBUTION type
    let mut member_reason = "Weekly contribution".to_string();
    if let Some(note) = &input.note {
        member_reason.push_str(&format!(" - {}", note));
    }

    tx.execute(
        "INSERT INTO member_transactions (member_id, amount, txn_type, reason, created_at)
         VALUES (?1, ?2, 'CONTRIBUTION', ?3, ?4)",
        (
            input.member_id,
            input.amount,
            member_reason,
            &now,
        ),
    )?;

    // 4) Update member balance cache (insert if not exists)
    tx.execute(
        "INSERT INTO member_balances (member_id, balance) VALUES (?1, ?2)
         ON CONFLICT(member_id) DO UPDATE SET balance = balance + excluded.balance",
        (input.member_id, input.amount),
    )?;

    // 5) Increment current_installments for every contribution (past_installments stays locked)
    let updated_installments: i64 = tx.query_row(
        "UPDATE members SET current_installments = current_installments + 1 WHERE id = ?1 RETURNING current_installments",
        [input.member_id],
        |row| row.get(0),
    )?;

    tx.commit()?;
    Ok(shg_txn_id)
}

/// Pay out (withdraw) a member's accrued savings. This is the inverse of a
/// contribution: it issues a VOUCHER for the money leaving the SHG and reduces
/// the member's savings balance by the same amount.
///
/// Guards:
///   - amount must be positive and not exceed the member's current savings;
///   - the SHG must actually hold enough CASH/BANK to make the payment
///     (enforced by `record_voucher_ex`).
///
/// The withdrawal is stored as a negative CONTRIBUTION row in
/// `member_transactions` so it lowers the running balance and shows up in the
/// member's savings passbook. Returns the voucher's shg_transactions id.
#[allow(clippy::too_many_arguments)]
pub fn payout_member_savings(
    conn: &mut Connection,
    member_id: i64,
    amount: f64,
    payment_method: &str,           // CASH | BANK | MIXED
    bank_txn_id: Option<&str>,
    created_at: &str,
    cash_amount: Option<f64>,       // required when MIXED
    bank_amount: Option<f64>,       // required when MIXED
) -> Result<i64, AppError> {
    if !amount.is_finite() || amount <= 0.0 {
        return Err(AppError::validation("amount must be > 0"));
    }
    let (cash_part, bank_part) = match payment_method {
        "CASH" | "BANK" => (None, None),
        "MIXED" => {
            let c = cash_amount.unwrap_or(0.0);
            let b = bank_amount.unwrap_or(0.0);
            if c <= 0.005 || b <= 0.005 {
                return Err(AppError::validation("A mixed payment needs a positive amount in both cash and bank"));
            }
            if (c + b - amount).abs() > 0.01 {
                return Err(AppError::validation("Cash + bank must equal the payout amount"));
            }
            (Some(c), Some(b))
        }
        _ => return Err(AppError::validation("payment_method must be CASH, BANK, or MIXED")),
    };

    let (member_code, member_name, is_active): (String, String, i64) = conn
        .query_row(
            "SELECT member_code, name, is_active FROM members WHERE id = ?1",
            [member_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|_| AppError::business("Member not found"))?;

    if is_active != 1 {
        return Err(AppError::business("Member is not active"));
    }

    let balance: f64 = conn
        .query_row(
            "SELECT COALESCE(balance, 0.0) FROM member_balances WHERE member_id = ?1",
            [member_id],
            |row| row.get(0),
        )
        .unwrap_or(0.0);

    if balance <= 0.005 {
        return Err(AppError::business(format!(
            "{member_name} has no savings to pay out."
        )));
    }
    if amount > balance + 0.005 {
        return Err(AppError::business(format!(
            "Cannot pay out ₹{amount:.2}: {member_name} only has ₹{balance:.2} in savings."
        )));
    }

    let mut tx = conn.transaction()?;

    // 1) Money leaves the SHG — a voucher (balance-checked). Mixed splits into
    //    a cash + bank voucher sharing a group id.
    let reason = format!("Savings payout to {member_name} ({member_code})");
    if payment_method == "MIXED" {
        ledger::record_voucher_mixed(
            &mut tx,
            cash_part.unwrap_or(0.0),
            bank_part.unwrap_or(0.0),
            &reason,
            Some("SAVINGS_WITHDRAWAL"),
            Some(member_id),
            created_at,
            bank_txn_id,
        )?;
    } else {
        let bank_txn = if payment_method == "BANK" { bank_txn_id } else { None };
        ledger::record_voucher_ex(
            &mut tx,
            amount,
            &reason,
            payment_method,
            Some("SAVINGS_WITHDRAWAL"),
            Some(member_id),
            created_at,
            bank_txn,
            None,
        )?;
    }
    let voucher_id = tx.last_insert_rowid();

    // 2) Reduce the member's savings (negative CONTRIBUTION keeps the passbook
    //    running balance correct).
    tx.execute(
        "INSERT INTO member_transactions (member_id, amount, txn_type, reason, created_at)
         VALUES (?1, ?2, 'CONTRIBUTION', ?3, ?4)",
        (member_id, -amount, "Savings payout", created_at),
    )?;

    // 3) Update the cached balance.
    tx.execute(
        "UPDATE member_balances SET balance = balance - ?1 WHERE member_id = ?2",
        (amount, member_id),
    )?;

    tx.commit()?;
    Ok(voucher_id)
}

// ─── Weekly status query ──────────────────────────────────────────────────────

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberContributionStatus {
    pub member_id: i64,
    pub member_name: String,
    pub member_code: String,
    pub has_paid: bool,
    /// Total amount paid in the period (may be > standard if multiple entries).
    pub amount_paid: f64,
    pub payment_method: Option<String>,
    pub paid_at: Option<String>,
    /// Number of individual contribution entries in the period.
    pub payment_count: i64,
    /// Cumulative savings balance for this member.
    pub total_savings: f64,
    /// Total installments this member has paid (seeded past + ongoing).
    pub installments_paid: i64,
    /// How many installments behind the current expected number (0 = up to date).
    pub behind_by: i64,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyContributionSummary {
    pub from_date: String,
    pub to_date: String,
    pub total_members: i64,
    pub paid_count: i64,
    pub pending_count: i64,
    pub total_collected: f64,
    /// Expected installment number as of today (auto-increments weekly).
    pub current_installment_number: i64,
    /// Number of members behind the current installment number.
    pub behind_count: i64,
    pub members: Vec<MemberContributionStatus>,
}

/// Return payment status for every active SHG member for the given period.
/// Pass bare ISO dates ("YYYY-MM-DD"); the function appends T23:59:59 for the upper bound.
pub fn get_weekly_contribution_status(
    conn: &Connection,
    from_date: &str,
    to_date: &str,
) -> Result<WeeklyContributionSummary, AppError> {
    let to_dt = format!("{}T23:59:59", to_date);

    let mut stmt = conn.prepare(
        "SELECT
             m.id, m.name, m.member_code,
             COALESCE(c.total_amount, 0.0)  AS amount_paid,
             c.payment_method,
             c.last_paid_at,
             COALESCE(c.payment_count, 0)   AS payment_count,
             COALESCE(mb.balance, 0.0)       AS total_savings,
             COALESCE(m.past_installments, 0) + COALESCE(m.current_installments, 0) AS installments_paid
         FROM members m
         LEFT JOIN (
             SELECT
                 reference_id              AS member_id,
                 SUM(amount)               AS total_amount,
                 MAX(payment_method)       AS payment_method,
                 MAX(created_at)           AS last_paid_at,
                 COUNT(*)                  AS payment_count
             FROM shg_transactions
             WHERE txn_type = 'RECEIPT'
               AND reference_type = 'WEEKLY_CONTRIBUTION'
               AND voided_at IS NULL AND reversal_of_id IS NULL
               AND created_at >= ?1
               AND created_at <= ?2
             GROUP BY reference_id
         ) c ON c.member_id = m.id
         LEFT JOIN member_balances mb ON mb.member_id = m.id
         WHERE m.is_active = 1 AND m.member_type = 'SHG'
         ORDER BY c.last_paid_at DESC NULLS LAST, m.name ASC",
    )?;

    // Expected installment number as of today (auto-increments weekly).
    let current_installment_number =
        db::settings::get_installment_status(conn)?.current_number;

    let rows = stmt.query_map([from_date, &to_dt], |r| {
        let amount_paid: f64 = r.get(3)?;
        let installments_paid: i64 = r.get(8)?;
        let behind_by = if current_installment_number > installments_paid {
            current_installment_number - installments_paid
        } else {
            0
        };
        Ok(MemberContributionStatus {
            member_id:      r.get(0)?,
            member_name:    r.get(1)?,
            member_code:    r.get(2)?,
            has_paid:       amount_paid > 0.0,
            amount_paid,
            payment_method: r.get(4)?,
            paid_at:        r.get(5)?,
            payment_count:  r.get(6)?,
            total_savings:  r.get(7)?,
            installments_paid,
            behind_by,
        })
    })?;

    let mut members = Vec::new();
    for row in rows { members.push(row?); }

    let total_members  = members.len() as i64;
    let paid_count     = members.iter().filter(|m| m.has_paid).count() as i64;
    let total_collected = members.iter().map(|m| m.amount_paid).sum();
    let behind_count   = members.iter().filter(|m| m.behind_by > 0).count() as i64;

    Ok(WeeklyContributionSummary {
        from_date: from_date.to_string(),
        to_date: to_date.to_string(),
        total_members,
        paid_count,
        pending_count: total_members - paid_count,
        total_collected,
        current_installment_number,
        behind_count,
        members,
    })
}
