//! Balance Sheet — snapshot of Assets vs Liabilities & Capital.
//! Supports any "as on" date so year-end sheets (March 31) work correctly.
//!
//! Assets   = Cash + Bank + Loans Outstanding + Chit Dues Receivable + Fixed Assets
//! Liabilities & Capital = Member Savings + Chit Dues Payable + SHG Surplus
//!
//! Chits are shown as two accrual positions that move every cycle (see
//! `chits::get_chit_member_positions`): `chit_receivable` (winners still repaying
//! — an asset) and `chit_payable` (members who have paid in but not yet won — a
//! liability the SHG owes them). Both settle to ~zero once a chit completes. The
//! chit cash the SHG actually holds is already inside Cash/Bank via the ledger, and
//! the identity `cash_held + chit_receivable = chit_payable + chit_commission`
//! keeps the two-way surplus reconciliation intact.

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
    // Chit dues RECEIVABLE — members who have won but are still repaying their
    // installments over the remaining cycles owe the SHG. Shrinks each cycle.
    pub chit_receivable: f64,
    pub total_assets: f64,

    // ── Liabilities: Member Savings ───────────────────────────────────────
    pub member_savings: f64,       // total savings the SHG holds for members
    pub total_members_with_savings: i64,

    // ── Liabilities: Chit Dues Payable ────────────────────────────────────
    // Members who have paid into a chit but have NOT yet won: the SHG owes them
    // what they have contributed so far. Grows as they keep paying, and nets to
    // ~zero once every member has won and the chit completes.
    pub chit_payable: f64,

    // ── Capital: SHG Surplus (= Total Assets − Member Savings − Chit Payable) ─
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
    pub chit_receivable: f64,                // asset — winners still repaying
    pub total_assets: f64,
    pub member_savings: f64,
    pub member_savings_receipts: f64,
    pub loan_repayment_receipts: f64,
    pub chit_installments_receipts: f64,     // CHIT_PAYMENT shg receipts (cash in)
    pub savings_payouts_txn: f64,
    pub opening_member_liability: f64,
    pub chit_payable: f64,                   // liability — members yet to win (incl. dividend)
    pub chit_payable_accrual: f64,           // members-yet-to-win component (pre-dividend)
    pub chit_dividend_payable: f64,          // undistributed auction dividend component
    pub chit_declared_live: f64,             // Σ live winners' bid discount
    pub chit_consumed_live: f64,             // Σ live payment shortfalls below monthly
    pub chit_live_cash: f64,                 // raw Σ chit_payments.amount (live) — cf. receipts
    pub chit_live_winner_gross: f64,         // Σ gross debited to live-cycle winners — cf. chit_payouts_txn
    pub chit_past_winner_gross: f64,         // Σ gross debited to past-cycle winners
    pub chit_live_winner_count: f64,         // number of live-cycle winners
    pub chit_opening_capital: f64,           // past-data chit net folded into capital
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

    // ── Chit member positions (accrual) ───────────────────────────────────
    // A proper chit statement shows two real, member-level positions that move
    // every cycle (the closed form of the chit passbook balance):
    //   • chit_payable   (LIABILITY) — members who have paid in but NOT yet won;
    //     the SHG owes them what they have paid so far. Grows as they keep paying.
    //   • chit_receivable (ASSET)     — members who HAVE won but are still repaying
    //     over the remaining cycles; they owe the SHG. Shrinks each cycle.
    // PAST-DATA cycles carry no ledger cash (it sits in the opening balance), so
    // their net effect is folded into chit_opening_capital below — mirroring the
    // past-loan / member-opening opening-capital adjustments — which keeps the
    // Assets = Liabilities + Capital reconciliation intact.
    let chit_pos = crate::db::chits::get_chit_member_positions(conn, &date_end)
        .unwrap_or_default();
    // The undistributed auction dividend is money the SHG holds on the members'
    // behalf between a winner's bid and the next cycle's reduced contributions, so
    // it belongs on the liability side alongside the members' accrued contributions.
    let chit_dividend_payable = chit_pos.dividend_payable;
    let chit_payable_accrual = chit_pos.payable;                   // members yet to win
    let chit_payable = chit_payable_accrual + chit_dividend_payable; // liability side
    let chit_receivable = chit_pos.receivable;                     // asset side
    let chit_opening_capital = chit_pos.opening_capital;
    let chit_declared_live = chit_pos.declared_live;
    let chit_consumed_live = chit_pos.consumed_live;
    let chit_live_cash = chit_pos.live_cash;
    let chit_live_winner_gross = chit_pos.live_winner_gross;
    let chit_past_winner_gross = chit_pos.past_winner_gross;
    let chit_live_winner_count = chit_pos.live_winner_count as f64;

    let total_assets =
        cash_in_hand + cash_at_bank + loans_to_members + fixed_assets + chit_receivable;

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
    // chit_opening_capital: net effect of past-data chit cycles (whose cash lives in
    // the opening balance, not the ledger). Folding it into opening capital keeps the
    // accrual chit_payable / chit_receivable consistent with the two-way surplus check.
    let shg_capital =
        shg_seed - opening_member_liability + past_loans_capital + chit_opening_capital;
    let total_income = shg_capital + interest_earned + chit_commission + donations_grants + other_income;

    // ── Derived surplus ───────────────────────────────────────────────────
    // Two independent computations of surplus:
    //   1. Derived = total_assets − member_savings − chit_payable
    //      (what the SHG has beyond what it owes members + chit dues payable)
    //   2. Independent = total_income − total_expenses (P&L since inception)
    // They should agree to within rounding. If they don't, something has
    // mutated assets without flowing through the income/expense ledger
    // (or vice versa) — a real integrity break that the user needs to see.
    let surplus_derived     = total_assets - member_savings - chit_payable;
    let surplus_independent = total_income - other_expenses;
    let total_liabilities_capital = member_savings + chit_payable + surplus_derived;
    let is_balanced = (surplus_derived - surplus_independent).abs() < 0.01;

    Ok(BalanceSheet {
        as_on_date: as_on_date.to_string(),
        cash_in_hand,
        cash_at_bank,
        loans_to_members,
        fixed_assets,
        chit_receivable,
        total_assets,
        member_savings,
        total_members_with_savings,
        chit_payable,
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
            chit_receivable,
            total_assets,
            member_savings,
            member_savings_receipts,
            loan_repayment_receipts,
            chit_installments_receipts: chit_installments,
            savings_payouts_txn,
            opening_member_liability,
            chit_payable,
            chit_payable_accrual,
            chit_dividend_payable,
            chit_declared_live,
            chit_consumed_live,
            chit_live_cash,
            chit_live_winner_gross,
            chit_past_winner_gross,
            chit_live_winner_count,
            chit_opening_capital,
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
