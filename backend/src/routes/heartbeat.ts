import type { Env } from '../env'

/**
 * POST /heartbeat
 *
 * Body:
 *   {
 *     "installationId": "uuid",
 *     "version": "1.0.12",
 *     "os": "windows",
 *     "arch": "x86_64"
 *   }
 *
 * Idempotent — upserts installation, updates last_seen_at, records version
 * history if this is a new version for this installation.
 *
 * Anonymous endpoint (no auth). Validation is strict so a malformed body
 * doesn't write garbage into the DB.
 */

interface HeartbeatBody {
  installationId?: unknown
  version?: unknown
  os?: unknown
  arch?: unknown
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}(-[A-Za-z0-9._-]{1,32})?$/

function asString(v: unknown, maxLen = 64): string | null {
  if (typeof v !== 'string') return null
  if (v.length === 0 || v.length > maxLen) return null
  return v
}

export async function handleHeartbeat(req: Request, env: Env): Promise<Response> {
  let body: HeartbeatBody
  try {
    body = (await req.json()) as HeartbeatBody
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const installationId = asString(body.installationId, 64)
  const version = asString(body.version, 32)
  const os = asString(body.os, 16) ?? 'unknown'
  const arch = asString(body.arch, 16) ?? 'unknown'

  if (!installationId || !UUID_RE.test(installationId)) {
    return json({ error: 'invalid_installation_id' }, 400)
  }
  if (!version || !VERSION_RE.test(version)) {
    return json({ error: 'invalid_version' }, 400)
  }

  const now = Date.now()

  // Upsert installation. SQLite "ON CONFLICT" handles repeat heartbeats.
  await env.DB.prepare(
    `INSERT INTO installations (installation_id, first_seen_at, last_seen_at,
                                current_version, os, arch, total_heartbeats)
     VALUES (?1, ?2, ?2, ?3, ?4, ?5, 1)
     ON CONFLICT(installation_id) DO UPDATE SET
       last_seen_at     = excluded.last_seen_at,
       current_version  = excluded.current_version,
       os               = excluded.os,
       arch             = excluded.arch,
       total_heartbeats = installations.total_heartbeats + 1`,
  )
    .bind(installationId, now, version, os, arch)
    .run()

  // Record version history (no-op if (installation, version) pair already exists).
  await env.DB.prepare(
    `INSERT OR IGNORE INTO version_history (installation_id, version, first_seen_at)
     VALUES (?1, ?2, ?3)`,
  )
    .bind(installationId, version, now)
    .run()

  return json({ ok: true, server_time: new Date(now).toISOString() })
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
