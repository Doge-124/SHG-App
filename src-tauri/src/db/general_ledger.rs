//! General ledger — every SHG receipt/voucher in a date range, categorised by
//! income/expense type so the operator can filter (e.g. all Rent, Stationery,
//! Salary/Incentive expenses this year). Categories derive from a transaction's
//! reference_type, or — for plain receipts/vouchers — its reason (the payee
//! suffix "purpose — payee" is stripped so entries group by purpose).

use rusqlite::Connection;
use serde::Serialize;

use crate::error::AppError;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlEntry {
    pub id: i64,
    pub date: String,
    pub category: String,
    pub kind: String, // "income" | "expense" | "transfer"
    pub description: String,
    pub amount: f64,
    pub payment_method: String,
    pub txn_type: String, // RECEIPT | VOUCHER
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlCategory {
    pub category: String,
    pub kind: String,
    pub count: i64,
    pub total: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneralLedger {
    pub from: String,
    pub to: String,
    pub categories: Vec<GlCategory>,
    pub entries: Vec<GlEntry>,
    pub total_income: f64,
    pub total_expense: f64,
}

/// Strip a "purpose — payee" suffix so external/general vouchers group by purpose.
fn base_reason(reason: &str) -> String {
    let base = reason.split(" — ").next().unwrap_or(reason).trim();
    if base.is_empty() { reason.trim().to_string() } else { base.to_string() }
}

/// Map a transaction to (category, kind). "transfer" = money that passes through
/// the SHG (loans, chit pool, savings) and is neither the SHG's income nor an expense.
fn categorize(txn_type: &str, reference_type: Option<&str>, reason: &str) -> (String, &'static str) {
    match (txn_type, reference_type) {
        ("RECEIPT", Some("WEEKLY_CONTRIBUTION")) | ("RECEIPT", Some("MEMBER_CONTRIBUTION")) => {
            ("Member Savings Collection".to_string(), "transfer")
        }
        ("RECEIPT", Some("MEMBER_RECEIPT")) => ("Member Receipt".to_string(), "transfer"),
        ("RECEIPT", Some("MEMBER_PAYMENT")) => ("Loan Repayment".to_string(), "transfer"),
        ("RECEIPT", Some("CHIT_PAYMENT")) => ("Chit Installment".to_string(), "transfer"),
        ("RECEIPT", Some("CHIT_COMMISSION")) => ("Chit Commission".to_string(), "income"),
        ("RECEIPT", Some("DONATION")) | ("RECEIPT", Some("GRANT")) => ("Donation / Grant".to_string(), "income"),
        ("RECEIPT", Some("ASSET_DISPOSAL")) => ("Asset Sale".to_string(), "income"),
        ("RECEIPT", _) => (base_reason(reason), "income"),

        ("VOUCHER", Some("MEMBER_LOAN")) => ("Loan Disbursed".to_string(), "transfer"),
        ("VOUCHER", Some("CHIT_PAYOUT")) => ("Chit Payout".to_string(), "transfer"),
        ("VOUCHER", Some("SAVINGS_WITHDRAWAL")) => ("Savings Payout".to_string(), "transfer"),
        ("VOUCHER", Some("ASSET_PURCHASE")) => ("Asset Purchase".to_string(), "transfer"),
        ("VOUCHER", _) => (base_reason(reason), "expense"),

        _ => (base_reason(reason), "transfer"),
    }
}

/// All receipts/vouchers in [from, to] with per-category totals. `from`/`to` are
/// ISO dates (YYYY-MM-DD); the `to` day is included in full.
pub fn get_general_ledger(conn: &Connection, from: &str, to: &str) -> Result<GeneralLedger, AppError> {
    let to_end = format!("{to}T23:59:59");

    let mut stmt = conn.prepare(
        "SELECT id, txn_type, amount, reason, payment_method, reference_type, created_at
         FROM shg_transactions
         WHERE txn_type IN ('RECEIPT', 'VOUCHER')
           AND voided_at IS NULL AND reversal_of_id IS NULL
           AND created_at >= ?1 AND created_at <= ?2
         ORDER BY created_at ASC, id ASC",
    )?;

    let rows = stmt.query_map([from, &to_end], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, String>(1)?,             // txn_type
            r.get::<_, f64>(2)?,                // amount
            r.get::<_, String>(3)?,             // reason
            r.get::<_, String>(4)?,             // payment_method
            r.get::<_, Option<String>>(5)?,     // reference_type
            r.get::<_, String>(6)?,             // created_at
        ))
    })?;

    let mut entries: Vec<GlEntry> = Vec::new();
    // category -> (kind, count, total)
    let mut cats: std::collections::HashMap<String, (&'static str, i64, f64)> = std::collections::HashMap::new();
    let mut total_income = 0.0_f64;
    let mut total_expense = 0.0_f64;

    for row in rows {
        let (id, txn_type, amount, reason, payment_method, reference_type, created_at) = row?;
        let (category, kind) = categorize(&txn_type, reference_type.as_deref(), &reason);

        match kind {
            "income" => total_income += amount,
            "expense" => total_expense += amount,
            _ => {}
        }

        let e = cats.entry(category.clone()).or_insert((kind, 0, 0.0));
        e.1 += 1;
        e.2 += amount;

        entries.push(GlEntry {
            id,
            date: created_at,
            category,
            kind: kind.to_string(),
            description: reason,
            amount,
            payment_method,
            txn_type,
        });
    }

    let mut categories: Vec<GlCategory> = cats
        .into_iter()
        .map(|(category, (kind, count, total))| GlCategory {
            category,
            kind: kind.to_string(),
            count,
            total,
        })
        .collect();
    // Biggest first within a stable kind order (income, expense, transfer).
    let kind_rank = |k: &str| match k { "income" => 0, "expense" => 1, _ => 2 };
    categories.sort_by(|a, b| {
        kind_rank(&a.kind)
            .cmp(&kind_rank(&b.kind))
            .then(b.total.partial_cmp(&a.total).unwrap_or(std::cmp::Ordering::Equal))
    });

    Ok(GeneralLedger {
        from: from.to_string(),
        to: to.to_string(),
        categories,
        entries,
        total_income,
        total_expense,
    })
}
