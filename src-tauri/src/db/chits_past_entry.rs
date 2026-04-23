//! Chit fund past data entry for migrating ongoing chits from books to app.
//!
//! This module handles:
//! - Recording past chit cycles with auction discount
//! - Tracking member payment status vs current cycle
//! - Identifying late payers
//!
//! Auction Discount Logic:
//! - bid_discount is subtracted from EVERY member's payment (not just the winner).
//! - actual_total_collection = N × (gross - bid_discount)
//! - SHG receipt = actual_total_collection (discount noted in the reason)
//! - SHG voucher = winner payout = actual_total_collection

use rusqlite::Connection;
use serde::Serialize;

use crate::error::AppError;
use crate::db::{chits::{ChitGroup, ChitCycle}, ledger};

/// Record past chit cycle data for migration from books.
///
/// The bid_discount is applied to the winning member's stored payment amount
/// (gross - bid_discount), matching how the live cycle flow works.
/// The SHG receipt reflects the actual net amount collected.
///
/// Also tracks member payment status for identifying late payers.
pub fn record_past_chit_cycle(
    conn: &mut Connection,
    chit_id: i64,
    cycle_no: i64,
    auction_date: &str,
    winning_member_id: Option<i64>,
    bid_discount: f64,
    winner_payout: f64,
    member_payments: &[(i64, f64, &str)], // (member_id, amount_paid, payment_method)
) -> Result<(), AppError> {
    // Get chit group details
    let chit: ChitGroup = conn.query_row(
        "SELECT id, name, total_amount, months, monthly_contribution, commission_percent, start_date, status
         FROM chit_groups WHERE id = ?1",
        [chit_id],
        |row| {
            Ok(ChitGroup {
                id: row.get(0)?,
                name: row.get(1)?,
                total_amount: row.get(2)?,
                months: row.get(3)?,
                monthly_contribution: row.get(4)?,
                commission_percent: row.get(5)?,
                start_date: row.get(6)?,
                status: row.get(7)?,
            })
        },
    )?;

    // Validate bid_discount doesn't exceed any member's contribution.
    if bid_discount > 0.0 {
        for (_, amount_paid, _) in member_payments {
            if bid_discount > *amount_paid {
                return Err(AppError::business(format!(
                    "Bid discount ({:.2}) exceeds a member's contribution ({:.2}). \
                     Reduce the discount or correct the member payment amounts.",
                    bid_discount, amount_paid
                )));
            }
        }
    }

    let mut tx = conn.transaction()?;

    // Apply bid_discount to EVERY member's payment — the auction discount reduces
    // what each member pays, not just the winner's contribution.
    let mut actual_total_collection: f64 = 0.0;
    let member_stored_amounts: Vec<(i64, f64, &str)> = member_payments
        .iter()
        .map(|(member_id, amount_paid, payment_method)| {
            let stored = (amount_paid - bid_discount).max(0.0);
            actual_total_collection += stored;
            (*member_id, stored, *payment_method)
        })
        .collect();

    // payout_amount on the cycle = what the winner actually receives (the adjusted total).
    let payout_amount = actual_total_collection;

    // Insert the cycle (or update if exists)
    tx.execute(
        "INSERT INTO chit_cycles
         (chit_id, cycle_no, auction_date, winning_member_id, bid_discount, payout_amount)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(chit_id, cycle_no) DO UPDATE SET
         auction_date = excluded.auction_date,
         winning_member_id = excluded.winning_member_id,
         bid_discount = excluded.bid_discount,
         payout_amount = excluded.payout_amount",
        (chit_id, cycle_no, auction_date, winning_member_id, bid_discount, payout_amount),
    )?;

    // Get the cycle ID (either newly inserted or updated)
    let cycle_id: i64 = tx.query_row(
        "SELECT id FROM chit_cycles WHERE chit_id = ?1 AND cycle_no = ?2",
        (chit_id, cycle_no),
        |row| row.get(0),
    )?;

    // Record each member's stored (net) payment.
    for (member_id, stored_amount, payment_method) in &member_stored_amounts {
        let payment_exists: bool = tx.query_row(
            "SELECT COUNT(*) FROM chit_payments WHERE cycle_id = ?1 AND member_id = ?2",
            (cycle_id, member_id),
            |row| row.get(0),
        ).unwrap_or(0) > 0;

        if payment_exists {
            tx.execute(
                "UPDATE chit_payments
                 SET amount = ?1, payment_method = ?2, paid_at = ?3
                 WHERE cycle_id = ?4 AND member_id = ?5",
                (stored_amount, payment_method, auction_date, cycle_id, member_id),
            )?;
        } else {
            tx.execute(
                "INSERT INTO chit_payments
                 (chit_id, cycle_id, member_id, amount, payment_method, paid_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                (chit_id, cycle_id, member_id, stored_amount, payment_method, auction_date),
            )?;
        }
    }

    // Record SHG receipt for the actual amount collected (winner's discount already deducted).
    if actual_total_collection > 0.0 {
        let receipt_reason = if bid_discount > 0.0 && winning_member_id.is_some() {
            format!(
                "Chit {} - Cycle {} member contributions (auction discount: {})",
                chit.name, cycle_no, bid_discount
            )
        } else {
            format!("Chit {} - Cycle {} member contributions", chit.name, cycle_no)
        };
        ledger::record_receipt(
            &mut tx,
            actual_total_collection,
            &receipt_reason,
            "CASH",
            Some("CHIT_PAYMENT"),
            Some(chit_id),
            auction_date,
        )?;
    }

    // Record winner payout as a voucher (equals actual_total_collection when discount is
    // applied to the winner's payment rather than the payout formula).
    let effective_payout = if winner_payout > 0.0 { winner_payout } else { actual_total_collection };
    if effective_payout > 0.0 && winning_member_id.is_some() {
        ledger::record_voucher_unchecked(
            &mut tx,
            effective_payout,
            &format!("Chit {} - Cycle {} winner payout", chit.name, cycle_no),
            "CASH",
            Some("CHIT_PAYOUT"),
            Some(cycle_id),
            auction_date,
        )?;
    }

    tx.commit()?;
    Ok(())
}

/// Member payment status for tracking late payers
#[derive(Debug, Serialize)]
pub struct MemberPaymentStatus {
    pub member_id: i64,
    pub member_name: String,
    pub cycles_paid: i64,
    pub current_cycle: i64,
    pub late_cycles: Vec<i64>, // List of cycle numbers where payment was late/missing
    pub is_up_to_date: bool,
}

/// Get member payment status for a chit group.
/// Returns how many cycles each member has paid for vs the current cycle.
/// This helps identify late payers.
pub fn get_member_payment_status(
    conn: &Connection,
    chit_id: i64,
) -> Result<Vec<MemberPaymentStatus>, AppError> {
    // Get all members in this chit
    let mut members_stmt = conn.prepare(
        "SELECT cm.member_id, m.name 
         FROM chit_members cm
         JOIN members m ON cm.member_id = m.id
         WHERE cm.chit_id = ?1"
    )?;

    let members: Vec<(i64, String)> = members_stmt
        .query_map([chit_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    // Get the current cycle number (highest cycle number with payments or cycles)
    let current_cycle: i64 = conn.query_row(
        "SELECT COALESCE(MAX(cycle_no), 0) FROM chit_cycles WHERE chit_id = ?1",
        [chit_id],
        |row| row.get(0),
    ).unwrap_or(0);

    let mut result = Vec::new();

    for (member_id, member_name) in members {
        // Count how many cycles this member has paid for
        let cycles_paid: i64 = conn.query_row(
            "SELECT COUNT(DISTINCT cp.cycle_id)
             FROM chit_payments cp
             JOIN chit_cycles cc ON cp.cycle_id = cc.id
             WHERE cc.chit_id = ?1 AND cp.member_id = ?2",
            (chit_id, member_id),
            |row| row.get(0),
        ).unwrap_or(0);

        // Find late/missing cycles
        let mut late_cycles = Vec::new();
        for cycle_no in 1..=current_cycle {
            let paid: bool = conn.query_row(
                "SELECT COUNT(*) > 0
                 FROM chit_payments cp
                 JOIN chit_cycles cc ON cp.cycle_id = cc.id
                 WHERE cc.chit_id = ?1 AND cc.cycle_no = ?2 AND cp.member_id = ?3",
                (chit_id, cycle_no, member_id),
                |row| row.get(0),
            ).unwrap_or(false);

            if !paid {
                late_cycles.push(cycle_no);
            }
        }

        let is_up_to_date = cycles_paid >= current_cycle && current_cycle > 0;

        result.push(MemberPaymentStatus {
            member_id,
            member_name,
            cycles_paid,
            current_cycle,
            late_cycles,
            is_up_to_date,
        });
    }

    Ok(result)
}

/// Detailed cycle information including auction discounts and collection data
#[derive(Debug, Serialize)]
pub struct ChitCycleDetail {
    pub id: i64,
    pub chit_id: i64,
    pub cycle_no: i64,
    pub auction_date: String,
    pub winning_member_id: Option<i64>,
    pub winning_member_name: Option<String>,
    pub bid_discount: f64,
    pub payout_amount: f64,
    pub total_collected: f64,
    pub number_of_payers: i64,
    pub expected_collection: f64,
}

/// Get chit cycles with detailed collection information
pub fn get_chit_cycles_with_details(
    conn: &Connection,
    chit_id: i64,
) -> Result<Vec<ChitCycleDetail>, AppError> {
    // Get monthly contribution for expected collection calculation
    let monthly_contribution: f64 = conn.query_row(
        "SELECT monthly_contribution FROM chit_groups WHERE id = ?1",
        [chit_id],
        |row| row.get(0),
    ).unwrap_or(0.0);

    let mut stmt = conn.prepare(
        "SELECT
            cc.id,
            cc.chit_id,
            cc.cycle_no,
            cc.auction_date,
            cc.winning_member_id,
            m.name as winning_member_name,
            cc.bid_discount,
            cc.payout_amount,
            COALESCE(SUM(cp.amount), 0) as total_collected,
            COUNT(DISTINCT cp.member_id) as number_of_payers
        FROM chit_cycles cc
        LEFT JOIN members m ON cc.winning_member_id = m.id
        LEFT JOIN chit_payments cp ON cc.id = cp.cycle_id
        WHERE cc.chit_id = ?1
        GROUP BY cc.id
        ORDER BY cc.cycle_no ASC"
    )?;

    let cycles = stmt.query_map([chit_id], |row| {
        let num_payers: i64 = row.get(9)?;
        Ok(ChitCycleDetail {
            id: row.get(0)?,
            chit_id: row.get(1)?,
            cycle_no: row.get(2)?,
            auction_date: row.get(3)?,
            winning_member_id: row.get(4)?,
            winning_member_name: row.get(5)?,
            bid_discount: row.get(6)?,
            payout_amount: row.get(7)?,
            total_collected: row.get(8)?,
            number_of_payers: num_payers,
            expected_collection: monthly_contribution * num_payers as f64,
        })
    })?;

    let mut result = Vec::new();
    for cycle in cycles {
        result.push(cycle?);
    }

    Ok(result)
}

/// Summary of chit migration/past data entry status
#[derive(Debug, Serialize)]
pub struct ChitMigrationStatus {
    pub chit_id: i64,
    pub chit_name: String,
    pub total_months: i64,
    pub cycles_entered: i64,
    pub cycles_remaining: i64,
    pub total_members: i64,
    pub members_up_to_date: i64,
    pub members_with_pending: i64,
    pub total_bid_discounts: f64,
    pub total_collected: f64,
    pub is_complete: bool,
}

/// Get migration status for a chit group
pub fn get_chit_migration_status(
    conn: &Connection,
    chit_id: i64,
) -> Result<ChitMigrationStatus, AppError> {
    // Get chit info
    let (chit_name, total_months, monthly_contribution): (String, i64, f64) = conn.query_row(
        "SELECT name, months, monthly_contribution FROM chit_groups WHERE id = ?1",
        [chit_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;

    // Count cycles entered
    let cycles_entered: i64 = conn.query_row(
        "SELECT COUNT(*) FROM chit_cycles WHERE chit_id = ?1",
        [chit_id],
        |row| row.get(0),
    ).unwrap_or(0);

    // Count total members
    let total_members: i64 = conn.query_row(
        "SELECT COUNT(*) FROM chit_members WHERE chit_id = ?1",
        [chit_id],
        |row| row.get(0),
    ).unwrap_or(0);

    // Calculate totals
    let total_bid_discounts: f64 = conn.query_row(
        "SELECT COALESCE(SUM(bid_discount), 0) FROM chit_cycles WHERE chit_id = ?1",
        [chit_id],
        |row| row.get(0),
    ).unwrap_or(0.0);

    let total_collected: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) 
         FROM chit_payments cp
         JOIN chit_cycles cc ON cp.cycle_id = cc.id
         WHERE cc.chit_id = ?1",
        [chit_id],
        |row| row.get(0),
    ).unwrap_or(0.0);

    // Get member payment status to count up-to-date vs pending
    let member_statuses = get_member_payment_status(conn, chit_id)?;
    let members_up_to_date = member_statuses.iter().filter(|m| m.is_up_to_date).count() as i64;
    let members_with_pending = total_members - members_up_to_date;

    Ok(ChitMigrationStatus {
        chit_id,
        chit_name,
        total_months,
        cycles_entered,
        cycles_remaining: total_months - cycles_entered,
        total_members,
        members_up_to_date,
        members_with_pending,
        total_bid_discounts,
        total_collected,
        is_complete: cycles_entered >= total_months,
    })
}
