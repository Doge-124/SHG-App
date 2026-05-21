# SHG Manager — Backend

Cloudflare Worker + D1 database that receives heartbeats from every installed
SHG Manager desktop app and renders an admin dashboard.

## Cost

$0/month for under ~100 customers checking in daily.
- Cloudflare Workers free tier: 100,000 requests / day
- D1 free tier: 5 GB storage + 5M reads/day

## What it does (Phase 1)

- `POST /heartbeat` — desktop app pings on launch with installation_id + version
- `GET /admin` — server-rendered HTML dashboard (auth: bearer token)
- `GET /admin/installations.json` — same data as JSON

## One-time setup

> All `wrangler` commands below use `npx wrangler` so they work whether wrangler
> is installed globally or only locally via the project's `npm install`. The
> `npm run X` shortcuts also work the same way.

### 1. Install backend dependencies (gets wrangler locally)

```powershell
cd backend
npm install
```

### 2. Log in to Cloudflare (opens browser)

```powershell
npx wrangler login
```

### 3. Create the D1 database

```powershell
npx wrangler d1 create shg-manager-db
```

The output includes a `database_id`. Paste it into `wrangler.toml` where it says
`REPLACE_WITH_DATABASE_ID_AFTER_wrangler_d1_create`.

### 4. Apply the schema

```powershell
npm run db:migrate:remote
```

### 5. Set the admin token

This is the password protecting the admin dashboard. Pick something long and random
(at least 32 chars). You'll use it to log in.

```powershell
npm run secret:set-admin-token
# prompts you to paste the token
```

### 6. Deploy

```powershell
npm run deploy
```

Wrangler will print the deployed URL — something like
`https://shg-manager-api.<yoursubdomain>.workers.dev`.

**Save that URL** — you'll need it for the desktop app config (next step).

### 7. View the dashboard

Open in browser:
`https://shg-manager-api.<yoursubdomain>.workers.dev/admin?token=<your-admin-token>`

You'll see the dashboard. No installations yet — that's expected until the desktop
app starts sending heartbeats (next phase of the rollout).

## Adding the desktop app integration

After deploying the Worker, you'll have a URL. Add it to the GitHub repo as a
secret named `TELEMETRY_ENDPOINT_URL`:

- Repo → Settings → Secrets and variables → Actions → New repository secret
- Name: `TELEMETRY_ENDPOINT_URL`
- Value: `https://shg-manager-api.<yoursubdomain>.workers.dev`

Then the next desktop release will start sending heartbeats automatically.

## Routes

| Method | Path | Auth | Body |
|---|---|---|---|
| `GET` | `/` | none | none — returns `{name, status, time}` |
| `POST` | `/heartbeat` | none | `{installationId, version, os, arch}` |
| `GET` | `/admin` | bearer | HTML dashboard |
| `GET` | `/admin/installations.json` | bearer | full JSON dump |

## Local development

```powershell
npm run dev          # starts wrangler dev server on localhost:8787
npm run db:migrate:local   # apply schema to local D1
```

Test with curl:

```powershell
curl -X POST http://localhost:8787/heartbeat `
  -H "content-type: application/json" `
  -d '{"installationId":"12345678-1234-1234-1234-123456789012","version":"1.0.12","os":"windows","arch":"x86_64"}'
```

## Inspecting data

```powershell
# Count installations
npx wrangler d1 execute shg-manager-db --remote --command="SELECT COUNT(*) FROM installations"

# Most recent
npx wrangler d1 execute shg-manager-db --remote --command="SELECT * FROM installations ORDER BY last_seen_at DESC LIMIT 5"

# Version distribution
npx wrangler d1 execute shg-manager-db --remote --command="SELECT current_version, COUNT(*) FROM installations GROUP BY current_version"
```

## Adding notes to a customer

You can add a human-readable label (customer name, location, etc.) to any
installation via SQL:

```powershell
npx wrangler d1 execute shg-manager-db --remote --command="UPDATE installations SET notes='Sangli SHG, Maharashtra' WHERE installation_id = '...'"
```

Notes show in the dashboard's last column.
