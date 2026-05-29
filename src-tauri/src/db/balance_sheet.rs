//! Balance Sheet — snapshot of Assets vs Liabilities & Capital.
//! Supports any "as on" date so year-end sheets (March 31) work correctly.
//!
//! Assets   = Cash + Bank + Loans Outstanding
//! Liabilities & Capital = Member Savings + Chit Funds Held + SHG Surplus
//!
//! `chit_funds_held` captures chit installments that have come into the SHG
//! cash box but haven't yet been paid out to the cycle's winner — they're
//! owed to the chit pool. Without this row a mid-cycle chit would inflate
//! cash with no offsetting entry on the right-hand side.

use rusqlite::Connection;
use serde::Serialize;
use crate::error::AppError;

#[derive(Debug, Serialize)]
pub struct BalanceSheet {
    pub as_on_date: String,

    // ── Assets ────────────────────────────────────────────────────────────
    pub cash_in_hand: f64,
    pub cash_at_bank: f64,
    pub loans_to_members: f64,
    pub total_assets: f64,

    // ── Liabilities: Member Savings ───────────────────────────────────────
    pub member_savings: f64,       // total savings the SHG holds for members
    pub total_members_with_savings: i64,

    // ── Liabilities: Chit Funds Held ──────────────────────────────────────
    // Chit installments collected but not yet disbursed (or net amount over
    // the lifetime of the chit-payout commission accounting):
    //   SUM(chit_payments.amount) - SUM(CHIT_PAYOUT vouchers).
    // Goes to zero when a cycle has been fully paid out and the commission
    // has been recognised as income.
    pub chit_funds_held: f64,

    // ── Capital: SHG Surplus (= Total Assets − Member Savings) ───────────
    pub surplus: f64,

    // Surplus breakdown (informational):
    pub shg_seed: f64,             // OPENING transactions (settings seed)
    pub interest_earned: f64,      // loan repayments minus principal recovered
    pub chit_commission: f64,
    pub donations_grants: f64,
    pub other_income: f64,
    pub total_income: f64,
    pub other_expenses: f64,       // vouchers not related to loans or chit payouts

    // ── Verification ──────────────────────────────────────────────────────
    pub total_liabilities_capital: f64,
    pub is_balanced: bool,         // total_assets == total_liabilities_capital
}

/// Compute the balance sheet as of a given date (ISO "YYYY-MM-DD").
pub fn get_balance_sheet(conn: &Connection, as_on_date: &str) -> Result<BalanceSheet, AppError> {
    // Upper boundary for the date — include all transactions up to end of day.
    let date_end = format!("{}T23:59:59", as_on_date);

    // ── Cash & Bank (computed from all transactions up to date) ───────────
    // txn_type OPENING and RECEIPT are credits; VOUCHER is a debit.
    let cash_in_hand: f64 = (conn.query_row(
        "SELECT COALESCE(SUM(
             CASE WHEN txn_type IN ('RECEIPT','OPENING') THEN amount ELSE -amount END
         ), 0)
         FROM shg_transactions
         WHERE payment_method = 'CASH' AND created_at <= ?1",
        [&date_end], |r| r.get::<_, f64>(0),
    ).unwrap_or(0.0)).max(0.0);

    let cash_at_bank: f64 = (conn.query_row(
        "SELECT COALESCE(SUM(
             CASE WHEN txn_type IN ('RECEIPT','OPENING') THEN amount ELSE -amount END
         ), 0)
         FROM shg_transactions
         WHERE payment_method = 'BANK' AND created_at <= ?1",
        [&date_end], |r| r.get::<_, f64>(0),
    ).unwrap_or(0.0)).max(0.0);

    // ── Loans outstanding as of date ──────────────────────────────────────
    // Subtract only the PRINCIPAL portion of repayments — interest paid is
    // SHG income, not loan reduction. Legacy rows have principal_amount
    // backfilled to amount (matches the prior reporting behaviour); new rows
    // have the correct split.
    let loans_to_members: f64 = conn.query_row(
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
        [&date_end], |r| r.get(0),
    ).unwrap_or(0.0);

    let total_assets = cash_in_hand + cash_at_bank + loans_to_members;

    // ── Member Savings ────────────────────────────────────────────────────
    // member_transactions type='CONTRIBUTION' = savings paid in.
    // type='OPENING' = member's initial past-data opening balance.
    // These represent what the SHG owes back to members.
    let member_savings: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM member_transactions
         WHERE txn_type IN ('CONTRIBUTION', 'OPENING') AND created_at <= ?1",
        [&date_end], |r| r.get(0),
    ).unwrap_or(0.0);

    let total_members_with_savings: i64 = conn.query_row(
        "SELECT COUNT(DISTINCT member_id) FROM member_transactions
         WHERE txn_type IN ('CONTRIBUTION', 'OPENING') AND created_at <= ?1",
        [&date_end], |r| r.get(0),
    ).unwrap_or(0);

    // ── Chit funds held ───────────────────────────────────────────────────
    // = installments collected through chit_payments
    // − payouts disbursed via CHIT_PAYOUT vouchers.
    // Voided rows are excluded so cancellations don't double-count.
    let chit_installments_collected: f64 = conn.query_row(
        "SELECT COALESCE(SUM(cp.amount), 0)
         FROM chit_payments cp
         WHERE cp.paid_at <= ?1",
        [&date_end], |r| r.get(0),
    ).unwrap_or(0.0);

    let chit_payouts_disbursed: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
         WHERE txn_type = 'VOUCHER' AND reference_type = 'CHIT_PAYOUT'
           AND voided_at IS NULL AND reversal_of_id IS NULL
           AND created_at <= ?1",
        [&date_end], |r| r.get(0),
    ).unwrap_or(0.0);

    let chit_funds_held = (chit_installments_collected - chit_payouts_disbursed).max(0.0);

    // ── Surplus breakdown ─────────────────────────────────────────────────
    // SHG seed (OPENING type in shg_transactions — set via Settings)
    let shg_seed: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
         WHERE txn_type = 'OPENING' AND created_at <= ?1",
        [&date_end], |r| r.get(0),
    ).unwrap_or(0.0);

    // Chit commission
    let chit_commission: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
         WHERE txn_type = 'RECEIPT' AND reference_type = 'CHIT_COMMISSION'
         AND created_at <= ?1",
        [&date_end], |r| r.get(0),
    ).unwrap_or(0.0);

    // Donations & grants
    let donations_grants: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
         WHERE txn_type = 'RECEIPT' AND reference_type IN ('DONATION', 'GRANT')
         AND created_at <= ?1",
        [&date_end], |r| r.get(0),
    ).unwrap_or(0.0);

    // Interest earned = sum of the interest portion of every loan payment.
    // This is now stored explicitly per row (see loans.rs); we no longer derive
    // it from the difference between outstanding and disbursed, which was
    // tautologically zero under the old gross-payment formula.
    let interest_earned: f64 = conn.query_row(
        "SELECT COALESCE(SUM(interest_amount), 0) FROM loan_payments WHERE created_at <= ?1",
        [&date_end], |r| r.get(0),
    ).unwrap_or(0.0);

    // Other income: any RECEIPT not already categorised above
    let total_receipts: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
         WHERE txn_type IN ('RECEIPT', 'OPENING') AND created_at <= ?1",
        [&date_end], |r| r.get(0),
    ).unwrap_or(0.0);

    // Known income already counted (note: member savings itself is a liability
    // transfer, not SHG income — chit installments & loan repayments go through
    // the SHG pool, so income = only the interest/commission/donations portion).
    let known_income = shg_seed + chit_commission + donations_grants + interest_earned;

    // All receipts minus member savings contributions minus loan repayments
    // (principal) minus chit installments (pass-through) gives other income.
    let member_savings_receipts: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
         WHERE txn_type = 'RECEIPT'
         AND reference_type IN ('WEEKLY_CONTRIBUTION','MEMBER_CONTRIBUTION','MEMBER_RECEIPT')
         AND created_at <= ?1",
        [&date_end], |r| r.get(0),
    ).unwrap_or(0.0);

    let chit_installments: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
         WHERE txn_type = 'RECEIPT' AND reference_type = 'CHIT_PAYMENT'
         AND created_at <= ?1",
        [&date_end], |r| r.get(0),
    ).unwrap_or(0.0);

    // Loan repayments (MEMBER_PAYMENT) include both principal and interest;
    // only interest is SHG income — principal is already captured above.
    let loan_repayment_receipts: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
         WHERE txn_type = 'RECEIPT' AND reference_type = 'MEMBER_PAYMENT'
         AND created_at <= ?1",
        [&date_end], |r| r.get(0),
    ).unwrap_or(0.0);

    let pass_through = member_savings_receipts + chit_installments + loan_repayment_receipts;
    let other_income = (total_receipts - shg_seed - pass_through - chit_commission - donations_grants).max(0.0);

    let total_income = shg_seed + interest_earned + chit_commission + donations_grants + other_income;

    // Other expenses = all vouchers not related to loans or chit payouts
    let total_vouchers: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
         WHERE txn_type = 'VOUCHER' AND created_at <= ?1",
        [&date_end], |r| r.get(0),
    ).unwrap_or(0.0);

    let loans_disbursed_txn: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
         WHERE txn_type = 'VOUCHER' AND reference_type = 'MEMBER_LOAN'
         AND created_at <= ?1",
        [&date_end], |r| r.get(0),
    ).unwrap_or(0.0);

    let chit_payouts_txn: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
         WHERE txn_type = 'VOUCHER' AND reference_type = 'CHIT_PAYOUT'
         AND created_at <= ?1",
        [&date_end], |r| r.get(0),
    ).unwrap_or(0.0);

    let other_expenses = (total_vouchers - loans_disbursed_txn - chit_payouts_txn).max(0.0);

    // ── Derived surplus ───────────────────────────────────────────────────
    // Two independent computations of surplus:
    //   1. Derived = total_assets − member_savings − chit_funds_held
    //      (what the SHG has beyond what it owes members + the chit pool)
    //   2. Independent = total_income − total_expenses (P&L since inception)
    // They should agree to within rounding. If they don't, something has
    // mutated assets without flowing through the income/expense ledger
    // (or vice versa) — a real integrity break that the user needs to see.
    let surplus_derived     = total_assets - member_savings - chit_funds_held;
    let surplus_independent = total_income - other_expenses;
    let total_liabilities_capital = member_savings + chit_funds_held + surplus_derived;
    let is_balanced = (surplus_derived - surplus_independent).abs() < 0.01;

    Ok(BalanceSheet {
        as_on_date: as_on_date.to_string(),
        cash_in_hand,
        cash_at_bank,
        loans_to_members,
        total_assets,
        member_savings,
        total_members_with_savings,
        chit_funds_held,
        surplus: surplus_derived,
        shg_seed,
        interest_earned,
        chit_commission,
        donations_grants,
        other_income,
        total_income,
        other_expenses,
        total_liabilities_capital,
        is_balanced,
    })
}
