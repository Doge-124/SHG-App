//! Cancellation for SHG transactions (receipts + vouchers).
//!
//! `cancel_shg_transaction(id, reason)` dispatches on the original row's
//! `reference_type` and:
//!   1. Cleans up derived state (loan, chit, contribution) where applicable.
//!   2. Inserts a paired reversing entry — opposite txn_type, same amount,
//!      `reversal_of_id` pointing back. The two rows always net to zero in
//!      balance queries.
//!   3. Marks the original `voided_at` + `voided_reason` for audit.
//!
//! All steps run inside a single SQLite transaction.

use rusqlite::Connection;
use crate::error::AppError;
use crate::db::audit;

#[derive(Debug, Clone)]
struct ShgTxn {
    id: i64,
    txn_type: String,
    amount: f64,
    reason: String,
    payment_method: String,
    reference_type: Option<String>,
    reference_id: Option<i64>,
    created_at: String,
    voided_at: Option<i64>,
    reversal_of_id: Option<i64>,
    group_id: Option<String>,
}

fn load_txn(conn: &Connection, txn_id: i64) -> Result<ShgTxn, AppError> {
    conn.query_row(
        "SELECT id, txn_type, amount, reason, payment_method, reference_type,
                reference_id, created_at, voided_at, reversal_of_id, group_id
         FROM shg_transactions WHERE id = ?1",
        [txn_id],
        |r| Ok(ShgTxn {
            id: r.get(0)?, txn_type: r.get(1)?, amount: r.get(2)?,
            reason: r.get(3)?, payment_method: r.get(4)?, reference_type: r.get(5)?,
            reference_id: r.get(6)?, created_at: r.get(7)?,
            voided_at: r.get(8)?, reversal_of_id: r.get(9)?, group_id: r.get(10)?,
        }),
    ).map_err(|_| AppError::business("Transaction not found"))
}

/// Total amount across a mixed-payment group (or just this row's amount when
/// the transaction isn't part of a group). The derived row (loan_payment /
/// chit_payment / member savings) carries the TOTAL, so cancellation must
/// match against this, not the individual cash/bank half.
fn group_total(conn: &Connection, txn: &ShgTxn) -> f64 {
    match &txn.group_id {
        Some(g) => conn.query_row(
            "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
             WHERE group_id = ?1 AND reversal_of_id IS NULL",
            [g], |r| r.get(0),
        ).unwrap_or(txn.amount),
        None => txn.amount,
    }
}

/// Void + reverse the clicked row AND every other live row in its mixed-payment
/// group. Each row is reversed with its own real cash/bank amount, so balances
/// stay correct. No-op beyond the single row when there's no group.
fn void_group(tx: &rusqlite::Transaction, anchor: &ShgTxn, reason: &str) -> Result<(), AppError> {
    void_and_reverse(tx, anchor, reason)?;
    if let Some(g) = &anchor.group_id {
        let mut stmt = tx.prepare(
            "SELECT id FROM shg_transactions
             WHERE group_id = ?1 AND id != ?2
               AND voided_at IS NULL AND reversal_of_id IS NULL",
        )?;
        let ids: Vec<i64> = stmt.query_map((g, anchor.id), |r| r.get(0))?
            .filter_map(|r| r.ok()).collect();
        drop(stmt);
        for id in ids {
            let sibling = load_txn(tx, id)?;
            void_and_reverse(tx, &sibling, reason)?;
        }
    }
    Ok(())
}

/// Public entry point. Caller is expected to verify admin PIN beforehand.
pub fn cancel_shg_transaction(
    conn: &mut Connection,
    txn_id: i64,
    reason: &str,
) -> Result<(), AppError> {
    let txn = load_txn(conn, txn_id)?;

    if txn.voided_at.is_some() {
        return Err(AppError::business("This transaction is already cancelled."));
    }
    if txn.reversal_of_id.is_some() {
        return Err(AppError::business(
            "This row is itself a reversal of another cancellation. Cancel the original instead."
        ));
    }
    if txn.txn_type == "OPENING" || txn.reference_type.as_deref() == Some("OPENING") {
        return Err(AppError::business(
            "Opening balance entries cannot be cancelled. Adjust via Settings → SHG Opening Balance."
        ));
    }
    if txn.reference_type.as_deref() == Some("CHIT_COMMISSION") {
        return Err(AppError::business(
            "Commission is part of a chit payout. Cancel the linked CHIT_PAYOUT entry — the commission will be reversed with it."
        ));
    }

    // Dispatch — each branch is responsible for cleaning up any derived
    // state, then must call `void_and_reverse` to complete the bookkeeping.
    // Total across the mixed-payment group (== txn.amount for single-method).
    let total = group_total(conn, &txn);

    match txn.reference_type.as_deref() {
        Some("MEMBER_LOAN")          => cancel_loan_disbursement(conn, &txn, total, reason),
        Some("MEMBER_PAYMENT")       => cancel_loan_repayment(conn, &txn, total, reason),
        Some("CHIT_PAYMENT")         => cancel_chit_installment(conn, &txn, total, reason),
        Some("CHIT_PAYOUT")          => cancel_chit_payout_with_commission(conn, &txn, reason),
        Some("WEEKLY_CONTRIBUTION") | Some("MEMBER_CONTRIBUTION")
                                     => cancel_member_contribution(conn, &txn, total, reason),
        _                            => cancel_manual(conn, &txn, reason),
    }
}

// ───── Bookkeeping primitives ────────────────────────────────────────────

/// Insert the reversing row and mark the original voided. All other tables
/// are the caller's responsibility (must run within the same transaction).
fn void_and_reverse(
    tx: &rusqlite::Transaction,
    original: &ShgTxn,
    reason: &str,
) -> Result<(), AppError> {
    let now = chrono::Utc::now().timestamp_millis();

    // Reversing row: opposite txn_type, same amount + method.
    let reverse_type = match original.txn_type.as_str() {
        "RECEIPT" => "VOUCHER",
        "VOUCHER" => "RECEIPT",
        other => return Err(AppError::business(&format!("Cannot reverse txn_type '{other}'"))),
    };
    let reverse_reason = format!("Reversal of #{}: {}", original.id, reason);

    tx.execute(
        "INSERT INTO shg_transactions
           (txn_type, amount, reason, payment_method, reference_type,
            reference_id, created_at, reversal_of_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        (
            reverse_type, original.amount, &reverse_reason, &original.payment_method,
            &original.reference_type, original.reference_id,
            chrono::Utc::now().to_rfc3339(), original.id,
        ),
    )?;

    // Update the live balance to reflect the reversal. (Original's effect
    // stays in the ledger via the voided row; the new row cancels it out.)
    let delta = match original.txn_type.as_str() {
        "RECEIPT" => -original.amount,
        "VOUCHER" =>  original.amount,
        _ => 0.0,
    };
    tx.execute(
        "UPDATE shg_balances SET balance = balance + ?1 WHERE method = ?2",
        (delta, &original.payment_method),
    )?;

    // Mark original voided.
    tx.execute(
        "UPDATE shg_transactions SET voided_at = ?1, voided_reason = ?2 WHERE id = ?3",
        (now, reason, original.id),
    )?;

    Ok(())
}

// ───── Per-reference_type unwinders ──────────────────────────────────────

fn cancel_manual(
    conn: &mut Connection,
    txn: &ShgTxn,
    reason: &str,
) -> Result<(), AppError> {
    let tx = conn.transaction()?;
    void_group(&tx, txn, reason)?;
    audit::log_audit_tx(&tx, "TXN_CANCELLED", "shg_transaction",
        Some(txn.id), &format!("manual {}, Rs.{}: {}", txn.txn_type, txn.amount, reason))?;
    tx.commit()?;
    Ok(())
}

fn cancel_loan_disbursement(
    conn: &mut Connection,
    txn: &ShgTxn,
    total: f64,
    reason: &str,
) -> Result<(), AppError> {
    let member_id = txn.reference_id.ok_or_else(||
        AppError::business("Loan disbursement entry has no member reference."))?;

    // Find the matching loan: same member, same amount, issued at the same
    // date (the voucher's created_at is loan.issued_at by construction).
    let date_prefix = &txn.created_at[..10.min(txn.created_at.len())];
    let loan_id: Option<i64> = conn.query_row(
        "SELECT id FROM loans
         WHERE member_id = ?1 AND ABS(amount - ?2) < 0.005
           AND substr(issued_at, 1, 10) = ?3
         ORDER BY id DESC LIMIT 1",
        (member_id, total, date_prefix),
        |r| r.get(0),
    ).ok();

    let loan_id = loan_id.ok_or_else(||
        AppError::business("Couldn't match this voucher to an existing loan. The loan may have already been deleted or modified."))?;

    // Refuse if the loan has any subsequent (non-upfront) repayment.
    let live_repayments: i64 = conn.query_row(
        "SELECT COUNT(*) FROM loan_payments
         WHERE loan_id = ?1 AND note != 'Upfront Interest'",
        [loan_id], |r| r.get(0),
    ).unwrap_or(0);
    if live_repayments > 0 {
        return Err(AppError::business(
            "This loan has repayments recorded against it. Cancel the repayments first, then cancel this disbursement."
        ));
    }

    let tx = conn.transaction()?;

    // Drop derived rows. Loan paths no longer touch member_balances, so we
    // just clean up the loan-side tables. (The legacy LOAN/PAYMENT entries
    // on member_transactions, if any, are cleaned up for tidiness.)
    tx.execute("DELETE FROM member_transactions WHERE reference_loan_id = ?1", [loan_id])?;
    tx.execute("DELETE FROM loan_payments WHERE loan_id = ?1", [loan_id])?;
    tx.execute("DELETE FROM loans WHERE id = ?1", [loan_id])?;

    // Also reverse the upfront-interest receipt if one exists. It was a
    // sibling shg_transactions row created on the same created_at with
    // reference_type MEMBER_PAYMENT and note 'Upfront Interest' on its
    // loan_payment side. Match by member + created_at + same date.
    let upfront_txn_id: Option<i64> = tx.query_row(
        "SELECT id FROM shg_transactions
         WHERE reference_type = 'MEMBER_PAYMENT' AND reference_id = ?1
           AND created_at = ?2 AND reason = 'Upfront Interest'
           AND voided_at IS NULL",
        (member_id, &txn.created_at),
        |r| r.get(0),
    ).ok();
    if let Some(id) = upfront_txn_id {
        let upfront = load_txn(&tx, id)?;
        void_and_reverse(&tx, &upfront, &format!("Auto-reversed with disbursement #{}", txn.id))?;
    }

    void_group(&tx, txn, reason)?;

    audit::log_audit_tx(&tx, "TXN_CANCELLED", "shg_transaction",
        Some(txn.id), &format!("MEMBER_LOAN disbursement reversed (loan #{}, Rs.{}): {}", loan_id, total, reason))?;
    tx.commit()?;
    Ok(())
}

fn cancel_loan_repayment(
    conn: &mut Connection,
    txn: &ShgTxn,
    total: f64,
    reason: &str,
) -> Result<(), AppError> {
    let member_id = txn.reference_id.ok_or_else(||
        AppError::business("Repayment receipt has no member reference."))?;

    // Find the matching loan_payments row.
    let payment_row: Option<(i64, i64, f64, f64, String)> = conn.query_row(
        "SELECT id, loan_id, principal_amount, interest_amount, created_at
         FROM loan_payments
         WHERE member_id = ?1 AND ABS(amount - ?2) < 0.005
           AND created_at = ?3 AND note != 'Upfront Interest'
         ORDER BY id DESC LIMIT 1",
        (member_id, total, &txn.created_at),
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
    ).ok();

    let (payment_id, loan_id, principal_amt, interest_amt, _) = payment_row.ok_or_else(||
        AppError::business("Couldn't match this receipt to a recorded loan payment. It may have already been deleted."))?;

    // Refuse if this isn't the most recent payment on the loan — reversing
    // a middle payment would corrupt the unpaid-interest carry-over chain.
    let latest_id: i64 = conn.query_row(
        "SELECT id FROM loan_payments
         WHERE loan_id = ?1 AND note != 'Upfront Interest'
         ORDER BY created_at DESC, id DESC LIMIT 1",
        [loan_id], |r| r.get(0),
    ).unwrap_or(0);
    if latest_id != payment_id {
        return Err(AppError::business(
            "Only the most recent repayment on a loan can be cancelled. Cancel later repayments first."
        ));
    }

    let tx = conn.transaction()?;

    // Restore loan outstanding + unpaid interest balance.
    tx.execute(
        "UPDATE loans
         SET outstanding_amount = outstanding_amount + ?1,
             unpaid_interest_balance = COALESCE(unpaid_interest_balance, 0) + ?2,
             status = 'active'
         WHERE id = ?3",
        (principal_amt, interest_amt, loan_id),
    )?;

    // Loan repayments no longer touch member_balances. We still clean up
    // any legacy PAYMENT row on member_transactions (best-effort match).
    if principal_amt.abs() > 0.005 {
        tx.execute(
            "DELETE FROM member_transactions
             WHERE reference_loan_id = ?1 AND txn_type = 'PAYMENT'
               AND ABS(amount + ?2) < 0.005 AND created_at = ?3",
            (loan_id, principal_amt, &txn.created_at),
        )?;
    }
    // Suppress "unused" warning — member_id is fetched for symmetry with
    // other unwinders and may be needed for future audit detail.
    let _ = member_id;

    // Drop the loan_payments row.
    tx.execute("DELETE FROM loan_payments WHERE id = ?1", [payment_id])?;

    void_and_reverse(&tx, txn, reason)?;

    audit::log_audit_tx(&tx, "TXN_CANCELLED", "shg_transaction",
        Some(txn.id), &format!("MEMBER_PAYMENT reversed (loan #{}, Rs.{}): {}", loan_id, txn.amount, reason))?;
    tx.commit()?;
    Ok(())
}

fn cancel_chit_installment(
    conn: &mut Connection,
    txn: &ShgTxn,
    total: f64,
    reason: &str,
) -> Result<(), AppError> {
    let member_id = txn.reference_id.ok_or_else(||
        AppError::business("Chit installment receipt has no member reference."))?;

    // Find the chit_payments row.
    let pay: Option<(i64, i64, i64)> = conn.query_row(
        "SELECT id, chit_id, cycle_id FROM chit_payments
         WHERE member_id = ?1 AND ABS(amount - ?2) < 0.005
           AND paid_at = ?3
         ORDER BY id DESC LIMIT 1",
        (member_id, total, &txn.created_at),
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    ).ok();

    let (payment_id, _chit_id, cycle_id) = pay.ok_or_else(||
        AppError::business("Couldn't match this receipt to a chit installment record."))?;

    // Refuse if the cycle has already been paid out.
    let winner_set: bool = conn.query_row(
        "SELECT winning_member_id IS NOT NULL FROM chit_cycles WHERE id = ?1",
        [cycle_id], |r| r.get(0),
    ).unwrap_or(false);
    if winner_set {
        return Err(AppError::business(
            "This cycle has already been paid out to a winner. Cancel the payout first, then cancel this installment."
        ));
    }

    let tx = conn.transaction()?;
    tx.execute("DELETE FROM chit_payments WHERE id = ?1", [payment_id])?;
    void_group(&tx, txn, reason)?;
    audit::log_audit_tx(&tx, "TXN_CANCELLED", "shg_transaction",
        Some(txn.id), &format!("CHIT_PAYMENT reversed (cycle #{}, Rs.{}): {}", cycle_id, total, reason))?;
    tx.commit()?;
    Ok(())
}

fn cancel_chit_payout_with_commission(
    conn: &mut Connection,
    txn: &ShgTxn,
    reason: &str,
) -> Result<(), AppError> {
    let cycle_id = txn.reference_id.ok_or_else(||
        AppError::business("Chit payout voucher has no cycle reference."))?;

    let tx = conn.transaction()?;

    // Drop winners + clear winning_member_id so the cycle is re-payable.
    tx.execute("DELETE FROM chit_cycle_winners WHERE cycle_id = ?1", [cycle_id])?;
    tx.execute(
        "UPDATE chit_cycles
         SET winning_member_id = NULL, bid_discount = 0, payout_amount = 0
         WHERE id = ?1",
        [cycle_id],
    )?;

    // Reverse any associated commission receipt(s).
    let mut stmt = tx.prepare(
        "SELECT id FROM shg_transactions
         WHERE reference_type = 'CHIT_COMMISSION' AND reference_id = ?1
           AND voided_at IS NULL AND reversal_of_id IS NULL"
    )?;
    let commission_ids: Vec<i64> = stmt.query_map([cycle_id], |r| r.get(0))?
        .filter_map(|r| r.ok()).collect();
    drop(stmt);
    for cid in commission_ids {
        let commission = load_txn(&tx, cid)?;
        void_and_reverse(&tx, &commission, &format!("Auto-reversed with payout #{}", txn.id))?;
    }

    void_and_reverse(&tx, txn, reason)?;
    audit::log_audit_tx(&tx, "TXN_CANCELLED", "shg_transaction",
        Some(txn.id), &format!("CHIT_PAYOUT reversed (cycle #{}, Rs.{}): {}", cycle_id, txn.amount, reason))?;
    tx.commit()?;
    Ok(())
}

fn cancel_member_contribution(
    conn: &mut Connection,
    txn: &ShgTxn,
    total: f64,
    reason: &str,
) -> Result<(), AppError> {
    let member_id = txn.reference_id.ok_or_else(||
        AppError::business("Contribution receipt has no member reference."))?;

    let tx = conn.transaction()?;

    // Reverse member savings balance + delete the CONTRIBUTION member_transactions row.
    tx.execute(
        "INSERT INTO member_balances (member_id, balance) VALUES (?1, ?2)
         ON CONFLICT(member_id) DO UPDATE SET balance = balance - ?2",
        (member_id, total),
    )?;

    let deleted: usize = tx.execute(
        "DELETE FROM member_transactions
         WHERE member_id = ?1 AND txn_type = 'CONTRIBUTION'
           AND ABS(amount - ?2) < 0.005 AND created_at = ?3",
        (member_id, total, &txn.created_at),
    )?;

    if deleted > 0 {
        // Roll back the installment counter (the original write incremented it).
        tx.execute(
            "UPDATE members
             SET current_installments = MAX(current_installments - 1, 0)
             WHERE id = ?1",
            [member_id],
        )?;
    }

    void_group(&tx, txn, reason)?;
    audit::log_audit_tx(&tx, "TXN_CANCELLED", "shg_transaction",
        Some(txn.id), &format!("CONTRIBUTION reversed (member #{}, Rs.{}): {}", member_id, total, reason))?;
    tx.commit()?;
    Ok(())
}
