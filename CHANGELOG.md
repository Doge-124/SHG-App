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
