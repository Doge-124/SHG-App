# Changelog

All notable changes to SHG Manager are tracked here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **Release build on GitHub Actions** — switched rusqlite feature from `bundled-sqlcipher` to `bundled-sqlcipher-vendored-openssl` so OpenSSL is vendored into the build. Without this, CI failed with `Missing environment variable OPENSSL_DIR` because the stock Windows runner has no OpenSSL on PATH. (No customer-visible behavior change — same encryption, same DB format.)

_Note: v1.0.1, v1.0.2 and v1.0.3 tags exist but produced no published GitHub Release (build failed for the above reason). v1.0.4 is the first version actually distributable to customers._

### Added (from v1.0.1/1.0.2/1.0.3 work)
- **Sentry crash reporting** (opt-in via Settings → Support):
  - Captures Rust panics + frontend errors automatically
  - PII scrubbing (10+ digit number runs replaced with `[REDACTED_PHONE]`); no IP/username sent
  - Installation ID attached as Sentry user.id for cross-event correlation
  - "Send Test Event" button to verify the pipeline
  - Graceful no-op when `SENTRY_DSN` is unset at build time
  - React `ErrorBoundary` shows a friendly fallback UI on render-time crashes
- Auto-updater via GitHub Releases (Tauri updater plugin with minisign signature verification)
- In-app **Support & Updates** panel in Settings:
  - Check for Updates (downloads + installs + restarts)
  - Export Logs (latest log file → user-chosen path)
  - Diagnostic Report (version, member/loan/chit counts, balances, log dir)
- Structured file logging via `tauri-plugin-log` (5 MB cap, keep-all rotation, written to `%APPDATA%\com.shg.manager\logs\`)
- Versioned database migration system (`schema_migrations` table, per-migration transactions, baselining of existing DBs)
- Pre-migration automatic backup (uses `VACUUM INTO`, written to `%APPDATA%\com.shg.manager\backups\`)
- Database integrity check (`PRAGMA integrity_check` + FK check + balance invariants + orphan detection) with severity-coded report
- Installation ID (UUID generated on first launch, persisted to `installation.json`) — included in diagnostic reports for support correlation
- Schema version display in diagnostic report
- GitHub Actions release workflow — push a `v*` tag → builds Windows installer → publishes GitHub Release with signed `latest.json`

### Changed
- `tauri.conf.json` now includes updater and log plugin configuration

## [1.0.57] - 2026-08-24

### Fixed
- **Chit payouts showed the wrong winner's name.** When a cycle had more than one winner, the Dashboard, the daily/weekly/monthly transaction reports, the Income Ledger and the bank transaction listing all displayed the *same* member against every payout in that cycle, because they identified the member from the cycle rather than from the payout itself. Chit commission entries showed no member name at all. Each entry is now named for the member it actually belongs to. **No money was affected** — payouts were always recorded against the correct member; only the displayed name was wrong, and the corrected names appear as soon as you update.
- The transaction reports could also show an unrelated member's name against a chit commission entry, for the same underlying reason.

## [1.0.56] - 2026-08-21

### Fixed
- **Cancelling one chit winner's payout unwound the whole cycle.** In a multi-winner cycle, cancelling a single payout voucher deleted *every* winner record and reversed *every* commission receipt, while reversing only the clicked payout. The other winners kept their money with no winner record, the group lost all of the cycle's commission income, and — because the winner records are what enforce one win per member — every winner in that cycle became eligible to win again and could be paid a second time. Cancelling now unwinds only the winner whose voucher was cancelled; everyone else keeps their payout, their commission, and their one-win lock. That winner's slot reopens so they can be re-paid.
- **Reversal entries named the wrong member.** Reversing entries did not carry over the member they belonged to, so chit payout and commission reversals fell back to reading the cycle number as a member number and displayed whichever member happened to share it. Reversals now keep their member, and reversal entries already recorded are repaired automatically on upgrade. Very old entries that never recorded a member show blank rather than a wrong name.

### Added
- **Chit winners can be paid one at a time.** Winners rarely all collect on the same day, but the payout screen previously required every winner to be entered before any payout could be recorded. Each winner — the fixed prize and every auction slot — now has its own **Record This Payout** button, and paid winners are shown as such with their amount and date. Recording everyone in one go is still available. A cycle now counts as complete only once every winner has been paid, so the next cycle cannot be started while a winner is still owed.

## [1.0.55] - 2026-08-19

### Fixed
- **Loan payoff could not be collected as a round rupee** — a payment more than half a paisa above the exact payoff was rejected as an overpayment, so a due of ₹50,718.78 could not be settled as ₹50,719. Payments up to ₹1 over the payoff are now accepted and close the loan, with the rounding excess booked as interest income. Principal is still capped at the outstanding amount, so the balance sheet and integrity check are unaffected. Overpayments beyond ₹1 are still rejected.

### Changed
- **Contributions — mixed (cash + bank) payments** are now available from the per-member quick-pay dialog, which previously offered only Cash or Bank. It now uses the same payment fields as the rest of the app, including the split amounts and the transfer/cheque reference.
- **Contributions — advance and top-up payments.** The per-member Record button no longer disappears once the week is marked paid; it stays available (reading "Add") so a member can pay several installments ahead or top up a short payment. Contributions are dated on the day they are entered.

## [1.0.0] - 2026-05-18

### Initial Release

- Member management (SHG / CHIT / LOAN types) with profiles, opening balances, past-data migration
- Weekly contribution tracking with paid/pending dashboard
- Loan issuance, repayment, interest accrual (upfront + daily on principal), weekly-loan fine after grace period
- Loan repayment schedule projection
- Configurable chit funds (W winners per cycle = 1 fixed + auction), eligibility tracking, auction discount distribution
- One-win-per-member enforcement across chit lifecycle
- Quick bulk past-data entry for chits
- Receipts and vouchers with PDF generation
- Cash Book, Bank Book, Day Book
- Trial Balance (Receipts & Payments Account)
- Income & Expenditure Account (with interest-earned formula)
- Balance Sheet (with FY-end snapshots)
- Member Passbook / Savings Ledger
- Audit log
- Encrypted database (SQLCipher)
- Past data lock, SHG opening balance, admin PIN reset via recovery
