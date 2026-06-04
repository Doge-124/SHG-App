//! Trial Balance — Receipts & Payments Account for a financial year.
//! Indian FY: April 1 (year) → March 31 (year + 1).
//!
//! The SHG opening balance set via Settings creates transactions with
//! txn_type = 'OPENING' (not 'RECEIPT'), so every query that sums
//! credit-side activity must include that type explicitly.

use rusqlite::Connection;
use serde::Serialize;
use chrono::Datelike;
use crate::error::AppError;

#[derive(Debug, Serialize)]
pub struct TrialBalance {
    pub financial_year: String,   // "2024-25"
    pub from_date: String,        // "2024-04-01"
    pub to_date: String,          // "2025-03-31"

    // ── Dr (Receipts) ──────────────────────────────────────────────────────
    pub opening_cash: f64,
    pub opening_bank: f64,
    pub shg_opening_seed: f64,        // OPENING txns that fell inside this FY period
    pub savings_contributions: f64,   // WEEKLY_CONTRIBUTION + MEMBER_CONTRIBUTION + MEMBER_RECEIPT
    pub loan_repayments: f64,         // MEMBER_PAYMENT receipts (real repayments only)
    pub upfront_loan_interest: f64,   // interest retained at disbursement (MEMBER_PAYMENT, reason 'Upfront…')
    pub chit_installments: f64,       // CHIT_PAYMENT
    pub chit_commission: f64,         // CHIT_COMMISSION
    pub grants_donations: f64,        // GRANT + DONATION
    pub other_receipts: f64,          // anything else received during period
    pub total_dr: f64,

    // ── Cr (Payments) ─────────────────────────────────────────────────────
    pub loans_disbursed: f64,         // MEMBER_LOAN vouchers (gross principal)
    pub savings_payouts: f64,         // SAVINGS_WITHDRAWAL vouchers
    pub chit_payouts: f64,            // CHIT_PAYOUT vouchers
    pub member_payments: f64,         // MEMBER_VOUCHER (payments to members / general expenses)
    pub other_payments: f64,          // remaining/uncategorised vouchers
    pub closing_cash: f64,            // derived: opening_cash + cash_in - cash_out
    pub closing_bank: f64,
    pub total_cr: f64,

    // ── Verification ──────────────────────────────────────────────────────
    pub outstanding_loans: f64,
    pub actual_cash_balance: f64,     // live shg_balances.CASH
    pub actual_bank_balance: f64,     // live shg_balances.BANK
    pub is_balanced: bool,
    pub cash_reconciled: bool,        // closing_cash == actual_cash_balance (current FY only)
    pub bank_reconciled: bool,
}

/// Returns the list of financial years that have any transaction data,
/// plus the current FY if not already included.
pub fn get_available_financial_years(conn: &Connection) -> Result<Vec<i32>, AppError> {
    let earliest: Option<String> = conn.query_row(
        "SELECT MIN(created_at) FROM shg_transactions",
        [], |row| row.get(0),
    ).unwrap_or(None);

    let today = chrono::Local::now().date_naive();
    let current_fy_start = if today.month() < 4 { today.year() - 1 } else { today.year() };

    let first_fy_start = if let Some(s) = earliest {
        let year: i32 = s[..4].parse().unwrap_or(current_fy_start);
        let month: u32 = s[5..7].parse().unwrap_or(1);
        if month < 4 { year - 1 } else { year }
    } else {
        current_fy_start
    };

    let mut years = Vec::new();
    let mut y = first_fy_start;
    while y <= current_fy_start {
        years.push(y);
        y += 1;
    }
    Ok(years)
}

/// Compute the Receipts & Payments Account for a given financial year.
pub fn get_trial_balance(conn: &Connection, financial_year: i32) -> Result<TrialBalance, AppError> {
    let from_date = format!("{}-04-01", financial_year);
    let to_dt     = format!("{}-03-31T23:59:59", financial_year + 1);
    let to_date   = format!("{}-03-31", financial_year + 1);

    // ── Opening balances: net of ALL credit/debit activity before this FY ──
    // txn_type='OPENING' is a credit (money the SHG starts with), same as RECEIPT.
    // txn_type='VOUCHER'  is a debit  (money paid out).
    // Any other unknown type is treated as a debit for safety.
    // Cancelled (voided) originals and their reversal rows are excluded from
    // every sum below so a reversed transaction never shows as a receipt or a
    // payment. The cancelled pair nets to zero, so balances still reconcile.
    let opening_cash: f64 = conn.query_row(
        "SELECT COALESCE(SUM(
             CASE WHEN txn_type IN ('RECEIPT','OPENING') THEN amount ELSE -amount END
         ), 0)
         FROM shg_transactions
         WHERE payment_method = 'CASH'
         AND voided_at IS NULL AND reversal_of_id IS NULL
         AND created_at < ?1",
        [&from_date], |r| r.get(0),
    ).unwrap_or(0.0);

    let opening_bank: f64 = conn.query_row(
        "SELECT COALESCE(SUM(
             CASE WHEN txn_type IN ('RECEIPT','OPENING') THEN amount ELSE -amount END
         ), 0)
         FROM shg_transactions
         WHERE payment_method = 'BANK'
         AND voided_at IS NULL AND reversal_of_id IS NULL
         AND created_at < ?1",
        [&from_date], |r| r.get(0),
    ).unwrap_or(0.0);

    // ── SHG seed entries that landed inside this FY ────────────────────────
    // These are the OPENING txns created by Settings → Data. If the user set up
    // the app in mid-year they appear as period receipts.
    let shg_opening_seed: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
         WHERE txn_type = 'OPENING'
         AND voided_at IS NULL AND reversal_of_id IS NULL
         AND created_at >= ?1 AND created_at <= ?2",
        [&from_date, &to_dt], |r| r.get(0),
    ).unwrap_or(0.0);

    // ── Period receipts by known category ─────────────────────────────────
    let receipt_by_types = |types: &str| -> f64 {
        conn.query_row(
            &format!(
                "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
                 WHERE txn_type = 'RECEIPT' AND reference_type IN ({types})
                 AND voided_at IS NULL AND reversal_of_id IS NULL
                 AND created_at >= ?1 AND created_at <= ?2"
            ),
            [&from_date, &to_dt], |r| r.get(0),
        ).unwrap_or(0.0)
    };

    let savings_contributions = receipt_by_types(
        "'WEEKLY_CONTRIBUTION','MEMBER_CONTRIBUTION','MEMBER_RECEIPT'"
    );
    // Loan-payment receipts split into the interest retained upfront at
    // disbursement (reason 'Upfront…') vs genuine later repayments, so a freshly
    // disbursed loan doesn't show a phantom "repayment".
    let upfront_loan_interest: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
         WHERE txn_type = 'RECEIPT' AND reference_type = 'MEMBER_PAYMENT'
         AND LOWER(reason) LIKE 'upfront%'
         AND voided_at IS NULL AND reversal_of_id IS NULL
         AND created_at >= ?1 AND created_at <= ?2",
        [&from_date, &to_dt], |r| r.get(0),
    ).unwrap_or(0.0);
    let loan_repayments: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
         WHERE txn_type = 'RECEIPT' AND reference_type = 'MEMBER_PAYMENT'
         AND LOWER(reason) NOT LIKE 'upfront%'
         AND voided_at IS NULL AND reversal_of_id IS NULL
         AND created_at >= ?1 AND created_at <= ?2",
        [&from_date, &to_dt], |r| r.get(0),
    ).unwrap_or(0.0);
    let chit_installments = receipt_by_types("'CHIT_PAYMENT'");
    let chit_commission   = receipt_by_types("'CHIT_COMMISSION'");
    let grants_donations  = receipt_by_types("'GRANT','DONATION'");

    let known_receipts = shg_opening_seed + savings_contributions + loan_repayments
        + upfront_loan_interest + chit_installments + chit_commission + grants_donations;

    // All credit activity during the period (RECEIPT + OPENING)
    let all_period_credits: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
         WHERE txn_type IN ('RECEIPT', 'OPENING')
         AND voided_at IS NULL AND reversal_of_id IS NULL
         AND created_at >= ?1 AND created_at <= ?2",
        [&from_date, &to_dt], |r| r.get(0),
    ).unwrap_or(0.0);

    let other_receipts = (all_period_credits - known_receipts).max(0.0);

    // ── Period payments by known category ─────────────────────────────────
    let voucher_by_types = |types: &str| -> f64 {
        conn.query_row(
            &format!(
                "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
                 WHERE txn_type = 'VOUCHER' AND reference_type IN ({types})
                 AND voided_at IS NULL AND reversal_of_id IS NULL
                 AND created_at >= ?1 AND created_at <= ?2"
            ),
            [&from_date, &to_dt], |r| r.get(0),
        ).unwrap_or(0.0)
    };

    let loans_disbursed = voucher_by_types("'MEMBER_LOAN'");
    let savings_payouts = voucher_by_types("'SAVINGS_WITHDRAWAL'");
    let chit_payouts    = voucher_by_types("'CHIT_PAYOUT'");
    let member_payments = voucher_by_types("'MEMBER_VOUCHER'");

    let all_period_vouchers: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
         WHERE txn_type = 'VOUCHER'
         AND voided_at IS NULL AND reversal_of_id IS NULL
         AND created_at >= ?1 AND created_at <= ?2",
        [&from_date, &to_dt], |r| r.get(0),
    ).unwrap_or(0.0);

    let other_payments =
        (all_period_vouchers - loans_disbursed - savings_payouts - chit_payouts - member_payments)
            .max(0.0);

    // ── Closing balances (derived) ─────────────────────────────────────────
    // period_cash_in includes OPENING txns (credit-side, CASH method)
    let period_cash_in: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
         WHERE txn_type IN ('RECEIPT', 'OPENING') AND payment_method = 'CASH'
         AND voided_at IS NULL AND reversal_of_id IS NULL
         AND created_at >= ?1 AND created_at <= ?2",
        [&from_date, &to_dt], |r| r.get(0),
    ).unwrap_or(0.0);

    let period_cash_out: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
         WHERE txn_type = 'VOUCHER' AND payment_method = 'CASH'
         AND voided_at IS NULL AND reversal_of_id IS NULL
         AND created_at >= ?1 AND created_at <= ?2",
        [&from_date, &to_dt], |r| r.get(0),
    ).unwrap_or(0.0);

    let period_bank_in: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
         WHERE txn_type IN ('RECEIPT', 'OPENING') AND payment_method = 'BANK'
         AND voided_at IS NULL AND reversal_of_id IS NULL
         AND created_at >= ?1 AND created_at <= ?2",
        [&from_date, &to_dt], |r| r.get(0),
    ).unwrap_or(0.0);

    let period_bank_out: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM shg_transactions
         WHERE txn_type = 'VOUCHER' AND payment_method = 'BANK'
         AND voided_at IS NULL AND reversal_of_id IS NULL
         AND created_at >= ?1 AND created_at <= ?2",
        [&from_date, &to_dt], |r| r.get(0),
    ).unwrap_or(0.0);

    let closing_cash = opening_cash + period_cash_in - period_cash_out;
    let closing_bank = opening_bank + period_bank_in - period_bank_out;

    // ── Totals ─────────────────────────────────────────────────────────────
    let total_dr = opening_cash + opening_bank
        + shg_opening_seed + savings_contributions + loan_repayments + upfront_loan_interest
        + chit_installments + chit_commission + grants_donations + other_receipts;

    let total_cr = loans_disbursed + savings_payouts + chit_payouts + member_payments
        + other_payments + closing_cash + closing_bank;

    // ── Live balances for reconciliation ──────────────────────────────────
    let actual_cash: f64 = conn.query_row(
        "SELECT COALESCE(balance, 0) FROM shg_balances WHERE method = 'CASH'",
        [], |r| r.get(0),
    ).unwrap_or(0.0);

    let actual_bank: f64 = conn.query_row(
        "SELECT COALESCE(balance, 0) FROM shg_balances WHERE method = 'BANK'",
        [], |r| r.get(0),
    ).unwrap_or(0.0);

    let outstanding_loans: f64 = conn.query_row(
        "SELECT COALESCE(SUM(outstanding_amount), 0) FROM loans WHERE status = 'active'",
        [], |r| r.get(0),
    ).unwrap_or(0.0);

    // Reconciliation only meaningful for the current FY
    let today = chrono::Local::now().date_naive();
    let current_fy_start = if today.month() < 4 { today.year() - 1 } else { today.year() };
    let is_current_fy = financial_year == current_fy_start;

    let cash_reconciled = !is_current_fy || (closing_cash - actual_cash).abs() < 0.01;
    let bank_reconciled = !is_current_fy || (closing_bank - actual_bank).abs() < 0.01;
    let is_balanced     = (total_dr - total_cr).abs() < 0.01;

    Ok(TrialBalance {
        financial_year: format!("{}-{:02}", financial_year, (financial_year + 1) % 100),
        from_date,
        to_date,
        opening_cash,
        opening_bank,
        shg_opening_seed,
        savings_contributions,
        loan_repayments,
        upfront_loan_interest,
        chit_installments,
        chit_commission,
        grants_donations,
        other_receipts,
        total_dr,
        loans_disbursed,
        savings_payouts,
        chit_payouts,
        member_payments,
        other_payments,
        closing_cash,
        closing_bank,
        total_cr,
        outstanding_loans,
        actual_cash_balance: actual_cash,
        actual_bank_balance: actual_bank,
        is_balanced,
        cash_reconciled,
        bank_reconciled,
    })
}
