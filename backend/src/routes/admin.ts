import type { Env } from '../env'

/**
 * GET /admin
 *   Server-rendered HTML dashboard (auth: bearer token).
 *
 * GET /admin/installations.json
 *   JSON list of installations (auth: bearer token).
 *
 * Auth: Authorization: Bearer <ADMIN_TOKEN>  OR  ?token=<ADMIN_TOKEN> in query string.
 * The token is set via `wrangler secret put ADMIN_TOKEN`.
 */

function isAuthorised(req: Request, env: Env): boolean {
  const url = new URL(req.url)
  const queryToken = url.searchParams.get('token')
  const header = req.headers.get('authorization') ?? ''
  const bearer = header.toLowerCase().startsWith('bearer ')
    ? header.slice(7).trim()
    : null
  const provided = bearer ?? queryToken
  return !!provided && provided === env.ADMIN_TOKEN
}

function unauthorised(): Response {
  return new Response(
    'Unauthorized -- append ?token=<ADMIN_TOKEN> or send Authorization: Bearer header',
    {
      status: 401,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    },
  )
}

interface InstallationRow {
  installation_id: string
  first_seen_at: number
  last_seen_at: number
  current_version: string
  os: string | null
  arch: string | null
  total_heartbeats: number
  notes: string | null
}

async function listInstallations(env: Env): Promise<InstallationRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT installation_id, first_seen_at, last_seen_at, current_version,
            os, arch, total_heartbeats, notes
     FROM installations
     ORDER BY last_seen_at DESC
     LIMIT 1000`,
  ).all<InstallationRow>()
  return results ?? []
}

interface VersionDistRow {
  current_version: string
  count: number
}

async function versionDistribution(env: Env): Promise<VersionDistRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT current_version, COUNT(*) AS count
     FROM installations
     GROUP BY current_version
     ORDER BY count DESC`,
  ).all<VersionDistRow>()
  return results ?? []
}

interface EventCountRow {
  event_name: string
  count: number
  unique_installs: number
}

interface DailyActivityRow {
  day: string
  events: number
  installs: number
}

async function topEvents(env: Env, sinceMs: number): Promise<EventCountRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT event_name,
            COUNT(*) AS count,
            COUNT(DISTINCT installation_id) AS unique_installs
     FROM events
     WHERE occurred_at >= ?1
     GROUP BY event_name
     ORDER BY count DESC
     LIMIT 30`,
  ).bind(sinceMs).all<EventCountRow>()
  return results ?? []
}

async function dailyActivity(env: Env, days: number): Promise<DailyActivityRow[]> {
  const sinceMs = Date.now() - days * 86400_000
  // SQLite's strftime works in seconds; events.occurred_at is in ms.
  const { results } = await env.DB.prepare(
    `SELECT strftime('%Y-%m-%d', occurred_at / 1000, 'unixepoch') AS day,
            COUNT(*)                            AS events,
            COUNT(DISTINCT installation_id)     AS installs
     FROM events
     WHERE occurred_at >= ?1
     GROUP BY day
     ORDER BY day ASC`,
  ).bind(sinceMs).all<DailyActivityRow>()
  return results ?? []
}

async function totalEventCount(env: Env, sinceMs: number): Promise<number> {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM events WHERE occurred_at >= ?1`,
  ).bind(sinceMs).first<{ n: number }>()
  return r?.n ?? 0
}

export async function handleAdminInstallationsJson(req: Request, env: Env): Promise<Response> {
  if (!isAuthorised(req, env)) return unauthorised()
  const installations = await listInstallations(env)
  const versions = await versionDistribution(env)
  const sevenDaysAgo = Date.now() - 7 * 86400_000
  const events_7d = await topEvents(env, sevenDaysAgo)
  const activity = await dailyActivity(env, 14)
  return new Response(
    JSON.stringify({
      installations,
      versions,
      events_7d,
      activity_14d: activity,
      generated_at: new Date().toISOString(),
    }),
    { headers: { 'content-type': 'application/json' } },
  )
}

interface LicenseRow {
  license_key: string
  customer_name: string | null
  customer_email: string | null
  issued_at: number
  expires_at: number | null
  grace_period_days: number
  status: string
  revoked_at: number | null
  revoked_reason: string | null
  bound_installation_id: string | null
  bound_at: number | null
  last_validated_at: number | null
  notes: string | null
}

async function readMinVersion(env: Env): Promise<string> {
  const row = await env.DB.prepare(
    `SELECT value FROM app_config WHERE key = 'min_supported_version'`,
  ).first<{ value: string }>()
  return row?.value?.trim() ?? ''
}

async function listLicensesForDashboard(env: Env): Promise<LicenseRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM licenses ORDER BY issued_at DESC LIMIT 500`,
  ).all<LicenseRow>()
  return results ?? []
}

export async function handleAdminDashboard(req: Request, env: Env): Promise<Response> {
  if (!isAuthorised(req, env)) return unauthorised()

  const installations = await listInstallations(env)
  const versions = await versionDistribution(env)
  const now = Date.now()

  const totalInstallations = installations.length
  const activeLast24h = installations.filter(i => now - i.last_seen_at < 24 * 3600_000).length
  const activeLast7d = installations.filter(i => now - i.last_seen_at < 7 * 24 * 3600_000).length

  const sevenDaysAgo = now - 7 * 86400_000
  const events7d = await topEvents(env, sevenDaysAgo)
  const totalEvents7d = await totalEventCount(env, sevenDaysAgo)
  const activity14d = await dailyActivity(env, 14)
  const licenses = await listLicensesForDashboard(env)
  const minVersion = await readMinVersion(env)

  const url = new URL(req.url)
  const adminToken = url.searchParams.get('token') ?? ''

  const html = renderHtml({
    totalInstallations,
    activeLast24h,
    activeLast7d,
    versions,
    installations,
    events7d,
    totalEvents7d,
    activity14d,
    licenses,
    minVersion,
    adminToken,
  })

  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
}

interface DashboardData {
  totalInstallations: number
  activeLast24h: number
  activeLast7d: number
  versions: VersionDistRow[]
  installations: InstallationRow[]
  events7d: EventCountRow[]
  totalEvents7d: number
  activity14d: DailyActivityRow[]
  licenses: LicenseRow[]
  minVersion: string
  adminToken: string
}

function renderHtml(d: DashboardData): string {
  const rows = d.installations
    .map(i => {
      const lastSeen = relativeTime(Date.now() - i.last_seen_at)
      const firstSeen = new Date(i.first_seen_at).toISOString().split('T')[0]
      const isStale = Date.now() - i.last_seen_at > 7 * 24 * 3600_000
      return `<tr class="${isStale ? 'stale' : ''}">
        <td class="mono">${escapeHtml(i.installation_id.slice(0, 8))}...</td>
        <td>${escapeHtml(i.current_version)}</td>
        <td>${escapeHtml(i.os ?? '')} / ${escapeHtml(i.arch ?? '')}</td>
        <td>${escapeHtml(lastSeen)}</td>
        <td>${escapeHtml(firstSeen)}</td>
        <td class="r">${i.total_heartbeats}</td>
        <td>${escapeHtml(i.notes ?? '')}</td>
      </tr>`
    })
    .join('')

  const versionRows = d.versions
    .map(v => `<tr><td class="mono">${escapeHtml(v.current_version)}</td><td class="r">${v.count}</td></tr>`)
    .join('')

  const eventRows = d.events7d
    .map(e => `<tr>
      <td class="mono">${escapeHtml(e.event_name)}</td>
      <td class="r">${e.count}</td>
      <td class="r">${e.unique_installs}</td>
    </tr>`)
    .join('')

  // Licenses table rows
  const now = Date.now()
  const licenseRows = d.licenses
    .map(lic => {
      let statusLabel = lic.status
      let statusClass = lic.status
      if (lic.status === 'active' && lic.expires_at !== null && lic.expires_at < now) {
        const graceEnd = lic.expires_at + lic.grace_period_days * 86400_000
        statusLabel = graceEnd > now ? 'expired (grace)' : 'expired'
        statusClass = graceEnd > now ? 'grace' : 'expired'
      }
      const expiresStr = lic.expires_at !== null
        ? new Date(lic.expires_at).toISOString().split('T')[0]
        : 'never'
      const bound = lic.bound_installation_id
        ? `<span class="mono" title="${escapeHtml(lic.bound_installation_id)}">${escapeHtml(lic.bound_installation_id.slice(0, 8))}...</span>`
        : '<span class="muted">not activated</span>'
      const customer = lic.customer_name || lic.customer_email || '<span class="muted">unnamed</span>'
      const isRevoked = lic.status === 'revoked' || lic.status === 'suspended'
      const isUnbound = !lic.bound_installation_id
      const actions: string[] = []
      if (isRevoked) {
        actions.push(`<button class="btn-mini" onclick="reactivateLicense('${escapeHtml(lic.license_key)}')">Reactivate</button>`)
      } else {
        actions.push(`<button class="btn-mini" onclick="revokeLicense('${escapeHtml(lic.license_key)}')">Revoke</button>`)
      }
      if (isUnbound) {
        actions.push(`<button class="btn-mini" onclick="rebindLicense('${escapeHtml(lic.license_key)}')">Re-bind</button>`)
      } else {
        actions.push(`<button class="btn-mini" onclick="unbindLicense('${escapeHtml(lic.license_key)}')">Unbind</button>`)
      }
      actions.push(`<button class="btn-mini" onclick="extendLicense('${escapeHtml(lic.license_key)}')">+1yr</button>`)

      return `<tr>
        <td class="mono">${escapeHtml(lic.license_key)}</td>
        <td>${customer === '<span class="muted">unnamed</span>' ? customer : escapeHtml(customer)}</td>
        <td><span class="badge ${statusClass}">${statusLabel}</span></td>
        <td>${expiresStr}</td>
        <td>${bound}</td>
        <td>${actions.join(' ')}</td>
      </tr>`
    })
    .join('')

  // Pad activity to 14 days even if some days have zero events.
  const activityMap = new Map(d.activity14d.map(a => [a.day, a]))
  const activityBars: string[] = []
  const maxEvents = Math.max(1, ...d.activity14d.map(a => a.events))
  for (let i = 13; i >= 0; i--) {
    const dayMs = Date.now() - i * 86400_000
    const day = new Date(dayMs).toISOString().split('T')[0]
    const row = activityMap.get(day)
    const events = row?.events ?? 0
    const installs = row?.installs ?? 0
    const pct = (events / maxEvents) * 100
    activityBars.push(`<div class="bar-row">
      <div class="bar-day">${day.slice(5)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      <div class="bar-val">${events}<span class="bar-installs">${installs > 0 ? ` · ${installs} inst` : ''}</span></div>
    </div>`)
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>SHG Manager — Admin Dashboard</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  * { box-sizing: border-box; }
  body { font: 14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif; margin: 0; background: #f8fafc; color: #0f172a; }
  header { background: #0f172a; color: #fff; padding: 16px 24px; }
  header h1 { margin: 0; font-size: 18px; font-weight: 600; }
  header .sub { font-size: 12px; color: #94a3b8; margin-top: 2px; }
  main { padding: 24px; max-width: 1200px; margin: 0 auto; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px; }
  .card .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-bottom: 4px; }
  .card .value { font-size: 24px; font-weight: 700; color: #0f172a; }
  .section { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0; margin-bottom: 16px; overflow: hidden; }
  .section h2 { margin: 0; padding: 12px 16px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; border-bottom: 1px solid #e2e8f0; background: #f8fafc; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #f1f5f9; }
  th { background: #f8fafc; color: #64748b; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
  td.r, th.r { text-align: right; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  tr.stale td { color: #94a3b8; }
  .footer { color: #64748b; font-size: 12px; margin-top: 24px; text-align: center; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 800px) { .grid-2 { grid-template-columns: 1fr; } }
  .bar-row { display: flex; align-items: center; gap: 12px; padding: 4px 16px; font-size: 12px; }
  .bar-day { width: 48px; color: #64748b; font-family: ui-monospace, monospace; }
  .bar-track { flex: 1; height: 14px; background: #f1f5f9; border-radius: 3px; overflow: hidden; }
  .bar-fill { height: 100%; background: linear-gradient(90deg, #3b82f6, #60a5fa); border-radius: 3px; transition: width .2s; }
  .bar-val { width: 100px; text-align: right; color: #0f172a; font-weight: 500; }
  .bar-installs { color: #94a3b8; font-weight: 400; font-size: 11px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
  .badge.active { background: #dcfce7; color: #166534; }
  .badge.revoked { background: #fee2e2; color: #991b1b; }
  .badge.suspended { background: #fef3c7; color: #92400e; }
  .badge.grace { background: #ffedd5; color: #9a3412; }
  .badge.expired { background: #f1f5f9; color: #475569; text-decoration: line-through; }
  .muted { color: #94a3b8; font-style: italic; }
  .btn-mini { background: #fff; border: 1px solid #cbd5e1; border-radius: 4px; padding: 2px 8px;
              font-size: 11px; cursor: pointer; margin-right: 4px; color: #475569; }
  .btn-mini:hover { background: #f1f5f9; border-color: #94a3b8; }
  .issue-form { padding: 12px 16px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
  .issue-form input { padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 4px;
                      font-size: 13px; margin-right: 8px; }
  .issue-form button { background: #0f172a; color: #fff; border: 0; border-radius: 4px;
                       padding: 6px 14px; font-size: 13px; cursor: pointer; font-weight: 500; }
  .issue-form button:hover { background: #1e293b; }
  .issued-key { background: #fefce8; border: 1px solid #fde047; padding: 10px 14px;
                margin: 12px 16px; border-radius: 4px; font-family: ui-monospace, monospace;
                font-size: 16px; font-weight: 700; color: #713f12; }
</style>
</head>
<body>
<header>
  <h1>SHG Manager — Admin Dashboard</h1>
  <div class="sub">Phase 1: telemetry only · generated ${new Date().toISOString()}</div>
</header>
<main>
  <div class="cards">
    <div class="card">
      <div class="label">Total installations</div>
      <div class="value">${d.totalInstallations}</div>
    </div>
    <div class="card">
      <div class="label">Active (24h)</div>
      <div class="value">${d.activeLast24h}</div>
    </div>
    <div class="card">
      <div class="label">Active (7d)</div>
      <div class="value">${d.activeLast7d}</div>
    </div>
    <div class="card">
      <div class="label">Versions in use</div>
      <div class="value">${d.versions.length}</div>
    </div>
    <div class="card">
      <div class="label">Events (7d)</div>
      <div class="value">${d.totalEvents7d}</div>
    </div>
    <div class="card">
      <div class="label">Tracked event types</div>
      <div class="value">${d.events7d.length}</div>
    </div>
  </div>

  <div class="grid-2">
    <div class="section">
      <h2>Top events (last 7 days)</h2>
      <table>
        <thead><tr><th>Event</th><th class="r">Count</th><th class="r">Installs</th></tr></thead>
        <tbody>${eventRows || '<tr><td colspan="3" style="text-align:center;padding:24px;color:#94a3b8;">No events recorded yet</td></tr>'}</tbody>
      </table>
    </div>
    <div class="section">
      <h2>Activity (last 14 days)</h2>
      <div style="padding:10px 0;">${activityBars.join('')}</div>
    </div>
  </div>

  <div class="section">
    <h2>Licenses (${d.licenses.length})</h2>
    <div class="issue-form">
      <form id="issue-form" onsubmit="issueLicense(event)">
        <input type="text" id="issue-name" placeholder="Customer name (optional)" style="width: 200px;" />
        <input type="email" id="issue-email" placeholder="Email (optional)" style="width: 200px;" />
        <input type="number" id="issue-days" placeholder="Valid days" value="365" style="width: 100px;" />
        <button type="submit">Issue License</button>
      </form>
      <div id="issued-result"></div>
    </div>
    <table>
      <thead>
        <tr>
          <th>License Key</th>
          <th>Customer</th>
          <th>Status</th>
          <th>Expires</th>
          <th>Bound Install</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>${licenseRows || '<tr><td colspan="6" style="text-align:center;padding:24px;color:#94a3b8;">No licenses issued yet</td></tr>'}</tbody>
    </table>
  </div>

  <div class="section">
    <h2>Force-update policy</h2>
    <div class="issue-form">
      <form id="minver-form" onsubmit="setMinVersion(event)">
        <label style="font-size:12px;color:#64748b;margin-right:8px;">Minimum supported version:</label>
        <input type="text" id="minver-input" placeholder="e.g. 1.0.17 (empty = no minimum)"
               value="${escapeHtml(d.minVersion)}" style="width: 240px;" />
        <button type="submit">Save</button>
        <span style="margin-left:12px;font-size:12px;color:#94a3b8;">
          Desktops below this version are blocked at launch with an "Update Now" prompt.
        </span>
      </form>
    </div>
  </div>

  <div class="section">
    <h2>Version distribution</h2>
    <table>
      <thead><tr><th>Version</th><th class="r">Installations</th></tr></thead>
      <tbody>${versionRows || '<tr><td colspan="2" style="text-align:center;padding:24px;color:#94a3b8;">No data yet</td></tr>'}</tbody>
    </table>
  </div>

  <div class="section">
    <h2>Installations (most recently active first)</h2>
    <table>
      <thead>
        <tr>
          <th>Install ID</th>
          <th>Version</th>
          <th>OS / Arch</th>
          <th>Last seen</th>
          <th>First seen</th>
          <th class="r">Heartbeats</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="7" style="text-align:center;padding:24px;color:#94a3b8;">No installations have reported yet</td></tr>'}</tbody>
    </table>
  </div>

  <div class="footer">
    Rows with grey text haven't been seen in 7+ days.
  </div>
</main>

<script>
const TOKEN = ${JSON.stringify(d.adminToken)};

async function api(path, opts = {}) {
  const res = await fetch(path + '?token=' + encodeURIComponent(TOKEN), {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error('HTTP ' + res.status + ': ' + text);
  }
  return res.json();
}

async function issueLicense(ev) {
  ev.preventDefault();
  const name  = document.getElementById('issue-name').value.trim();
  const email = document.getElementById('issue-email').value.trim();
  const days  = parseInt(document.getElementById('issue-days').value, 10) || 365;
  try {
    const r = await api('/admin/license', {
      method: 'POST',
      body: JSON.stringify({ customerName: name || null, customerEmail: email || null, validForDays: days }),
    });
    document.getElementById('issued-result').innerHTML =
      '<div class="issued-key">' + r.licenseKey +
      ' <span style="font-weight:400;font-size:12px;color:#a16207;">(valid ' + days + ' days)</span></div>';
    document.getElementById('issue-name').value = '';
    document.getElementById('issue-email').value = '';
    setTimeout(() => location.reload(), 2000);
  } catch (e) {
    alert('Failed to issue license: ' + e.message);
  }
}

async function revokeLicense(key) {
  const reason = prompt('Reason for revocation (shown to customer)?', '');
  if (reason === null) return;
  try {
    await api('/admin/license/' + encodeURIComponent(key) + '/revoke', {
      method: 'POST', body: JSON.stringify({ reason }),
    });
    location.reload();
  } catch (e) { alert('Failed: ' + e.message); }
}

async function unbindLicense(key) {
  if (!confirm('Unbind this license? The customer can then activate on a different machine.')) return;
  try {
    await api('/admin/license/' + encodeURIComponent(key) + '/unbind', { method: 'POST' });
    location.reload();
  } catch (e) { alert('Failed: ' + e.message); }
}

async function extendLicense(key) {
  if (!confirm('Extend this license by 365 days?')) return;
  try {
    await api('/admin/license/' + encodeURIComponent(key) + '/extend', {
      method: 'POST', body: JSON.stringify({ addDays: 365 }),
    });
    location.reload();
  } catch (e) { alert('Failed: ' + e.message); }
}

async function reactivateLicense(key) {
  if (!confirm('Reactivate this license? The customer will regain access immediately.')) return;
  try {
    await api('/admin/license/' + encodeURIComponent(key) + '/reactivate', { method: 'POST' });
    location.reload();
  } catch (e) { alert('Failed: ' + e.message); }
}

async function setMinVersion(e) {
  e.preventDefault();
  const minVer = document.getElementById('minver-input').value.trim();
  try {
    const r = await api('/admin/version-policy', {
      method: 'POST', body: JSON.stringify({ minSupportedVersion: minVer }),
    });
    alert(r.minSupportedVersion
      ? 'Minimum version set to ' + r.minSupportedVersion
      : 'Minimum version cleared. No version gating.');
    location.reload();
  } catch (err) {
    alert('Failed: ' + err.message);
  }
}

async function rebindLicense(key) {
  const installationId = prompt(
    'Bind this license to which installation ID?\\n' +
    '(Copy from the Installations table above.)',
    '',
  );
  if (!installationId) return;
  try {
    await api('/admin/license/' + encodeURIComponent(key) + '/rebind', {
      method: 'POST', body: JSON.stringify({ installationId: installationId.trim() }),
    });
    location.reload();
  } catch (e) { alert('Failed: ' + e.message); }
}
</script>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function relativeTime(ms: number): string {
  if (ms < 60_000) return 'just now'
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)} min ago`
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)} h ago`
  return `${Math.floor(ms / 86400_000)} d ago`
}
