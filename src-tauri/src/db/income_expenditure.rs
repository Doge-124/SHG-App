//! Income & Expenditure Account — revenue-based P&L for a financial year.
//!
//! Unlike the Receipts & Payments account (trial balance), this excludes
//! capital flows (loans disbursed/repaid, chit installments/payouts, member
//! savings) and shows only the SHG's true income and operational expenses.
//!
//! Interest Earned formula (correct for period accounting):
//!   Interest = Repayments_in_period − (Outstanding_start + Disbursed_in_period − Outstanding_end)
//!            = Repayments − Principal_recovered_in_period
//!
//! Indian FY: April 1 (year) → March 31 (year + 1).

use rusqlite::Connection;
use serde::Serialize;
use crate::error::AppError;

#[derive(Debug, Serialize)]
pub struct IncomeExpenditureAccount {
    pub financial_year: String,   // "2024-25"
    pub from_date: String,
    pub to_date: String,

    // ── Income ────────────────────────────────────────────────────────────
    pub interest_on_loans: f64,
    pub chit_commission: f64,
    pub donations_grants: f64,
    pub other_income: f64,
    pub total_income: f64,

    // ── Expenditure ───────────────────────────────────────────────────────
    pub operational_expenses: f64,  // any voucher not a loan/chit payout
    pub total_expenditure: f64,

    // ── Result ────────────────────────────────────────────────────────────
    pub surplus: f64,               // positive = surplus, negative = deficit

    // ── Working for interest calculation (informational) ──────────────────
    pub loans_outstanding_start: f64,
    pub loans_disbursed_in_period: f64,
    pub loan_repayments_in_period: f64,
    pub loans_outstanding_end: f64,
    pub principal_recovered: f64,
}

/// Compute loans outstanding as of a given date boundary (inclusive).
/// Only the principal portion of repayments reduces outstanding — interest
/// is income, not a loan reduction.
fn loans_outstanding_as_of(conn: &Connection, date_end: &str) -> f64 {
    conn.query_row(
        "SELECT COALESCE(SUM(outstanding), 0)
         FROM (
             SELECT l.amount - COALESCE(paid.total, 0) AS outstanding
             FROM loans l
             LEFT JOIN (
                 SELECT loan_id, SUM(principal_amount) AS total
                 FROM loan_payments
                 WHERE created_at <= ?1
                 GROUP BY loan_id
             ) paid ON paid.loan_id = l.id
             WHERE l.issued_at <= ?1
         ) sub
         WHERE outstanding > 0.005",
        [date_end],
        |r| r.get::<_, f64>(0),
    ).unwrap_or(0.0)
}

pub fn get_income_expenditure(
    conn: &Connection,
    financial_year: i32,
) -> Result<IncomeExpenditureAccount, AppError> {
    let from_date  = format!("{}-04-01", financial_year);
    let to_dt      = format!("{}-03-31T23:59:59", financial_year + 1);
    let to_date    = format!("{}-03-31", financial_year + 1);
    // One instant before the period start — used for "start of period" balance.
    // Using the bare from_date as boundary means "strictly before April 1".
    let before_start = &from_date;

    // ── Interest calculation ──────────────────────────────────────────────
    // Outstanding at start of FY (everything issued and not yet repaid before April 1)
    let loans_outstanding_start = loans_outstanding_as_of(conn, before_start);

    // Outstanding at end of FY
    let loans_outstanding_end = loans_outstanding_as_of(conn, &to_dt);

    // Loans newly disbursed during the FY
    let loans_disbursed_in_period: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM loans
         WHERE issued_at >= ?1 AND issued_at <= ?2",
        [&from_date, &to_dt],
        |r| r.get(0),
    ).unwrap_or(0.0);

    // Total repayments received during the FY (from loan_payments table,
    // not shg_transactions, because loan_payments records the actual amounts
    // credited against each loan).
    let loan_repayments_in_period: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM loan_payments
         WHERE created_at >= ?1 AND created_at <= ?2",
        [&from_date, &to_dt],
        |r| r.get(0),
    ).unwrap_or(0.0);

    // Principal recovered = how much of the outstanding was paid back.
    // principal_recovered = L_start + D − L_end (working figure for reporting)
    let principal_recovered =
        (loans_outstanding_start + loans_disbursed_in_period - loans_outstanding_end).max(0.0);

    // Interest = sum of the interest portion of every payment in the period.
    // Use the explicit column rather than the L_start+D−L_end residual, which
    // tautologically equalled total_repayments under the old gross-payment
    // formula and produced Rs 0 interest income.
    let interest_on_loans: f64 = conn.query_row(
        "SELECT COALESCE(SUM(interest_amount), 0) FROM loan_payments
         WHERE created_at >= ?1 AND created_at <= ?2",
        [&from_date, &to_dt],
        |r| r.get(0),
    ).unwrap_or(0.0);

    // ── Chit commission ───────────────────────────────────────────────────
    let chit_commission: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
         WHERE txn_type = 'RECEIPT' AND reference_type = 'CHIT_COMMISSION'
         AND voided_at IS NULL AND reversal_of_id IS NULL
         AND created_at >= ?1 AND created_at <= ?2",
        [&from_date, &to_dt],
        |r| r.get(0),
    ).unwrap_or(0.0);

    // ── Donations & grants ────────────────────────────────────────────────
    let donations_grants: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
         WHERE txn_type = 'RECEIPT' AND reference_type IN ('DONATION', 'GRANT')
         AND voided_at IS NULL AND reversal_of_id IS NULL
         AND created_at >= ?1 AND created_at <= ?2",
        [&from_date, &to_dt],
        |r| r.get(0),
    ).unwrap_or(0.0);

    // ── Other income ──────────────────────────────────────────────────────
    // Any RECEIPT not in pass-through categories (savings, loan repayments,
    // chit installments) and not already counted above. Cancelled (voided) and
    // reversal rows are excluded so a reversed transaction doesn't show as income.
    let other_income: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
         WHERE txn_type = 'RECEIPT'
         AND voided_at IS NULL AND reversal_of_id IS NULL
         AND (reference_type IS NULL OR reference_type NOT IN (
             'WEEKLY_CONTRIBUTION','MEMBER_CONTRIBUTION','MEMBER_RECEIPT',
             'MEMBER_PAYMENT','CHIT_PAYMENT','CHIT_COMMISSION',
             'DONATION','GRANT'
         ))
         AND created_at >= ?1 AND created_at <= ?2",
        [&from_date, &to_dt],
        |r| r.get(0),
    ).unwrap_or(0.0);

    let total_income = interest_on_loans + chit_commission + donations_grants + other_income;

    // ── Operational expenses ──────────────────────────────────────────────
    // Vouchers that are genuine expenses — NOT loan disbursements, NOT chit
    // payouts, and NOT savings payouts. A savings payout (SAVINGS_WITHDRAWAL)
    // returns a member their own deposited savings: it reduces a liability, it
    // is not an income-statement expense. Cancelled (voided) originals and
    // reversal vouchers are excluded so a reversed transaction isn't counted.
    let operational_expenses: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
         WHERE txn_type = 'VOUCHER'
         AND voided_at IS NULL AND reversal_of_id IS NULL
         AND (reference_type IS NULL OR reference_type NOT IN
              ('MEMBER_LOAN', 'CHIT_PAYOUT', 'SAVINGS_WITHDRAWAL'))
         AND created_at >= ?1 AND created_at <= ?2",
        [&from_date, &to_dt],
        |r| r.get(0),
    ).unwrap_or(0.0);

    let total_expenditure = operational_expenses;
    let surplus = total_income - total_expenditure;

    Ok(IncomeExpenditureAccount {
        financial_year: format!("{}-{:02}", financial_year, (financial_year + 1) % 100),
        from_date,
        to_date,
        interest_on_loans,
        chit_commission,
        donations_grants,
        other_income,
        total_income,
        operational_expenses,
        total_expenditure,
        surplus,
        loans_outstanding_start,
        loans_disbursed_in_period,
        loan_repayments_in_period,
        loans_outstanding_end,
        principal_recovered,
    })
}
