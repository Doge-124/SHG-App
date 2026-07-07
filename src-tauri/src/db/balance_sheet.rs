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
    pub fixed_assets: f64,         // fixed-asset register, at cost (active assets)
    pub chit_advances: f64,        // net amount fronted to chit winners ahead of collections
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

    // Memo (informational, NOT added into totals — the net chit position above
    // already captures it): gross installments still owed by members for live
    // drawn cycles ("amount to be received").
    pub chit_installments_receivable: f64,

    // Memo (informational): estimated prize money still to be paid to members of
    // active chits who have not won yet ("money owed to people yet to win").
    pub chit_rewards_payable: f64,

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

    // Component-level reconciliation breakdown (diagnostic).
    pub recon: ReconDebug,
}

/// Every raw figure that feeds the two-way surplus reconciliation, so an
/// imbalance can be traced to the exact component. Surfaced in the UI when the
/// sheet doesn't reconcile.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconDebug {
    pub cash_in_hand: f64,
    pub cash_at_bank: f64,
    pub loans_to_members: f64,
    pub past_loans_capital: f64,
    pub fixed_assets: f64,
    pub chit_advances: f64,
    pub total_assets: f64,
    pub member_savings: f64,
    pub member_savings_receipts: f64,
    pub loan_repayment_receipts: f64,
    pub chit_installments_receipts: f64,     // CHIT_PAYMENT shg receipts (cash in)
    pub chit_installments_collected: f64,    // chit_payments table (live cycles) — should match
    pub savings_payouts_txn: f64,
    pub opening_member_liability: f64,
    pub chit_funds_held: f64,
    pub shg_seed_raw: f64,
    pub shg_capital: f64,
    pub interest_earned: f64,
    pub chit_commission: f64,
    pub donations_grants: f64,
    pub opening_asset_capital: f64,
    pub other_income: f64,
    pub total_income: f64,
    pub total_vouchers: f64,
    pub loans_disbursed_txn: f64,
    pub chit_payouts_txn: f64,
    pub asset_purchase_txn: f64,
    pub disposed_asset_cost: f64,
    pub other_expenses: f64,
    pub total_receipts: f64,
    pub surplus_derived: f64,
    pub surplus_independent: f64,
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

    // ORIGINAL principal of PAST-DATA (reference-only) loans. These loans were
    // disbursed before the app, so the cash going out never hit the SHG ledger — it
    // is baked into the opening seed. The full original principal is therefore part
    // of the SHG's opening net worth (an opening receivable), and must be added to
    // opening capital on the income side to keep the two-way reconciliation intact.
    // We use the OPENING receivable — original principal minus any principal that was
    // already repaid via reference-data (is_past_entry) payments before the app — not
    // the current outstanding. As the past loan is repaid LIVE the receivable simply
    // converts to cash (net worth unchanged), so this must stay constant; the live
    // interest is recognised separately as income. Using the current outstanding would
    // drop the capital as it's repaid while the recovered cash stays in assets.
    let past_loans_capital: f64 = conn.query_row(
        "SELECT COALESCE(SUM(l.amount), 0)
                - COALESCE((
                    SELECT SUM(lp.principal_amount) FROM loan_payments lp
                    JOIN loans l2 ON l2.id = lp.loan_id
                    WHERE COALESCE(l2.is_past_entry, 0) = 1
                      AND COALESCE(lp.is_past_entry, 0) = 1
                      AND lp.created_at <= ?1
                ), 0)
         FROM loans l
         WHERE l.issued_at <= ?1 AND COALESCE(l.is_past_entry, 0) = 1",
        [&date_end], |r| r.get(0),
    ).unwrap_or(0.0);

    // ── Fixed assets (register, at cost) as of date ───────────────────────
    // An asset counts as held on `date` if acquired by then and not yet disposed
    // by then. This mirrors cash/loans converting into a fixed asset: a cash/bank
    // purchase reduces cash (ASSET_PURCHASE voucher) and adds here, net zero.
    let fixed_assets: f64 = conn.query_row(
        "SELECT COALESCE(SUM(cost), 0) FROM assets
         WHERE purchase_date <= ?1
           AND (status = 'ACTIVE' OR disposed_at > ?1)",
        [&date_end], |r| r.get(0),
    ).unwrap_or(0.0);

    // total_assets is finalised after the chit position below (an ongoing chit can
    // be a net asset when the SHG has fronted early winners more than it collected).

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
    // = live installments collected through chit_payments
    // − payouts disbursed via CHIT_PAYOUT vouchers.
    // PAST-DATA cycles are reference-only: they create no real cash receipts and
    // no payout vouchers, and the SHG's historical position is already captured
    // in the opening balance. Counting their installments here would inflate the
    // liability with money the SHG doesn't actually hold, throwing the surplus
    // wildly negative — so exclude past cycles. Voided rows are excluded too.
    let chit_installments_collected: f64 = conn.query_row(
        "SELECT COALESCE(SUM(cp.amount), 0)
         FROM chit_payments cp
         JOIN chit_cycles cc ON cc.id = cp.cycle_id
         WHERE COALESCE(cc.is_past_entry, 0) = 0
           AND cp.paid_at <= ?1",
        [&date_end], |r| r.get(0),
    ).unwrap_or(0.0);

    let chit_payouts_disbursed: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
         WHERE txn_type = 'VOUCHER' AND reference_type = 'CHIT_PAYOUT'
           AND voided_at IS NULL AND reversal_of_id IS NULL
           AND created_at <= ?1",
        [&date_end], |r| r.get(0),
    ).unwrap_or(0.0);

    // Net chit position. Positive = the SHG is holding pooled installments it still
    // owes the chit (a LIABILITY). Negative = it has paid early winners more than it
    // has collected, so members' future installments will repay it (an ASSET). We do
    // NOT clamp: clamping the negative case to zero hid ongoing chits and broke the
    // Assets = Liabilities + Capital reconciliation.
    let chit_net = chit_installments_collected - chit_payouts_disbursed;
    let chit_funds_held = chit_net.max(0.0);      // liability side
    let chit_advances = (-chit_net).max(0.0);     // asset side (receivable from the chit)

    let total_assets =
        cash_in_hand + cash_at_bank + loans_to_members + fixed_assets + chit_advances;

    // Gross arrears (memo only — do NOT add to total_assets; the net chit position
    // above already reflects it): installments members still owe for live drawn cycles.
    let chit_installments_receivable =
        crate::db::chits::get_total_chit_receivable(conn).unwrap_or(0.0);
    let chit_rewards_payable =
        crate::db::chits::get_total_chit_rewards_payable(conn).unwrap_or(0.0);

    // ── Surplus breakdown ─────────────────────────────────────────────────
    // SHG seed (OPENING type in shg_transactions — set via Settings)
    let shg_seed: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
         WHERE txn_type = 'OPENING'
         AND voided_at IS NULL AND reversal_of_id IS NULL
         AND created_at <= ?1",
        [&date_end], |r| r.get(0),
    ).unwrap_or(0.0);

    // Chit commission
    let chit_commission: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
         WHERE txn_type = 'RECEIPT' AND reference_type = 'CHIT_COMMISSION'
         AND voided_at IS NULL AND reversal_of_id IS NULL
         AND created_at <= ?1",
        [&date_end], |r| r.get(0),
    ).unwrap_or(0.0);

    // Donations & grants
    let donations_grants: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
         WHERE txn_type = 'RECEIPT' AND reference_type IN ('DONATION', 'GRANT')
         AND voided_at IS NULL AND reversal_of_id IS NULL
         AND created_at <= ?1",
        [&date_end], |r| r.get(0),
    ).unwrap_or(0.0);

    // Interest earned = sum of the interest portion of every loan payment.
    // This is now stored explicitly per row (see loans.rs); we no longer derive
    // it from the difference between outstanding and disbursed, which was
    // tautologically zero under the old gross-payment formula.
    // Past-data (reference-only) repayments are excluded — their interest was
    // earned before the app and must not count as SHG income.
    let interest_earned: f64 = conn.query_row(
        "SELECT COALESCE(SUM(interest_amount), 0) FROM loan_payments
         WHERE COALESCE(is_past_entry, 0) = 0 AND created_at <= ?1",
        [&date_end], |r| r.get(0),
    ).unwrap_or(0.0);

    // Other income: any RECEIPT not already categorised above
    let total_receipts: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
         WHERE txn_type IN ('RECEIPT', 'OPENING')
         AND voided_at IS NULL AND reversal_of_id IS NULL
         AND created_at <= ?1",
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
         AND voided_at IS NULL AND reversal_of_id IS NULL
         AND created_at <= ?1",
        [&date_end], |r| r.get(0),
    ).unwrap_or(0.0);

    let chit_installments: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
         WHERE txn_type = 'RECEIPT' AND reference_type = 'CHIT_PAYMENT'
         AND voided_at IS NULL AND reversal_of_id IS NULL
         AND created_at <= ?1",
        [&date_end], |r| r.get(0),
    ).unwrap_or(0.0);

    // Loan repayments (MEMBER_PAYMENT) include both principal and interest;
    // only interest is SHG income — principal is already captured above.
    let loan_repayment_receipts: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
         WHERE txn_type = 'RECEIPT' AND reference_type = 'MEMBER_PAYMENT'
         AND voided_at IS NULL AND reversal_of_id IS NULL
         AND created_at <= ?1",
        [&date_end], |r| r.get(0),
    ).unwrap_or(0.0);

    // Opening assets (already owned before the app) add to the SHG's capital: they
    // increase fixed_assets with no offsetting cash movement, so mirror their cost
    // on the income/capital side to keep the sheet balanced. Folded into other_income
    // so the surplus breakdown still sums to total_income.
    let opening_asset_capital: f64 = conn.query_row(
        "SELECT COALESCE(SUM(cost), 0) FROM assets
         WHERE is_opening = 1 AND purchase_date <= ?1
           AND (status = 'ACTIVE' OR disposed_at > ?1)",
        [&date_end], |r| r.get(0),
    ).unwrap_or(0.0);

    let pass_through = member_savings_receipts + chit_installments + loan_repayment_receipts;
    let other_income = (total_receipts - shg_seed - pass_through - chit_commission - donations_grants).max(0.0)
        + opening_asset_capital;

    // Other expenses = all vouchers that are genuine expenses — NOT loan
    // disbursements, chit payouts, or savings payouts. A savings payout
    // (SAVINGS_WITHDRAWAL) returns a member their own savings: it reduces both
    // cash (asset) and member savings (liability), so counting it as an expense
    // would understate surplus and break the two-way surplus reconciliation.
    let total_vouchers: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
         WHERE txn_type = 'VOUCHER'
         AND voided_at IS NULL AND reversal_of_id IS NULL
         AND created_at <= ?1",
        [&date_end], |r| r.get(0),
    ).unwrap_or(0.0);

    let loans_disbursed_txn: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
         WHERE txn_type = 'VOUCHER' AND reference_type = 'MEMBER_LOAN'
         AND voided_at IS NULL AND reversal_of_id IS NULL
         AND created_at <= ?1",
        [&date_end], |r| r.get(0),
    ).unwrap_or(0.0);

    let chit_payouts_txn: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
         WHERE txn_type = 'VOUCHER' AND reference_type = 'CHIT_PAYOUT'
         AND voided_at IS NULL AND reversal_of_id IS NULL
         AND created_at <= ?1",
        [&date_end], |r| r.get(0),
    ).unwrap_or(0.0);

    let savings_payouts_txn: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
         WHERE txn_type = 'VOUCHER' AND reference_type = 'SAVINGS_WITHDRAWAL'
         AND voided_at IS NULL AND reversal_of_id IS NULL
         AND created_at <= ?1",
        [&date_end], |r| r.get(0),
    ).unwrap_or(0.0);

    // Asset purchases are capital expenditure (cash → fixed asset), NOT an
    // income-statement expense, so exclude them from other_expenses.
    let asset_purchase_txn: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
         WHERE txn_type = 'VOUCHER' AND reference_type = 'ASSET_PURCHASE'
         AND voided_at IS NULL AND reversal_of_id IS NULL
         AND created_at <= ?1",
        [&date_end], |r| r.get(0),
    ).unwrap_or(0.0);

    // When a PURCHASED asset is disposed, its cost leaves the asset side while the
    // sale proceeds arrive as income. Recognise the written-off cost as a loss so
    // the net P&L impact is the gain/loss (proceeds − cost). Opening assets need no
    // such correction — their capital term simply drops when they go inactive.
    let disposed_asset_cost: f64 = conn.query_row(
        "SELECT COALESCE(SUM(cost), 0) FROM assets
         WHERE status = 'DISPOSED' AND is_opening = 0 AND disposed_at <= ?1",
        [&date_end], |r| r.get(0),
    ).unwrap_or(0.0);

    let other_expenses =
        (total_vouchers - loans_disbursed_txn - chit_payouts_txn - savings_payouts_txn
            - asset_purchase_txn).max(0.0)
        + disposed_asset_cost;

    // ── SHG opening capital (income/capital side) ─────────────────────────
    // The opening seed is opening CASH. But the SHG's true opening net worth also
    // includes past-data positions that never touched the cash ledger:
    //   + past loans outstanding (a receivable, cash lent out before the app)
    //   − members' opening savings still owed (a liability inside the seed cash)
    // Member savings owed from before the app = member_savings minus the LIVE member
    // cash flows (contributions received − live payouts made). Computing it this way
    // (rather than from the raw OPENING sum) automatically nets out past member
    // payouts, so the reconciliation holds for every past-data combination.
    let opening_member_liability =
        member_savings - member_savings_receipts + savings_payouts_txn;
    let shg_capital = shg_seed - opening_member_liability + past_loans_capital;
    let total_income = shg_capital + interest_earned + chit_commission + donations_grants + other_income;

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
        fixed_assets,
        chit_advances,
        total_assets,
        member_savings,
        total_members_with_savings,
        chit_funds_held,
        chit_installments_receivable,
        chit_rewards_payable,
        surplus: surplus_derived,
        shg_seed: shg_capital,
        interest_earned,
        chit_commission,
        donations_grants,
        other_income,
        total_income,
        other_expenses,
        total_liabilities_capital,
        is_balanced,
        recon: ReconDebug {
            cash_in_hand,
            cash_at_bank,
            loans_to_members,
            past_loans_capital,
            fixed_assets,
            chit_advances,
            total_assets,
            member_savings,
            member_savings_receipts,
            loan_repayment_receipts,
            chit_installments_receipts: chit_installments,
            chit_installments_collected,
            savings_payouts_txn,
            opening_member_liability,
            chit_funds_held,
            shg_seed_raw: shg_seed,
            shg_capital,
            interest_earned,
            chit_commission,
            donations_grants,
            opening_asset_capital,
            other_income,
            total_income,
            total_vouchers,
            loans_disbursed_txn,
            chit_payouts_txn,
            asset_purchase_txn,
            disposed_asset_cost,
            total_receipts,
            other_expenses,
            surplus_derived,
            surplus_independent,
        },
    })
}
