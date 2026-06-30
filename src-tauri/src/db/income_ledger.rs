//! Income ledgers — line-item lists of the SHG's three income streams for an
//! arbitrary date range:
//!   - Interest income  (interest portion of every loan payment)
//!   - Chit income      (CHIT_COMMISSION receipts)
//!   - Savings income   (member savings collected: WEEKLY_CONTRIBUTION /
//!                       MEMBER_CONTRIBUTION receipts)
//!
//! "Savings income" is the money members deposit into the group fund. It's a
//! liability the SHG owes back, not profit — but the client wants it tracked
//! alongside the earnings streams, so it's reported here as its own section.
//!
//! Each ledger is an ordered list of entries plus a total. Voided rows and
//! reversal rows are excluded so cancellations don't inflate the figures.

use rusqlite::Connection;
use serde::Serialize;
use crate::error::AppError;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerEntry {
    pub id: i64,
    pub date: String,
    pub member_name: Option<String>,
    pub amount: f64,
    pub note: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerSection {
    pub entries: Vec<LedgerEntry>,
    pub total: f64,
    pub count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomeLedger {
    pub from_date: String,
    pub to_date: String,
    pub interest: LedgerSection,
    pub principal: LedgerSection, // loan principal collected (return of capital, not profit)
    pub chit: LedgerSection,
    pub savings: LedgerSection,
    pub grand_total: f64,        // interest + chit (true income; principal & savings excluded)
}

fn section_from(entries: Vec<LedgerEntry>) -> LedgerSection {
    let total = (entries.iter().map(|e| e.amount).sum::<f64>() * 100.0).round() / 100.0;
    let count = entries.len() as i64;
    LedgerSection { entries, total, count }
}

/// Interest income: the interest portion of each loan payment in the period,
/// joined to the borrowing member's name. loan_payments has no void flag of
/// its own, but cancelled repayments are deleted from it, so it's already
/// the live set.
fn interest_entries(conn: &Connection, from: &str, to: &str) -> Result<Vec<LedgerEntry>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT lp.id, lp.created_at, m.name, lp.interest_amount, lp.note
         FROM loan_payments lp
         LEFT JOIN members m ON m.id = lp.member_id
         WHERE lp.interest_amount > 0.005
           AND COALESCE(lp.is_past_entry, 0) = 0
           AND lp.created_at >= ?1 AND lp.created_at <= ?2
         ORDER BY lp.created_at ASC, lp.id ASC",
    )?;
    let rows = stmt.query_map([from, to], |r| {
        Ok(LedgerEntry {
            id: r.get(0)?,
            date: r.get(1)?,
            member_name: r.get(2)?,
            amount: r.get(3)?,
            note: r.get::<_, Option<String>>(4)?.unwrap_or_default(),
        })
    })?;
    let mut out = Vec::new();
    for row in rows { out.push(row?); }
    Ok(out)
}

/// Loan principal collected: the principal portion of each loan payment in the
/// period — i.e. all loan money coming back in, separate from interest. Like the
/// interest list this reads loan_payments, which is already the live set
/// (cancelled repayments are deleted from it).
fn principal_entries(conn: &Connection, from: &str, to: &str) -> Result<Vec<LedgerEntry>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT lp.id, lp.created_at, m.name, lp.principal_amount, lp.note
         FROM loan_payments lp
         LEFT JOIN members m ON m.id = lp.member_id
         WHERE lp.principal_amount > 0.005
           AND lp.created_at >= ?1 AND lp.created_at <= ?2
         ORDER BY lp.created_at ASC, lp.id ASC",
    )?;
    let rows = stmt.query_map([from, to], |r| {
        Ok(LedgerEntry {
            id: r.get(0)?,
            date: r.get(1)?,
            member_name: r.get(2)?,
            amount: r.get(3)?,
            note: r.get::<_, Option<String>>(4)?.unwrap_or_default(),
        })
    })?;
    let mut out = Vec::new();
    for row in rows { out.push(row?); }
    Ok(out)
}

/// Generic helper for the two shg_transactions-backed sections.
fn receipt_entries(
    conn: &Connection,
    from: &str,
    to: &str,
    reference_types: &str,   // comma-separated quoted list, e.g. "'CHIT_COMMISSION'"
    chit_member: bool,       // resolve name via winning member of the chit cycle
) -> Result<Vec<LedgerEntry>, AppError> {
    // Name resolution differs: chit commission references a cycle id (look up
    // the winner), savings references a member id directly.
    let name_expr = if chit_member {
        "(SELECT m.name FROM members m
          JOIN chit_cycles cc ON cc.winning_member_id = m.id
          WHERE cc.id = t.reference_id)"
    } else {
        "(SELECT name FROM members WHERE id = t.reference_id)"
    };

    let sql = format!(
        "SELECT t.id, t.created_at, {name_expr} AS member_name, t.amount, t.reason
         FROM shg_transactions t
         WHERE t.txn_type = 'RECEIPT'
           AND t.reference_type IN ({reference_types})
           AND t.voided_at IS NULL AND t.reversal_of_id IS NULL
           AND t.created_at >= ?1 AND t.created_at <= ?2
         ORDER BY t.created_at ASC, t.id ASC",
    );

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([from, to], |r| {
        Ok(LedgerEntry {
            id: r.get(0)?,
            date: r.get(1)?,
            member_name: r.get(2)?,
            amount: r.get(3)?,
            note: r.get::<_, Option<String>>(4)?.unwrap_or_default(),
        })
    })?;
    let mut out = Vec::new();
    for row in rows { out.push(row?); }
    Ok(out)
}

/// Build all three income ledgers for the inclusive date range. `from` and
/// `to` are full timestamp bounds (caller appends T23:59:59 to the upper).
pub fn get_income_ledger(
    conn: &Connection,
    from: &str,
    to: &str,
) -> Result<IncomeLedger, AppError> {
    let interest = section_from(interest_entries(conn, from, to)?);
    let principal = section_from(principal_entries(conn, from, to)?);
    let chit = section_from(receipt_entries(conn, from, to, "'CHIT_COMMISSION'", true)?);
    let savings = section_from(receipt_entries(
        conn, from, to,
        "'WEEKLY_CONTRIBUTION','MEMBER_CONTRIBUTION'",
        false,
    )?);

    let grand_total = (((interest.total + chit.total) * 100.0).round()) / 100.0;

    Ok(IncomeLedger {
        from_date: from.to_string(),
        to_date: to.to_string(),
        interest,
        principal,
        chit,
        savings,
        grand_total,
    })
}
