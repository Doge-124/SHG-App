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
use rusqlite::OptionalExtension;
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
    /// The member a chit payout/commission row is FOR. A cycle can have several
    /// winners, so this — not `reference_id` (the cycle) — is what identifies them.
    member_ref_id: Option<i64>,
}

fn load_txn(conn: &Connection, txn_id: i64) -> Result<ShgTxn, AppError> {
    conn.query_row(
        "SELECT id, txn_type, amount, reason, payment_method, reference_type,
                reference_id, created_at, voided_at, reversal_of_id, group_id,
                member_ref_id
         FROM shg_transactions WHERE id = ?1",
        [txn_id],
        |r| Ok(ShgTxn {
            id: r.get(0)?, txn_type: r.get(1)?, amount: r.get(2)?,
            reason: r.get(3)?, payment_method: r.get(4)?, reference_type: r.get(5)?,
            reference_id: r.get(6)?, created_at: r.get(7)?,
            voided_at: r.get(8)?, reversal_of_id: r.get(9)?, group_id: r.get(10)?,
            member_ref_id: r.get(11)?,
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
        Some("SAVINGS_WITHDRAWAL")   => cancel_savings_withdrawal(conn, &txn, total, reason),
        _                            => cancel_manual(conn, &txn, reason),
    }
}

/// One-time repair for the mixed-reversal bug: cancelling a MIXED loan repayment
/// or chit payout used to reverse only the clicked half, leaving the sibling half
/// live and the SHG balance off by that amount. Find any still-live original row
/// whose mixed-payment group has already been (partly) voided, and reverse it too.
///
/// Safe + idempotent: a fully-live group (nothing voided) is untouched, and once a
/// straggler is reversed it is no longer live so it won't be picked up again.
/// Returns the number of rows repaired.
pub fn repair_orphaned_mixed_reversals(conn: &mut Connection) -> Result<usize, AppError> {
    let ids: Vec<i64> = {
        let mut stmt = match conn.prepare(
            "SELECT t.id FROM shg_transactions t
             WHERE t.group_id IS NOT NULL
               AND t.voided_at IS NULL
               AND t.reversal_of_id IS NULL
               AND EXISTS (
                   SELECT 1 FROM shg_transactions s
                   WHERE s.group_id = t.group_id AND s.voided_at IS NOT NULL
               )",
        ) {
            Ok(s) => s,
            Err(_) => return Ok(0), // e.g. group_id column absent on very old DBs
        };
        let rows = stmt.query_map([], |r| r.get::<_, i64>(0))?;
        let mut v = Vec::new();
        for r in rows {
            if let Ok(id) = r { v.push(id); }
        }
        v
    };
    if ids.is_empty() {
        return Ok(0);
    }

    let tx = conn.transaction()?;
    let mut repaired = 0usize;
    for id in ids {
        let txn = load_txn(&tx, id)?;
        void_and_reverse(&tx, &txn, "Auto-repair: completed a partially-reversed mixed payment")?;
        audit::log_audit_tx(&tx, "MIXED_REVERSAL_REPAIR", "shg_transaction",
            Some(txn.id), &format!("Reversed stranded {} half Rs.{:.2} ({})",
                txn.payment_method, txn.amount, txn.reference_type.as_deref().unwrap_or("")))?;
        repaired += 1;
    }
    tx.commit()?;
    Ok(repaired)
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

    // member_ref_id must be carried across. Without it the reversal falls back to
    // resolving the member from the cycle (reference_id), and a multi-winner cycle
    // has only one `chit_cycles.winning_member_id` — so every reversal in that
    // cycle would name the same wrong member.
    tx.execute(
        "INSERT INTO shg_transactions
           (txn_type, amount, reason, payment_method, reference_type,
            reference_id, created_at, reversal_of_id, member_ref_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        (
            reverse_type, original.amount, &reverse_reason, &original.payment_method,
            &original.reference_type, original.reference_id,
            chrono::Utc::now().to_rfc3339(), original.id, original.member_ref_id,
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

    // Reverse the receipt(s). void_group handles a cash+bank mixed repayment so
    // BOTH halves are reversed (the loan side above already used the group total).
    void_group(&tx, txn, reason)?;

    audit::log_audit_tx(&tx, "TXN_CANCELLED", "shg_transaction",
        Some(txn.id), &format!("MEMBER_PAYMENT reversed (loan #{}, Rs.{}): {}", loan_id, total, reason))?;
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

    // One receipt can back SEVERAL chit_payments rows — a batch dues collection
    // records one receipt for many cycles, all inserted with the receipt's exact
    // paid_at. Match every chit_payment created at the same instant for this member
    // (a normal single payment matches exactly one row). Late-dues on already-drawn
    // cycles are cancellable: deleting the chit_payments + reversing the receipt keeps
    // the accrual and cash consistent, and the winner's payout is untouched.
    let payment_ids: Vec<i64> = {
        let mut stmt = conn.prepare(
            "SELECT id FROM chit_payments WHERE member_id = ?1 AND paid_at = ?2",
        )?;
        let rows = stmt.query_map((member_id, &txn.created_at), |r| r.get::<_, i64>(0))?;
        let mut v = Vec::new();
        for r in rows { if let Ok(id) = r { v.push(id); } }
        v
    };

    if payment_ids.is_empty() {
        return Err(AppError::business(
            "Couldn't match this receipt to a chit installment record. It may have already been cancelled."));
    }

    let tx = conn.transaction()?;
    for pid in &payment_ids {
        tx.execute("DELETE FROM chit_payments WHERE id = ?1", [pid])?;
    }
    // Reverse the receipt(s) — void_group handles a cash+bank mixed receipt group.
    void_group(&tx, txn, reason)?;
    audit::log_audit_tx(&tx, "TXN_CANCELLED", "shg_transaction",
        Some(txn.id), &format!("CHIT_PAYMENT reversed ({} cycle(s), Rs.{}): {}",
            payment_ids.len(), total, reason))?;
    tx.commit()?;
    Ok(())
}

/// Which winner a payout voucher belongs to. `member_ref_id` is authoritative;
/// vouchers written before that column existed fall back to the cycle's legacy
/// single-winner pointer, which only means anything when the cycle has one winner.
fn payout_winner_id(conn: &Connection, txn: &ShgTxn, cycle_id: i64) -> Result<i64, AppError> {
    if let Some(m) = txn.member_ref_id {
        return Ok(m);
    }
    let winners: Vec<i64> = {
        let mut stmt = conn.prepare(
            "SELECT member_id FROM chit_cycle_winners WHERE cycle_id = ?1",
        )?;
        let rows = stmt.query_map([cycle_id], |r| r.get::<_, i64>(0))?;
        rows.filter_map(|r| r.ok()).collect()
    };
    if winners.len() == 1 {
        return Ok(winners[0]);
    }
    conn.query_row(
        "SELECT winning_member_id FROM chit_cycles WHERE id = ?1",
        [cycle_id],
        |r| r.get::<_, Option<i64>>(0),
    ).ok().flatten().ok_or_else(|| AppError::business(
        "This payout voucher is not linked to a specific winner and the cycle has several \
         winners, so there is no way to tell which payout to reverse."
    ))
}

/// Cancel ONE winner's payout. A cycle can have several winners, each with their own
/// payout voucher and commission receipt, so only the clicked winner is unwound: their
/// winner slot is freed, their commission reversed, their voucher reversed. Everyone
/// else keeps their payout, their commission, and their one-win-per-member lock.
fn cancel_chit_payout_with_commission(
    conn: &mut Connection,
    txn: &ShgTxn,
    reason: &str,
) -> Result<(), AppError> {
    let cycle_id = txn.reference_id.ok_or_else(||
        AppError::business("Chit payout voucher has no cycle reference."))?;
    let member_id = payout_winner_id(conn, txn, cycle_id)?;

    let tx = conn.transaction()?;

    // Free only this winner's slot, dropping the cycle below its required winner
    // count so this one seat can be re-paid. Deleting every winner (the old
    // behaviour) both stranded the other winners' live payout vouchers and let them
    // win again — chit_cycle_winners is what enforces one win per member per chit.
    tx.execute(
        "DELETE FROM chit_cycle_winners WHERE cycle_id = ?1 AND member_id = ?2",
        (cycle_id, member_id),
    )?;

    // Recompute the cycle's legacy single-winner columns from whoever is left.
    // winning_member_id only needs re-pointing when it named the cancelled member;
    // the discount totals are derived, so re-sum them from the surviving rows.
    let remaining: Option<i64> = tx.query_row(
        "SELECT member_id FROM chit_cycle_winners WHERE cycle_id = ?1 LIMIT 1",
        [cycle_id], |r| r.get(0),
    ).optional()?;
    let remaining_discounts: f64 = tx.query_row(
        "SELECT COALESCE(SUM(bid_discount), 0) FROM chit_cycle_winners WHERE cycle_id = ?1",
        [cycle_id], |r| r.get(0),
    ).unwrap_or(0.0);
    let current_pointer: Option<i64> = tx.query_row(
        "SELECT winning_member_id FROM chit_cycles WHERE id = ?1",
        [cycle_id], |r| r.get(0),
    ).unwrap_or(None);

    if remaining.is_none() {
        // Last winner removed — the cycle is fully back to its pre-payout state.
        tx.execute(
            "UPDATE chit_cycles
             SET winning_member_id = NULL, bid_discount = 0, payout_amount = 0,
                 total_bid_discounts = 0
             WHERE id = ?1",
            [cycle_id],
        )?;
    } else {
        let new_pointer = if current_pointer == Some(member_id) { remaining } else { current_pointer };
        tx.execute(
            "UPDATE chit_cycles
             SET winning_member_id = ?1, bid_discount = ?2, total_bid_discounts = ?2
             WHERE id = ?3",
            (new_pointer, remaining_discounts, cycle_id),
        )?;
    }

    // Reverse only this winner's commission receipt(s). Commissions are pinned to
    // their member via member_ref_id; untagged rows are only safe to claim when no
    // other winner is left, otherwise we would reverse someone else's income.
    let tagged: Vec<i64> = {
        let mut stmt = tx.prepare(
            "SELECT id FROM shg_transactions
             WHERE reference_type = 'CHIT_COMMISSION' AND reference_id = ?1
               AND member_ref_id = ?2
               AND voided_at IS NULL AND reversal_of_id IS NULL"
        )?;
        let rows = stmt.query_map((cycle_id, member_id), |r| r.get::<_, i64>(0))?;
        rows.filter_map(|r| r.ok()).collect()
    };
    let commission_ids: Vec<i64> = if !tagged.is_empty() || remaining.is_some() {
        tagged
    } else {
        let mut stmt = tx.prepare(
            "SELECT id FROM shg_transactions
             WHERE reference_type = 'CHIT_COMMISSION' AND reference_id = ?1
               AND member_ref_id IS NULL
               AND voided_at IS NULL AND reversal_of_id IS NULL"
        )?;
        let rows = stmt.query_map([cycle_id], |r| r.get::<_, i64>(0))?;
        rows.filter_map(|r| r.ok()).collect()
    };
    for cid in commission_ids {
        let commission = load_txn(&tx, cid)?;
        void_and_reverse(&tx, &commission, &format!("Auto-reversed with payout #{}", txn.id))?;
    }

    // Reverse the payout voucher(s). void_group handles a cash+bank mixed payout so
    // both halves are reversed, not just the clicked one.
    void_group(&tx, txn, reason)?;
    audit::log_audit_tx(&tx, "TXN_CANCELLED", "shg_transaction",
        Some(txn.id), &format!("CHIT_PAYOUT reversed for member {} (cycle #{}, Rs.{}): {}",
            member_id, cycle_id, txn.amount, reason))?;
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

/// Cancel a savings payout (SAVINGS_WITHDRAWAL). The payout is the inverse of a
/// contribution: it reduced the member's savings (a negative CONTRIBUTION row +
/// balance decrement) and paid money out (a voucher, possibly a cash+bank
/// group). Reversing it restores the savings balance, removes the withdrawal
/// row, and reverses the voucher(s) so the SHG cash/bank is restored too.
fn cancel_savings_withdrawal(
    conn: &mut Connection,
    txn: &ShgTxn,
    total: f64,
    reason: &str,
) -> Result<(), AppError> {
    let member_id = txn.reference_id.ok_or_else(||
        AppError::business("Savings payout has no member reference."))?;

    let tx = conn.transaction()?;

    // Restore the member's savings balance (the payout decremented it).
    tx.execute(
        "INSERT INTO member_balances (member_id, balance) VALUES (?1, ?2)
         ON CONFLICT(member_id) DO UPDATE SET balance = balance + ?2",
        (member_id, total),
    )?;

    // Remove the negative CONTRIBUTION (withdrawal) row the payout inserted.
    tx.execute(
        "DELETE FROM member_transactions
         WHERE member_id = ?1 AND txn_type = 'CONTRIBUTION'
           AND ABS(amount + ?2) < 0.005 AND created_at = ?3",
        (member_id, total, &txn.created_at),
    )?;

    // Reverse the voucher(s) (restores SHG cash/bank). Handles the cash+bank
    // group for mixed payouts.
    void_group(&tx, txn, reason)?;
    audit::log_audit_tx(&tx, "TXN_CANCELLED", "shg_transaction",
        Some(txn.id), &format!("SAVINGS_PAYOUT reversed (member #{}, Rs.{}): {}", member_id, total, reason))?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;

    /// A four-winner cycle, mirroring the reported case: every winner has their own
    /// winner row, CHIT_PAYOUT voucher, and CHIT_COMMISSION receipt, each pinned to
    /// that member via `member_ref_id`.
    const WINNERS: [i64; 4] = [1, 2, 3, 4];

    fn seed() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(schema::SCHEMA_SQL).unwrap();
        schema::apply_migrations(&mut conn).unwrap();

        for (id, code, name) in [
            (1, "M001", "Asha"), (2, "M002", "Bina"),
            (3, "M003", "Chandra"), (4, "M004", "Divya"),
        ] {
            conn.execute(
                "INSERT INTO members (id, member_code, name, joined_at) VALUES (?1, ?2, ?3, '2026-01-01')",
                rusqlite::params![id, code, name],
            ).unwrap();
        }
        conn.execute(
            "INSERT INTO chit_groups (id, name, total_amount, months, total_members,
                                      monthly_contribution, commission_percent, start_date,
                                      status, winners_per_cycle)
             VALUES (7, 'Group A', 100000, 10, 20, 10000, 5, '2026-01-01', 'ACTIVE', 4)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO chit_cycles (id, chit_id, cycle_no, auction_date, winning_member_id,
                                      payout_amount, bid_discount, total_bid_discounts)
             VALUES (7, 7, 1, '2026-02-01', 1, 90000, 400, 400)",
            [],
        ).unwrap();

        for m in WINNERS {
            conn.execute(
                "INSERT INTO chit_cycle_winners
                   (chit_id, cycle_id, member_id, winner_type, bid_discount, commission,
                    payout_amount, payment_method, paid_at)
                 VALUES (7, 7, ?1, 'AUCTION', 100, 500, 89500, 'CASH', '2026-02-01T10:00:00Z')",
                [m],
            ).unwrap();
            conn.execute(
                "INSERT INTO shg_transactions
                   (txn_type, amount, reason, payment_method, reference_type,
                    reference_id, created_at, member_ref_id)
                 VALUES ('RECEIPT', 500, 'Chit commission', 'CASH', 'CHIT_COMMISSION',
                         7, '2026-02-01T10:00:00Z', ?1)",
                [m],
            ).unwrap();
            conn.execute(
                "INSERT INTO shg_transactions
                   (txn_type, amount, reason, payment_method, reference_type,
                    reference_id, created_at, member_ref_id)
                 VALUES ('VOUCHER', 90000, 'Chit payout', 'CASH', 'CHIT_PAYOUT',
                         7, '2026-02-01T10:00:00Z', ?1)",
                [m],
            ).unwrap();
        }
        conn
    }

    /// The live payout voucher belonging to one winner.
    fn payout_id_for(conn: &Connection, member_id: i64) -> i64 {
        conn.query_row(
            "SELECT id FROM shg_transactions
             WHERE reference_type = 'CHIT_PAYOUT' AND member_ref_id = ?1
               AND voided_at IS NULL AND reversal_of_id IS NULL",
            [member_id], |r| r.get(0),
        ).unwrap()
    }

    fn payout_id(conn: &Connection) -> i64 {
        payout_id_for(conn, 1)
    }

    fn live_count(conn: &Connection, ref_type: &str) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM shg_transactions
             WHERE reference_type = ?1 AND voided_at IS NULL AND reversal_of_id IS NULL",
            [ref_type], |r| r.get(0),
        ).unwrap()
    }

    fn winner_ids(conn: &Connection) -> Vec<i64> {
        let mut stmt = conn.prepare(
            "SELECT member_id FROM chit_cycle_winners WHERE cycle_id = 7 ORDER BY member_id",
        ).unwrap();
        let v = stmt.query_map([], |r| r.get(0)).unwrap().filter_map(|r| r.ok()).collect();
        v
    }

    /// Cancelling one winner's payout must not touch the other three. The old code
    /// deleted every winner row and reversed every commission while reversing only
    /// the clicked voucher — stranding three live payouts with no winner record and
    /// releasing all four members to win again.
    #[test]
    fn cancelling_one_payout_leaves_the_other_winners_intact() {
        let mut conn = seed();
        let id = payout_id_for(&conn, 2);
        cancel_shg_transaction(&mut conn, id, "paid the wrong member").unwrap();

        assert_eq!(winner_ids(&conn), vec![1, 3, 4], "only the cancelled winner is freed");
        assert_eq!(live_count(&conn, "CHIT_COMMISSION"), 3, "other commissions untouched");
        assert_eq!(live_count(&conn, "CHIT_PAYOUT"), 3, "other payouts untouched");
    }

    /// The reversed commission must be the cancelled member's, not somebody else's.
    #[test]
    fn only_the_cancelled_winners_commission_is_reversed() {
        let mut conn = seed();
        let id = payout_id_for(&conn, 2);
        cancel_shg_transaction(&mut conn, id, "paid the wrong member").unwrap();

        let voided: Vec<i64> = {
            let mut stmt = conn.prepare(
                "SELECT member_ref_id FROM shg_transactions
                 WHERE reference_type = 'CHIT_COMMISSION' AND voided_at IS NOT NULL",
            ).unwrap();
            stmt.query_map([], |r| r.get(0)).unwrap().filter_map(|r| r.ok()).collect()
        };
        assert_eq!(voided, vec![2], "exactly the cancelled winner's commission");
    }

    /// The cycle pointer must move off the cancelled member rather than going blank
    /// while three winners remain.
    #[test]
    fn cycle_pointer_moves_to_a_remaining_winner() {
        let mut conn = seed();
        let id = payout_id_for(&conn, 1); // member 1 is the cycle's winning_member_id
        cancel_shg_transaction(&mut conn, id, "duplicate").unwrap();

        let pointer: Option<i64> = conn.query_row(
            "SELECT winning_member_id FROM chit_cycles WHERE id = 7", [], |r| r.get(0),
        ).unwrap();
        assert!(pointer.is_some(), "three winners remain, so the cycle still has one");
        assert_ne!(pointer, Some(1), "pointer must leave the cancelled member");
        let discounts: f64 = conn.query_row(
            "SELECT total_bid_discounts FROM chit_cycles WHERE id = 7", [], |r| r.get(0),
        ).unwrap();
        assert!((discounts - 300.0).abs() < 0.005, "discount total re-summed from 3 winners");
    }

    /// Removing the last winner returns the cycle to its pre-payout state.
    #[test]
    fn removing_every_winner_resets_the_cycle() {
        let mut conn = seed();
        for m in WINNERS {
            let id = payout_id_for(&conn, m);
            cancel_shg_transaction(&mut conn, id, "restart cycle").unwrap();
        }
        assert!(winner_ids(&conn).is_empty());
        assert_eq!(live_count(&conn, "CHIT_COMMISSION"), 0);
        assert_eq!(live_count(&conn, "CHIT_PAYOUT"), 0);

        let (pointer, payout): (Option<i64>, f64) = conn.query_row(
            "SELECT winning_member_id, payout_amount FROM chit_cycles WHERE id = 7",
            [], |r| Ok((r.get(0)?, r.get(1)?)),
        ).unwrap();
        assert_eq!(pointer, None);
        assert!(payout.abs() < 0.005);
    }

    /// Each reversal must name the member its original named. Before the fix the
    /// reversals carried no member_ref_id at all, so reports resolved them from the
    /// cycle and every winner in the cycle collapsed onto one (wrong) member.
    #[test]
    fn reversals_keep_the_original_member() {
        let mut conn = seed();
        let id = payout_id(&conn);
        cancel_shg_transaction(&mut conn, id, "entered twice").unwrap();

        let mut stmt = conn.prepare(
            "SELECT r.reference_type, o.member_ref_id, r.member_ref_id
             FROM shg_transactions r
             JOIN shg_transactions o ON o.id = r.reversal_of_id
             WHERE r.reversal_of_id IS NOT NULL",
        ).unwrap();
        let rows: Vec<(String, Option<i64>, Option<i64>)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap().filter_map(|r| r.ok()).collect();

        assert_eq!(rows.len(), 2, "the winner's commission + their payout");
        for (ref_type, original, reversal) in rows {
            assert!(original.is_some(), "{ref_type}: test seed should pin a member");
            assert_eq!(reversal, original, "{ref_type}: reversal lost the member");
        }
    }

    /// Both winners must still be distinguishable after the cancellation — the
    /// symptom was several reversals all pointing at the same member.
    #[test]
    fn multi_winner_reversals_stay_distinct() {
        let mut conn = seed();
        let id = payout_id(&conn);
        cancel_shg_transaction(&mut conn, id, "entered twice").unwrap();

        let mut stmt = conn.prepare(
            "SELECT DISTINCT member_ref_id FROM shg_transactions
             WHERE reversal_of_id IS NOT NULL AND reference_type = 'CHIT_COMMISSION'
             ORDER BY member_ref_id",
        ).unwrap();
        let members: Vec<i64> = stmt.query_map([], |r| r.get(0)).unwrap()
            .filter_map(|r| r.ok()).collect();
        assert_eq!(members, vec![1], "the reversal is attributed to its own winner");
    }

    /// The v2 migration repairs rows already written by the old code.
    #[test]
    fn migration_backfills_existing_reversals() {
        let mut conn = seed();
        let id = payout_id(&conn);
        cancel_shg_transaction(&mut conn, id, "entered twice").unwrap();
        // Simulate the pre-fix state: reversals written without a member.
        conn.execute(
            "UPDATE shg_transactions SET member_ref_id = NULL WHERE reversal_of_id IS NOT NULL",
            [],
        ).unwrap();

        let tx = conn.transaction().unwrap();
        crate::db::migrations::MIGRATIONS
            .iter().find(|m| m.version == 2).map(|m| (m.up)(&tx).unwrap()).unwrap();
        tx.commit().unwrap();

        let unrepaired: i64 = conn.query_row(
            "SELECT COUNT(*) FROM shg_transactions r
             JOIN shg_transactions o ON o.id = r.reversal_of_id
             WHERE o.member_ref_id IS NOT NULL
               AND (r.member_ref_id IS NULL OR r.member_ref_id != o.member_ref_id)",
            [], |r| r.get(0),
        ).unwrap();
        assert_eq!(unrepaired, 0, "every reversal should be restored to its member");
    }
}
