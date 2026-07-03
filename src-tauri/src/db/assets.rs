//! Fixed-asset register (office, computer, furniture, etc.).
//!
//! Assets are tracked at acquisition cost (no depreciation). Buying an asset with
//! cash/bank creates a balance-checked `ASSET_PURCHASE` voucher (cash → fixed
//! asset), so the SHG's net worth is unchanged and the Balance Sheet stays
//! reconciled. Assets already owned before using the app are entered as "opening"
//! assets (no cash movement; they count toward capital). Disposal marks the asset
//! inactive and, if sold, records the proceeds as an `ASSET_DISPOSAL` receipt.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::db::ledger;
use crate::error::AppError;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub id: i64,
    pub name: String,
    pub category: String,
    pub purchase_date: String,
    pub cost: f64,
    pub supplier: Option<String>,
    pub location: Option<String>,
    pub reference_no: Option<String>,
    pub note: Option<String>,
    pub funding_method: String, // CASH | BANK | OPENING
    pub is_opening: bool,
    pub status: String, // ACTIVE | DISPOSED
    pub disposed_at: Option<String>,
    pub disposal_amount: Option<f64>,
    pub disposal_method: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewAsset {
    pub name: String,
    pub category: String,
    pub purchase_date: String,
    pub cost: f64,
    pub supplier: Option<String>,
    pub location: Option<String>,
    pub reference_no: Option<String>,
    pub note: Option<String>,
    /// CASH or BANK for a purchase paid now; OPENING for an already-owned asset.
    pub funding_method: String,
    /// Optional bank reference for a BANK purchase.
    pub bank_txn_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetSummary {
    pub active_count: i64,
    pub total_cost: f64,
    pub by_category: Vec<CategoryTotal>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryTotal {
    pub category: String,
    pub count: i64,
    pub cost: f64,
}

fn row_to_asset(row: &rusqlite::Row) -> rusqlite::Result<Asset> {
    Ok(Asset {
        id: row.get(0)?,
        name: row.get(1)?,
        category: row.get(2)?,
        purchase_date: row.get(3)?,
        cost: row.get(4)?,
        supplier: row.get(5)?,
        location: row.get(6)?,
        reference_no: row.get(7)?,
        note: row.get(8)?,
        funding_method: row.get(9)?,
        is_opening: row.get::<_, i64>(10)? != 0,
        status: row.get(11)?,
        disposed_at: row.get(12)?,
        disposal_amount: row.get(13)?,
        disposal_method: row.get(14)?,
        created_at: row.get(15)?,
    })
}

const SELECT_COLS: &str =
    "id, name, category, purchase_date, cost, supplier, location, reference_no, note,
     funding_method, is_opening, status, disposed_at, disposal_amount, disposal_method, created_at";

/// List all assets, newest first (active before disposed).
pub fn list_assets(conn: &Connection) -> Result<Vec<Asset>, AppError> {
    let sql = format!(
        "SELECT {SELECT_COLS} FROM assets
         ORDER BY (status = 'DISPOSED'), purchase_date DESC, id DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_asset)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Add an asset. For CASH/BANK funding this records a balance-checked
/// ASSET_PURCHASE voucher (cash/bank goes down); OPENING records no ledger entry.
pub fn add_asset(conn: &mut Connection, input: &NewAsset) -> Result<i64, AppError> {
    if input.name.trim().is_empty() {
        return Err(AppError::validation("Asset name is required"));
    }
    if input.cost <= 0.0 {
        return Err(AppError::validation("Asset cost must be greater than zero"));
    }
    let method = input.funding_method.to_uppercase();
    if !matches!(method.as_str(), "CASH" | "BANK" | "OPENING") {
        return Err(AppError::validation("Funding must be CASH, BANK, or OPENING"));
    }

    let now = chrono::Utc::now().to_rfc3339();
    let is_opening = method == "OPENING";
    let mut tx = conn.transaction()?;

    // For a real purchase, record the cash/bank outflow first (balance-checked).
    // The last INSERT in record_voucher_ex is the voucher row, so last_insert_rowid
    // gives us its id to link back from the asset.
    let voucher_ref_id: Option<i64> = if is_opening {
        None
    } else {
        let reason = format!("Asset purchase: {}", input.name.trim());
        ledger::record_voucher_ex(
            &mut tx,
            input.cost,
            &reason,
            &method,
            Some("ASSET_PURCHASE"),
            None,
            &input.purchase_date,
            input.bank_txn_id.as_deref(),
            None,
        )?;
        Some(tx.last_insert_rowid())
    };

    tx.execute(
        "INSERT INTO assets
           (name, category, purchase_date, cost, supplier, location, reference_no, note,
            funding_method, is_opening, voucher_ref_id, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'ACTIVE', ?12)",
        rusqlite::params![
            input.name.trim(),
            input.category.trim(),
            input.purchase_date,
            input.cost,
            input.supplier,
            input.location,
            input.reference_no,
            input.note,
            method,
            is_opening as i64,
            voucher_ref_id,
            now,
        ],
    )?;
    let id = tx.last_insert_rowid();
    tx.commit()?;
    Ok(id)
}

/// Update descriptive fields of an asset (not cost or funding).
pub fn update_asset(
    conn: &Connection,
    id: i64,
    name: &str,
    category: &str,
    supplier: Option<&str>,
    location: Option<&str>,
    note: Option<&str>,
) -> Result<(), AppError> {
    if name.trim().is_empty() {
        return Err(AppError::validation("Asset name is required"));
    }
    conn.execute(
        "UPDATE assets SET name = ?1, category = ?2, supplier = ?3, location = ?4, note = ?5
         WHERE id = ?6",
        rusqlite::params![name.trim(), category.trim(), supplier, location, note, id],
    )?;
    Ok(())
}

/// Dispose (sell/scrap) an asset. Marks it DISPOSED; if `proceeds` > 0 records an
/// ASSET_DISPOSAL receipt (cash/bank goes up). Scrapping = proceeds 0.
pub fn dispose_asset(
    conn: &mut Connection,
    id: i64,
    proceeds: f64,
    method: Option<&str>,
    date: &str,
) -> Result<(), AppError> {
    if proceeds < 0.0 {
        return Err(AppError::validation("Proceeds cannot be negative"));
    }

    let (name, status): (String, String) = conn
        .query_row("SELECT name, status FROM assets WHERE id = ?1", [id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .map_err(|_| AppError::validation("Asset not found"))?;
    if status == "DISPOSED" {
        return Err(AppError::business("Asset is already disposed"));
    }

    let pay_method = method.map(|m| m.to_uppercase());
    if proceeds > 0.0 {
        match pay_method.as_deref() {
            Some("CASH") | Some("BANK") => {}
            _ => return Err(AppError::validation("Choose Cash or Bank for the sale proceeds")),
        }
    }

    let mut tx = conn.transaction()?;
    if proceeds > 0.0 {
        let m = pay_method.unwrap();
        let reason = format!("Asset disposal: {name}");
        ledger::record_receipt_ex(
            &mut tx,
            proceeds,
            &reason,
            &m,
            Some("ASSET_DISPOSAL"),
            Some(id),
            date,
            None,
            None,
        )?;
        tx.execute(
            "UPDATE assets SET status = 'DISPOSED', disposed_at = ?1,
               disposal_amount = ?2, disposal_method = ?3 WHERE id = ?4",
            rusqlite::params![date, proceeds, m, id],
        )?;
    } else {
        tx.execute(
            "UPDATE assets SET status = 'DISPOSED', disposed_at = ?1,
               disposal_amount = 0, disposal_method = NULL WHERE id = ?2",
            rusqlite::params![date, id],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Summary of active assets: total count, total cost, and per-category breakdown.
pub fn get_asset_summary(conn: &Connection) -> Result<AssetSummary, AppError> {
    let (active_count, total_cost): (i64, f64) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(cost), 0) FROM assets WHERE status = 'ACTIVE'",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;

    let mut stmt = conn.prepare(
        "SELECT category, COUNT(*), COALESCE(SUM(cost), 0) FROM assets
         WHERE status = 'ACTIVE'
         GROUP BY category ORDER BY SUM(cost) DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(CategoryTotal {
            category: r.get(0)?,
            count: r.get(1)?,
            cost: r.get(2)?,
        })
    })?;
    let mut by_category = Vec::new();
    for r in rows {
        by_category.push(r?);
    }

    Ok(AssetSummary { active_count, total_cost, by_category })
}
