# Release Runbook

How to ship an update to all customers. Total time per release: ~15 minutes (mostly waiting for CI).

---

## Prerequisites (one-time, already done)

- [x] Signing keypair generated; public key in `src-tauri/tauri.conf.json`
- [x] `TAURI_SIGNING_PRIVATE_KEY` GitHub Actions secret set
- [x] `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` GitHub Actions secret set
- [x] GitHub Actions workflow at `.github/workflows/release.yml`
- [ ] (Optional) `SENTRY_DSN` GitHub Actions secret set — see Sentry section below

---

## Standard release flow

### 1. Make the change

Either:
- Hand the request to Claude ("fix X", "add Y"), let it write the code and run compile checks, OR
- Make the change yourself and run `cargo check` + `npx tsc --noEmit` in the frontend

### 2. If the schema changed → add a migration

Edit `src-tauri/src/db/migrations.rs` and append to `MIGRATIONS`:

```rust
Migration {
    version: 2,                              // next version (was 1)
    name: "add_member_email_column",
    up: m002_add_member_email_column,
},
```

Then define the migration function:

```rust
fn m002_add_member_email_column(tx: &Transaction) -> Result<(), AppError> {
    tx.execute_batch("ALTER TABLE members ADD COLUMN email TEXT")?;
    Ok(())
}
```

**Rules:**
- Never edit an existing migration — always add a new one.
- Each migration runs in its own transaction; on failure it rolls back AND the pre-migration backup is preserved.
- Test locally by reverting your local DB to a backup or building fresh.

### 3. Update `CHANGELOG.md`

Move items from `[Unreleased]` into a new version section, dated today.

### 4. Run the release script

```powershell
.\scripts\release.ps1 -Version 1.0.1
```

The script will:
1. Validate the version format
2. Check the working tree is clean (or warn)
3. Update version in `Cargo.toml` and `tauri.conf.json`
4. Run `cargo check` and `tsc --noEmit`
5. Show you the diff
6. Ask "Proceed?" — last chance to abort
7. Commit `chore: release v1.0.1`
8. Create annotated tag `v1.0.1`
9. Push commit and tag

### 5. Wait for CI

- GitHub Actions starts within ~30 seconds of the tag push
- Build takes ~5-10 minutes (Rust compile is the slow part)
- Watch progress: https://github.com/Doge-124/SHG-App/actions

### 6. Verify the release

When CI finishes:
- Go to https://github.com/Doge-124/SHG-App/releases
- Confirm the release shows:
  - The installer (`SHG Manager_1.0.1_x64-setup.exe`)
  - The MSI (`SHG Manager_1.0.1_x64_en-US.msi`)
  - `latest.json` (signature manifest)
- Customers will see the update prompt on their next app launch

---

## Version numbering (semver)

| Change | Bump |
|---|---|
| Fix a bug, no new features, no schema changes | **PATCH** (1.0.0 → 1.0.1) |
| New feature, possibly new migration, backwards compatible | **MINOR** (1.0.0 → 1.1.0) |
| Breaking change (rare for an app) | **MAJOR** (1.0.0 → 2.0.0) |

---

## Hotfix flow (urgent fix going out fast)

Same as standard release but:
1. Make the fix on `main` directly (it's a small team — branching adds friction with no benefit)
2. Bump only the PATCH version
3. Run the release script
4. Tell customers via your usual channel (WhatsApp/email) that an update is rolling out

---

## Rollback (if a release breaks something)

If a release goes out broken:

### Option A: Push a new fix immediately

Most often the right answer. Fix the bug → bump to next patch → release. Customers update again.

### Option B: Tell customers to roll back

1. Delete or unpublish the bad release on GitHub
2. The most recent remaining release becomes `latest`
3. Anyone who already updated → they have the bad version installed and need to manually download the old installer from GitHub Releases and reinstall
4. **Their data is safe** — the pre-migration backup is in `%APPDATA%\com.shg.manager\backups\`

### Option C: For a broken migration specifically

If migration v3 breaks data:
1. Don't try to "undo" the migration. Write a new migration v4 that fixes the broken state.
2. Release v1.x.x with migration v4.
3. Customers' migration v4 runs on top of broken v3 state and corrects it.

---

## Diagnosing a customer issue

1. Ask customer to: **Settings → Support & Updates → Generate Report**, then send the file
2. The report includes:
   - Installation ID (correlate across tickets)
   - Schema version (do they have your latest fix?)
   - DB stats (does the issue make sense given their data?)
   - OS / arch
3. If you need more: ask them to **Export Logs** and send that too
4. If integrity is suspect: ask them to **Run Integrity Check** and screenshot the result
5. If nothing else works: they have an auto-generated backup at `%APPDATA%\com.shg.manager\backups\` — guide them to restore via Settings → Data

---

## Where customer data lives (for support)

| What | Where |
|---|---|
| Encrypted database | `%APPDATA%\com.shg.manager\data\shg.db` |
| Security file (PIN salt + recovery) | `%APPDATA%\com.shg.manager\data\security.json` |
| Installation ID | `%APPDATA%\com.shg.manager\installation.json` |
| Log files | `%APPDATA%\com.shg.manager\logs\` |
| Automatic & manual backups | `%APPDATA%\com.shg.manager\backups\` |

---

## Emergency contacts (fill in)

- **GitHub repo:** https://github.com/Doge-124/SHG-App
- **Latest releases:** https://github.com/Doge-124/SHG-App/releases
- **CI workflow runs:** https://github.com/Doge-124/SHG-App/actions
- **Sentry project (errors):** https://sentry.io/organizations/<your-org>/projects/shg-manager/

---

## Sentry crash reporting setup (one-time)

The app is wired for Sentry but inert until a DSN is configured. To activate:

### 1. Create the Sentry project

1. Sign up at https://sentry.io (free tier: 5k events/month — plenty for a few customers)
2. Create a new project → choose "React" as the platform (we'll use the same DSN for Rust)
3. Copy the **DSN** (looks like `https://abc123@o12345.ingest.sentry.io/67890`)

### 2. Add the DSN as a GitHub secret

- Repo → Settings → Secrets and variables → Actions
- New repository secret:
  - Name: `SENTRY_DSN`
  - Value: paste the DSN

### 3. Ship a release

Next time you run the release script, the DSN gets baked into both the Rust binary (`option_env!("SENTRY_DSN")`) and the Next.js bundle (`process.env.NEXT_PUBLIC_SENTRY_DSN`). Without the secret, builds still succeed but Sentry is dormant.

### 4. Verify it works

In the installed app: **Settings → Support & Updates → Send Test Event** — you should see an event appear in your Sentry dashboard within ~30 seconds, tagged with the customer's installation ID.

### 5. What customers see

- Default: crash reporting ON
- Toggleable in **Settings → Support & Updates → Automatic Crash Reporting**
- When disabled, `before_send` returns null — no events leave the device
- PII (10+ digit number runs) is stripped from messages/exceptions before send

### What's captured automatically

- Rust panics (via `sentry::ClientOptions { attach_stacktrace: true }`)
- Frontend JS exceptions (via Sentry React init)
- React render errors (via `Sentry.ErrorBoundary` in `app/layout.tsx`)
- Any `log::error!(...)` from Rust if you later add `sentry-log` (not enabled yet)

### What's NOT captured

- Member names, phone numbers, addresses, balances
- Database contents
- Encryption keys / PINs
- IP addresses or geolocation (`send_default_pii: false`)
