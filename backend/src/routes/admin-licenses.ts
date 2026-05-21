import type { Env } from '../env'

/**
 * Admin endpoints for managing licenses. All require bearer token auth
 * (re-uses the same ADMIN_TOKEN secret as the dashboard).
 *
 *   POST   /admin/license              issue a new license
 *   GET    /admin/licenses.json        list all
 *   POST   /admin/license/:key/revoke  revoke (with reason)
 *   POST   /admin/license/:key/unbind  clear installation binding (for transfer)
 *   POST   /admin/license/:key/extend  set/update expires_at
 *   DELETE /admin/license/:key         hard delete (use with caution)
 */

function isAuthorised(req: Request, env: Env): boolean {
  const url = new URL(req.url)
  const queryToken = url.searchParams.get('token')
  const header = req.headers.get('authorization') ?? ''
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null
  const provided = bearer ?? queryToken
  return !!provided && provided === env.ADMIN_TOKEN
}

function unauthorised(): Response {
  return new Response('Unauthorized', { status: 401 })
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// Crockford-ish alphabet — excludes 0, O, 1, I, L (visually ambiguous)
const KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function generateLicenseKey(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const chars: string[] = []
  for (let i = 0; i < 16; i++) {
    chars.push(KEY_ALPHABET[bytes[i] % KEY_ALPHABET.length])
  }
  return `SHG-${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}-${chars.slice(12, 16).join('')}`
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

// ─── POST /admin/license — issue ─────────────────────────────────────────
export async function handleIssueLicense(req: Request, env: Env): Promise<Response> {
  if (!isAuthorised(req, env)) return unauthorised()

  let body: {
    customerName?: string
    customerEmail?: string
    validForDays?: number          // e.g. 365 for annual
    gracePeriodDays?: number       // optional, defaults to 14
    notes?: string
  }
  try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }

  const now = Date.now()
  const validForDays = typeof body.validForDays === 'number' && body.validForDays > 0
    ? Math.floor(body.validForDays) : 365
  const gracePeriodDays = typeof body.gracePeriodDays === 'number' && body.gracePeriodDays >= 0
    ? Math.floor(body.gracePeriodDays) : 14
  const expiresAt = now + validForDays * 86_400_000

  // Generate a key, retry up to 5 times on the astronomically-unlikely collision.
  let licenseKey: string | null = null
  for (let i = 0; i < 5; i++) {
    const candidate = generateLicenseKey()
    const existing = await env.DB.prepare(
      `SELECT 1 FROM licenses WHERE license_key = ?1`,
    ).bind(candidate).first()
    if (!existing) { licenseKey = candidate; break }
  }
  if (!licenseKey) return json({ error: 'key_collision' }, 500)

  await env.DB.prepare(
    `INSERT INTO licenses
       (license_key, customer_name, customer_email, issued_at, expires_at,
        grace_period_days, status, notes)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7)`,
  ).bind(
    licenseKey,
    body.customerName ?? null,
    body.customerEmail ?? null,
    now,
    expiresAt,
    gracePeriodDays,
    body.notes ?? null,
  ).run()

  return json({
    ok: true,
    licenseKey,
    expiresAt,
    gracePeriodDays,
    customerName: body.customerName ?? null,
  })
}

// ─── GET /admin/licenses.json — list ─────────────────────────────────────
export async function handleListLicenses(req: Request, env: Env): Promise<Response> {
  if (!isAuthorised(req, env)) return unauthorised()
  const { results } = await env.DB.prepare(
    `SELECT * FROM licenses ORDER BY issued_at DESC LIMIT 1000`,
  ).all<LicenseRow>()
  return json({ licenses: results ?? [], generated_at: new Date().toISOString() })
}

// ─── POST /admin/license/:key/revoke ─────────────────────────────────────
export async function handleRevokeLicense(req: Request, env: Env, key: string): Promise<Response> {
  if (!isAuthorised(req, env)) return unauthorised()

  let body: { reason?: string } = {}
  try { body = await req.json() } catch { /* reason is optional */ }

  const lic = await env.DB.prepare(
    `SELECT license_key FROM licenses WHERE license_key = ?1`,
  ).bind(key).first()
  if (!lic) return json({ error: 'license_not_found' }, 404)

  await env.DB.prepare(
    `UPDATE licenses SET status = 'revoked', revoked_at = ?1, revoked_reason = ?2
     WHERE license_key = ?3`,
  ).bind(Date.now(), body.reason ?? null, key).run()

  return json({ ok: true })
}

// ─── POST /admin/license/:key/unbind ─────────────────────────────────────
// Clears installation binding so the customer can activate on a different machine.
export async function handleUnbindLicense(req: Request, env: Env, key: string): Promise<Response> {
  if (!isAuthorised(req, env)) return unauthorised()
  const lic = await env.DB.prepare(
    `SELECT license_key FROM licenses WHERE license_key = ?1`,
  ).bind(key).first()
  if (!lic) return json({ error: 'license_not_found' }, 404)

  await env.DB.prepare(
    `UPDATE licenses SET bound_installation_id = NULL, bound_at = NULL
     WHERE license_key = ?1`,
  ).bind(key).run()

  return json({ ok: true })
}

// ─── POST /admin/license/:key/extend ─────────────────────────────────────
// Body: { addDays: 365 }  OR  { setExpiresAt: 1716240000000 }
export async function handleExtendLicense(req: Request, env: Env, key: string): Promise<Response> {
  if (!isAuthorised(req, env)) return unauthorised()
  let body: { addDays?: number; setExpiresAt?: number }
  try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }

  const lic = await env.DB.prepare(
    `SELECT expires_at FROM licenses WHERE license_key = ?1`,
  ).bind(key).first<{ expires_at: number | null }>()
  if (!lic) return json({ error: 'license_not_found' }, 404)

  let newExpiresAt: number | null = null
  if (typeof body.setExpiresAt === 'number') {
    newExpiresAt = body.setExpiresAt
  } else if (typeof body.addDays === 'number' && body.addDays > 0) {
    const base = lic.expires_at ?? Date.now()
    newExpiresAt = base + body.addDays * 86_400_000
  } else {
    return json({ error: 'must_provide_addDays_or_setExpiresAt' }, 400)
  }

  await env.DB.prepare(
    `UPDATE licenses SET expires_at = ?1, status = 'active', revoked_at = NULL, revoked_reason = NULL
     WHERE license_key = ?2`,
  ).bind(newExpiresAt, key).run()

  return json({ ok: true, expiresAt: newExpiresAt })
}

// ─── DELETE /admin/license/:key ──────────────────────────────────────────
export async function handleDeleteLicense(req: Request, env: Env, key: string): Promise<Response> {
  if (!isAuthorised(req, env)) return unauthorised()
  await env.DB.prepare(`DELETE FROM licenses WHERE license_key = ?1`).bind(key).run()
  return json({ ok: true })
}
