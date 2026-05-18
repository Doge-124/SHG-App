# Changelog

All notable changes to SHG Manager are tracked here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Changes since v1.0.0 that haven't been released yet — move these into a new version section when releasing._

### Added
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
