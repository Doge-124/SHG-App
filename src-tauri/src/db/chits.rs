//! Chit fund lifecycle management.
//!
//! Financial flows:
//! - Installment: chit installment → SHG receipt.
//! - Payout: chit winner payout → SHG voucher.

use rusqlite::Connection;
use rusqlite::OptionalExtension;
use serde::Serialize;

use crate::error::AppError;
use crate::db::{ledger, validation};

/// Look up a member's passbook number for a chit, if one has been entered.
fn passbook_number(conn: &Connection, chit_id: i64, member_id: i64) -> Option<String> {
    conn.query_row(
        "SELECT passbook_number FROM chit_members WHERE chit_id = ?1 AND member_id = ?2",
        (chit_id, member_id),
        |r| r.get::<_, Option<String>>(0),
    ).ok().flatten().filter(|s| !s.trim().is_empty())
}

/// Pin the just-recorded shg_transactions row to a specific member. Chit
/// payout/commission rows reference the cycle (reference_id = cycle_id), but a
/// cycle can have several winners (multi-winner + closing cycles), so the member
/// can't be derived from the cycle alone. Call immediately after
/// record_receipt/record_voucher_ex so `last_insert_rowid()` still points at it.
fn tag_member_ref(conn: &Connection, member_id: i64) -> Result<(), AppError> {
    let txn_id = conn.last_insert_rowid();
    conn.execute(
        "UPDATE shg_transactions SET member_ref_id = ?1 WHERE id = ?2",
        (member_id, txn_id),
    )?;
    Ok(())
}

/// Round a chit installment to the nearest multiple of 5, rounding UP when the
/// amount past the lower multiple of 5 is 3 or more and DOWN when it is less
/// than 3 (e.g. 173.8 -> 175, 172.2 -> 170). Keeps collected contributions to
/// clean cash amounts. Non-positive amounts round to 0.
pub fn round_to_5(amount: f64) -> f64 {
    if amount <= 0.0 {
        return 0.0;
    }
    ((amount + 2.0) / 5.0).floor() * 5.0
}

/// Format a rupee amount compactly for receipt/voucher descriptions
/// (whole numbers without decimals, e.g. "Rs.100" or "Rs.100.50").
fn fmt_rs(amount: f64) -> String {
    if amount.fract().abs() < 0.005 {
        format!("Rs.{}", amount.round() as i64)
    } else {
        format!("Rs.{amount:.2}")
    }
}

/// Build a transaction reason that includes the passbook number when present,
/// e.g. "Chit Installment (Passbook 17)". Used so chit receipts/vouchers carry
/// the passbook ID the SHG uses for lots.
fn reason_with_passbook(base: &str, passbook: &Option<String>) -> String {
    match passbook {
        Some(p) => format!("{base} (Passbook {p})"),
        None => base.to_string(),
    }
}

/// A cycle is completed when all required winners have been recorded in chit_cycle_winners.
fn is_cycle_completed(conn: &Connection, cycle_id: i64) -> Result<bool, AppError> {
    let chit_id: i64 = conn.query_row(
        "SELECT chit_id FROM chit_cycles WHERE id = ?1",
        [cycle_id],
        |row| row.get(0),
    ).map_err(|_| AppError::business("Chit cycle not found"))?;

    let winners_required: i64 = conn.query_row(
        "SELECT COALESCE(winners_per_cycle, 1) FROM chit_groups WHERE id = ?1",
        [chit_id],
        |row| row.get(0),
    ).unwrap_or(1);

    let winners_recorded: i64 = conn.query_row(
        "SELECT COUNT(*) FROM chit_cycle_winners WHERE cycle_id = ?1",
        [cycle_id],
        |row| row.get(0),
    ).unwrap_or(0);

    Ok(winners_recorded >= winners_required)
}

/// Check if a member can participate in chit funds (SHG or CHIT type)
fn can_participate_in_chit(conn: &Connection, member_id: i64) -> Result<bool, AppError> {
    let mt: String = conn.query_row(
        "SELECT member_type FROM members WHERE id = ?1",
        [member_id],
        |row| row.get(0),
    )?;
    // member_type is a role set; SHG or CHIT grants chit privileges.
    Ok(crate::db::members::roles_allow_chit(&mt))
}

#[derive(Debug, Serialize, Clone)]
pub struct ChitCycle {
    pub id: i64,
    pub chit_id: i64,
    pub cycle_no: i64,
    pub auction_date: String,
    pub winning_member_id: Option<i64>,
    pub bid_discount: f64,
    pub payout_amount: f64,
}

#[derive(Serialize)]
pub struct ChitGroup {
    pub id: i64,
    pub name: String,
    pub total_amount: f64,       // fixed prize amount (P)
    pub months: i64,             // total cycles = floor(N/W)
    pub total_members: i64,      // N
    pub monthly_contribution: f64, // C per member per cycle
    pub commission_percent: f64, // legacy — not used for new chit logic
    pub start_date: String,
    pub status: String,
    pub winners_per_cycle: i64,   // W
    pub commission_per_winner: f64, // F: commission SHG takes per winner
    pub fixed_prize_amount: f64,  // P (if 0, falls back to total_amount)
}

#[derive(Debug, Serialize, Clone)]
pub struct ChitCycleWinner {
    pub id: i64,
    pub chit_id: i64,
    pub cycle_id: i64,
    pub member_id: i64,
    pub member_name: String,
    pub winner_type: String, // 'FIXED' or 'AUCTION'
    pub bid_discount: f64,
    pub commission: f64,
    pub payout_amount: f64,
    pub payment_method: String,
    pub paid_at: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct MemberEligibility {
    pub member_id: i64,
    pub member_name: String,
    pub is_eligible: bool,
    pub admin_override: bool,
}

#[derive(Debug, Serialize)]
pub struct ChitPayment {
    pub id: i64,
    pub chit_id: i64,
    pub cycle_id: i64,
    pub member_id: i64,
    pub member_name: String,
    pub amount: f64,
    pub payment_method: String,
    pub paid_at: String,
}

/// Create a new chit group definition.
///
/// * `monthly_contribution` (C) — what each member pays per cycle.
/// * `total_members` (N) — number of participants.
/// * `winners_per_cycle` (W) — winners selected each cycle (1 fixed + W-1 auction).
/// * `commission_per_winner` (F) — flat commission SHG deducts from each winner's payout.
/// * `fixed_prize_amount` (P) — prize the fixed winner receives before commission (default = N×C).
pub fn create_chit_group(
    conn: &mut Connection,
    name: &str,
    total_amount: f64,         // kept for legacy / display
    months: i64,               // total cycles
    total_members: i64,        // N
    commission_percent: f64,   // legacy
    start_date: &str,
    winners_per_cycle: i64,
    commission_per_winner: f64,
    fixed_prize_amount: f64,
) -> Result<(), AppError> {
    if total_members < 1 {
        return Err(AppError::validation("Total members must be at least 1"));
    }
    if winners_per_cycle < 1 || winners_per_cycle > total_members {
        return Err(AppError::validation("Winners per cycle must be between 1 and total members"));
    }
    if commission_per_winner < 0.0 {
        return Err(AppError::validation("Commission per winner cannot be negative"));
    }

    let monthly = total_amount / months as f64;
    let prize = if fixed_prize_amount > 0.0 { fixed_prize_amount } else { total_amount };

    conn.execute(
        "INSERT INTO chit_groups
         (name, total_amount, months, total_members, monthly_contribution, commission_percent,
          start_date, status, winners_per_cycle, commission_per_winner, fixed_prize_amount)
         VALUES (?1,?2,?3,?4,?5,?6,?7,'ACTIVE',?8,?9,?10)",
        (name, total_amount, months, total_members, monthly, commission_percent,
         start_date, winners_per_cycle, commission_per_winner, prize),
    )?;

    Ok(())
}

/// Add a member to a chit group.
pub fn add_member_to_chit(
    conn: &mut Connection,
    chit_id: i64,
    member_id: i64,
    joined_at: &str,
) -> Result<(), AppError> {
    // Check if member can participate in chit (must be SHG or CHIT type)
    if !can_participate_in_chit(conn, member_id)? {
        return Err(AppError::business(
            "Only SHG and CHIT members can participate in chit funds. LOAN members cannot join chit groups."
        ));
    }

    // A chit is sized for a fixed number of participants (chit_groups.total_members).
    // Don't let it grow past that — extra members break cycle/eligibility math.
    // Re-adding an existing member is a harmless no-op (INSERT OR IGNORE) and is
    // allowed even when full.
    let already_in: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM chit_members WHERE chit_id = ?1 AND member_id = ?2",
        (chit_id, member_id),
        |r| r.get(0),
    ).unwrap_or(false);
    if !already_in {
        let (total_members, current): (i64, i64) = conn.query_row(
            "SELECT g.total_members,
                    (SELECT COUNT(*) FROM chit_members WHERE chit_id = g.id)
             FROM chit_groups g WHERE g.id = ?1",
            [chit_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        if current >= total_members {
            return Err(AppError::business(format!(
                "This chit is limited to {total_members} member(s) and is already full."
            )));
        }
    }

    let tx = conn.transaction()?;
    tx.execute(
        "INSERT OR IGNORE INTO chit_members (chit_id, member_id, joined_at)
         VALUES (?1, ?2, ?3)",
        (chit_id, member_id, joined_at),
    )?;
    tx.commit()?;
    Ok(())
}

/// Get all cycles for a chit group
pub fn get_chit_cycles(
    conn: &Connection,
    chit_id: i64,
) -> Result<Vec<ChitCycle>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT
            cc.id,
            cc.chit_id,
            cc.cycle_no,
            cc.auction_date,
            cc.winning_member_id,
            cc.bid_discount,
            cc.payout_amount
        FROM chit_cycles cc
        WHERE cc.chit_id = ?1
        ORDER BY cc.cycle_no ASC"
    ).map_err(|e| AppError::database(&format!("Failed to prepare chit cycles query: {}", e)))?;

    let cycles = stmt.query_map([chit_id], |row| {
        Ok(ChitCycle {
            id: row.get(0)?,
            chit_id: row.get(1)?,
            cycle_no: row.get(2)?,
            auction_date: row.get(3)?,
            winning_member_id: row.get(4)?,
            bid_discount: row.get(5)?,
            payout_amount: row.get(6)?,
        })
    }).map_err(|e| AppError::database(&format!("Failed to execute chit cycles query: {}", e)))?;

    let mut result = Vec::new();
    for cycle in cycles {
        result.push(cycle.map_err(|e| AppError::database(&format!("Failed to parse chit cycle: {}", e)))?);
    }

    Ok(result)
}

// ── Eligibility ───────────────────────────────────────────────────────────

/// Compute eligibility for `target_cycle_id` based on who paid in `source_cycle_id`.
/// Members who paid in the source cycle are eligible for the discount in the target cycle.
/// On the first cycle every member is eligible by default.
pub fn compute_and_store_eligibility(
    conn: &mut Connection,
    chit_id: i64,
    source_cycle_id: Option<i64>, // None → first cycle, all eligible
    target_cycle_id: i64,
) -> Result<(), AppError> {
    let now = chrono::Utc::now().to_rfc3339();

    // Collect member IDs before opening the transaction to avoid borrow conflicts.
    let members: Vec<i64> = conn
        .prepare("SELECT member_id FROM chit_members WHERE chit_id = ?1")?
        .query_map([chit_id], |row| row.get::<_, i64>(0))?
        .filter_map(|r| r.ok())
        .collect();

    let mut tx = conn.transaction()?;

    // Remove any stale eligibility rows for the target cycle.
    tx.execute(
        "DELETE FROM chit_member_eligibility WHERE chit_id = ?1 AND cycle_id = ?2",
        (chit_id, target_cycle_id),
    )?;

    for member_id in &members {
        let is_eligible = match source_cycle_id {
            None => true, // first cycle — everyone eligible
            Some(src) => {
                // Eligible if they paid in the source cycle.
                let paid: bool = tx.query_row(
                    "SELECT COUNT(*) > 0 FROM chit_payments
                     WHERE cycle_id = ?1 AND member_id = ?2",
                    (src, member_id),
                    |row| row.get(0),
                ).unwrap_or(false);
                paid
            }
        };

        tx.execute(
            "INSERT OR IGNORE INTO chit_member_eligibility
             (chit_id, cycle_id, member_id, is_eligible, admin_override, created_at)
             VALUES (?1, ?2, ?3, ?4, 0, ?5)",
            (chit_id, target_cycle_id, member_id, is_eligible as i64, &now),
        )?;
    }

    tx.commit()?;
    Ok(())
}

/// Get eligibility list for a cycle.
pub fn get_cycle_eligibility(
    conn: &Connection,
    chit_id: i64,
    cycle_id: i64,
) -> Result<Vec<MemberEligibility>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT e.member_id, m.name, e.is_eligible, e.admin_override
         FROM chit_member_eligibility e
         JOIN members m ON e.member_id = m.id
         WHERE e.chit_id = ?1 AND e.cycle_id = ?2
         ORDER BY m.name COLLATE NOCASE"
    )?;

    let rows = stmt.query_map((chit_id, cycle_id), |row| {
        Ok(MemberEligibility {
            member_id: row.get(0)?,
            member_name: row.get(1)?,
            is_eligible: row.get::<_, i64>(2)? != 0,
            admin_override: row.get::<_, i64>(3)? != 0,
        })
    })?;

    let mut result = Vec::new();
    for row in rows { result.push(row?); }
    Ok(result)
}

/// Admin override: flip eligibility for one member in a cycle.
pub fn override_member_eligibility(
    conn: &mut Connection,
    chit_id: i64,
    cycle_id: i64,
    member_id: i64,
    eligible: bool,
    reason: &str,
) -> Result<(), AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO chit_member_eligibility
             (chit_id, cycle_id, member_id, is_eligible, admin_override, override_reason, created_at)
         VALUES (?1,?2,?3,?4,1,?5,?6)
         ON CONFLICT(chit_id, cycle_id, member_id) DO UPDATE SET
             is_eligible = excluded.is_eligible,
             admin_override = 1,
             override_reason = excluded.override_reason",
        (chit_id, cycle_id, member_id, eligible as i64, reason, &now),
    )?;
    Ok(())
}

// ── Winners ───────────────────────────────────────────────────────────────

/// Record all winners for a cycle, compute the auction discount, create vouchers + commission receipts.
///
/// `fixed_winner`: (member_id, payment_method, bank_txn_id)
/// `auction_winners`: [(member_id, bid_discount, payment_method, bank_txn_id)]
/// `bank_txn_id` is the cheque no. / UTR for a BANK payout (ignored for CASH).
pub fn process_cycle_winners(
    conn: &mut Connection,
    chit_id: i64,
    cycle_id: i64,
    fixed_winner: Option<(i64, &str, Option<&str>)>,
    auction_winners: &[(i64, f64, &str, Option<&str>)], // (member_id, bid_discount, payment_method, bank_txn_id)
    override_discount_per_member: Option<f64>,
) -> Result<f64, AppError> { // returns auction_discount_per_member
    if is_cycle_completed(conn, cycle_id)? {
        return Err(AppError::business("This cycle is already completed."));
    }

    let (prize, commission_per_winner, total_members): (f64, f64, i64) = conn.query_row(
        "SELECT COALESCE(fixed_prize_amount, total_amount), commission_per_winner, total_members
         FROM chit_groups WHERE id = ?1",
        [chit_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;

    let cycle_no: i64 = conn.query_row(
        "SELECT cycle_no FROM chit_cycles WHERE id = ?1",
        [cycle_id],
        |row| row.get(0),
    )?;

    // Validate no member has already won in this chit.
    let check_already_won = |member_id: i64| -> Result<bool, AppError> {
        Ok(conn.query_row(
            "SELECT COUNT(*) > 0 FROM chit_cycle_winners WHERE chit_id = ?1 AND member_id = ?2",
            (chit_id, member_id),
            |row| row.get(0),
        ).unwrap_or(false))
    };
    if let Some((member_id, _, _)) = fixed_winner {
        if check_already_won(member_id)? {
            return Err(AppError::business("Fixed winner has already won in a previous cycle"));
        }
    }
    for (member_id, _, _, _) in auction_winners {
        if check_already_won(*member_id)? {
            return Err(AppError::business("An auction winner has already won in a previous cycle"));
        }
    }

    let now = chrono::Utc::now().to_rfc3339();
    let mut tx = conn.transaction()?;

    let mut total_bid_discounts = 0.0_f64;

    // Fixed prize winner.
    // The voucher records the GROSS prize disbursed; the commission is booked as a
    // separate receipt (SHG income). Net cash out = prize − commission, while the
    // voucher correctly shows the full prize. The winner row keeps the NET amount
    // the member actually receives.
    if let Some((member_id, payment_method, bank_txn_id)) = fixed_winner {
        let payout = (prize - commission_per_winner).max(0.0);
        tx.execute(
            "INSERT INTO chit_cycle_winners
             (chit_id, cycle_id, member_id, winner_type, bid_discount, commission, payout_amount, payment_method, paid_at)
             VALUES (?1,?2,?3,'FIXED',0,?4,?5,?6,?7)",
            (chit_id, cycle_id, member_id, commission_per_winner, payout, payment_method, &now),
        )?;
        let pb = passbook_number(&tx, chit_id, member_id);
        if commission_per_winner > 0.0 {
            ledger::record_receipt(&mut tx, commission_per_winner,
                &reason_with_passbook("Chit Commission", &pb),
                payment_method, Some("CHIT_COMMISSION"), Some(cycle_id), &now)?;
            tag_member_ref(&tx, member_id)?;
        }
        let bank_txn = if payment_method == "BANK" { bank_txn_id } else { None };
        ledger::record_voucher_ex(&mut tx, prize,
            &reason_with_passbook("Chit Payout", &pb),
            payment_method, Some("CHIT_PAYOUT"), Some(cycle_id), &now, bank_txn, None)?;
        tag_member_ref(&tx, member_id)?;
    }

    // Auction winners. Voucher = the bid-reduced prize (gross of commission);
    // commission booked as a separate receipt. Winner row keeps the NET amount.
    for (member_id, bid_discount, payment_method, bank_txn_id) in auction_winners {
        let payout = (prize - bid_discount - commission_per_winner).max(0.0);
        let voucher_amount = (prize - bid_discount).max(0.0);
        total_bid_discounts += bid_discount;
        tx.execute(
            "INSERT INTO chit_cycle_winners
             (chit_id, cycle_id, member_id, winner_type, bid_discount, commission, payout_amount, payment_method, paid_at)
             VALUES (?1,?2,?3,'AUCTION',?4,?5,?6,?7,?8)",
            (chit_id, cycle_id, member_id, bid_discount, commission_per_winner, payout, payment_method, &now),
        )?;
        let pb = passbook_number(&tx, chit_id, *member_id);
        if commission_per_winner > 0.0 {
            ledger::record_receipt(&mut tx, commission_per_winner,
                &reason_with_passbook("Chit Commission", &pb),
                payment_method, Some("CHIT_COMMISSION"), Some(cycle_id), &now)?;
            tag_member_ref(&tx, *member_id)?;
        }
        let bank_txn = if *payment_method == "BANK" { *bank_txn_id } else { None };
        let payout_base = if *bid_discount > 0.005 {
            format!("Chit Payout (Bid discount {})", fmt_rs(*bid_discount))
        } else {
            "Chit Payout".to_string()
        };
        ledger::record_voucher_ex(&mut tx, voucher_amount,
            &reason_with_passbook(&payout_base, &pb),
            payment_method, Some("CHIT_PAYOUT"), Some(cycle_id), &now, bank_txn, None)?;
        tag_member_ref(&tx, *member_id)?;
    }

    let discount_per_member = if let Some(ov) = override_discount_per_member {
        ov
    } else if total_members > 0 && total_bid_discounts > 0.0 {
        (total_bid_discounts / total_members as f64 * 100.0).round() / 100.0
    } else {
        0.0
    };

    // Backfill winning_member_id on chit_cycles for legacy compat.
    let first_winner = fixed_winner
        .map(|(id, _, _)| id)
        .or_else(|| auction_winners.first().map(|(id, _, _, _)| *id));

    tx.execute(
        "UPDATE chit_cycles SET
             winning_member_id = ?1, bid_discount = ?2, payout_amount = ?3,
             total_bid_discounts = ?4, auction_discount_per_member = ?5
         WHERE id = ?6",
        (first_winner, total_bid_discounts, prize, total_bid_discounts, discount_per_member, cycle_id),
    )?;

    tx.commit()?;
    Ok(discount_per_member)
}

/// Get all winners for a cycle.
pub fn get_cycle_winners(conn: &Connection, cycle_id: i64) -> Result<Vec<ChitCycleWinner>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT w.id, w.chit_id, w.cycle_id, w.member_id, m.name,
                w.winner_type, w.bid_discount, w.commission, w.payout_amount,
                w.payment_method, w.paid_at
         FROM chit_cycle_winners w
         JOIN members m ON w.member_id = m.id
         WHERE w.cycle_id = ?1"
    )?;
    let rows = stmt.query_map([cycle_id], |row| {
        Ok(ChitCycleWinner {
            id: row.get(0)?,
            chit_id: row.get(1)?,
            cycle_id: row.get(2)?,
            member_id: row.get(3)?,
            member_name: row.get(4)?,
            winner_type: row.get(5)?,
            bid_discount: row.get(6)?,
            commission: row.get(7)?,
            payout_amount: row.get(8)?,
            payment_method: row.get(9)?,
            paid_at: row.get(10)?,
        })
    })?;
    let mut result = Vec::new();
    for row in rows { result.push(row?); }
    Ok(result)
}

/// Manual cycle management: Get current active cycle for a chit group
pub fn get_current_cycle(conn: &Connection, chit_id: i64) -> Result<Option<ChitCycle>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, chit_id, cycle_no, auction_date, winning_member_id, bid_discount, payout_amount
         FROM chit_cycles
         WHERE chit_id = ?1
         ORDER BY cycle_no DESC
         LIMIT 1"
    )?;

    let cycle = stmt.query_row([chit_id], |row| {
        Ok(ChitCycle {
            id: row.get(0)?,
            chit_id: row.get(1)?,
            cycle_no: row.get(2)?,
            auction_date: row.get(3)?,
            winning_member_id: row.get(4)?,
            bid_discount: row.get(5)?,
            payout_amount: row.get(6)?,
        })
    }).ok();

    Ok(cycle)
}

/// Manual cycle management: Advance to next cycle.
/// Computes eligibility for the new cycle based on payments in the current one.
pub fn advance_to_next_cycle(
    conn: &mut Connection,
    chit_id: i64,
) -> Result<ChitCycle, AppError> {
    let current_cycle = get_current_cycle(conn, chit_id)?;
    let next_cycle_no = current_cycle.as_ref().map(|c| c.cycle_no + 1).unwrap_or(1);

    let chit: ChitGroup = conn.query_row(
        "SELECT id, name, total_amount, months, total_members, monthly_contribution, commission_percent,
                start_date, status,
                COALESCE(winners_per_cycle,1), COALESCE(commission_per_winner,0),
                COALESCE(fixed_prize_amount, total_amount)
         FROM chit_groups WHERE id = ?1",
        [chit_id],
        |row| {
            Ok(ChitGroup {
                id: row.get(0)?,
                name: row.get(1)?,
                total_amount: row.get(2)?,
                months: row.get(3)?,
                total_members: row.get(4)?,
                monthly_contribution: row.get(5)?,
                commission_percent: row.get(6)?,
                start_date: row.get(7)?,
                status: row.get(8)?,
                winners_per_cycle: row.get(9)?,
                commission_per_winner: row.get(10)?,
                fixed_prize_amount: row.get(11)?,
            })
        },
    )?;

    // A chit runs for a fixed number of cycles (chit_groups.months). Don't let
    // the operator start a cycle beyond that.
    if next_cycle_no > chit.months {
        return Err(AppError::business(format!(
            "This chit runs for {} cycle(s) — all cycles are complete. You can't start another.",
            chit.months
        )));
    }

    let auction_date = if let Some(ref current) = current_cycle {
        let current_date = chrono::NaiveDate::parse_from_str(&current.auction_date, "%Y-%m-%d")
            .unwrap_or_else(|_| chrono::Local::now().naive_local().date());
        (current_date + chrono::Duration::days(30)).format("%Y-%m-%d").to_string()
    } else {
        chit.start_date.clone()
    };

    // Auction discount from previous cycle carries to new cycle's payment calculations.
    let prev_discount: f64 = current_cycle.as_ref().map(|c| {
        conn.query_row(
            "SELECT COALESCE(auction_discount_per_member, 0) FROM chit_cycles WHERE id = ?1",
            [c.id],
            |row| row.get::<_, f64>(0),
        ).unwrap_or(0.0)
    }).unwrap_or(0.0);

    conn.execute(
        "INSERT INTO chit_cycles
         (chit_id, cycle_no, auction_date, winning_member_id, bid_discount, payout_amount,
          auction_discount_per_member, total_bid_discounts)
         VALUES (?1,?2,?3,NULL,0,?4,0,0)",
        (chit_id, next_cycle_no, &auction_date, chit.fixed_prize_amount),
    )?;

    let cycle_id = conn.last_insert_rowid();

    // Compute eligibility: source = current completed cycle (None on first cycle).
    let source_cycle_id = current_cycle.as_ref().map(|c| c.id);
    compute_and_store_eligibility(conn, chit_id, source_cycle_id, cycle_id)?;

    Ok(ChitCycle {
        id: cycle_id,
        chit_id,
        cycle_no: next_cycle_no,
        auction_date,
        winning_member_id: None,
        bid_discount: prev_discount,
        payout_amount: chit.fixed_prize_amount,
    })
}

/// Record member installment payment for the current cycle.
///
/// `gross_amount` is the net amount collected (after per-member auction discount deducted).
/// `auction_discount` is the per-member discount — stored in the receipt description for reference.
#[allow(clippy::too_many_arguments)]
#[allow(clippy::too_many_arguments)]
pub fn record_member_payment_with_discount(
    conn: &mut Connection,
    chit_id: i64,
    cycle_id: i64,
    member_id: i64,
    gross_amount: f64,
    auction_discount: f64,
    payment_method: &str,           // CASH | BANK | MIXED
    paid_at: &str,
    cash_amount: Option<f64>,       // required when MIXED
    bank_amount: Option<f64>,       // required when MIXED
    bank_txn_id: Option<&str>,      // optional bank reference
    allow_completed: bool,          // true → permit paying a cycle that already has a winner (late dues)
) -> Result<ChitPayment, AppError> {
    validation::validate_money_amount(gross_amount)?;
    let (cash_part, bank_part) = match payment_method {
        "MIXED" => {
            let c = cash_amount.unwrap_or(0.0);
            let b = bank_amount.unwrap_or(0.0);
            if c <= 0.005 || b <= 0.005 {
                return Err(AppError::validation("A mixed payment needs a positive amount in both cash and bank"));
            }
            if (c + b - gross_amount).abs() > 0.01 {
                return Err(AppError::validation("Cash + bank must equal the installment amount"));
            }
            (Some(c), Some(b))
        }
        "CASH" | "BANK" => (None, None),
        _ => return Err(AppError::validation("payment_method must be CASH, BANK, or MIXED")),
    };

    let monthly_contribution: f64 = conn.query_row(
        "SELECT monthly_contribution FROM chit_groups WHERE id = ?1",
        [chit_id],
        |row| row.get(0),
    ).unwrap_or(0.0);

    let mut tx = conn.transaction()?;

    let winner_inside: Option<i64> = tx.query_row(
        "SELECT winning_member_id FROM chit_cycles WHERE id = ?1",
        [cycle_id],
        |row| row.get(0),
    ).map_err(|_| AppError::business("Chit cycle not found"))?;
    // A completed cycle (winner chosen) is normally locked. Collecting an
    // overdue installment for such a cycle (late dues) explicitly opts in.
    if winner_inside.is_some() && !allow_completed {
        return Err(AppError::business(
            "This cycle is locked — the winner has already been paid out. No further payments can be recorded."
        ));
    }

    let payment_exists: bool = tx.query_row(
        "SELECT COUNT(*) FROM chit_payments WHERE chit_id = ?1 AND cycle_id = ?2 AND member_id = ?3",
        (chit_id, cycle_id, member_id),
        |row| row.get(0),
    ).unwrap_or(0) > 0;

    if payment_exists {
        return Err(AppError::business(
            "Payment already recorded for this member in this cycle. \
             Reverse the existing payment before recording a new one.",
        ));
    }

    tx.execute(
        "INSERT INTO chit_payments
         (chit_id, cycle_id, member_id, amount, payment_method, paid_at, cash_amount, bank_amount)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        (chit_id, cycle_id, member_id, gross_amount, payment_method, paid_at, cash_part, bank_part),
    )?;

    let payment_id = tx.last_insert_rowid();

    let cycle_no: i64 = tx.query_row(
        "SELECT cycle_no FROM chit_cycles WHERE id = ?1",
        [cycle_id],
        |row| row.get(0),
    ).unwrap_or(cycle_id);

    let pb = passbook_number(&tx, chit_id, member_id);
    // Show the bid (auction) discount actually applied = how much less than the
    // full monthly contribution was collected. Robust regardless of the discount
    // the caller passed (computed from what was really paid).
    let applied_discount = (monthly_contribution - gross_amount).max(0.0);
    let installment_base = if applied_discount > 0.005 {
        format!("Chit Installment (Bid discount {})", fmt_rs(applied_discount))
    } else {
        "Chit Installment".to_string()
    };
    let installment_reason = reason_with_passbook(&installment_base, &pb);
    if payment_method == "MIXED" {
        ledger::record_receipt_mixed(
            &mut tx,
            cash_part.unwrap_or(0.0),
            bank_part.unwrap_or(0.0),
            &installment_reason,
            Some("CHIT_PAYMENT"),
            Some(member_id),
            paid_at,
            bank_txn_id,
        )?;
    } else {
        let bank_txn = if payment_method == "BANK" { bank_txn_id } else { None };
        ledger::record_receipt_ex(
            &mut tx,
            gross_amount,
            &installment_reason,
            payment_method,
            Some("CHIT_PAYMENT"),
            Some(member_id),
            paid_at,
            bank_txn,
            None,
        )?;
    }

    tx.commit()?;

    let member_name: String = conn.query_row(
        "SELECT name FROM members WHERE id = ?1",
        [member_id],
        |row| row.get(0),
    ).unwrap_or_else(|_| "Unknown".to_string());

    Ok(ChitPayment {
        id: payment_id,
        chit_id,
        cycle_id,
        member_id,
        member_name,
        amount: gross_amount,
        payment_method: payment_method.to_string(),
        paid_at: paid_at.to_string(),
    })
}

/// One outstanding installment a member still owes for an already-completed cycle.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingDue {
    pub cycle_id: i64,
    pub cycle_no: i64,
    pub member_id: i64,
    pub member_name: String,
    pub amount_owed: f64,
}

/// List overdue installments for a chit: every member who hasn't paid a
/// *completed* cycle (one that already has a winner). The amount owed for a
/// cycle is the monthly contribution minus the discount that applied to it
/// (= the previous cycle's auction discount per member), matching how the
/// live/past payment amounts are computed.
pub fn get_chit_pending_dues(
    conn: &Connection,
    chit_id: i64,
) -> Result<Vec<PendingDue>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT cc.id, cc.cycle_no, m.id, m.name,
                cg.monthly_contribution,
                COALESCE((SELECT prev.auction_discount_per_member FROM chit_cycles prev
                          WHERE prev.chit_id = cc.chit_id AND prev.cycle_no = cc.cycle_no - 1), 0)
         FROM chit_cycles cc
         JOIN chit_groups cg ON cg.id = cc.chit_id
         JOIN chit_members cm ON cm.chit_id = cc.chit_id
         JOIN members m ON m.id = cm.member_id
         WHERE cc.chit_id = ?1
           AND cc.winning_member_id IS NOT NULL
           -- Only regular cycles owe contributions. The closing/settlement cycle
           -- (cycle_no = months + 1) is payout-only — members don't pay into it,
           -- so it must never be counted as an unpaid due.
           AND cc.cycle_no <= cg.months
           AND NOT EXISTS (
               SELECT 1 FROM chit_payments cp
               WHERE cp.cycle_id = cc.id AND cp.member_id = cm.member_id
           )
         ORDER BY cc.cycle_no ASC, m.name COLLATE NOCASE ASC",
    )?;

    let rows = stmt.query_map([chit_id], |row| {
        let monthly: f64 = row.get(4)?;
        let prev_discount: f64 = row.get(5)?;
        Ok(PendingDue {
            cycle_id: row.get(0)?,
            cycle_no: row.get(1)?,
            member_id: row.get(2)?,
            member_name: row.get(3)?,
            amount_owed: round_to_5((monthly - prev_discount).max(0.0)),
        })
    })?;

    let mut out = Vec::new();
    for r in rows { out.push(r?); }
    Ok(out)
}

/// One line of a member's detailed chit ledger.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChitLedgerRow {
    pub cycle_no: i64,
    pub date: String,
    pub particulars: String,
    pub debit: f64,    // winner payout (gross prize drawn)
    pub credit: f64,   // contribution: a receipt (cash) or an auction discount
    pub balance: f64,  // running creditor(+) / debtor(−) balance
    pub is_payout: bool,
}

/// A member's full debit/credit ledger within a single chit.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberChitLedger {
    pub chit_id: i64,
    pub member_id: i64,
    pub member_name: String,
    pub member_code: String,
    pub chit_name: String,
    pub passbook_number: Option<String>,
    pub monthly_contribution: f64,
    pub total_cycles: i64,
    pub won_cycle_no: Option<i64>,
    pub payout_amount: f64,
    pub total_debit: f64,
    pub total_credit: f64,
    pub total_payout: f64,
    pub closing_balance: f64,
    pub guarantors: Vec<crate::db::guarantors::Guarantor>,
    pub rows: Vec<ChitLedgerRow>,
}

/// Build a member's detailed chit ledger in the traditional chit-passbook form.
/// Every cycle CREDITS the member's full contribution, split into a "Receipt"
/// line (cash actually paid) and an "Auction discount" line (the bid discount
/// that reduced their cash that cycle). When the member wins, the GROSS prize is
/// a single DEBIT. The running balance is a creditor/debtor figure — positive =
/// CR (the SHG owes the member), negative = DR (the member owes the SHG) — and
/// settles to NIL once the chit completes. Includes past-data entries (they live
/// in chit_payments / chit_cycle_winners like live data).
pub fn get_member_chit_ledger(
    conn: &Connection,
    chit_id: i64,
    member_id: i64,
) -> Result<MemberChitLedger, AppError> {
    let (member_name, member_code): (String, String) = conn.query_row(
        "SELECT name, member_code FROM members WHERE id = ?1",
        [member_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    // prize = the gross pot the winner draws (debited once they win).
    let (chit_name, monthly_contribution, total_cycles, prize): (String, f64, i64, f64) =
        conn.query_row(
            "SELECT name, monthly_contribution, months, COALESCE(fixed_prize_amount, total_amount)
             FROM chit_groups WHERE id = ?1",
            [chit_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )?;
    let passbook_number = passbook_number(conn, chit_id, member_id);

    // Guarantors (sureties) for this member's chit membership, if any.
    let guarantors = match crate::db::guarantors::chit_member_ref(conn, chit_id, member_id) {
        Ok(ref_id) => crate::db::guarantors::get_guarantors(conn, "CHIT_MEMBER", ref_id)?,
        Err(_) => Vec::new(),
    };

    // The cycle this member won (members win at most once). Prefer the modern
    // multi-winner table; fall back to the legacy single-winner column.
    let won: Option<(i64, String)> = conn.query_row(
        "SELECT cc.cycle_no, w.paid_at
         FROM chit_cycle_winners w
         JOIN chit_cycles cc ON cc.id = w.cycle_id
         WHERE w.chit_id = ?1 AND w.member_id = ?2
         ORDER BY cc.cycle_no ASC LIMIT 1",
        (chit_id, member_id),
        |r| Ok((r.get(0)?, r.get(1)?)),
    ).optional()?.or(
        conn.query_row(
            "SELECT cc.cycle_no, cc.auction_date
             FROM chit_cycles cc
             WHERE cc.chit_id = ?1 AND cc.winning_member_id = ?2
               AND NOT EXISTS (SELECT 1 FROM chit_cycle_winners w
                               WHERE w.cycle_id = cc.id AND w.member_id = ?2)
             ORDER BY cc.cycle_no ASC LIMIT 1",
            (chit_id, member_id),
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).optional()?
    );
    let won_cycle_no = won.as_ref().map(|w| w.0);

    // Member's instalments for this chit (cycle_no, cash_paid, paid_at), in order.
    let mut installments: Vec<(i64, f64, String)> = {
        let mut stmt = conn.prepare(
            "SELECT cc.cycle_no, cp.amount, cp.paid_at
             FROM chit_payments cp
             JOIN chit_cycles cc ON cc.id = cp.cycle_id
             WHERE cp.chit_id = ?1 AND cp.member_id = ?2",
        )?;
        let rows = stmt.query_map((chit_id, member_id), |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, f64>(1)?, r.get::<_, String>(2)?))
        })?;
        let mut v = Vec::new();
        for r in rows { v.push(r?); }
        v
    };
    installments.sort_by(|a, b| a.0.cmp(&b.0).then(a.2.cmp(&b.2)));

    let mut rows: Vec<ChitLedgerRow> = Vec::new();
    let mut balance = 0.0_f64;       // credits positive, debits negative
    let mut total_debit = 0.0_f64;
    let mut total_credit = 0.0_f64;
    let mut payout_done = won.is_none();

    let emit_payout = |rows: &mut Vec<ChitLedgerRow>, balance: &mut f64, total_debit: &mut f64| {
        if let Some((wcn, wdate)) = won.as_ref() {
            *balance -= prize;
            *total_debit += prize;
            rows.push(ChitLedgerRow {
                cycle_no: *wcn,
                date: wdate.clone(),
                particulars: "Winner payout".to_string(),
                debit: prize,
                credit: 0.0,
                balance: *balance,
                is_payout: true,
            });
        }
    };

    for (cycle_no, cash, date) in &installments {
        // Payout goes before any later-cycle instalment (covers a member who won
        // but didn't pay their own winning cycle).
        if !payout_done {
            if let Some(wc) = won_cycle_no {
                if *cycle_no > wc {
                    emit_payout(&mut rows, &mut balance, &mut total_debit);
                    payout_done = true;
                }
            }
        }

        // Receipt — cash actually paid (a credit).
        balance += *cash;
        total_credit += *cash;
        rows.push(ChitLedgerRow {
            cycle_no: *cycle_no,
            date: date.clone(),
            particulars: "Receipt".to_string(),
            debit: 0.0,
            credit: *cash,
            balance,
            is_payout: false,
        });

        // Auction (bid) discount that reduced this cycle's cash — also a credit.
        let discount = (monthly_contribution - *cash).max(0.0);
        if discount > 0.005 {
            balance += discount;
            total_credit += discount;
            rows.push(ChitLedgerRow {
                cycle_no: *cycle_no,
                date: date.clone(),
                particulars: "Auction discount".to_string(),
                debit: 0.0,
                credit: discount,
                balance,
                is_payout: false,
            });
        }

        // Payout right after the winning cycle's contribution lines.
        if !payout_done {
            if let Some(wc) = won_cycle_no {
                if *cycle_no == wc {
                    emit_payout(&mut rows, &mut balance, &mut total_debit);
                    payout_done = true;
                }
            }
        }
    }

    // Won, but no instalment at/after the winning cycle recorded yet.
    if !payout_done {
        emit_payout(&mut rows, &mut balance, &mut total_debit);
    }

    Ok(MemberChitLedger {
        chit_id,
        member_id,
        member_name,
        member_code,
        chit_name,
        passbook_number,
        monthly_contribution,
        total_cycles,
        won_cycle_no,
        payout_amount: prize,
        total_debit,
        total_credit,
        total_payout: total_debit,
        closing_balance: balance,
        guarantors,
        rows,
    })
}

// ─── Closing cycle / final settlement ────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClosingMember {
    pub member_id: i64,
    pub member_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClosingInfo {
    pub all_cycles_complete: bool,
    pub outstanding_dues: i64,
    pub payout_each: f64,
    pub already_closed: bool,
    pub leftover_members: Vec<ClosingMember>,
}

/// Read what a chit needs for its closing cycle: whether all regular cycles are
/// done, how many overdue installments remain, and which members never won (and
/// must be paid out at close). `payout_each` = prize − commission per winner.
pub fn get_chit_closing_info(conn: &Connection, chit_id: i64) -> Result<ClosingInfo, AppError> {
    let (months, prize, commission_per_winner, status): (i64, f64, f64, String) = conn.query_row(
        "SELECT months, COALESCE(fixed_prize_amount, total_amount),
                COALESCE(commission_per_winner, 0), status
         FROM chit_groups WHERE id = ?1",
        [chit_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )?;

    let completed_regular: i64 = conn.query_row(
        "SELECT COUNT(*) FROM chit_cycles
         WHERE chit_id = ?1 AND cycle_no >= 1 AND cycle_no <= ?2 AND winning_member_id IS NOT NULL",
        (chit_id, months),
        |r| r.get(0),
    ).unwrap_or(0);

    let outstanding_dues = get_chit_pending_dues(conn, chit_id)?.len() as i64;

    let mut stmt = conn.prepare(
        "SELECT m.id, m.name
         FROM chit_members cm
         JOIN members m ON m.id = cm.member_id
         WHERE cm.chit_id = ?1
           AND NOT EXISTS (
               SELECT 1 FROM chit_cycle_winners w
               WHERE w.chit_id = cm.chit_id AND w.member_id = cm.member_id
           )
         ORDER BY m.name COLLATE NOCASE ASC",
    )?;
    let rows = stmt.query_map([chit_id], |r| {
        Ok(ClosingMember { member_id: r.get(0)?, member_name: r.get(1)? })
    })?;
    let mut leftover = Vec::new();
    for r in rows { leftover.push(r?); }

    Ok(ClosingInfo {
        all_cycles_complete: completed_regular >= months,
        outstanding_dues,
        payout_each: (prize - commission_per_winner).max(0.0),
        already_closed: status == "CLOSED",
        leftover_members: leftover,
    })
}

/// Pay out leftover (never-won) members in the closing/settlement cycle.
///
/// This is INTENTIONALLY allowed even while other members still owe dues — the
/// leftover members are entitled to their payout and shouldn't be held up by late
/// payers. It is idempotent: a member already paid in the closing cycle is
/// rejected, so re-running only settles the rest. It does NOT close the chit;
/// that's a separate step (`close_chit`) gated on everything being settled.
pub fn pay_closing_members(
    conn: &mut Connection,
    chit_id: i64,
    payouts: &[(i64, String, Option<String>)], // (member_id, payment_method, bank_txn_id)
) -> Result<(), AppError> {
    let (months, prize, commission_per_winner, status): (i64, f64, f64, String) = conn.query_row(
        "SELECT months, COALESCE(fixed_prize_amount, total_amount),
                COALESCE(commission_per_winner, 0), status
         FROM chit_groups WHERE id = ?1",
        [chit_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )?;

    if status == "CLOSED" {
        return Err(AppError::business("This chit is already closed."));
    }
    if payouts.is_empty() {
        return Ok(());
    }

    let completed_regular: i64 = conn.query_row(
        "SELECT COUNT(*) FROM chit_cycles
         WHERE chit_id = ?1 AND cycle_no >= 1 AND cycle_no <= ?2 AND winning_member_id IS NOT NULL",
        (chit_id, months),
        |r| r.get(0),
    ).unwrap_or(0);
    if completed_regular < months {
        return Err(AppError::business("Finish all regular cycles before settling the chit."));
    }

    // Validate every payout target is a real, not-yet-paid leftover member.
    for (member_id, method, _) in payouts {
        validation::validate_payment_method(method)?;
        let is_member: bool = conn.query_row(
            "SELECT COUNT(*) > 0 FROM chit_members WHERE chit_id = ?1 AND member_id = ?2",
            (chit_id, member_id), |r| r.get(0),
        ).unwrap_or(false);
        if !is_member {
            return Err(AppError::business("A payout member is not part of this chit."));
        }
        let already_won: bool = conn.query_row(
            "SELECT COUNT(*) > 0 FROM chit_cycle_winners WHERE chit_id = ?1 AND member_id = ?2",
            (chit_id, member_id), |r| r.get(0),
        ).unwrap_or(false);
        if already_won {
            return Err(AppError::business("A payout member has already been paid or has won a cycle."));
        }
    }

    let now = chrono::Utc::now().to_rfc3339();
    let payout = (prize - commission_per_winner).max(0.0);
    let mut tx = conn.transaction()?;

    // Find or create the single closing cycle (cycle_no = months + 1).
    let cycle_id: i64 = match tx.query_row(
        "SELECT id FROM chit_cycles WHERE chit_id = ?1 AND cycle_no = ?2",
        (chit_id, months + 1),
        |r| r.get(0),
    ).optional()? {
        Some(id) => id,
        None => {
            tx.execute(
                "INSERT INTO chit_cycles
                 (chit_id, cycle_no, auction_date, winning_member_id, bid_discount, payout_amount,
                  total_bid_discounts, auction_discount_per_member, is_past_entry)
                 VALUES (?1, ?2, ?3, ?4, 0, ?5, 0, 0, 0)",
                (chit_id, months + 1, &now[..10], payouts[0].0, prize),
            )?;
            tx.last_insert_rowid()
        }
    };

    for (member_id, method, bank_txn_id) in payouts {
        tx.execute(
            "INSERT INTO chit_cycle_winners
             (chit_id, cycle_id, member_id, winner_type, bid_discount, commission, payout_amount, payment_method, paid_at)
             VALUES (?1, ?2, ?3, 'FIXED', 0, ?4, ?5, ?6, ?7)",
            (chit_id, cycle_id, *member_id, commission_per_winner, payout, method.as_str(), &now),
        )?;
        let pb = passbook_number(&tx, chit_id, *member_id);
        if commission_per_winner > 0.0 {
            ledger::record_receipt(&mut tx, commission_per_winner,
                &reason_with_passbook("Chit Commission (closing)", &pb),
                method.as_str(), Some("CHIT_COMMISSION"), Some(cycle_id), &now)?;
            tag_member_ref(&tx, *member_id)?;
        }
        // Voucher = GROSS prize; commission booked as a separate receipt.
        let bank_txn = if method == "BANK" { bank_txn_id.as_deref() } else { None };
        ledger::record_voucher_ex(&mut tx, prize,
            &reason_with_passbook("Chit Payout (closing)", &pb),
            method.as_str(), Some("CHIT_PAYOUT"), Some(cycle_id), &now, bank_txn, None)?;
        tag_member_ref(&tx, *member_id)?;
    }

    tx.commit()?;
    Ok(())
}

/// Mark a chit CLOSED. Only allowed once everything is settled: all regular
/// cycles complete, no outstanding dues, and every leftover member already paid
/// out (`pay_closing_members`). Does not move any money itself.
pub fn close_chit(conn: &mut Connection, chit_id: i64) -> Result<(), AppError> {
    let (months, status): (i64, String) = conn.query_row(
        "SELECT months, status FROM chit_groups WHERE id = ?1",
        [chit_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;

    if status == "CLOSED" {
        return Err(AppError::business("This chit is already closed."));
    }

    let completed_regular: i64 = conn.query_row(
        "SELECT COUNT(*) FROM chit_cycles
         WHERE chit_id = ?1 AND cycle_no >= 1 AND cycle_no <= ?2 AND winning_member_id IS NOT NULL",
        (chit_id, months),
        |r| r.get(0),
    ).unwrap_or(0);
    if completed_regular < months {
        return Err(AppError::business("Finish all regular cycles before closing the chit."));
    }

    if !get_chit_pending_dues(conn, chit_id)?.is_empty() {
        return Err(AppError::business("Collect all pending dues before closing the chit."));
    }

    // Everyone must have won (regular cycle or closing settlement) before closing.
    let leftover: i64 = conn.query_row(
        "SELECT COUNT(*) FROM chit_members cm
         WHERE cm.chit_id = ?1
           AND NOT EXISTS (SELECT 1 FROM chit_cycle_winners w
                           WHERE w.chit_id = cm.chit_id AND w.member_id = cm.member_id)",
        [chit_id],
        |r| r.get(0),
    ).unwrap_or(0);
    if leftover > 0 {
        return Err(AppError::business("Pay out all remaining members before closing the chit."));
    }

    conn.execute("UPDATE chit_groups SET status = 'CLOSED' WHERE id = ?1", [chit_id])?;
    Ok(())
}

/// Process winner payout.
///
/// - `bid_discount`: total auction discount for this cycle, given back to members (reduces their installment).
/// - `commission`: SHG commission taken from the winner, recorded as a separate receipt.
/// - winner receives `total_amount − bid_discount − commission` via voucher.
pub fn process_winner_payout(
    conn: &mut Connection,
    chit_id: i64,
    cycle_id: i64,
    winning_member_id: i64,
    bid_discount: f64,
    commission: f64,
    payment_method: &str,
    payout_date: &str,
    note: &str,
) -> Result<(f64, f64), AppError> {
    if is_cycle_completed(conn, cycle_id)? {
        return Err(AppError::business(
            "This cycle is already completed — the winner has already been paid out."
        ));
    }

    let (total_amount, chit_name, cycle_no): (f64, String, i64) = conn.query_row(
        "SELECT cg.total_amount, cg.name, cc.cycle_no
         FROM chit_groups cg JOIN chit_cycles cc ON cg.id = cc.chit_id
         WHERE cg.id = ?1 AND cc.id = ?2",
        (chit_id, cycle_id),
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;

    if bid_discount < 0.0 {
        return Err(AppError::validation("Auction discount cannot be negative"));
    }
    if commission < 0.0 {
        return Err(AppError::validation("Commission cannot be negative"));
    }
    if bid_discount + commission >= total_amount {
        return Err(AppError::validation(
            "Auction discount + commission cannot equal or exceed the chit total amount"
        ));
    }
    let winner_amount = total_amount - bid_discount - commission;

    let mut tx = conn.transaction()?;

    tx.execute(
        "UPDATE chit_cycles
         SET winning_member_id = ?1, bid_discount = ?2, payout_amount = ?3
         WHERE id = ?4 AND chit_id = ?5",
        (winning_member_id, bid_discount, winner_amount, cycle_id, chit_id),
    )?;

    let pb = passbook_number(&tx, chit_id, winning_member_id);

    // Commission receipt — SHG's take from the winner, separate from member installments.
    if commission > 0.0 {
        ledger::record_receipt(
            &mut tx,
            commission,
            &reason_with_passbook("Chit Commission", &pb),
            payment_method,
            Some("CHIT_COMMISSION"),
            Some(cycle_id),
            payout_date,
        )?;
    }

    // Voucher = GROSS prize disbursed (bid-reduced, before commission); the
    // commission is the separate receipt above. Net cash out = winner_amount, but
    // the voucher correctly shows the full amount disbursed.
    let voucher_amount = (total_amount - bid_discount).max(0.0);
    let payout_base = if bid_discount > 0.005 {
        format!("Chit Payout (Bid discount {})", fmt_rs(bid_discount))
    } else {
        "Chit Payout".to_string()
    };
    ledger::record_voucher(
        &mut tx,
        voucher_amount,
        &reason_with_passbook(&payout_base, &pb),
        payment_method,
        Some("CHIT_PAYOUT"),
        Some(cycle_id),
        payout_date,
    )?;

    tx.commit()?;
    Ok((winner_amount, commission))
}
/// Create a chit cycle definition.
pub fn create_chit_cycle(
    conn: &mut Connection,
    chit_id: i64,
    cycle_no: i64,
    auction_date: &str,
    winning_member_id: Option<i64>,
    bid_discount: f64,
    payout_amount: f64,
) -> Result<(), AppError> {
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO chit_cycles
         (chit_id, cycle_no, auction_date, winning_member_id, bid_discount, payout_amount)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        (chit_id, cycle_no, auction_date, winning_member_id, bid_discount, payout_amount),
    )?;
    tx.commit()?;
    Ok(())
}

/// Record a chit installment payment and associated ledger receipt.
pub fn record_chit_payment(
    conn: &mut Connection,
    chit_id: i64,
    cycle_id: i64,
    member_id: i64,
    amount: f64,
    payment_method: &str,
    paid_at: &str,
) -> Result<(), AppError> {
    validation::validate_money_amount(amount)?;
    validation::validate_payment_method(payment_method)?;

    // Reject if the cycle is already completed.
    if is_cycle_completed(conn, cycle_id)? {
        return Err(AppError::business(
            "This cycle is locked — the winner has already been paid out. No further payments can be recorded."
        ));
    }

    let mut tx = conn.transaction()?;

    // Verify the cycle exists — never auto-create a ghost cycle.
    let cycle_exists: bool = tx.query_row(
        "SELECT COUNT(*) FROM chit_cycles WHERE id = ?1",
        [cycle_id],
        |row| row.get(0),
    ).unwrap_or(0) > 0;

    if !cycle_exists {
        return Err(AppError::business("Chit cycle not found"));
    }

    // Check if payment already exists; if so, add the incremental amount
    // (partial-payment top-up) and record a receipt for the incremental cash received.
    let payment_exists: bool = tx.query_row(
        "SELECT COUNT(*) FROM chit_payments WHERE cycle_id = ?1 AND member_id = ?2",
        [cycle_id, member_id],
        |row| row.get(0),
    ).unwrap_or(0) > 0;

    if payment_exists {
        tx.execute(
            "UPDATE chit_payments
             SET amount = amount + ?1, payment_method = ?2, paid_at = ?3
             WHERE cycle_id = ?4 AND member_id = ?5",
            (amount, payment_method, paid_at, cycle_id, member_id),
        )?;
    } else {
        tx.execute(
            "INSERT INTO chit_payments
             (chit_id, cycle_id, member_id, amount, payment_method, paid_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            (chit_id, cycle_id, member_id, amount, payment_method, paid_at),
        )?;
    }

    let pb = passbook_number(&tx, chit_id, member_id);
    ledger::record_receipt(
        &mut tx,
        amount,
        &reason_with_passbook("Chit payment", &pb),
        payment_method,
        Some("CHIT_PAYMENT"),
        Some(member_id),
        paid_at,
    )?;

    tx.commit()?;
    Ok(())
}

/// Get payment summary for a cycle
#[derive(Debug, Serialize)]
pub struct CyclePaymentSummary {
    pub member_id: i64,
    pub member_name: String,
    pub has_paid: bool,
    pub amount_paid: f64,
    pub payment_method: Option<String>,
    pub paid_at: Option<String>,
    pub is_eligible_for_discount: bool,
    pub payable_amount: f64, // C - discount if eligible, C otherwise
    pub has_won: bool,       // already won this chit — excluded from future auctions
}

pub fn get_cycle_payment_summary(
    conn: &Connection,
    chit_id: i64,
    cycle_id: i64,
) -> Result<Vec<CyclePaymentSummary>, AppError> {
    let monthly_contribution: f64 = conn.query_row(
        "SELECT monthly_contribution FROM chit_groups WHERE id = ?1",
        [chit_id],
        |row| row.get(0),
    ).unwrap_or(0.0);

    // Chit discounts carry forward: this cycle's contributions are reduced by the
    // PREVIOUS cycle's auction discount (not this cycle's own). Read it from the
    // cycle with cycle_no - 1, matching past-data entry and pending-dues. This is
    // robust to whether this cycle's winners have been processed yet, and works
    // seamlessly across the past-entry → live-management boundary.
    let discount_per_member: f64 = conn.query_row(
        "SELECT COALESCE(prev.auction_discount_per_member, 0)
         FROM chit_cycles cur
         JOIN chit_cycles prev
           ON prev.chit_id = cur.chit_id AND prev.cycle_no = cur.cycle_no - 1
         WHERE cur.id = ?1",
        [cycle_id],
        |row| row.get(0),
    ).unwrap_or(0.0);

    let mut stmt = conn.prepare(
        "SELECT cm.member_id, m.name
         FROM chit_members cm
         JOIN members m ON cm.member_id = m.id
         WHERE cm.chit_id = ?1
         ORDER BY m.name COLLATE NOCASE"
    )?;

    let members: Vec<(i64, String)> = stmt
        .query_map([chit_id], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;

    let mut result = Vec::new();

    for (member_id, member_name) in members {
        let payment_info: Option<(f64, String, String)> = conn.query_row(
            "SELECT amount, payment_method, paid_at FROM chit_payments
             WHERE chit_id = ?1 AND cycle_id = ?2 AND member_id = ?3",
            (chit_id, cycle_id, member_id),
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).ok();

        let is_eligible: bool = conn.query_row(
            "SELECT COALESCE(is_eligible, 1) FROM chit_member_eligibility
             WHERE chit_id = ?1 AND cycle_id = ?2 AND member_id = ?3",
            (chit_id, cycle_id, member_id),
            |row| row.get::<_, i64>(0),
        ).unwrap_or(1) != 0;

        let has_won: bool = conn.query_row(
            "SELECT COUNT(*) > 0 FROM chit_cycle_winners
             WHERE chit_id = ?1 AND member_id = ?2",
            (chit_id, member_id),
            |row| row.get(0),
        ).unwrap_or(false);

        let payable_amount = round_to_5(if is_eligible {
            (monthly_contribution - discount_per_member).max(0.0)
        } else {
            monthly_contribution
        });

        result.push(CyclePaymentSummary {
            member_id,
            member_name,
            has_paid: payment_info.is_some(),
            amount_paid: payment_info.as_ref().map(|p| p.0).unwrap_or(0.0),
            payment_method: payment_info.as_ref().map(|p| p.1.clone()),
            paid_at: payment_info.as_ref().map(|p| p.2.clone()),
            is_eligible_for_discount: is_eligible,
            payable_amount,
            has_won,
        });
    }

    Ok(result)
}
