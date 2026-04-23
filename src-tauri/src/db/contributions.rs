//! Member contribution operations for weekly installments.

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

    let shg_txn_id = tx.execute(
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
    )? as i64;

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
