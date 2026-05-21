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

export async function handleAdminInstallationsJson(req: Request, env: Env): Promise<Response> {
  if (!isAuthorised(req, env)) return unauthorised()
  const installations = await listInstallations(env)
  const versions = await versionDistribution(env)
  return new Response(
    JSON.stringify({ installations, versions, generated_at: new Date().toISOString() }),
    { headers: { 'content-type': 'application/json' } },
  )
}

export async function handleAdminDashboard(req: Request, env: Env): Promise<Response> {
  if (!isAuthorised(req, env)) return unauthorised()

  const installations = await listInstallations(env)
  const versions = await versionDistribution(env)
  const now = Date.now()

  const totalInstallations = installations.length
  const activeLast24h = installations.filter(i => now - i.last_seen_at < 24 * 3600_000).length
  const activeLast7d = installations.filter(i => now - i.last_seen_at < 7 * 24 * 3600_000).length

  const html = renderHtml({
    totalInstallations,
    activeLast24h,
    activeLast7d,
    versions,
    installations,
  })

  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
}

interface DashboardData {
  totalInstallations: number
  activeLast24h: number
  activeLast7d: number
  versions: VersionDistRow[]
  installations: InstallationRow[]
}

function renderHtml(d: DashboardData): string {
  const rows = d.installations
    .map(i => {
      const lastSeen = relativeTime(Date.now() - i.last_seen_at)
      const firstSeen = new Date(i.first_seen_at).toISOString().split('T')[0]
      const isStale = Date.now() - i.last_seen_at > 7 * 24 * 3600_000
      return `<tr class="${isStale ? 'stale' : ''}">
        <td class="mono">${escapeHtml(i.installation_id.slice(0, 8))}…</td>
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
