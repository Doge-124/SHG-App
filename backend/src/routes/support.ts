import type { Env } from '../env'

/**
 * Remote support inbox.
 *
 * Public (desktop, anonymous — gated only by knowing your own installation_id):
 *   POST /support/poll      → returns pending commands for this install
 *   POST /support/result    → uploads the result of one command
 *
 * Admin (bearer token):
 *   POST   /admin/support/command            → queue a command
 *   GET    /admin/support/commands.json      → list all (filterable)
 *   DELETE /admin/support/command/:id        → cancel a pending command
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ALLOWED_COMMANDS = new Set(['collect_diagnostic', 'collect_integrity'])
const MAX_PAYLOAD_BYTES = 64 * 1024  // 64 KB — diagnostics are small JSON, refuse log dumps

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

function unauthorised(): Response {
  return new Response('Unauthorized', { status: 401 })
}

// ─── POST /support/poll ──────────────────────────────────────────────────
export async function handleSupportPoll(req: Request, env: Env): Promise<Response> {
  let body: { installationId?: unknown }
  try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }

  const installationId = typeof body.installationId === 'string' ? body.installationId : ''
  if (!UUID_RE.test(installationId)) {
    return json({ error: 'invalid_installation_id' }, 400)
  }

  const { results } = await env.DB.prepare(
    `SELECT id, command, note, created_at
     FROM support_commands
     WHERE installation_id = ?1 AND status = 'pending'
     ORDER BY created_at ASC
     LIMIT 10`,
  ).bind(installationId).all<{ id: number; command: string; note: string | null; created_at: number }>()

  const now = Date.now()
  const ids = (results ?? []).map(r => r.id)
  if (ids.length > 0) {
    // Mark as dispatched so admin sees the desktop picked them up.
    const placeholders = ids.map((_, i) => `?${i + 2}`).join(',')
    await env.DB.prepare(
      `UPDATE support_commands SET dispatched_at = ?1
       WHERE id IN (${placeholders}) AND dispatched_at IS NULL`,
    ).bind(now, ...ids).run()
  }

  return json({
    ok: true,
    commands: (results ?? []).map(r => ({
      id: r.id,
      command: r.command,
      note: r.note,
      createdAt: r.created_at,
    })),
  })
}

// ─── POST /support/result ────────────────────────────────────────────────
export async function handleSupportResult(req: Request, env: Env): Promise<Response> {
  let body: {
    id?: unknown
    installationId?: unknown
    ok?: unknown
    payload?: unknown
    error?: unknown
  }
  try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }

  const id = typeof body.id === 'number' ? body.id : NaN
  const installationId = typeof body.installationId === 'string' ? body.installationId : ''
  const ok = body.ok === true
  if (!Number.isFinite(id) || !UUID_RE.test(installationId)) {
    return json({ error: 'invalid_request' }, 400)
  }

  // Confirm the command belongs to this installation — stops a misbehaving
  // client from clobbering someone else's pending row (modulo guessing UUIDs).
  const row = await env.DB.prepare(
    `SELECT id FROM support_commands
     WHERE id = ?1 AND installation_id = ?2`,
  ).bind(id, installationId).first()
  if (!row) return json({ error: 'command_not_found' }, 404)

  const payloadJson = body.payload === undefined
    ? null
    : JSON.stringify(body.payload).slice(0, MAX_PAYLOAD_BYTES)
  const errorText = typeof body.error === 'string' ? body.error.slice(0, 2000) : null

  await env.DB.prepare(
    `UPDATE support_commands
     SET status = ?1, completed_at = ?2, result_payload = ?3, error = ?4
     WHERE id = ?5`,
  ).bind(
    ok ? 'completed' : 'failed',
    Date.now(),
    payloadJson,
    errorText,
    id,
  ).run()

  return json({ ok: true })
}

// ─── POST /admin/support/command ─────────────────────────────────────────
export async function handleQueueSupportCommand(req: Request, env: Env): Promise<Response> {
  if (!isAuthorised(req, env)) return unauthorised()

  let body: { installationId?: unknown; command?: unknown; note?: unknown }
  try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }

  const installationId = typeof body.installationId === 'string' ? body.installationId : ''
  const command = typeof body.command === 'string' ? body.command : ''
  const note = typeof body.note === 'string' ? body.note.slice(0, 200) : null

  if (!UUID_RE.test(installationId)) return json({ error: 'invalid_installation_id' }, 400)
  if (!ALLOWED_COMMANDS.has(command))  return json({ error: 'unknown_command' }, 400)

  // Coalesce: don't double-queue the same pending command for the same install.
  const existing = await env.DB.prepare(
    `SELECT id FROM support_commands
     WHERE installation_id = ?1 AND command = ?2 AND status = 'pending'`,
  ).bind(installationId, command).first<{ id: number }>()
  if (existing) {
    return json({ ok: true, id: existing.id, coalesced: true })
  }

  const r = await env.DB.prepare(
    `INSERT INTO support_commands (installation_id, command, status, created_at, note)
     VALUES (?1, ?2, 'pending', ?3, ?4)
     RETURNING id`,
  ).bind(installationId, command, Date.now(), note).first<{ id: number }>()

  return json({ ok: true, id: r?.id })
}

// ─── GET /admin/support/commands.json ────────────────────────────────────
export async function handleListSupportCommands(req: Request, env: Env): Promise<Response> {
  if (!isAuthorised(req, env)) return unauthorised()
  const url = new URL(req.url)
  const filterInstall = url.searchParams.get('installation') ?? ''

  let stmt
  if (filterInstall && UUID_RE.test(filterInstall)) {
    stmt = env.DB.prepare(
      `SELECT * FROM support_commands WHERE installation_id = ?1
       ORDER BY created_at DESC LIMIT 200`,
    ).bind(filterInstall)
  } else {
    stmt = env.DB.prepare(
      `SELECT * FROM support_commands ORDER BY created_at DESC LIMIT 200`,
    )
  }
  const { results } = await stmt.all()
  return json({ commands: results ?? [], generatedAt: new Date().toISOString() })
}

// ─── DELETE /admin/support/command/:id ───────────────────────────────────
export async function handleCancelSupportCommand(req: Request, env: Env, id: number): Promise<Response> {
  if (!isAuthorised(req, env)) return unauthorised()
  if (!Number.isFinite(id)) return json({ error: 'invalid_id' }, 400)

  await env.DB.prepare(
    `UPDATE support_commands SET status = 'cancelled'
     WHERE id = ?1 AND status = 'pending'`,
  ).bind(id).run()
  return json({ ok: true })
}
