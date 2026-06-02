//! Database integrity checks and repair operations.
//!
//! Runs several layers of validation:
//!   1. SQLite's built-in `PRAGMA integrity_check` (file/page-level corruption)
//!   2. Foreign-key constraint check
//!   3. App-level invariants:
//!      - `member_balances.balance` matches sum of that member's transactions
//!      - `shg_balances.balance` matches sum of all SHG transactions (cash & bank)
//!      - No orphaned loan_payments / chit_payments / chit_cycle_winners
//!   4. Database size (informational)

use rusqlite::Connection;
use serde::Serialize;
use crate::error::AppError;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IntegrityCheck {
    pub name: String,
    pub passed: bool,
    pub details: Option<String>,
    pub severity: String, // "ok" | "warn" | "error" | "info"
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrityReport {
    pub overall_ok: bool,
    pub error_count: usize,
    pub warn_count: usize,
    pub checks: Vec<IntegrityCheck>,
    pub generated_at: String,
}

pub fn check_integrity(conn: &Connection) -> Result<IntegrityReport, AppError> {
    let mut checks: Vec<IntegrityCheck> = Vec::new();

    // 1. SQLite integrity_check
    let integrity_result: String = conn
        .query_row("PRAGMA integrity_check(20)", [], |r| r.get(0))
        .unwrap_or_else(|e| format!("query failed: {e}"));
    let ok = integrity_result == "ok";
    checks.push(IntegrityCheck {
        name: "SQLite file integrity".into(),
        passed: ok,
        details: if ok { None } else { Some(integrity_result) },
        severity: if ok { "ok".into() } else { "error".into() },
    });

    // 2. Foreign key check
    let fk_violations = count_query(conn, "PRAGMA foreign_key_check").unwrap_or(0);
    let fk_ok = fk_violations == 0;
    checks.push(IntegrityCheck {
        name: "Foreign-key constraints".into(),
        passed: fk_ok,
        details: if fk_ok {
            None
        } else {
            Some(format!("{fk_violations} violation(s)"))
        },
        severity: if fk_ok { "ok".into() } else { "error".into() },
    });

    // 3a. Member savings balance invariant.
    // member_balances tracks SAVINGS only (OPENING + CONTRIBUTION). LOAN /
    // PAYMENT rows are loan-side history that lives on the loans tables
    // and must not be counted here.
    let member_mismatches: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM (
                SELECT mb.member_id
                FROM member_balances mb
                LEFT JOIN member_transactions mt
                  ON mt.member_id = mb.member_id
                 AND mt.txn_type IN ('OPENING','CONTRIBUTION')
                GROUP BY mb.member_id
                HAVING ABS(mb.balance - COALESCE(SUM(mt.amount), 0)) > 0.01
            )",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let mb_ok = member_mismatches == 0;
    checks.push(IntegrityCheck {
        name: "Member savings balance invariant".into(),
        passed: mb_ok,
        details: if mb_ok {
            None
        } else {
            Some(format!(
                "{member_mismatches} member(s) have a cached balance that disagrees with their transaction history"
            ))
        },
        severity: if mb_ok { "ok".into() } else { "error".into() },
    });

    // 3b. SHG balance invariant (cash + bank)
    check_shg_balance(conn, "CASH", &mut checks);
    check_shg_balance(conn, "BANK", &mut checks);

    // 4a. Orphaned loan_payments
    let orphans = count_query(
        conn,
        "SELECT 1 FROM loan_payments lp
         WHERE NOT EXISTS (SELECT 1 FROM loans l WHERE l.id = lp.loan_id)",
    )
    .unwrap_or(0);
    checks.push(IntegrityCheck {
        name: "Loan payments link to valid loans".into(),
        passed: orphans == 0,
        details: if orphans == 0 {
            None
        } else {
            Some(format!("{orphans} orphaned loan payment(s)"))
        },
        severity: if orphans == 0 { "ok".into() } else { "warn".into() },
    });

    // 4b. Orphaned chit payments
    let orphans = count_query(
        conn,
        "SELECT 1 FROM chit_payments cp
         WHERE NOT EXISTS (SELECT 1 FROM chit_cycles cc WHERE cc.id = cp.cycle_id)",
    )
    .unwrap_or(0);
    checks.push(IntegrityCheck {
        name: "Chit payments link to valid cycles".into(),
        passed: orphans == 0,
        details: if orphans == 0 {
            None
        } else {
            Some(format!("{orphans} orphaned chit payment(s)"))
        },
        severity: if orphans == 0 { "ok".into() } else { "warn".into() },
    });

    // 4c. Loan outstanding invariant: cached outstanding_amount must equal
    // amount − Σ(principal repaid). Drift here is exactly the "trial balance
    // shows the wrong outstanding" class of bug; "Rebuild Balances" repairs it.
    let loan_mismatches: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM (
                SELECT l.id
                FROM loans l
                LEFT JOIN loan_payments lp ON lp.loan_id = l.id
                GROUP BY l.id
                HAVING ABS(l.outstanding_amount -
                    MAX(0, l.amount - COALESCE(SUM(lp.principal_amount), 0))) > 0.01
            )",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let loans_ok = loan_mismatches == 0;
    checks.push(IntegrityCheck {
        name: "Loan outstanding invariant".into(),
        passed: loans_ok,
        details: if loans_ok {
            None
        } else {
            Some(format!(
                "{loan_mismatches} loan(s) have a cached outstanding that disagrees with their repayment history — run Rebuild Balances"
            ))
        },
        severity: if loans_ok { "ok".into() } else { "error".into() },
    });

    // 5. DB size (informational)
    let page_count: i64 = conn.query_row("PRAGMA page_count", [], |r| r.get(0)).unwrap_or(0);
    let page_size: i64 = conn.query_row("PRAGMA page_size", [], |r| r.get(0)).unwrap_or(0);
    let db_size_mb = (page_count * page_size) as f64 / 1_048_576.0;
    checks.push(IntegrityCheck {
        name: "Database size".into(),
        passed: true,
        details: Some(format!("{db_size_mb:.2} MB ({page_count} pages × {page_size} bytes)")),
        severity: "info".into(),
    });

    let error_count = checks.iter().filter(|c| c.severity == "error").count();
    let warn_count = checks.iter().filter(|c| c.severity == "warn").count();
    let overall_ok = error_count == 0;

    Ok(IntegrityReport {
        overall_ok,
        error_count,
        warn_count,
        checks,
        generated_at: chrono::Utc::now().to_rfc3339(),
    })
}

fn check_shg_balance(conn: &Connection, method: &str, checks: &mut Vec<IntegrityCheck>) {
    let actual: f64 = conn
        .query_row(
            "SELECT COALESCE(balance, 0) FROM shg_balances WHERE method = ?1",
            [method],
            |r| r.get(0),
        )
        .unwrap_or(0.0);
    let computed: f64 = conn
        .query_row(
            "SELECT COALESCE(SUM(
                CASE WHEN txn_type IN ('RECEIPT','OPENING') THEN amount ELSE -amount END
             ), 0)
             FROM shg_transactions WHERE payment_method = ?1",
            [method],
            |r| r.get(0),
        )
        .unwrap_or(0.0);
    let ok = (actual - computed).abs() < 0.01;
    checks.push(IntegrityCheck {
        name: format!("SHG {method} balance invariant"),
        passed: ok,
        details: if ok {
            None
        } else {
            Some(format!(
                "cached Rs.{actual:.2} vs computed Rs.{computed:.2} (diff Rs.{:.2})",
                (actual - computed).abs()
            ))
        },
        severity: if ok { "ok".into() } else { "error".into() },
    });
}

/// Report from a balance rebuild — useful for surfacing what was repaired.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RebuildReport {
    pub member_rows_updated: usize,
    pub loan_rows_updated: usize,
    pub shg_cash_before: f64,
    pub shg_cash_after: f64,
    pub shg_bank_before: f64,
    pub shg_bank_after: f64,
    pub generated_at: String,
}

/// Rebuild `member_balances` and `shg_balances` from their source-of-truth
/// transaction tables. Cheap, idempotent, and safe to run any time — if the
/// caches already match, nothing changes. Use this when the integrity check
/// flags drift, or as a periodic safety net.
pub fn rebuild_balances(conn: &mut Connection) -> Result<RebuildReport, AppError> {
    let shg_cash_before: f64 = conn.query_row(
        "SELECT COALESCE(balance, 0) FROM shg_balances WHERE method = 'CASH'",
        [], |r| r.get(0),
    ).unwrap_or(0.0);
    let shg_bank_before: f64 = conn.query_row(
        "SELECT COALESCE(balance, 0) FROM shg_balances WHERE method = 'BANK'",
        [], |r| r.get(0),
    ).unwrap_or(0.0);

    let tx = conn.transaction()?;

    // Recompute member_balances from member_transactions. Insert rows for
    // members that have transactions but no cache entry yet.
    let mut member_rows_updated = 0usize;
    {
        // Savings only — see check_integrity's matching invariant.
        let mut stmt = tx.prepare(
            "SELECT member_id, COALESCE(SUM(amount), 0) AS total
             FROM member_transactions
             WHERE txn_type IN ('OPENING','CONTRIBUTION')
             GROUP BY member_id",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, f64>(1)?))
        })?;
        for r in rows {
            let (mid, total) = r?;
            tx.execute(
                "INSERT INTO member_balances (member_id, balance) VALUES (?1, ?2)
                 ON CONFLICT(member_id) DO UPDATE SET balance = excluded.balance",
                (mid, total),
            )?;
            member_rows_updated += 1;
        }
    }

    // Recompute each loan's outstanding principal from its payment history.
    // The authoritative value is amount − Σ(principal_amount). Upfront-interest
    // rows have principal_amount = 0 so they don't affect it. Status is realigned
    // (paid when nothing is owed), but a manual 'defaulted' mark is preserved.
    let loan_rows_updated: usize = {
        let mismatches: usize = tx.query_row(
            "SELECT COUNT(*) FROM (
                SELECT l.id
                FROM loans l
                LEFT JOIN loan_payments lp ON lp.loan_id = l.id
                GROUP BY l.id
                HAVING ABS(l.outstanding_amount -
                    MAX(0, l.amount - COALESCE(SUM(lp.principal_amount), 0))) > 0.01
            )",
            [], |r| r.get::<_, i64>(0),
        ).unwrap_or(0) as usize;

        tx.execute(
            "UPDATE loans SET outstanding_amount = MAX(0, amount - COALESCE(
                (SELECT SUM(principal_amount) FROM loan_payments WHERE loan_id = loans.id), 0))",
            [],
        )?;
        tx.execute(
            "UPDATE loans SET status = CASE
                WHEN status = 'defaulted' THEN 'defaulted'
                WHEN outstanding_amount <= 0.01 AND COALESCE(unpaid_interest_balance, 0) <= 0.01 THEN 'paid'
                ELSE 'active'
             END",
            [],
        )?;
        mismatches
    };

    // Recompute SHG cash + bank from shg_transactions.
    for method in &["CASH", "BANK"] {
        let computed: f64 = tx.query_row(
            "SELECT COALESCE(SUM(
                CASE WHEN txn_type IN ('RECEIPT','OPENING') THEN amount ELSE -amount END
             ), 0)
             FROM shg_transactions WHERE payment_method = ?1",
            [method], |r| r.get(0),
        ).unwrap_or(0.0);
        tx.execute(
            "INSERT INTO shg_balances (method, balance) VALUES (?1, ?2)
             ON CONFLICT(method) DO UPDATE SET balance = excluded.balance",
            (*method, computed),
        )?;
    }

    tx.commit()?;

    let shg_cash_after: f64 = conn.query_row(
        "SELECT COALESCE(balance, 0) FROM shg_balances WHERE method = 'CASH'",
        [], |r| r.get(0),
    ).unwrap_or(0.0);
    let shg_bank_after: f64 = conn.query_row(
        "SELECT COALESCE(balance, 0) FROM shg_balances WHERE method = 'BANK'",
        [], |r| r.get(0),
    ).unwrap_or(0.0);

    Ok(RebuildReport {
        member_rows_updated,
        loan_rows_updated,
        shg_cash_before, shg_cash_after,
        shg_bank_before, shg_bank_after,
        generated_at: chrono::Utc::now().to_rfc3339(),
    })
}

/// Count rows returned by a SELECT/PRAGMA that returns one row per violation.
fn count_query(conn: &Connection, sql: &str) -> Result<i64, AppError> {
    let mut stmt = conn.prepare(sql)?;
    let mut rows = stmt.query([])?;
    let mut count = 0i64;
    while rows.next()?.is_some() {
        count += 1;
    }
    Ok(count)
}
