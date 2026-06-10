//! Member management and member balance tracking.
//!
//! Financial invariant:
//! - `member_balances.balance` must always equal the sum of all
//!   `member_transactions.amount` for that member.

use rusqlite::Connection;
use serde::Serialize;

use crate::error::AppError;
use crate::db::validation;

/// Member type - determines what a member can participate in
/// SHG members can participate in savings
/// CHIT members can participate in chit funds
/// LOAN members can participate in loans
#[derive(Debug, Clone, PartialEq, Serialize)]
pub enum MemberType {
    #[serde(rename = "SHG")]
    SHG,
    #[serde(rename = "CHIT")]
    CHIT,
    #[serde(rename = "LOAN")]
    LOAN,
}

impl std::str::FromStr for MemberType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "SHG" => Ok(MemberType::SHG),
            "CHIT" => Ok(MemberType::CHIT),
            "LOAN" => Ok(MemberType::LOAN),
            _ => Err(format!("Invalid member type: {}", s)),
        }
    }
}

impl std::fmt::Display for MemberType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MemberType::SHG => write!(f, "SHG"),
            MemberType::CHIT => write!(f, "CHIT"),
            MemberType::LOAN => write!(f, "LOAN"),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub id: i64,
    pub member_code: String,
    pub name: String,
    pub phone: Option<String>,
    pub address: Option<String>,
    pub joined_at: String,
    pub is_active: bool,
    pub opening_balance: f64,
    pub opening_balance_method: Option<String>,
    pub opening_balance_set_at: Option<String>,
    pub past_installments: i64,
    pub current_installments: i64,
    pub member_type: MemberType,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberTxn {
    pub id: i64,
    pub member_id: i64,
    pub amount: f64,
    pub txn_type: String,
    pub reason: String,
    pub created_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberProfile {
    pub member: Member,
    pub current_balance: f64,
    pub opening_balance: f64,
    /// Savings accrued through the app (contributions), net of withdrawals,
    /// with payouts drawn from the opening pool first so this never goes
    /// negative just because opening-balance money was paid out.
    pub regular_balance: f64,
    pub opening_balance_method: Option<String>,
    pub opening_balance_set_at: Option<String>,
    pub initial_installments: u32,      // Seeded from past data (locked)
    pub current_installments: u32,         // Ongoing contributions
    pub total_installments: u32,           // Total = initial + current
    pub opening_data_locked: bool,
    pub recent_transactions: Vec<MemberTxn>,
}

/// Reject a new/edited member that collides with an existing **active** member
/// by name or phone. Names are matched case-insensitively and trimmed; phones
/// are matched trimmed (and only when non-empty, since many members have none).
///
/// This enforces "one person, one entry" across **all** member types — a person
/// already on the SHG list cannot be re-added as a Loan or Chit member, etc.
/// Deactivated members are ignored so a name freed by deactivation can be reused
/// (re-add the same person via Reactivate instead).
///
/// `exclude_code` skips a member by code so editing a member doesn't clash with
/// itself.
pub fn ensure_no_duplicate_member(
    conn: &Connection,
    name: &str,
    phone: Option<&str>,
    exclude_code: Option<&str>,
) -> Result<(), AppError> {
    use rusqlite::OptionalExtension;

    let trimmed_name = name.trim();
    let exclude = exclude_code.unwrap_or("");

    // Name collision (case-insensitive).
    let name_match: Option<(String, String)> = conn
        .query_row(
            "SELECT member_code, member_type FROM members
             WHERE is_active = 1
               AND LOWER(TRIM(name)) = LOWER(TRIM(?1))
               AND member_code <> ?2
             LIMIT 1",
            (trimmed_name, exclude),
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    if let Some((code, mtype)) = name_match {
        return Err(AppError::business(format!(
            "A member named \"{trimmed_name}\" already exists ({mtype} member #{code}). Each person can only be added once across SHG, Loan, and Chit."
        )));
    }

    // Phone collision (only when a phone was given).
    if let Some(p) = phone {
        let p = p.trim();
        if !p.is_empty() {
            let phone_match: Option<(String, String, String)> = conn
                .query_row(
                    "SELECT member_code, member_type, name FROM members
                     WHERE is_active = 1
                       AND phone IS NOT NULL
                       AND TRIM(phone) = TRIM(?1)
                       AND member_code <> ?2
                     LIMIT 1",
                    (p, exclude),
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .optional()?;
            if let Some((code, mtype, ename)) = phone_match {
                return Err(AppError::business(format!(
                    "Phone number {p} is already registered to {ename} ({mtype} member #{code}). Each person can only be added once across SHG, Loan, and Chit."
                )));
            }
        }
    }

    Ok(())
}

/// Create a new member and initialize their balance to zero.
/// Add a member with an auto-assigned serial number (1, 2, 3 …). Picks the
/// next integer above the highest existing numeric member_code, so legacy
/// alphanumeric codes (`SHG1700000000000`) are ignored when deciding the next
/// serial. Returns (member_id, generated_code).
pub fn add_member_auto_code(
    conn: &mut Connection,
    name: &str,
    phone: Option<&str>,
    address: Option<&str>,
    joined_at: &str,
    member_type: &str,
) -> Result<(i64, String), AppError> {
    let _mt = member_type.parse::<MemberType>()
        .map_err(|e| AppError::validation(&e))?;

    let tx = conn.transaction()?;

    ensure_no_duplicate_member(&tx, name, phone, None)?;

    // Highest existing pure-numeric code, NULL → 0. Retry the insert on the
    // unique-constraint race (extremely unlikely in a single-user desktop, but
    // cheap to defend against).
    let next: i64 = tx.query_row(
        "SELECT COALESCE(MAX(CAST(member_code AS INTEGER)), 0)
         FROM members
         WHERE member_code GLOB '[0-9]*' AND CAST(member_code AS INTEGER) > 0",
        [],
        |r| r.get(0),
    ).unwrap_or(0);

    let code = (next + 1).to_string();

    tx.execute(
        "INSERT INTO members (member_code, name, phone, address, joined_at, member_type)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        (&code, name, phone, address, joined_at, member_type),
    )?;

    let member_id: i64 = tx.query_row(
        "SELECT id FROM members WHERE member_code = ?1",
        [&code],
        |r| r.get(0),
    )?;

    tx.execute(
        "INSERT INTO member_balances (member_id, balance) VALUES (?1, 0)",
        [member_id],
    )?;

    tx.commit()?;
    Ok((member_id, code))
}

/// Returns the new member's id.
pub fn add_member(
    conn: &mut Connection,
    code: &str,
    name: &str,
    phone: Option<&str>,
    address: Option<&str>,
    joined_at: &str,
    member_type: &str,
) -> Result<i64, AppError> {
    validation::validate_member_code(code)?;

    // Validate member_type
    let _mt = member_type.parse::<MemberType>()
        .map_err(|e| AppError::validation(&e))?;

    let tx = conn.transaction()?;

    ensure_no_duplicate_member(&tx, name, phone, None)?;

    tx.execute(
        "INSERT INTO members (member_code, name, phone, address, joined_at, member_type)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        (code, name, phone, address, joined_at, member_type),
    )?;

    let member_id: i64 = tx.query_row(
        "SELECT id FROM members WHERE member_code = ?1",
        [code],
        |r| r.get(0),
    )?;

    tx.execute(
        "INSERT INTO member_balances (member_id, balance) VALUES (?1, 0)",
        [member_id],
    )?;

    tx.commit()?;
    Ok(member_id)
}

/// Fetch a member by their unique member code.
pub fn get_member_by_code(conn: &Connection, code: &str) -> Result<Member, AppError> {
    validation::validate_member_code(code)?;

    let member = conn.query_row(
        "SELECT id, member_code, name, phone, address, joined_at, is_active,
                opening_balance, opening_balance_method, opening_balance_set_at, past_installments, current_installments, member_type
         FROM members
         WHERE member_code = ?1",
        [code],
        |row| {
            let mt: String = row.get(12)?;
            Ok(Member {
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
                member_type: mt.parse::<MemberType>().unwrap_or(MemberType::SHG),
            })
        },
    )?;

    Ok(member)
}

/// List all members, ordered by name.
pub fn list_members(conn: &Connection) -> Result<Vec<Member>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, member_code, name, phone, address, joined_at, is_active,
                opening_balance, opening_balance_method, opening_balance_set_at, past_installments, current_installments, member_type
         FROM members
         ORDER BY name",
    )?;

    let rows = stmt.query_map([], |row| {
        let mt: String = row.get(12)?;
        Ok(Member {
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
            member_type: mt.parse::<MemberType>().unwrap_or(MemberType::SHG),
        })
    })?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Get the cached outstanding balance for a member.
pub fn get_member_balance(conn: &Connection, member_id: i64) -> Result<f64, AppError> {
    match conn.query_row(
        "SELECT balance FROM member_balances WHERE member_id = ?1",
        [member_id],
        |row| row.get::<_, f64>(0),
    ) {
        Ok(v) => Ok(v),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(0.0),
        Err(e) => Err(AppError::from(e)),
    }
}

/// Compute the outstanding balance for a member from the ledger of
/// `member_transactions` and compare it to the cached balance.
///
/// This function is used to enforce business rules such as preventing
/// over-payments (double spending) and to assert the invariant:
/// `member_balances.balance == SUM(member_transactions.amount)`.
#[allow(dead_code)]
pub fn get_member_outstanding(conn: &Connection, member_id: i64) -> Result<f64, AppError> {
    let computed: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0.0) FROM member_transactions WHERE member_id = ?1",
        [member_id],
        |row| row.get(0),
    )?;

    let cached = get_member_balance(conn, member_id)?;

    // Small tolerance for floating point noise.
    if (computed - cached).abs() > 0.01 {
        return Err(AppError::business(format!(
            "member balance cache mismatch (computed={computed}, cached={cached})"
        )));
    }

    Ok(computed)
}

/// Update an existing member's details.
pub fn update_member(
    conn: &mut Connection,
    code: &str,
    name: &str,
    phone: Option<&str>,
    address: Option<&str>,
) -> Result<(), AppError> {
    validation::validate_member_code(code)?;
    validation::validate_member_name(name)?;

    // Don't let an edit rename/re-number a member onto another member's
    // identity. Exclude self so saving unchanged details is always allowed.
    ensure_no_duplicate_member(conn, name, phone, Some(code))?;

    conn.execute(
        "UPDATE members SET name = ?1, phone = ?2, address = ?3 WHERE member_code = ?4",
        (name, phone, address, code),
    )?;

    Ok(())
}

/// Activate or deactivate a member.
///
/// Deactivation is a soft state — the member and their full history are kept, but
/// they are hidden from the active-member lists and blocked from new loans/chits.
/// We refuse to deactivate a member who still has financial obligations (an active
/// loan with a balance, or membership in a running chit group) so their books can
/// never be left dangling. Reactivation has no such guards.
pub fn set_member_active(
    conn: &mut Connection,
    member_id: i64,
    active: bool,
) -> Result<(), AppError> {
    let (name, is_active): (String, i64) = conn
        .query_row(
            "SELECT name, is_active FROM members WHERE id = ?1",
            [member_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| AppError::business("Member not found"))?;

    // No-op if already in the requested state.
    if (is_active == 1) == active {
        return Ok(());
    }

    if !active {
        // Guard: outstanding active loan balance.
        let loan_outstanding: f64 = conn.query_row(
            "SELECT COALESCE(SUM(outstanding_amount), 0.0)
             FROM loans
             WHERE member_id = ?1 AND status = 'active'",
            [member_id],
            |row| row.get(0),
        )?;
        if loan_outstanding > 0.01 {
            return Err(AppError::business(format!(
                "Cannot deactivate {name}: they still have an active loan with ₹{loan_outstanding:.2} outstanding. Settle or close the loan first."
            )));
        }

        // Guard: membership in a running (ACTIVE) chit group.
        let active_chits: i64 = conn.query_row(
            "SELECT COUNT(*)
             FROM chit_members cm
             JOIN chit_groups cg ON cg.id = cm.chit_id
             WHERE cm.member_id = ?1 AND cg.status = 'ACTIVE'",
            [member_id],
            |row| row.get(0),
        )?;
        if active_chits > 0 {
            return Err(AppError::business(format!(
                "Cannot deactivate {name}: they are part of {active_chits} active chit group(s). Remove them from the chit(s) or wait until it closes first."
            )));
        }
    }

    conn.execute(
        "UPDATE members SET is_active = ?1 WHERE id = ?2",
        (if active { 1 } else { 0 }, member_id),
    )?;

    Ok(())
}

/// One-time migration entry to seed a member's opening balance and past installments.
///
/// This operation is strictly atomic: either all related ledger + balance rows are updated,
/// or nothing is written.
pub fn set_member_opening_data(
    conn: &mut Connection,
    member_id: i64,
    opening_balance: f64,
    payment_method: Option<&str>,
    past_installments: u32,
) -> Result<(), AppError> {
    if !opening_balance.is_finite() || opening_balance < 0.0 {
        return Err(AppError::validation("opening_balance must be >= 0.0"));
    }

    // payment_method stored for reference but no longer required (opening balance
    // is a member-profile-only record and does not affect SHG cash/bank balances).

    let now = chrono::Utc::now().to_rfc3339();

    // Load and validate the member state outside the write transaction.
    let (member_code, name, is_active): (String, String, i64) = conn.query_row(
        "SELECT member_code, name, is_active
         FROM members
         WHERE id = ?1",
        [member_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;

    if is_active != 1 {
        return Err(AppError::business("Member is not active"));
    }

    let tx = conn.transaction()?;

    // CRITICAL: Guard check must be INSIDE the transaction to prevent race conditions
    let locked_at: Option<String> = tx.query_row(
        "SELECT opening_balance_set_at FROM members WHERE id = ?1",
        [member_id],
        |row| row.get(0),
    )?;

    if locked_at.is_some() {
        return Err(AppError::business(
            "Opening data has already been set for this member and cannot be changed.",
        ));
    }

    if opening_balance > 0.0 {
        // Member savings reference only — does NOT touch SHG cash/bank balances.
        // SHG opening funds are set separately via Settings → SHG Opening Balance.

        // 1) Member opening transaction (reference in member profile)
        tx.execute(
            "INSERT INTO member_transactions (member_id, amount, txn_type, reason, created_at)
             VALUES (?1, ?2, 'OPENING', ?3, ?4)",
            (
                member_id,
                opening_balance,
                "Opening balance (pre-migration savings)",
                &now,
            ),
        )?;

        // 2) Update member balance cache
        tx.execute(
            "INSERT INTO member_balances (member_id, balance) VALUES (?1, ?2)
             ON CONFLICT(member_id) DO UPDATE SET balance = member_balances.balance + excluded.balance",
            (member_id, opening_balance),
        )?;
    }

    // 5) Lock and persist the migration fields on members
    tx.execute(
        "UPDATE members
         SET opening_balance = ?1,
             opening_balance_method = ?2,
             opening_balance_set_at = ?3,
             past_installments = ?4
         WHERE id = ?5",
        (
            opening_balance,
            payment_method,
            &now,
            past_installments as i64,
            member_id,
        ),
    )?;

    // 6) No role assignment needed - member_type is set at creation

    tx.commit()?;
    Ok(())
}

/// Fetch a composite profile for a member including opening-data migration info.
pub fn get_member_profile(conn: &Connection, member_id: i64) -> Result<MemberProfile, AppError> {
    let member: Member = conn.query_row(
        "SELECT id, member_code, name, phone, address, joined_at, is_active,
                opening_balance, opening_balance_method, opening_balance_set_at, past_installments, current_installments, member_type
         FROM members
         WHERE id = ?1",
        [member_id],
        |row| {
            let mt: String = row.get(12)?;
            Ok(Member {
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
                member_type: mt.parse::<MemberType>().unwrap_or(MemberType::SHG),
            })
        },
    )?;

    let current_balance = get_member_balance(conn, member_id)?;

    // "Regular balance" = savings beyond the pre-app opening. Savings payouts are
    // stored as negative CONTRIBUTION rows; we treat a withdrawal as coming out
    // of the opening pool first, so paying out opening-balance money leaves the
    // contributions figure untouched (instead of driving it negative). The
    // displayed opening_balance itself stays immutable.
    let withdrawals: f64 = conn.query_row(
        "SELECT COALESCE(-SUM(amount), 0) FROM member_transactions
         WHERE member_id = ?1 AND txn_type = 'CONTRIBUTION' AND amount < 0",
        [member_id],
        |r| r.get(0),
    ).unwrap_or(0.0);
    let remaining_opening = (member.opening_balance - withdrawals).max(0.0);
    let regular_balance = current_balance - remaining_opening;

    // Recent transactions (includes OPENING/LOAN/PAYMENT).
    let mut stmt = conn.prepare(
        "SELECT id, member_id, amount, txn_type, reason, created_at
         FROM member_transactions
         WHERE member_id = ?1
         ORDER BY created_at DESC
         LIMIT 20",
    )?;

    let rows = stmt.query_map([member_id], |row| {
        Ok(MemberTxn {
            id: row.get(0)?,
            member_id: row.get(1)?,
            amount: row.get(2)?,
            txn_type: row.get(3)?,
            reason: row.get(4)?,
            created_at: row.get(5)?,
        })
    })?;

    let mut recent_transactions = Vec::new();
    for r in rows {
        recent_transactions.push(r?);
    }

    let opening_data_locked = member.opening_balance_set_at.is_some();
    let initial_installments = member.past_installments.max(0) as u32;
    let current_installments = member.current_installments.max(0) as u32;
    let total_installments = initial_installments + current_installments;

    Ok(MemberProfile {
        opening_balance: member.opening_balance,
        regular_balance,
        opening_balance_method: member.opening_balance_method.clone(),
        opening_balance_set_at: member.opening_balance_set_at.clone(),
        initial_installments,
        current_installments,
        total_installments,
        opening_data_locked,
        current_balance,
        member,
        recent_transactions,
    })
}

/// List all members of a specific type
pub fn list_members_by_type(
    conn: &Connection,
    member_type: MemberType,
) -> Result<Vec<Member>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, member_code, name, phone, address, joined_at, is_active,
                opening_balance, opening_balance_method, opening_balance_set_at,
                past_installments, current_installments, member_type
         FROM members
         WHERE member_type = ?1 AND is_active = 1
         ORDER BY name",
    )?;

    let rows = stmt.query_map([member_type.to_string()], |row| {
        let mt: String = row.get(12)?;
        Ok(Member {
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
            member_type: mt.parse::<MemberType>().unwrap_or(MemberType::SHG),
        })
    })?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

// ─── Passbook ──────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PassbookEntry {
    pub id: i64,
    pub date: String,
    pub particulars: String,
    pub txn_type: String,
    pub credit: f64,
    pub running_balance: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberPassbook {
    pub member_id: i64,
    pub member_name: String,
    pub member_code: String,
    pub member_type: String,
    pub join_date: String,
    pub from_date: String,
    pub to_date: String,
    pub migration_opening: f64,   // from members.opening_balance — pre-app savings
    pub opening_balance: f64,     // migration_opening + contributions before period
    pub entries: Vec<PassbookEntry>,
    pub total_credits: f64,
    pub closing_balance: f64,
    pub total_installments: i64,
}

/// Fetch the savings passbook for a member for a given date range.
/// Pass empty strings for `from_date` / `to_date` to get all-time data.
///
/// # Opening balance strategy
/// The OPENING transaction in `member_transactions` is stamped with the date the
/// past data was *entered* (today), not the member's actual historical join date.
/// Relying on its `created_at` makes it invisible for any date range that predates
/// when the migration was run.  Instead we read `members.opening_balance` directly —
/// it represents savings accumulated before the app was adopted and always forms the
/// base of the passbook, regardless of the date range selected.
pub fn get_member_passbook(
    conn: &Connection,
    member_id: i64,
    from_date: &str,
    to_date: &str,
) -> Result<MemberPassbook, AppError> {
    // ── Member details ────────────────────────────────────────────────────
    let (member_name, member_code, member_type, join_date, migration_opening): (String, String, String, String, f64) =
        conn.query_row(
            "SELECT name, member_code, member_type, joined_at,
                    COALESCE(opening_balance, 0.0)
             FROM members WHERE id = ?1",
            [member_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )?;

    let to_dt = if to_date.is_empty() {
        chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S").to_string()
    } else {
        format!("{}T23:59:59", to_date)
    };

    // ── Opening balance for this period ───────────────────────────────────
    // = migration opening balance (always)
    // + weekly CONTRIBUTION entries recorded before `from_date`
    // (OPENING entries in member_transactions are excluded — handled via members.opening_balance)
    let contributions_before: f64 = if from_date.is_empty() {
        0.0
    } else {
        conn.query_row(
            "SELECT COALESCE(SUM(amount), 0) FROM member_transactions
             WHERE member_id = ?1 AND txn_type = 'CONTRIBUTION'
             AND created_at < ?2",
            (member_id, from_date),
            |r| r.get(0),
        ).unwrap_or(0.0)
    };

    let opening_balance = migration_opening + contributions_before;

    // ── Entries within the period (CONTRIBUTION only) ─────────────────────
    // We exclude OPENING entries from the timeline because the migration opening
    // balance is already baked into `opening_balance` above.
    let mut stmt = conn.prepare(
        "SELECT id, created_at, txn_type, reason, amount
         FROM member_transactions
         WHERE member_id = ?1
           AND txn_type = 'CONTRIBUTION'
           AND (?2 = '' OR created_at >= ?2)
           AND created_at <= ?3
         ORDER BY created_at ASC, id ASC",
    )?;

    let rows = stmt.query_map((member_id, from_date, &to_dt), |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, f64>(4)?,
        ))
    })?;

    let mut entries: Vec<PassbookEntry> = Vec::new();
    let mut running = opening_balance;
    for row in rows {
        let (id, date, txn_type, reason, amount) = row?;
        running += amount;
        let particulars = if !reason.is_empty() {
            reason
        } else {
            "Savings Contribution".to_string()
        };
        entries.push(PassbookEntry {
            id,
            date,
            particulars,
            txn_type,
            credit: amount,
            running_balance: running,
        });
    }

    let total_credits: f64 = entries.iter().map(|e| e.credit).sum();
    let closing_balance = opening_balance + total_credits;
    let total_installments = entries.len() as i64;

    Ok(MemberPassbook {
        member_id,
        member_name,
        member_code,
        member_type,
        join_date,
        from_date: from_date.to_string(),
        to_date: to_date.to_string(),
        migration_opening,
        opening_balance,
        entries,
        total_credits,
        closing_balance,
        total_installments,
    })
}

// ─── Loan passbook ───────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoanLedgerEntry {
    pub id: i64,
    pub date: String,
    pub particulars: String,
    pub debit: f64,                // amount lent out (disbursement)
    pub credit: f64,              // amount repaid
    pub principal: f64,
    pub interest: f64,
    pub running_outstanding: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoanPassbookLoan {
    pub loan_id: i64,
    pub amount: f64,
    pub issued_at: String,
    pub status: String,
    pub loan_type: String,
    pub daily_interest_rate: f64,
    pub outstanding: f64,
    pub total_principal_paid: f64,
    pub total_interest_paid: f64,
    pub guarantors: Vec<crate::db::guarantors::Guarantor>,
    pub entries: Vec<LoanLedgerEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberLoanPassbook {
    pub member_id: i64,
    pub member_name: String,
    pub member_code: String,
    pub member_type: String,
    pub join_date: String,
    pub loans: Vec<LoanPassbookLoan>,
    pub total_disbursed: f64,
    pub total_principal_paid: f64,
    pub total_interest_paid: f64,
    pub total_outstanding: f64,
}

/// Fetch a member's full loan history, grouped per loan, each with a running
/// outstanding balance (disbursement raises it, principal repayments lower it).
pub fn get_member_loan_passbook(
    conn: &Connection,
    member_id: i64,
) -> Result<MemberLoanPassbook, AppError> {
    let (member_name, member_code, member_type, join_date): (String, String, String, String) =
        conn.query_row(
            "SELECT name, member_code, member_type, joined_at FROM members WHERE id = ?1",
            [member_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )?;

    // Loan headers first (drop the statement before per-loan payment queries).
    let loan_headers: Vec<(i64, f64, f64, String, String, f64, String)> = {
        let mut stmt = conn.prepare(
            "SELECT id, amount, outstanding_amount, status, loan_type,
                    COALESCE(daily_interest_rate, 0), issued_at
             FROM loans
             WHERE member_id = ?1
             ORDER BY issued_at ASC, id ASC",
        )?;
        let rows = stmt.query_map([member_id], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, f64>(1)?,
                r.get::<_, f64>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, f64>(5)?,
                r.get::<_, String>(6)?,
            ))
        })?;
        let mut v = Vec::new();
        for r in rows { v.push(r?); }
        v
    };

    let mut loans: Vec<LoanPassbookLoan> = Vec::new();
    let mut total_disbursed = 0.0;
    let mut total_principal_paid = 0.0;
    let mut total_interest_paid = 0.0;
    let mut total_outstanding = 0.0;

    for (loan_id, amount, outstanding, status, loan_type, daily_rate, issued_at) in loan_headers {
        total_disbursed += amount;
        total_outstanding += outstanding;

        let mut entries: Vec<LoanLedgerEntry> = Vec::new();
        let mut running = amount; // outstanding right after disbursement

        entries.push(LoanLedgerEntry {
            id: -loan_id, // synthetic id for the disbursement row (won't clash with payment ids)
            date: issued_at.clone(),
            particulars: "Loan disbursed".to_string(),
            debit: amount,
            credit: 0.0,
            principal: 0.0,
            interest: 0.0,
            running_outstanding: running,
        });

        let mut loan_principal_paid = 0.0;
        let mut loan_interest_paid = 0.0;

        let mut pstmt = conn.prepare(
            "SELECT id, created_at, COALESCE(principal_amount, 0), COALESCE(interest_amount, 0),
                    amount, note
             FROM loan_payments
             WHERE loan_id = ?1
             ORDER BY created_at ASC, id ASC",
        )?;
        let prows = pstmt.query_map([loan_id], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, f64>(2)?,
                r.get::<_, f64>(3)?,
                r.get::<_, f64>(4)?,
                r.get::<_, String>(5)?,
            ))
        })?;
        for pr in prows {
            let (id, date, principal, interest, amt, note) = pr?;
            running -= principal;
            loan_principal_paid += principal;
            loan_interest_paid += interest;
            let particulars = if !note.trim().is_empty() {
                note
            } else if principal <= 0.005 {
                "Interest payment".to_string()
            } else {
                "Loan repayment".to_string()
            };
            entries.push(LoanLedgerEntry {
                id,
                date,
                particulars,
                debit: 0.0,
                credit: amt,
                principal,
                interest,
                running_outstanding: running,
            });
        }

        total_principal_paid += loan_principal_paid;
        total_interest_paid += loan_interest_paid;

        let loan_guarantors = crate::db::guarantors::get_guarantors(conn, "LOAN", loan_id)
            .unwrap_or_default();

        loans.push(LoanPassbookLoan {
            loan_id,
            amount,
            issued_at,
            status,
            loan_type,
            daily_interest_rate: daily_rate,
            outstanding,
            total_principal_paid: loan_principal_paid,
            total_interest_paid: loan_interest_paid,
            guarantors: loan_guarantors,
            entries,
        });
    }

    Ok(MemberLoanPassbook {
        member_id,
        member_name,
        member_code,
        member_type,
        join_date,
        loans,
        total_disbursed,
        total_principal_paid,
        total_interest_paid,
        total_outstanding,
    })
}

// ─── Chit passbook ───────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChitLedgerEntry {
    pub id: i64,
    pub date: String,
    pub particulars: String,
    pub paid: f64,        // installment the member paid in
    pub won: f64,         // payout the member received
    pub running_paid: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChitPassbookGroup {
    pub chit_id: i64,
    pub chit_name: String,
    pub passbook_number: Option<String>,
    pub total_amount: f64,
    pub monthly_contribution: f64,
    pub status: String,
    pub entries: Vec<ChitLedgerEntry>,
    pub total_paid: f64,
    pub total_won: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberChitPassbook {
    pub member_id: i64,
    pub member_name: String,
    pub member_code: String,
    pub member_type: String,
    pub join_date: String,
    pub groups: Vec<ChitPassbookGroup>,
    pub total_paid: f64,
    pub total_won: f64,
}

/// Fetch a member's chit history across every chit group they belong to, listing
/// installments paid in and any payouts won, per group, with a running total of
/// what they've contributed.
pub fn get_member_chit_passbook(
    conn: &Connection,
    member_id: i64,
) -> Result<MemberChitPassbook, AppError> {
    let (member_name, member_code, member_type, join_date): (String, String, String, String) =
        conn.query_row(
            "SELECT name, member_code, member_type, joined_at FROM members WHERE id = ?1",
            [member_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )?;

    // Groups the member belongs to (drop statement before per-group queries).
    let group_headers: Vec<(i64, String, Option<String>, f64, f64, String)> = {
        let mut stmt = conn.prepare(
            "SELECT cg.id, cg.name, cm.passbook_number, cg.total_amount,
                    cg.monthly_contribution, cg.status
             FROM chit_members cm
             JOIN chit_groups cg ON cg.id = cm.chit_id
             WHERE cm.member_id = ?1
             ORDER BY cg.start_date ASC, cg.id ASC",
        )?;
        let rows = stmt.query_map([member_id], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, f64>(3)?,
                r.get::<_, f64>(4)?,
                r.get::<_, String>(5)?,
            ))
        })?;
        let mut v = Vec::new();
        for r in rows { v.push(r?); }
        v
    };

    let mut groups: Vec<ChitPassbookGroup> = Vec::new();
    let mut grand_paid = 0.0;
    let mut grand_won = 0.0;

    for (chit_id, chit_name, passbook_number, total_amount, monthly_contribution, status) in group_headers {
        // Collect installments + payouts as a single dated timeline.
        // (date, particulars, paid, won, sort_id)
        let mut raw: Vec<(String, String, f64, f64, i64)> = Vec::new();

        // Installments paid in this chit.
        {
            let mut stmt = conn.prepare(
                "SELECT cp.id, cp.amount, cp.paid_at, cc.cycle_no
                 FROM chit_payments cp
                 JOIN chit_cycles cc ON cc.id = cp.cycle_id
                 WHERE cp.chit_id = ?1 AND cp.member_id = ?2",
            )?;
            let rows = stmt.query_map((chit_id, member_id), |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, f64>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })?;
            for row in rows {
                let (id, amount, paid_at, cycle_no) = row?;
                raw.push((paid_at, format!("Cycle {cycle_no} installment"), amount, 0.0, id));
            }
        }

        // Payouts won — modern multi-winner flow.
        {
            let mut stmt = conn.prepare(
                "SELECT w.id, w.payout_amount, w.paid_at, cc.cycle_no
                 FROM chit_cycle_winners w
                 JOIN chit_cycles cc ON cc.id = w.cycle_id
                 WHERE w.chit_id = ?1 AND w.member_id = ?2",
            )?;
            let rows = stmt.query_map((chit_id, member_id), |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, f64>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })?;
            for row in rows {
                let (id, payout, paid_at, cycle_no) = row?;
                raw.push((paid_at, format!("Cycle {cycle_no} payout (won)"), 0.0, payout, 1_000_000 + id));
            }
        }

        // Payouts won — legacy single-winner flow (cycles whose winner is this
        // member but that have no row in chit_cycle_winners).
        {
            let mut stmt = conn.prepare(
                "SELECT cc.id, cc.payout_amount, cc.auction_date, cc.cycle_no
                 FROM chit_cycles cc
                 WHERE cc.chit_id = ?1 AND cc.winning_member_id = ?2
                   AND NOT EXISTS (
                       SELECT 1 FROM chit_cycle_winners w
                       WHERE w.cycle_id = cc.id AND w.member_id = ?2
                   )",
            )?;
            let rows = stmt.query_map((chit_id, member_id), |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, f64>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })?;
            for row in rows {
                let (id, payout, date, cycle_no) = row?;
                raw.push((date, format!("Cycle {cycle_no} payout (won)"), 0.0, payout, 2_000_000 + id));
            }
        }

        // Order the timeline by date, then by the synthetic sort id.
        raw.sort_by(|a, b| a.0.cmp(&b.0).then(a.4.cmp(&b.4)));

        let mut entries: Vec<ChitLedgerEntry> = Vec::new();
        let mut running_paid = 0.0;
        let mut total_paid = 0.0;
        let mut total_won = 0.0;
        for (date, particulars, paid, won, sort_id) in raw {
            running_paid += paid;
            total_paid += paid;
            total_won += won;
            entries.push(ChitLedgerEntry {
                id: sort_id,
                date,
                particulars,
                paid,
                won,
                running_paid,
            });
        }

        grand_paid += total_paid;
        grand_won += total_won;

        groups.push(ChitPassbookGroup {
            chit_id,
            chit_name,
            passbook_number,
            total_amount,
            monthly_contribution,
            status,
            entries,
            total_paid,
            total_won,
        });
    }

    Ok(MemberChitPassbook {
        member_id,
        member_name,
        member_code,
        member_type,
        join_date,
        groups,
        total_paid: grand_paid,
        total_won: grand_won,
    })
}

/// Check if a member is of a specific type
pub fn is_member_type(conn: &Connection, member_id: i64, member_type: MemberType) -> Result<bool, AppError> {
    let mt: String = conn.query_row(
        "SELECT member_type FROM members WHERE id = ?1",
        [member_id],
        |row| row.get(0),
    )?;
    Ok(mt == member_type.to_string())
}
