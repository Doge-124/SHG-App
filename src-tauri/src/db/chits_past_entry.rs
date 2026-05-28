//! Chit fund past data entry — migrating historical records to the app.
//! All entries are reference-only: no SHG ledger entries are created.
//! The SHG opening balance (Settings → Data) accounts for historical funds.

use rusqlite::Connection;
use serde::Serialize;

use crate::error::AppError;
use crate::db::validation;

/// A winner entry for past data — either the fixed prize winner or an auction winner.
pub struct PastWinnerInput<'a> {
    pub member_id: i64,
    pub winner_type: &'a str,   // "FIXED" or "AUCTION"
    pub bid_discount: f64,      // 0 for fixed winner
    pub commission: f64,
    pub payout_amount: f64,     // what the winner received
    pub payment_method: &'a str,
}

/// Record one past chit cycle (reference only — does not touch SHG balance).
///
/// Supports multiple winners (1 fixed + W-1 auction) matching the new configurable model.
/// Auction discount per member = sum(auction_bid_discounts) / total_members.
pub fn record_past_chit_cycle(
    conn: &mut Connection,
    chit_id: i64,
    cycle_no: i64,
    auction_date: &str,
    winners: &[PastWinnerInput<'_>],
    auction_discount_per_member: f64, // pre-computed = sum(bid_discounts) / N
    member_payments: &[(i64, f64, &str)], // (member_id, amount_paid, payment_method)
) -> Result<(), AppError> {
    if auction_discount_per_member < 0.0 {
        return Err(AppError::validation("Auction discount per member cannot be negative"));
    }

    // Reject any winner who has already won in this chit.
    for w in winners {
        let already_won: bool = conn.query_row(
            "SELECT COUNT(*) > 0 FROM chit_cycle_winners WHERE chit_id = ?1 AND member_id = ?2",
            (chit_id, w.member_id),
            |row| row.get(0),
        ).unwrap_or(false);
        if already_won {
            return Err(AppError::business("A selected winner has already won in a previous cycle of this chit"));
        }
    }

    let total_bid_discounts: f64 = winners.iter()
        .filter(|w| w.winner_type == "AUCTION")
        .map(|w| w.bid_discount)
        .sum();

    let first_payout = winners.first().map(|w| w.payout_amount).unwrap_or(0.0);
    let first_winner_id: Option<i64> = winners.first().map(|w| w.member_id);

    // Collect member IDs before the transaction to avoid borrow conflicts.
    let all_member_ids: Vec<i64> = conn
        .prepare("SELECT member_id FROM chit_members WHERE chit_id = ?1")?
        .query_map([chit_id], |row| row.get::<_, i64>(0))?
        .filter_map(|r| r.ok())
        .collect();

    let paying_member_ids: std::collections::HashSet<i64> = member_payments.iter()
        .filter(|(_, amt, _)| *amt > 0.0)
        .map(|(id, _, _)| *id)
        .collect();

    let mut tx = conn.transaction()?;

    // Upsert cycle record. is_past_entry stays 1 even on conflict update so
    // the row always identifies itself as past-data for the delete guard.
    tx.execute(
        "INSERT INTO chit_cycles
         (chit_id, cycle_no, auction_date, winning_member_id, bid_discount, payout_amount,
          total_bid_discounts, auction_discount_per_member, is_past_entry)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,1)
         ON CONFLICT(chit_id, cycle_no) DO UPDATE SET
             auction_date = excluded.auction_date,
             winning_member_id = excluded.winning_member_id,
             bid_discount = excluded.bid_discount,
             payout_amount = excluded.payout_amount,
             total_bid_discounts = excluded.total_bid_discounts,
             auction_discount_per_member = excluded.auction_discount_per_member,
             is_past_entry = 1",
        (chit_id, cycle_no, auction_date, first_winner_id, total_bid_discounts,
         first_payout, total_bid_discounts, auction_discount_per_member),
    )?;

    let cycle_id: i64 = tx.query_row(
        "SELECT id FROM chit_cycles WHERE chit_id = ?1 AND cycle_no = ?2",
        (chit_id, cycle_no),
        |row| row.get(0),
    )?;

    // Record each winner in chit_cycle_winners (reference)
    for w in winners {
        tx.execute(
            "INSERT OR REPLACE INTO chit_cycle_winners
             (chit_id, cycle_id, member_id, winner_type, bid_discount, commission, payout_amount, payment_method, paid_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            (chit_id, cycle_id, w.member_id, w.winner_type, w.bid_discount,
             w.commission, w.payout_amount, w.payment_method, auction_date),
        )?;
    }

    // Record member payments in chit_payments (reference)
    for (member_id, amount, payment_method) in member_payments {
        let stored = ((amount * 100.0).round()) / 100.0;
        let exists: bool = tx.query_row(
            "SELECT COUNT(*) FROM chit_payments WHERE cycle_id = ?1 AND member_id = ?2",
            (cycle_id, member_id),
            |row| row.get(0),
        ).unwrap_or(0) > 0;

        if exists {
            tx.execute(
                "UPDATE chit_payments SET amount=?1, payment_method=?2, paid_at=?3
                 WHERE cycle_id=?4 AND member_id=?5",
                (stored, payment_method, auction_date, cycle_id, member_id),
            )?;
        } else {
            tx.execute(
                "INSERT INTO chit_payments (chit_id, cycle_id, member_id, amount, payment_method, paid_at)
                 VALUES (?1,?2,?3,?4,?5,?6)",
                (chit_id, cycle_id, member_id, stored, payment_method, auction_date),
            )?;
        }
    }

    // Store eligibility — use pre-collected data so conn isn't borrowed while tx is live.
    let now = chrono::Utc::now().to_rfc3339();
    tx.execute(
        "DELETE FROM chit_member_eligibility WHERE chit_id = ?1 AND cycle_id = ?2",
        (chit_id, cycle_id),
    )?;
    for member_id in &all_member_ids {
        let eligible = paying_member_ids.contains(member_id);
        tx.execute(
            "INSERT OR IGNORE INTO chit_member_eligibility
             (chit_id, cycle_id, member_id, is_eligible, admin_override, created_at)
             VALUES (?1,?2,?3,?4,0,?5)",
            (chit_id, cycle_id, member_id, eligible as i64, &now),
        )?;
    }

    tx.commit()?;
    Ok(())
}

// ─── Bulk past entry ─────────────────────────────────────────────────────────

pub struct BulkAuctionWinner {
    pub member_id: i64,
    pub bid_discount: f64,
    pub payment_method: String,
}

/// One cycle's data for bulk past entry — supports configurable W winners/cycle.
pub struct BulkCycleInput {
    pub cycle_no: i64,
    pub auction_date: String,
    pub fixed_winner_member_id: Option<i64>,
    pub fixed_winner_payment_method: String,
    pub auction_winners: Vec<BulkAuctionWinner>,
}

/// Record multiple past cycles in one call.
/// All members are assumed to have paid their standard contribution each cycle.
/// Returns the number of cycles successfully recorded.
pub fn record_bulk_past_chit_cycles(
    conn: &mut Connection,
    chit_id: i64,
    inputs: &[BulkCycleInput],
) -> Result<usize, AppError> {
    let (monthly_contribution, commission_per_winner, fixed_prize_amount): (f64, f64, f64) =
        conn.query_row(
            "SELECT monthly_contribution,
                    COALESCE(commission_per_winner, 0.0),
                    COALESCE(fixed_prize_amount, total_amount)
             FROM chit_groups WHERE id = ?1",
            [chit_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;

    let all_member_ids: Vec<i64> = conn
        .prepare("SELECT member_id FROM chit_members WHERE chit_id = ?1")?
        .query_map([chit_id], |r| r.get::<_, i64>(0))?
        .filter_map(|r| r.ok())
        .collect();

    if all_member_ids.is_empty() {
        return Err(AppError::business("No members in this chit group"));
    }

    let n = all_member_ids.len() as f64;
    let mut recorded = 0usize;

    for input in inputs {
        // Build the winners list: 1 FIXED + W-1 AUCTION
        let mut winner_strs: Vec<(i64, &str, f64, f64, String, String)> = Vec::new();

        if let Some(fid) = input.fixed_winner_member_id {
            let payout = (fixed_prize_amount - commission_per_winner).max(0.0);
            winner_strs.push((fid, "FIXED", 0.0, commission_per_winner, payout.to_string(),
                input.fixed_winner_payment_method.clone()));
        }

        for aw in &input.auction_winners {
            let payout = (fixed_prize_amount - aw.bid_discount - commission_per_winner).max(0.0);
            winner_strs.push((aw.member_id, "AUCTION", aw.bid_discount,
                commission_per_winner, payout.to_string(), aw.payment_method.clone()));
        }

        // Build PastWinnerInput slice (borrows from winner_strs)
        let winner_vec: Vec<PastWinnerInput<'_>> = winner_strs.iter().map(|w| {
            PastWinnerInput {
                member_id: w.0,
                winner_type: w.1,
                bid_discount: w.2,
                commission: w.3,
                payout_amount: w.4.parse().unwrap_or(0.0),
                payment_method: &w.5,
            }
        }).collect();

        // Auction discount per member = sum of auction bid_discounts / N
        let total_bid_discounts: f64 = input.auction_winners.iter().map(|w| w.bid_discount).sum();
        let auction_discount_per_member = if n > 0.0 { total_bid_discounts / n } else { 0.0 };

        let per_member_amount = (monthly_contribution - auction_discount_per_member).max(0.0);
        let payment_method_str = "CASH";
        let payments: Vec<(i64, f64, &str)> = all_member_ids
            .iter()
            .map(|&id| (id, per_member_amount, payment_method_str))
            .collect();

        record_past_chit_cycle(
            conn, chit_id, input.cycle_no, &input.auction_date,
            &winner_vec, auction_discount_per_member, &payments,
        )?;

        recorded += 1;
    }

    Ok(recorded)
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
