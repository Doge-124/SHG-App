//! Member contribution operations for weekly installments.
//!
//! `shg_transactions` stores each contribution with:
//!   txn_type = 'RECEIPT', reference_type = 'WEEKLY_CONTRIBUTION', reference_id = member_id

use rusqlite::Connection;
use crate::error::AppError;
use crate::db::{self, validation};
use chrono::Utc;

/// Input for recording a weekly contribution
#[derive(Debug, serde::Deserialize)]
pub struct WeeklyContributionInput {
    pub member_id: i64,
    pub amount: f64,
    pub payment_method: String,
    pub note: Option<String>,
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

    validation::validate_payment_method(&input.payment_method)?;

    let now = Utc::now().to_rfc3339();
    let payment_method = input.payment_method.clone();

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

    let tx = conn.transaction()?;

    // 1) SHG receipt transaction
    let mut reason = format!("Weekly contribution from {} ({})", member_name, member_code);
    if let Some(note) = &input.note {
        reason.push_str(&format!(" - {}", note));
    }

    tx.execute(
        "INSERT INTO shg_transactions
         (txn_type, amount, reason, payment_method, reference_type, reference_id, created_at)
         VALUES ('RECEIPT', ?1, ?2, ?3, 'WEEKLY_CONTRIBUTION', ?4, ?5)",
        (
            input.amount,
            reason,
            payment_method.clone(),
            input.member_id,
            &now,
        ),
    )?;
    let shg_txn_id = tx.last_insert_rowid();

    // 2) Update SHG balances
    tx.execute(
        "UPDATE shg_balances SET balance = balance + ?1 WHERE method = ?2",
        (input.amount, payment_method.clone()),
    )?;

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
             COALESCE(mb.balance, 0.0)       AS total_savings
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
               AND created_at >= ?1
               AND created_at <= ?2
             GROUP BY reference_id
         ) c ON c.member_id = m.id
         LEFT JOIN member_balances mb ON mb.member_id = m.id
         WHERE m.is_active = 1 AND m.member_type = 'SHG'
         ORDER BY c.last_paid_at DESC NULLS LAST, m.name ASC",
    )?;

    let rows = stmt.query_map([from_date, &to_dt], |r| {
        let amount_paid: f64 = r.get(3)?;
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
        })
    })?;

    let mut members = Vec::new();
    for row in rows { members.push(row?); }

    let total_members  = members.len() as i64;
    let paid_count     = members.iter().filter(|m| m.has_paid).count() as i64;
    let total_collected = members.iter().map(|m| m.amount_paid).sum();

    Ok(WeeklyContributionSummary {
        from_date: from_date.to_string(),
        to_date: to_date.to_string(),
        total_members,
        paid_count,
        pending_count: total_members - paid_count,
        total_collected,
        members,
    })
}
