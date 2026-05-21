import type { Env } from '../env'

/**
 * POST /events
 *
 * Anonymous batch event ingestion. Body:
 *   {
 *     "installationId": "uuid",
 *     "appVersion": "1.0.14",
 *     "events": [
 *       { "eventId": "uuid", "name": "loan.issued", "props": {...}, "occurredAt": 1716240000000 },
 *       { "eventId": "uuid", "name": "member.created", "props": {...}, "occurredAt": 1716240005000 }
 *     ]
 *   }
 *
 * - event_id is a client-generated UUID — re-uploads are idempotent (INSERT OR IGNORE)
 * - props must be a JSON-serialisable object, ≤ 2 KB stringified, NO PII
 * - Per-request cap: 500 events, 256 KB body
 */

interface IncomingEvent {
  eventId?: unknown
  name?: unknown
  props?: unknown
  occurredAt?: unknown
}

interface BatchBody {
  installationId?: unknown
  appVersion?: unknown
  events?: unknown
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}(-[A-Za-z0-9._-]{1,32})?$/
const EVENT_NAME_RE = /^[a-z][a-z0-9_]{0,31}(\.[a-z][a-z0-9_]{0,31}){0,3}$/

const MAX_EVENTS_PER_REQUEST = 500
const MAX_PROPS_BYTES = 2048

function asString(v: unknown, maxLen: number): string | null {
  if (typeof v !== 'string') return null
  if (v.length === 0 || v.length > maxLen) return null
  return v
}

export async function handleEvents(req: Request, env: Env): Promise<Response> {
  let body: BatchBody
  try {
    body = (await req.json()) as BatchBody
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const installationId = asString(body.installationId, 64)
  if (!installationId || !UUID_RE.test(installationId)) {
    return json({ error: 'invalid_installation_id' }, 400)
  }

  const appVersion = asString(body.appVersion, 32)
  if (!appVersion || !VERSION_RE.test(appVersion)) {
    return json({ error: 'invalid_app_version' }, 400)
  }

  if (!Array.isArray(body.events)) {
    return json({ error: 'events_must_be_array' }, 400)
  }
  if (body.events.length === 0) {
    return json({ ok: true, accepted: 0 })
  }
  if (body.events.length > MAX_EVENTS_PER_REQUEST) {
    return json({ error: 'too_many_events', max: MAX_EVENTS_PER_REQUEST }, 400)
  }

  const now = Date.now()
  const rows: Array<[string, string, string, string | null, number, number, string]> = []
  const errors: { index: number; reason: string }[] = []

  body.events.forEach((raw, i) => {
    const e = raw as IncomingEvent
    const eventId = asString(e.eventId, 64)
    const name = asString(e.name, 80)
    const occurredAt = typeof e.occurredAt === 'number' && Number.isFinite(e.occurredAt) ? e.occurredAt : null

    if (!eventId || !UUID_RE.test(eventId)) {
      errors.push({ index: i, reason: 'invalid_event_id' })
      return
    }
    if (!name || !EVENT_NAME_RE.test(name)) {
      errors.push({ index: i, reason: 'invalid_event_name' })
      return
    }
    if (occurredAt === null || occurredAt < 0 || occurredAt > now + 60_000) {
      errors.push({ index: i, reason: 'invalid_occurred_at' })
      return
    }

    let propsStr: string | null = null
    if (e.props !== undefined && e.props !== null) {
      if (typeof e.props !== 'object' || Array.isArray(e.props)) {
        errors.push({ index: i, reason: 'props_must_be_object' })
        return
      }
      try {
        propsStr = JSON.stringify(e.props)
        if (propsStr.length > MAX_PROPS_BYTES) {
          errors.push({ index: i, reason: 'props_too_large' })
          return
        }
      } catch {
        errors.push({ index: i, reason: 'props_not_serialisable' })
        return
      }
    }

    rows.push([eventId, installationId, name, propsStr, occurredAt, now, appVersion])
  })

  // Batch insert. INSERT OR IGNORE makes re-uploads safe.
  if (rows.length > 0) {
    const stmt = env.DB.prepare(
      `INSERT OR IGNORE INTO events
         (event_id, installation_id, event_name, properties, occurred_at, received_at, app_version)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    const batch = rows.map(r => stmt.bind(...r))
    await env.DB.batch(batch)
  }

  // Also bump the installation's last_seen_at — receiving events implies the
  // app is alive even if no heartbeat happened to land in the same window.
  await env.DB.prepare(
    `UPDATE installations SET last_seen_at = ?1 WHERE installation_id = ?2`,
  )
    .bind(now, installationId)
    .run()

  return json({ ok: true, accepted: rows.length, rejected: errors.length, errors })
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
