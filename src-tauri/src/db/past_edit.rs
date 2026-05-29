//! Edits/deletes for past-data entries, used to fix mistakes after entry.
//!
//! Every function in this module is intended to be gated behind admin PIN
//! re-auth at the command layer — it does not check the PIN itself.
//!
//! All operations are transactional and reverse every derived ledger row
//! they originally produced, so cached balances stay consistent without
//! needing a separate rebuild.

use rusqlite::Connection;
use chrono::Utc;
use crate::error::AppError;
use crate::db::audit;

// ───── Edit member opening data ──────────────────────────────────────────

/// Replace a member's opening-balance entry in place. The original OPENING
/// member_transaction is removed and a new one inserted; member_balances is
/// updated by the delta; the `members` columns are overwritten with the new
/// values. Audited.
pub fn edit_member_opening_data(
    conn: &mut Connection,
    member_id: i64,
    new_opening_balance: f64,
    new_payment_method: Option<&str>,
    new_past_installments: u32,
) -> Result<(), AppError> {
    if !new_opening_balance.is_finite() || new_opening_balance < 0.0 {
        return Err(AppError::validation("opening_balance must be >= 0"));
    }

    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    // Confirm the member exists and load the prior opening_balance.
    let (current_opening, was_set): (f64, Option<String>) = tx.query_row(
        "SELECT COALESCE(opening_balance, 0), opening_balance_set_at FROM members WHERE id = ?1",
        [member_id],
        |row| Ok((row.get::<_, f64>(0)?, row.get::<_, Option<String>>(1)?)),
    ).map_err(|_| AppError::business("Member not found"))?;

    if was_set.is_none() {
        return Err(AppError::business(
            "Member has no opening data set yet — use 'Set opening data' instead of edit.",
        ));
    }

    // Wipe the existing OPENING ledger row(s) and the balance contribution.
    // We re-insert below for the new value, so the cumulative effect on
    // member_balances is (new - old) regardless of how many rows existed.
    tx.execute(
        "DELETE FROM member_transactions
         WHERE member_id = ?1 AND txn_type = 'OPENING'",
        [member_id],
    )?;

    if new_opening_balance > 0.0 {
        tx.execute(
            "INSERT INTO member_transactions (member_id, amount, txn_type, reason, created_at)
             VALUES (?1, ?2, 'OPENING', 'Opening balance (edited)', ?3)",
            (member_id, new_opening_balance, &now),
        )?;
    }

    let delta = new_opening_balance - current_opening;
    if delta.abs() > 0.005 {
        tx.execute(
            "INSERT INTO member_balances (member_id, balance) VALUES (?1, ?2)
             ON CONFLICT(member_id) DO UPDATE SET balance = balance + ?2",
            (member_id, delta),
        )?;
    }

    tx.execute(
        "UPDATE members
         SET opening_balance = ?1,
             opening_balance_method = ?2,
             past_installments = ?3,
             opening_balance_set_at = ?4
         WHERE id = ?5",
        (
            new_opening_balance,
            new_payment_method,
            new_past_installments as i64,
            &now,
            member_id,
        ),
    )?;

    audit::log_audit_tx(
        &tx,
        "edit_opening_data",
        "member",
        Some(member_id),
        &format!("opening: {current_opening:.2} → {new_opening_balance:.2}, installments → {new_past_installments}"),
    )?;

    tx.commit()?;
    Ok(())
}

// ───── Delete past loan ──────────────────────────────────────────────────

/// Cascade-delete a loan and every derived row that hangs off it.
/// Loans no longer touch member_balances or member_transactions, so deletion
/// is purely a clean-up of the loan-side tables — savings stay untouched.
pub fn delete_past_loan(conn: &mut Connection, loan_id: i64) -> Result<(), AppError> {
    let tx = conn.transaction()?;

    let (member_id, outstanding, is_past): (i64, f64, i64) = tx.query_row(
        "SELECT member_id, outstanding_amount, COALESCE(is_past_entry, 0) FROM loans WHERE id = ?1",
        [loan_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    ).map_err(|_| AppError::business("Loan not found"))?;

    if is_past == 0 {
        return Err(AppError::business(
            "This is a live loan, not a past-data entry. Refusing to delete — it would orphan SHG ledger rows.",
        ));
    }

    // Also clean up any legacy LOAN/PAYMENT rows on member_transactions
    // (pre-fix writes — current loan paths don't add new ones).
    tx.execute(
        "DELETE FROM member_transactions WHERE reference_loan_id = ?1",
        [loan_id],
    )?;
    tx.execute("DELETE FROM loan_payments WHERE loan_id = ?1", [loan_id])?;

    // NOTE: live (non-past) loans also created SHG ledger entries
    // (RECEIPT/VOUCHER) via the ledger module. We leave those alone — they
    // reflect actual cash movement and the user can void them via the
    // vouchers/receipts page if needed.
    tx.execute("DELETE FROM loans WHERE id = ?1", [loan_id])?;

    audit::log_audit_tx(
        &tx,
        "delete_past_loan",
        "loan",
        Some(loan_id),
        &format!("member_id={member_id}, deleted_outstanding={outstanding:.2}"),
    )?;

    tx.commit()?;
    Ok(())
}

// ───── Delete past chit cycle ────────────────────────────────────────────

/// Delete a past chit cycle along with its winners and member payments.
/// Past chit entries are reference-only on the SHG ledger, so this only
/// touches chit-scoped tables — no SHG balance impact to reverse.
pub fn delete_past_chit_cycle(conn: &mut Connection, cycle_id: i64) -> Result<(), AppError> {
    let tx = conn.transaction()?;

    let (chit_id, cycle_no, is_past): (i64, i64, i64) = tx.query_row(
        "SELECT chit_id, cycle_no, COALESCE(is_past_entry, 0) FROM chit_cycles WHERE id = ?1",
        [cycle_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    ).map_err(|_| AppError::business("Chit cycle not found"))?;

    if is_past == 0 {
        return Err(AppError::business(
            "This is a live chit cycle, not a past-data entry. Refusing to delete — it would orphan SHG receipts/payouts.",
        ));
    }

    tx.execute("DELETE FROM chit_cycle_winners WHERE cycle_id = ?1", [cycle_id])?;
    tx.execute("DELETE FROM chit_payments WHERE cycle_id = ?1", [cycle_id])?;
    tx.execute("DELETE FROM chit_member_eligibility WHERE cycle_id = ?1", [cycle_id])?;
    tx.execute("DELETE FROM chit_cycles WHERE id = ?1", [cycle_id])?;

    audit::log_audit_tx(
        &tx,
        "delete_past_chit_cycle",
        "chit_cycle",
        Some(cycle_id),
        &format!("chit_id={chit_id}, cycle_no={cycle_no}"),
    )?;

    tx.commit()?;
    Ok(())
}
