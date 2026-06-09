//! Guarantors for loans and chit memberships.
//!
//! Optional, up to two per loan (scope = "LOAN", ref_id = loans.id) and per chit
//! membership (scope = "CHIT_MEMBER", ref_id = chit_members.id). A guarantor can
//! be the borrower/member themselves (SELF), another SHG member (MEMBER), or an
//! external party captured as free text (OTHER).

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::error::AppError;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuarantorInput {
    pub guarantor_type: String,        // self | member | other (any case)
    #[serde(default)]
    pub member_id: Option<i64>,        // when type = member
    #[serde(default)]
    pub name: Option<String>,          // when type = other
    #[serde(default)]
    pub details: Option<String>,       // when type = other (phone/address/etc)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Guarantor {
    pub slot: i64,
    pub guarantor_type: String,        // SELF | MEMBER | OTHER
    pub member_id: Option<i64>,
    pub member_name: Option<String>,   // resolved for MEMBER
    pub name: Option<String>,          // for OTHER
    pub details: Option<String>,       // for OTHER
}

fn valid_scope(scope: &str) -> Result<(), AppError> {
    match scope {
        "LOAN" | "CHIT_MEMBER" => Ok(()),
        _ => Err(AppError::validation("Invalid guarantor scope")),
    }
}

/// Replace all guarantors for a target with the given list (max 2). Empty list
/// clears them. Slots are assigned 1..=2 in order.
pub fn save_guarantors(
    conn: &Connection,
    scope: &str,
    ref_id: i64,
    items: &[GuarantorInput],
    created_at: &str,
) -> Result<(), AppError> {
    valid_scope(scope)?;
    if items.len() > 2 {
        return Err(AppError::validation("A maximum of 2 guarantors is allowed"));
    }

    conn.execute(
        "DELETE FROM guarantors WHERE scope = ?1 AND ref_id = ?2",
        (scope, ref_id),
    )?;

    for (i, g) in items.iter().enumerate() {
        let slot = (i + 1) as i64;
        match g.guarantor_type.to_uppercase().as_str() {
            "SELF" => {
                conn.execute(
                    "INSERT INTO guarantors (scope, ref_id, slot, guarantor_type, created_at)
                     VALUES (?1, ?2, ?3, 'SELF', ?4)",
                    (scope, ref_id, slot, created_at),
                )?;
            }
            "MEMBER" => {
                let mid = g.member_id
                    .ok_or_else(|| AppError::validation("A guarantor member must be selected"))?;
                conn.execute(
                    "INSERT INTO guarantors
                       (scope, ref_id, slot, guarantor_type, guarantor_member_id, created_at)
                     VALUES (?1, ?2, ?3, 'MEMBER', ?4, ?5)",
                    (scope, ref_id, slot, mid, created_at),
                )?;
            }
            "OTHER" => {
                let name = g.name.as_deref().unwrap_or("").trim().to_string();
                if name.is_empty() {
                    return Err(AppError::validation("A guarantor name is required for 'Other'"));
                }
                let details = g.details.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty());
                conn.execute(
                    "INSERT INTO guarantors
                       (scope, ref_id, slot, guarantor_type, guarantor_name, guarantor_details, created_at)
                     VALUES (?1, ?2, ?3, 'OTHER', ?4, ?5, ?6)",
                    (scope, ref_id, slot, name, details, created_at),
                )?;
            }
            _ => return Err(AppError::validation("Invalid guarantor type")),
        }
    }
    Ok(())
}

/// Fetch guarantors for a target, resolving member names.
pub fn get_guarantors(
    conn: &Connection,
    scope: &str,
    ref_id: i64,
) -> Result<Vec<Guarantor>, AppError> {
    valid_scope(scope)?;
    let mut stmt = conn.prepare(
        "SELECT g.slot, g.guarantor_type, g.guarantor_member_id,
                (SELECT name FROM members WHERE id = g.guarantor_member_id),
                g.guarantor_name, g.guarantor_details
         FROM guarantors g
         WHERE g.scope = ?1 AND g.ref_id = ?2
         ORDER BY g.slot",
    )?;
    let rows = stmt.query_map((scope, ref_id), |r| {
        Ok(Guarantor {
            slot: r.get(0)?,
            guarantor_type: r.get(1)?,
            member_id: r.get(2)?,
            member_name: r.get(3)?,
            name: r.get(4)?,
            details: r.get(5)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Resolve the chit_members row id for a (chit, member) pair.
pub fn chit_member_ref(conn: &Connection, chit_id: i64, member_id: i64) -> Result<i64, AppError> {
    conn.query_row(
        "SELECT id FROM chit_members WHERE chit_id = ?1 AND member_id = ?2",
        (chit_id, member_id),
        |r| r.get(0),
    ).map_err(|_| AppError::business("This member is not part of the chit"))
}
