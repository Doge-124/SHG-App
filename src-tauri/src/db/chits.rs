//! Chit fund lifecycle management.
//!
//! Financial flows:
//! - Installment: chit installment → SHG receipt.
//! - Payout: chit winner payout → SHG voucher.

use rusqlite::Connection;
use serde::Serialize;

use crate::error::AppError;
use crate::db::{ledger, validation};

/// Check if a member can participate in chit funds (SHG or CHIT type)
fn can_participate_in_chit(conn: &Connection, member_id: i64) -> Result<bool, AppError> {
    let mt: String = conn.query_row(
        "SELECT member_type FROM members WHERE id = ?1",
        [member_id],
        |row| row.get(0),
    )?;
    // SHG members can do everything, CHIT members can do chit
    Ok(mt == "SHG" || mt == "CHIT")
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
    pub total_amount: f64,
    pub months: i64,
    pub monthly_contribution: f64,
    pub commission_percent: f64,
    pub start_date: String,
    pub status: String,
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
pub fn create_chit_group(
    conn: &mut Connection,
    name: &str,
    total_amount: f64,
    months: i64,
    commission_percent: f64,
    start_date: &str,
) -> Result<(), AppError> {
    validation::validate_chit_parameters(total_amount, months)?;

    let monthly = total_amount / months as f64;

    conn.execute(
        "INSERT INTO chit_groups
         (name, total_amount, months, monthly_contribution, commission_percent, start_date, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'ACTIVE')",
        (name, total_amount, months, monthly, commission_percent, start_date),
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

/// Manual cycle management: Advance to next cycle
pub fn advance_to_next_cycle(
    conn: &mut Connection,
    chit_id: i64,
) -> Result<ChitCycle, AppError> {
    let current_cycle = get_current_cycle(conn, chit_id)?;
    let next_cycle_no = current_cycle.as_ref().map(|c| c.cycle_no + 1).unwrap_or(1);

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

    // Calculate next auction date
    let auction_date = if let Some(ref current) = current_cycle {
        let current_date = chrono::NaiveDate::parse_from_str(&current.auction_date, "%Y-%m-%d")
            .unwrap_or_else(|_| chrono::Local::now().naive_local().date());
        let next_date = current_date + chrono::Duration::days(30);
        next_date.format("%Y-%m-%d").to_string()
    } else {
        chit.start_date.clone()
    };

    // Calculate expected payout
    let member_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM chit_members WHERE chit_id = ?1",
        [chit_id],
        |row| row.get(0),
    ).unwrap_or(0);

    let total_collection = chit.monthly_contribution * member_count as f64;

    conn.execute(
        "INSERT INTO chit_cycles
         (chit_id, cycle_no, auction_date, winning_member_id, bid_discount, payout_amount)
         VALUES (?1, ?2, ?3, NULL, 0, ?4)",
        (chit_id, next_cycle_no, &auction_date, total_collection),
    )?;

    let cycle_id = conn.last_insert_rowid();

    Ok(ChitCycle {
        id: cycle_id,
        chit_id,
        cycle_no: next_cycle_no,
        auction_date,
        winning_member_id: None,
        bid_discount: 0.0,
        payout_amount: total_collection,
    })
}

/// Record member payment for current cycle with auction discount
pub fn record_member_payment_with_discount(
    conn: &mut Connection,
    chit_id: i64,
    cycle_id: i64,
    member_id: i64,
    gross_amount: f64,
    auction_discount: f64,
    payment_method: &str,
    paid_at: &str,
) -> Result<ChitPayment, AppError> {
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

    // Calculate net amount (gross - discount)
    let net_amount = gross_amount - auction_discount;

    let mut tx = conn.transaction()?;

    // Check if payment already exists
    let payment_exists: bool = tx.query_row(
        "SELECT COUNT(*) FROM chit_payments WHERE chit_id = ?1 AND cycle_id = ?2 AND member_id = ?3",
        (chit_id, cycle_id, member_id),
        |row| row.get(0),
    ).unwrap_or(0) > 0;

    if payment_exists {
        tx.execute(
            "UPDATE chit_payments 
             SET amount = ?1, payment_method = ?2, paid_at = ?3
             WHERE chit_id = ?4 AND cycle_id = ?5 AND member_id = ?6",
            (net_amount, payment_method, paid_at, chit_id, cycle_id, member_id),
        )?;
    } else {
        tx.execute(
            "INSERT INTO chit_payments
             (chit_id, cycle_id, member_id, amount, payment_method, paid_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            (chit_id, cycle_id, member_id, net_amount, payment_method, paid_at),
        )?;
    }

    let payment_id = tx.last_insert_rowid();

    // Record receipt for the NET amount
    ledger::record_receipt(
        &mut tx,
        net_amount,
        &format!("Chit {} - Cycle {} payment from member {} (Gross: {}, Discount: {})",
            chit.name, cycle_id, member_id, gross_amount, auction_discount),
        payment_method,
        Some("CHIT_PAYMENT"),
        Some(member_id),
        paid_at,
    )?;

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
        amount: net_amount,
        payment_method: payment_method.to_string(),
        paid_at: paid_at.to_string(),
    })
}

/// Process winner payout - records the winning member and generates voucher
pub fn process_winner_payout(
    conn: &mut Connection,
    chit_id: i64,
    cycle_id: i64,
    winning_member_id: i64,
    winner_amount: f64,
    payment_method: &str,
    payout_date: &str,
    note: &str,
) -> Result<(), AppError> {
    let mut tx = conn.transaction()?;

    // Get cycle details
    let cycle: ChitCycle = tx.query_row(
        "SELECT id, chit_id, cycle_no, auction_date, winning_member_id, bid_discount, payout_amount
         FROM chit_cycles WHERE id = ?1",
        [cycle_id],
        |row| {
            Ok(ChitCycle {
                id: row.get(0)?,
                chit_id: row.get(1)?,
                cycle_no: row.get(2)?,
                auction_date: row.get(3)?,
                winning_member_id: row.get(4)?,
                bid_discount: row.get(5)?,
                payout_amount: row.get(6)?,
            })
        },
    )?;

    // Calculate bid discount based on winner amount
    let total_collection = cycle.payout_amount + cycle.bid_discount;
    let bid_discount = total_collection - winner_amount;

    // Update cycle with winning member
    tx.execute(
        "UPDATE chit_cycles
         SET winning_member_id = ?1, bid_discount = ?2, payout_amount = ?3
         WHERE id = ?4 AND chit_id = ?5",
        (winning_member_id, bid_discount, winner_amount, cycle_id, chit_id),
    )?;

    // Generate voucher for winner payout
    // Using unchecked voucher since funds were just collected from members
    ledger::record_voucher_unchecked(
        &mut tx,
        winner_amount,
        note,
        payment_method,
        Some("CHIT_PAYOUT"),
        Some(cycle_id),
        payout_date,
    )?;

    tx.commit()?;
    Ok(())
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

    let mut tx = conn.transaction()?;

    // Check if the cycle exists, if not create it
    let cycle_exists: bool = tx.query_row(
        "SELECT COUNT(*) FROM chit_cycles WHERE id = ?1",
        [cycle_id],
        |row| row.get(0),
    ).unwrap_or(0) > 0;

    let actual_cycle_id: i64 = if !cycle_exists {
        // Create a default cycle if it doesn't exist
        tx.execute(
            "INSERT INTO chit_cycles (chit_id, cycle_no, auction_date, winning_member_id, bid_discount, payout_amount)
             VALUES (?1, ?2, ?3, NULL, 0, 0)",
            (chit_id, 1, paid_at),
        )?;
        // Get the ID of the newly created cycle
        tx.last_insert_rowid()
    } else {
        cycle_id
    };

    // Check if payment already exists for this member and cycle
    let payment_exists: bool = tx.query_row(
        "SELECT COUNT(*) FROM chit_payments WHERE cycle_id = ?1 AND member_id = ?2",
        [actual_cycle_id, member_id],
        |row| row.get(0),
    ).unwrap_or(0) > 0;

    if payment_exists {
        // Update existing payment instead of creating a new one
        tx.execute(
            "UPDATE chit_payments 
             SET amount = amount + ?1, payment_method = ?2, paid_at = ?3
             WHERE cycle_id = ?4 AND member_id = ?5",
            (amount, payment_method, paid_at, actual_cycle_id, member_id),
        )?;
    } else {
        // Create new payment
        tx.execute(
            "INSERT INTO chit_payments
             (chit_id, cycle_id, member_id, amount, payment_method, paid_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            (chit_id, actual_cycle_id, member_id, amount, payment_method, paid_at),
        )?;
    }

    ledger::record_receipt(
        &mut tx,
        amount,
        "Chit payment",
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
}

pub fn get_cycle_payment_summary(
    conn: &Connection,
    chit_id: i64,
    cycle_id: i64,
) -> Result<Vec<CyclePaymentSummary>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT cm.member_id, m.name 
         FROM chit_members cm
         JOIN members m ON cm.member_id = m.id
         WHERE cm.chit_id = ?1
         ORDER BY m.name"
    )?;

    let members: Vec<(i64, String)> = stmt
        .query_map([chit_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut result = Vec::new();

    for (member_id, member_name) in members {
        let payment_info: Option<(f64, String, String)> = conn.query_row(
            "SELECT amount, payment_method, paid_at
             FROM chit_payments
             WHERE chit_id = ?1 AND cycle_id = ?2 AND member_id = ?3",
            (chit_id, cycle_id, member_id),
            |row| {
                Ok((
                    row.get::<_, f64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        ).ok();

        result.push(CyclePaymentSummary {
            member_id,
            member_name,
            has_paid: payment_info.is_some(),
            amount_paid: payment_info.as_ref().map(|p| p.0).unwrap_or(0.0),
            payment_method: payment_info.as_ref().map(|p| p.1.clone()),
            paid_at: payment_info.as_ref().map(|p| p.2.clone()),
        });
    }

    Ok(result)
}
