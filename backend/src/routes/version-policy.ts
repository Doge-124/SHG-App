import type { Env } from '../env'

/**
 * Public + admin endpoints for the desktop version policy.
 *
 *   GET  /version-policy                  → public. Returns the minimum
 *                                            supported version. Desktop calls
 *                                            this on launch to decide whether
 *                                            to gate.
 *   POST /admin/version-policy            → admin. Body: { minSupportedVersion }
 *                                            Setting to empty string disables
 *                                            the gate.
 *
 * Version comparison is left to the desktop (simple semver split-and-compare).
 */

const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}(-[A-Za-z0-9._-]{1,32})?$/
const CONFIG_KEY = 'min_supported_version'

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function isAuthorised(req: Request, env: Env): boolean {
  const url = new URL(req.url)
  const queryToken = url.searchParams.get('token')
  const header = req.headers.get('authorization') ?? ''
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null
  const provided = bearer ?? queryToken
  return !!provided && provided === env.ADMIN_TOKEN
}

async function readMinVersion(env: Env): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT value FROM app_config WHERE key = ?1`,
  ).bind(CONFIG_KEY).first<{ value: string }>()
  const v = row?.value?.trim()
  return v ? v : null
}

// ─── GET /version-policy ─────────────────────────────────────────────────
export async function handleGetVersionPolicy(_req: Request, env: Env): Promise<Response> {
  const minSupportedVersion = await readMinVersion(env)
  return json({
    ok: true,
    minSupportedVersion,                  // null = no minimum enforced
    serverTime: new Date().toISOString(),
  })
}

// ─── POST /admin/version-policy ──────────────────────────────────────────
export async function handleSetVersionPolicy(req: Request, env: Env): Promise<Response> {
  if (!isAuthorised(req, env)) return new Response('Unauthorized', { status: 401 })

  let body: { minSupportedVersion?: unknown }
  try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }

  const raw = typeof body.minSupportedVersion === 'string'
    ? body.minSupportedVersion.trim()
    : ''

  if (raw && !VERSION_RE.test(raw)) {
    return json({ error: 'invalid_version_format', expected: 'X.Y.Z' }, 400)
  }

  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO app_config (key, value, updated_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).bind(CONFIG_KEY, raw, now).run()

  return json({ ok: true, minSupportedVersion: raw || null })
}
