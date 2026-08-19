# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SHG Manager — an offline-first Windows desktop app (Tauri 2) for Indian Self Help Groups / microfinance groups. It does member management, weekly savings contributions, loans, chit funds, and produces the statutory reports an auditor asks for (Trial Balance, Income & Expenditure, Balance Sheet, Cash/Bank/Day Book, ledgers, passbooks). Commercially licensed; shipped to customers as a signed Windows installer via GitHub Releases with auto-update.

All customer data lives in a **SQLCipher-encrypted SQLite file** on the user's machine. There is no cloud database for customer data.

## Repo layout — read this before navigating

| Path | Role |
|---|---|
| `frontend/` | **The actual UI.** Next.js 16 static export (`output: 'export'` → `frontend/out`), React 19, Tailwind 4, shadcn/Radix |
| `src-tauri/` | **The actual backend.** ~19k lines of Rust: all business logic, all SQL, all money math |
| `backend/` | Cloudflare Worker + D1. Licensing, telemetry, version policy, remote support. **Not** part of the desktop app |
| `src/`, `index.html`, `vite.config.ts`, root `README.md` | **Dead leftover Vite scaffold.** Ignore it. The root README is the stock Vite template and describes nothing in this project. `tauri.conf.json` points at `frontend/`, not `src/` |
| `debug-*.js`, `test-*.js`, `final-test-report.md` | Stale one-off harnesses from early development. Not a test suite |

## Commands

Run from `shg-manager/` unless noted.

```powershell
npm run tauri dev        # full app (starts Next dev server on :3000, then Tauri)
npm run tauri build      # production installer

# Verification — these two are the de-facto CI gate; release.ps1 runs both
cd src-tauri; cargo check
cd frontend;  npx tsc --noEmit

cd frontend; npm run build   # static export only, no Rust
npm run tauri:clean          # cargo clean when Rust builds go weird
```

Backend Worker (`backend/`):

```powershell
npm run dev                  # wrangler dev on :8787
npm run deploy
npm run db:migrate:remote    # applies schema.sql to D1
```

**Testing:** there is no test runner. Rust has `#[cfg(test)]` blocks in only two files (`db/daybook.rs`, `version_policy.rs`) — run them with `cd src-tauri; cargo test`. `db/test_helpers.rs` is a set of manual scenario helpers, not tests. Verification in practice means `cargo check` + `npx tsc --noEmit` + exercising the flow in a dev build.

**Caveat:** `frontend/next.config.mjs` sets `typescript: { ignoreBuildErrors: true }`. A green `npm run build` does **not** mean the types are clean — always run `npx tsc --noEmit` separately.

## Architecture

### The one boundary that matters

The frontend never touches the database. Every operation is `invoke('command_name', {...})` from `@tauri-apps/api/core` into a Rust command. Adding a feature that touches data means all three of:

1. `src-tauri/src/db/<area>.rs` — the SQL and the money math
2. `src-tauri/src/commands/<area>.rs` — a `#[tauri::command]` wrapper returning `Result<T, String>` (map `AppError` via `.map_err(|e: AppError| e.to_string())`)
3. Registering it in the `invoke_handler![...]` list in `src-tauri/src/main.rs` — **easy to forget; the command silently doesn't exist without it**

Frontend call sites are wrapped in `frontend/lib/api/*.ts`, which return `ApiResponse<T>` (`{success, data?, error?}`) and swallow errors into `success: false`.

`AppState` (`src-tauri/src/state.rs`) is a `Mutex<AppState>` holding the open `Connection`, the hex DB key, and any startup integrity warning. Commands lock it and take `guard.db.as_mut()`; `None` means the DB isn't unlocked yet.

Serde naming is **inconsistent** — some structs use `#[serde(rename_all = "camelCase")]`, most don't. Check the specific struct before assuming a field name on the TypeScript side.

### Startup gate chain

`frontend/app/layout.tsx` nests: Sentry → Appearance → **VersionGate** → **LicenseGate** → **AuthLayout** → AppLayout.

- **VersionGate** — asks the Worker for `min_supported_version`; fails **open** (unreachable server or unset minimum ⇒ allowed). Never lock customers out on a flaky network.
- **LicenseGate** — key format `SHG-XXXX-XXXX-XXXX-XXXX`, bound server-side to an installation ID, cached in `license.json` with a **7-day offline grace**.
- **AuthLayout** — the user's PIN is Argon2-derived into the SQLCipher key. No PIN, no readable database. Salt lives in `data/security.json`. There is a master-password recovery path. On unlock it fires the support inbox, a due cloud backup, and surfaces any integrity warning.

App data lives under `%APPDATA%\com.shg.manager\` — `data/shg.db`, `data/security.json`, `license.json`, `installation.json`, `backups/`, `logs/`.

### The financial model

Everything reduces to one ledger table. `shg_transactions` rows are `RECEIPT | VOUCHER | OPENING` against `CASH | BANK`, and `shg_balances` holds the running cash/bank balance. **All reports are derived views over this ledger** — Trial Balance, Balance Sheet, Income & Expenditure, Day/Cash/Bank Book, general and income ledgers. If a new flow moves money, it must go through `db/ledger.rs` (`record_receipt*` / `record_voucher*`) so balances and reports stay consistent. There are `_mixed` variants that split one logical transaction across cash and bank using a shared `group_id` — MIXED payments are common and cancellation/reversal must handle both halves.

Members carry a **comma-separated role set** in `members.member_type` — `SHG`, `CHIT`, `LOAN` (e.g. `"CHIT,LOAN"`), validated in code, not by a CHECK constraint. Roles gate capability: `db/members.rs::roles_allow_loan` decides who may borrow.

Two subsystems carry most of the domain complexity:

- **Loans** (`db/loans.rs`) — interest is collected **upfront at disbursement as income, and does not reduce principal**. Monthly loans are open-ended with 30 days upfront; weekly loans have a 120-day term with the whole term's interest upfront, **no grace period**, daily interest from day 121, and a daily fine past term computed at repayment time. The borrower receives `amount − upfront_interest` in hand, but owes the full `amount`.
- **Chits** (`db/chits.rs`, 2000+ lines) — configurable groups with N winners per cycle (1 fixed prize + auction), bid discounts redistributed to members, one-win-per-member enforced across the lifecycle, eligibility overrides, bulk past-data entry, and a closing settlement paying out members who never won.

Groups migrating from paper books enter historical data through dedicated "past entry" paths (`db/chits_past_entry.rs`, `record_past_loan`, member opening balances), which can then be **locked** via the past-data lock in Settings. `db/past_edit.rs` and `db/cancel.rs` handle corrections and reversals after the fact.

### Schema changes

`db/schema.rs` holds `SCHEMA_SQL` (fresh installs) plus a legacy idempotent `apply_migrations` that runs on every open. That legacy path is **baseline version 1** and is frozen — do not add to it.

New schema changes go in `db/migrations.rs` as a `Migration` entry with the next version number and bump `CURRENT_SCHEMA_VERSION`. Rules enforced by the system: never edit an applied migration, each runs in its own transaction, and a `VACUUM INTO` backup is taken before any pending migration runs. `MIGRATIONS` is currently empty — yours would be version 2.

Every customer DB in the field is real money data with no server-side copy. Migrations are one-way and unattended.

## Releasing

`.\scripts\release.ps1 -Version X.Y.Z` (flags: `-DryRun`, `-SkipChecks`, `-Force`). It validates the workflow YAML, bumps the version in `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, root `package.json`, and `frontend/package.json`, runs `cargo check` + `tsc --noEmit`, commits, tags `vX.Y.Z`, and pushes. The tag triggers `.github/workflows/release.yml`, which builds the Windows installer, signs it with the minisign key, and publishes a GitHub Release with `latest.json` for the auto-updater.

Full runbook including the Sentry DSN and signing-key setup is in `RELEASE.md`. Update `CHANGELOG.md` before releasing.

Build-time secrets read via `option_env!`: `TELEMETRY_ENDPOINT_URL` (Worker base URL — gates telemetry, licensing, version policy, and support inbox; absent ⇒ all no-op) and `SENTRY_DSN` (absent ⇒ crash reporting no-ops).
