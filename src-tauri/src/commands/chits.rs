//! Tauri commands for chit group management and flows.

use std::sync::Mutex;
use tauri::State;

use crate::db::{self, validation};
use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
pub fn get_chit_group(state: State<Mutex<AppState>>, id: i64) -> Result<Option<db::chits::ChitGroup>, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    let mut stmt = conn.prepare(
        "SELECT id, name, total_amount, months, monthly_contribution, commission_percent, start_date, status
         FROM chit_groups 
         WHERE id = ?1"
    ).map_err(|e| e.to_string())?;

    let group = stmt.query_row([id], |row| {
        Ok(db::chits::ChitGroup {
            id: row.get(0)?,
            name: row.get(1)?,
            total_amount: row.get(2)?,
            months: row.get(3)?,
            monthly_contribution: row.get(4)?,
            commission_percent: row.get(5)?,
            start_date: row.get(6)?,
            status: row.get(7)?,
        })
    });

    match group {
        Ok(g) => Ok(Some(g)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn get_chit_groups(state: State<Mutex<AppState>>) -> Result<Vec<db::chits::ChitGroup>, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    let mut stmt = conn.prepare(
        "SELECT id, name, total_amount, months, monthly_contribution, commission_percent, start_date, status
         FROM chit_groups 
         ORDER BY start_date DESC"
    ).map_err(|e| e.to_string())?;

    let groups = stmt.query_map([], |row| {
        Ok(db::chits::ChitGroup {
            id: row.get(0)?,
            name: row.get(1)?,
            total_amount: row.get(2)?,
            months: row.get(3)?,
            monthly_contribution: row.get(4)?,
            commission_percent: row.get(5)?,
            start_date: row.get(6)?,
            status: row.get(7)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for group in groups {
        result.push(group.map_err(|e| e.to_string())?);
    }

    Ok(result)
}

#[tauri::command]
pub fn create_chit_group(
    state: State<Mutex<AppState>>,
    name: String,
    total_amount: f64,
    months: i64,
    commission_percent: f64,
    start_date: String,
) -> Result<(), String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    db::chits::create_chit_group(
        conn,
        &name,
        total_amount,
        months,
        commission_percent,
        &start_date,
    )
    .map_err(|e: AppError| e.to_string())
}

#[derive(serde::Serialize)]
pub struct ChitMemberResponse {
    pub id: String,
    pub chit_group_id: String,
    pub member_id: String,
    pub member_name: String,
    pub joined_at: String,
    pub is_winner: bool,
}

#[tauri::command]
pub fn get_chit_members(state: State<Mutex<AppState>>, chit_id: i64) -> Result<Vec<ChitMemberResponse>, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    let mut stmt = conn.prepare(
        "SELECT cm.id, cm.chit_id, cm.member_id, cm.joined_at, m.name
         FROM chit_members cm
         JOIN members m ON cm.member_id = m.id
         WHERE cm.chit_id = ?1
         ORDER BY cm.joined_at DESC"
    ).map_err(|e| e.to_string())?;

    let members = stmt.query_map([chit_id], |row| {
        Ok(ChitMemberResponse {
            id: format!("{}_{}", row.get::<_, i64>(0)?, row.get::<_, i64>(2)?),
            chit_group_id: row.get::<_, i64>(1)?.to_string(),
            member_id: row.get::<_, i64>(2)?.to_string(),
            member_name: row.get(4)?,
            joined_at: row.get(3)?,
            is_winner: false, // Would need to be determined from chit_cycles
        })
    }).map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for member in members {
        result.push(member.map_err(|e| e.to_string())?);
    }

    Ok(result)
}

#[tauri::command]
pub fn get_chit_payments(state: State<Mutex<AppState>>, chit_id: i64) -> Result<Vec<serde_json::Value>, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    let mut stmt = conn.prepare(
        "SELECT cp.id, cp.chit_id, cp.cycle_id, cp.member_id, cp.amount, cp.payment_method, cp.paid_at, m.name
         FROM chit_payments cp
         JOIN members m ON cp.member_id = m.id
         WHERE cp.chit_id = ?1
         ORDER BY cp.paid_at DESC"
    ).map_err(|e| e.to_string())?;

    let payments = stmt.query_map([chit_id], |row| {
        Ok(serde_json::json!({
            "id": row.get::<_, i64>(0)?.to_string(),
            "chitGroupId": row.get::<_, i64>(1)?.to_string(),
            "chitCycleId": row.get::<_, i64>(2)?.to_string(),
            "memberId": row.get::<_, i64>(3)?.to_string(),
            "memberName": row.get::<_, String>(7)?,
            "amount": row.get::<_, f64>(4)?,
            "paymentMethod": row.get::<_, String>(5)?.to_lowercase(),
            "status": "paid",
            "paidAt": row.get::<_, String>(6)?
        }))
    }).map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for payment in payments {
        result.push(payment.map_err(|e| e.to_string())?);
    }

    Ok(result)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn get_chit_cycles(state: State<Mutex<AppState>>, chitId: i64) -> Result<Vec<db::chits::ChitCycle>, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    db::chits::get_chit_cycles(conn, chitId).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_member_to_chit(
    state: State<Mutex<AppState>>,
    chit_id: i64,
    member_id: i64,
    joined_at: String,
) -> Result<ChitMemberResponse, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    // First, get the member details
    let member: db::Member = conn
        .query_row(
        "SELECT id, member_code, name, phone, address, joined_at, is_active,
                opening_balance, opening_balance_method, opening_balance_set_at, past_installments, current_installments, member_type
         FROM members
         WHERE id = ?1",
        [member_id],
        |row| {
            let mt: String = row.get(12)?;
            Ok(db::Member {
                id: row.get(0)?,
                member_code: row.get(1)?,
                name: row.get(2)?,
                phone: row.get(3)?,
                address: row.get(4)?,
                joined_at: row.get(5)?,
                is_active: row.get::<_, i64>(6)? == 1,
                opening_balance: row.get(7)?,
                opening_balance_method: row.get(8)?,
                opening_balance_set_at: row.get(9)?,
                past_installments: row.get(10)?,
                current_installments: row.get(11)?,
                member_type: mt.parse::<db::members::MemberType>().unwrap_or(db::members::MemberType::SHG),
            })
        },
    )
    .map_err(|e| e.to_string())?;

    // Add the member to the chit group
    db::chits::add_member_to_chit(conn, chit_id, member_id, &joined_at)
        .map_err(|e| e.to_string())?;

    // Return the member information
    Ok(ChitMemberResponse {
        id: format!("{}_{}", chit_id, member_id), // Create a composite ID
        chit_group_id: chit_id.to_string(),
        member_id: member_id.to_string(),
        member_name: member.name,
        joined_at,
        is_winner: false,
    })
}

#[tauri::command]
pub fn create_chit_cycle(
    state: State<Mutex<AppState>>,
    chit_id: i64,
    cycle_no: i64,
    auction_date: String,
    winning_member_id: Option<i64>,
    bid_discount: f64,
    payout_amount: f64,
) -> Result<(), String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    db::chits::create_chit_cycle(
        conn,
        chit_id,
        cycle_no,
        &auction_date,
        winning_member_id,
        bid_discount,
        payout_amount,
    )
    .map_err(|e: AppError| e.to_string())
}

#[derive(serde::Serialize)]
#[allow(non_snake_case)]
pub struct ChitPaymentResponse {
    pub id: String,
    pub chitGroupId: String,
    pub chitCycleId: String,
    pub memberId: String,
    pub memberName: String,
    pub amount: f64,
    pub paymentMethod: String,
    pub status: String,
    pub paidAt: String,
}

#[tauri::command]
pub fn record_chit_payment(
    state: State<Mutex<AppState>>,
    chit_id: i64,
    cycle_id: i64,
    member_id: i64,
    amount: f64,
    payment_method: String,
    paid_at: String,
) -> Result<ChitPaymentResponse, String> {
    validation::validate_money_amount(amount)
        .map_err(|e: AppError| e.to_string())?;
    validation::validate_payment_method(&payment_method)
        .map_err(|e: AppError| e.to_string())?;

    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    // Get member name for response
    let member_name: String = conn.query_row(
        "SELECT name FROM members WHERE id = ?1",
        [member_id],
        |row| row.get(0),
    ).unwrap_or_else(|_| "Unknown Member".to_string());

    db::chits::record_chit_payment(
        conn,
        chit_id,
        cycle_id,
        member_id,
        amount,
        &payment_method,
        &paid_at,
    )
    .map_err(|e| e.to_string())?;

    // Return the payment information
    Ok(ChitPaymentResponse {
        id: format!("{}_{}_{}", chit_id, cycle_id, member_id),
        chitGroupId: chit_id.to_string(),
        chitCycleId: cycle_id.to_string(),
        memberId: member_id.to_string(),
        memberName: member_name,
        amount,
        paymentMethod: payment_method.to_lowercase(),
        status: "paid".to_string(),
        paidAt: paid_at,
    })
}

#[tauri::command]
pub fn payout_chit_winner(
    state: State<Mutex<AppState>>,
    chit_id: i64,
    cycle_id: i64,
    winning_member_id: i64,
    payout_amount: f64,
    payment_method: String,
    payout_date: String,
    note: String,
) -> Result<(), String> {
    validation::validate_money_amount(payout_amount)
        .map_err(|e: AppError| e.to_string())?;
    validation::validate_payment_method(&payment_method)
        .map_err(|e: AppError| e.to_string())?;

    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    db::chits::process_winner_payout(
        conn,
        chit_id,
        cycle_id,
        winning_member_id,
        payout_amount,
        &payment_method,
        &payout_date,
        &note,
    )
    .map_err(|e: AppError| e.to_string())
}

// Manual Cycle Management Commands

#[derive(serde::Serialize)]
pub struct CurrentCycleResponse {
    pub cycle: Option<db::ChitCycle>,
    pub payment_summary: Vec<db::chits::CyclePaymentSummary>,
}

#[tauri::command]
pub fn get_current_cycle_with_summary(
    state: State<Mutex<AppState>>,
    chit_id: i64,
) -> Result<CurrentCycleResponse, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    let cycle = db::chits::get_current_cycle(conn, chit_id)
        .map_err(|e: AppError| e.to_string())?;

    let payment_summary = if let Some(ref c) = cycle {
        db::chits::get_cycle_payment_summary(conn, chit_id, c.id)
            .map_err(|e: AppError| e.to_string())?
    } else {
        Vec::new()
    };

    Ok(CurrentCycleResponse {
        cycle,
        payment_summary,
    })
}

#[derive(serde::Serialize)]
pub struct AdvanceCycleResponse {
    pub cycle: db::ChitCycle,
    pub message: String,
}

#[tauri::command]
pub fn advance_to_next_cycle(
    state: State<Mutex<AppState>>,
    chit_id: i64,
) -> Result<AdvanceCycleResponse, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    let cycle = db::chits::advance_to_next_cycle(conn, chit_id)
        .map_err(|e: AppError| e.to_string())?;

    let message = format!("Advanced to cycle {}", cycle.cycle_no);

    Ok(AdvanceCycleResponse {
        cycle,
        message,
    })
}

#[derive(serde::Deserialize)]
pub struct RecordPaymentWithDiscountInput {
    pub chit_id: i64,
    pub cycle_id: i64,
    pub member_id: i64,
    pub gross_amount: f64,
    pub auction_discount: f64,
    pub payment_method: String,
}

#[derive(serde::Serialize)]
pub struct RecordPaymentResponse {
    pub payment_id: i64,
    pub net_amount: f64,
    pub receipt_generated: bool,
    pub message: String,
}

#[tauri::command]
pub fn record_member_payment_with_discount(
    state: State<Mutex<AppState>>,
    input: RecordPaymentWithDiscountInput,
) -> Result<RecordPaymentResponse, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    let paid_at = chrono::Utc::now().to_rfc3339();

    let payment = db::chits::record_member_payment_with_discount(
        conn,
        input.chit_id,
        input.cycle_id,
        input.member_id,
        input.gross_amount,
        input.auction_discount,
        &input.payment_method,
        &paid_at,
    )
    .map_err(|e: AppError| e.to_string())?;

    let net_amount = input.gross_amount - input.auction_discount;

    Ok(RecordPaymentResponse {
        payment_id: payment.id,
        net_amount,
        receipt_generated: true,
        message: format!(
            "Payment recorded: Gross {}, Discount {}, Net {} added to SHG balance",
            input.gross_amount, input.auction_discount, net_amount
        ),
    })
}

#[derive(serde::Deserialize)]
pub struct ProcessWinnerPayoutInput {
    pub chit_id: i64,
    pub cycle_id: i64,
    pub winning_member_id: i64,
    pub winner_amount: f64,
    pub payment_method: String,
    pub note: String,
}

#[derive(serde::Serialize)]
pub struct WinnerPayoutResponse {
    pub voucher_generated: bool,
    pub bid_discount: f64,
    pub message: String,
}

#[tauri::command]
pub fn process_winner_payout(
    state: State<Mutex<AppState>>,
    input: ProcessWinnerPayoutInput,
) -> Result<WinnerPayoutResponse, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    let payout_date = chrono::Utc::now().to_rfc3339();

    // Get current cycle to calculate bid discount
    let cycle = db::chits::get_current_cycle(conn, input.chit_id)
        .map_err(|e: AppError| e.to_string())?
        .ok_or_else(|| "No active cycle found".to_string())?;

    let total_collection = cycle.payout_amount + cycle.bid_discount;
    let bid_discount = total_collection - input.winner_amount;

    db::chits::process_winner_payout(
        conn,
        input.chit_id,
        input.cycle_id,
        input.winning_member_id,
        input.winner_amount,
        &input.payment_method,
        &payout_date,
        &input.note,
    )
    .map_err(|e: AppError| e.to_string())?;

    Ok(WinnerPayoutResponse {
        voucher_generated: true,
        bid_discount,
        message: format!(
            "Winner payout processed: {} paid, Bid discount: {}",
            input.winner_amount, bid_discount
        ),
    })
}

/// Returns all chit groups a specific member belongs to.
#[tauri::command]
pub fn get_member_chit_groups(
    state: State<Mutex<AppState>>,
    member_id: i64,
) -> Result<Vec<serde_json::Value>, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT cg.id, cg.name, cg.total_amount, cg.months, cg.monthly_contribution,
                    cg.commission_percent, cg.start_date, cg.status,
                    cm.joined_at,
                    (SELECT MAX(cycle_no) FROM chit_cycles WHERE chit_id = cg.id) as current_cycle
             FROM chit_groups cg
             JOIN chit_members cm ON cg.id = cm.chit_id
             WHERE cm.member_id = ?1
             ORDER BY cg.start_date DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([member_id], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "name": row.get::<_, String>(1)?,
                "totalAmount": row.get::<_, f64>(2)?,
                "months": row.get::<_, i64>(3)?,
                "monthlyContribution": row.get::<_, f64>(4)?,
                "commissionPercent": row.get::<_, f64>(5)?,
                "startDate": row.get::<_, String>(6)?,
                "status": row.get::<_, String>(7)?,
                "joinedAt": row.get::<_, String>(8)?,
                "currentCycle": row.get::<_, Option<i64>>(9)?.unwrap_or(0),
            }))
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

// Chit Past Data Entry Commands

/// Record past chit cycle data for migration from books
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberPaymentInput {
    pub member_id: i64,
    pub amount: f64,
    pub payment_method: String,
}

#[derive(serde::Serialize)]
pub struct RecordPastCycleResponse {
    pub cycle_id: i64,
    pub total_collected: f64,
    pub bid_discount: f64,
    pub payout_amount: f64,
    pub net_to_shg: f64,
}

#[tauri::command]
pub fn record_past_chit_cycle(
    state: State<Mutex<AppState>>,
    chit_id: i64,
    cycle_no: i64,
    auction_date: String,
    winning_member_id: Option<i64>,
    bid_discount: f64,
    winner_payout: f64,
    member_payments: Vec<MemberPaymentInput>,
) -> Result<RecordPastCycleResponse, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    // Convert member payments to the format expected by db function
    let payments: Vec<(i64, f64, &str)> = member_payments
        .iter()
        .map(|p| (p.member_id, p.amount, p.payment_method.as_str()))
        .collect();

    db::chits_past_entry::record_past_chit_cycle(
        conn,
        chit_id,
        cycle_no,
        &auction_date,
        winning_member_id,
        bid_discount,
        winner_payout,
        &payments,
    )
    .map_err(|e: AppError| e.to_string())?;

    // Get the cycle details to return
    let cycle_id: i64 = conn.query_row(
        "SELECT id FROM chit_cycles WHERE chit_id = ?1 AND cycle_no = ?2",
        (chit_id, cycle_no),
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;

    let total_collected: f64 = payments.iter().map(|(_, amount, _)| amount).sum();
    let payout_amount = total_collected - bid_discount;
    let net_to_shg = total_collected - bid_discount - winner_payout;

    Ok(RecordPastCycleResponse {
        cycle_id,
        total_collected,
        bid_discount,
        payout_amount,
        net_to_shg,
    })
}

#[tauri::command]
pub fn get_member_payment_status(
    state: State<Mutex<AppState>>,
    chit_id: i64,
) -> Result<Vec<db::chits_past_entry::MemberPaymentStatus>, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    db::chits_past_entry::get_member_payment_status(conn, chit_id)
        .map_err(|e: AppError| e.to_string())
}

#[tauri::command]
pub fn get_chit_cycles_with_details(
    state: State<Mutex<AppState>>,
    chit_id: i64,
) -> Result<Vec<db::chits_past_entry::ChitCycleDetail>, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    db::chits_past_entry::get_chit_cycles_with_details(conn, chit_id)
        .map_err(|e: AppError| e.to_string())
}

#[tauri::command]
pub fn get_chit_migration_status(
    state: State<Mutex<AppState>>,
    chit_id: i64,
) -> Result<db::chits_past_entry::ChitMigrationStatus, String> {
    let mut guard = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let conn = guard
        .db
        .as_mut()
        .ok_or_else(|| "DB not unlocked".to_string())?;

    db::chits_past_entry::get_chit_migration_status(conn, chit_id)
        .map_err(|e: AppError| e.to_string())
}
