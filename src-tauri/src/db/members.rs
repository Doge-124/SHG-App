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
    pub opening_balance_method: Option<String>,
    pub opening_balance_set_at: Option<String>,
    pub initial_installments: u32,      // Seeded from past data (locked)
    pub current_installments: u32,         // Ongoing contributions
    pub total_installments: u32,           // Total = initial + current
    pub opening_data_locked: bool,
    pub recent_transactions: Vec<MemberTxn>,
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

    conn.execute(
        "UPDATE members SET name = ?1, phone = ?2, address = ?3 WHERE member_code = ?4",
        (name, phone, address, code),
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

/// Check if a member is of a specific type
pub fn is_member_type(conn: &Connection, member_id: i64, member_type: MemberType) -> Result<bool, AppError> {
    let mt: String = conn.query_row(
        "SELECT member_type FROM members WHERE id = ?1",
        [member_id],
        |row| row.get(0),
    )?;
    Ok(mt == member_type.to_string())
}
