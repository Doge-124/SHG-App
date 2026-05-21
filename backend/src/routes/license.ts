import type { Env } from '../env'

/**
 * Public license endpoints — called by the desktop app.
 *
 * POST /license/activate
 *   First-time activation. Binds the license key to this installation.
 *   Body: { licenseKey, installationId }
 *   Returns: { ok: true, expiresAt, gracePeriodDays, status } on success
 *            { ok: false, error: "..." } on failure
 *
 * POST /license/validate
 *   Per-launch check. Verifies key + machine binding + status + expiry.
 *   Body: { licenseKey, installationId }
 *   Returns: { ok: true, status: "active"|"expired"|"revoked"|"wrong_machine"|"suspended",
 *              expiresAt, gracePeriodEndsAt, revokedReason }
 */

const LICENSE_KEY_RE = /^SHG-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function asString(v: unknown, maxLen: number): string | null {
  if (typeof v !== 'string') return null
  if (v.length === 0 || v.length > maxLen) return null
  return v
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

interface LicenseRow {
  license_key: string
  customer_name: string | null
  customer_email: string | null
  issued_at: number
  expires_at: number | null
  grace_period_days: number
  status: 'active' | 'revoked' | 'suspended'
  revoked_at: number | null
  revoked_reason: string | null
  bound_installation_id: string | null
  bound_at: number | null
  last_validated_at: number | null
  notes: string | null
}

async function fetchLicense(env: Env, key: string): Promise<LicenseRow | null> {
  return await env.DB.prepare(
    `SELECT license_key, customer_name, customer_email, issued_at, expires_at,
            grace_period_days, status, revoked_at, revoked_reason,
            bound_installation_id, bound_at, last_validated_at, notes
     FROM licenses WHERE license_key = ?1`,
  ).bind(key).first<LicenseRow>()
}

// ─── /license/activate ────────────────────────────────────────────────────
export async function handleLicenseActivate(req: Request, env: Env): Promise<Response> {
  let body: { licenseKey?: unknown; installationId?: unknown }
  try { body = await req.json() } catch { return json({ ok: false, error: 'invalid_json' }, 400) }

  const licenseKey = asString(body.licenseKey, 32)
  const installationId = asString(body.installationId, 64)
  if (!licenseKey || !LICENSE_KEY_RE.test(licenseKey)) {
    return json({ ok: false, error: 'invalid_license_key_format' }, 400)
  }
  if (!installationId || !UUID_RE.test(installationId)) {
    return json({ ok: false, error: 'invalid_installation_id' }, 400)
  }

  const lic = await fetchLicense(env, licenseKey)
  if (!lic) {
    return json({ ok: false, error: 'license_not_found' }, 404)
  }
  if (lic.status === 'revoked') {
    return json({ ok: false, error: 'license_revoked', revokedReason: lic.revoked_reason }, 403)
  }
  if (lic.status === 'suspended') {
    return json({ ok: false, error: 'license_suspended' }, 403)
  }

  // If already bound to a DIFFERENT installation, reject.
  if (lic.bound_installation_id && lic.bound_installation_id !== installationId) {
    return json({
      ok: false,
      error: 'license_bound_to_other_machine',
      message: 'This license is already activated on another machine. Contact support to transfer.',
    }, 409)
  }

  const now = Date.now()

  // First-time binding (or re-activation on the same machine).
  if (!lic.bound_installation_id) {
    await env.DB.prepare(
      `UPDATE licenses
       SET bound_installation_id = ?1, bound_at = ?2, last_validated_at = ?2
       WHERE license_key = ?3`,
    ).bind(installationId, now, licenseKey).run()
  } else {
    await env.DB.prepare(
      `UPDATE licenses SET last_validated_at = ?1 WHERE license_key = ?2`,
    ).bind(now, licenseKey).run()
  }

  return json({
    ok: true,
    status: 'active',
    expiresAt: lic.expires_at,
    gracePeriodDays: lic.grace_period_days,
    customerName: lic.customer_name,
  })
}

// ─── /license/validate ────────────────────────────────────────────────────
export async function handleLicenseValidate(req: Request, env: Env): Promise<Response> {
  let body: { licenseKey?: unknown; installationId?: unknown }
  try { body = await req.json() } catch { return json({ ok: false, error: 'invalid_json' }, 400) }

  const licenseKey = asString(body.licenseKey, 32)
  const installationId = asString(body.installationId, 64)
  if (!licenseKey || !LICENSE_KEY_RE.test(licenseKey)) {
    return json({ ok: false, error: 'invalid_license_key_format' }, 400)
  }
  if (!installationId || !UUID_RE.test(installationId)) {
    return json({ ok: false, error: 'invalid_installation_id' }, 400)
  }

  const lic = await fetchLicense(env, licenseKey)
  if (!lic) {
    return json({ ok: false, error: 'license_not_found' }, 404)
  }

  const now = Date.now()
  let status: 'active' | 'expired' | 'revoked' | 'wrong_machine' | 'suspended'
  let gracePeriodEndsAt: number | null = null

  if (lic.status === 'revoked') {
    status = 'revoked'
  } else if (lic.status === 'suspended') {
    status = 'suspended'
  } else if (!lic.bound_installation_id) {
    // Not yet activated — caller must hit /activate first.
    return json({ ok: false, error: 'not_activated' }, 403)
  } else if (lic.bound_installation_id !== installationId) {
    status = 'wrong_machine'
  } else if (lic.expires_at !== null && lic.expires_at < now) {
    status = 'expired'
    gracePeriodEndsAt = lic.expires_at + (lic.grace_period_days * 86_400_000)
  } else {
    status = 'active'
    // Bump last_validated_at on successful active validations.
    await env.DB.prepare(
      `UPDATE licenses SET last_validated_at = ?1 WHERE license_key = ?2`,
    ).bind(now, licenseKey).run()
  }

  return json({
    ok: true,
    status,
    expiresAt: lic.expires_at,
    gracePeriodEndsAt,
    gracePeriodDays: lic.grace_period_days,
    revokedReason: lic.revoked_reason,
    customerName: lic.customer_name,
  })
}
