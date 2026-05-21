/**
 * SHG Manager backend — Cloudflare Worker entry point.
 *
 * Public routes (called by desktop app, anonymous):
 *   POST /heartbeat              — version + last-seen ping
 *   POST /events                 — batch feature usage events
 *   POST /license/activate       — first-time license activation
 *   POST /license/validate       — per-launch license check
 *
 * Admin routes (bearer token auth, used by the dev):
 *   GET  /admin                       — server-rendered HTML dashboard
 *   GET  /admin/installations.json    — JSON dump for the dashboard
 *   GET  /admin/licenses.json         — JSON list of licenses
 *   POST /admin/license               — issue a new license
 *   POST /admin/license/:key/revoke   — revoke
 *   POST /admin/license/:key/unbind   — clear binding (for machine transfer)
 *   POST /admin/license/:key/extend   — update expiry
 *   DELETE /admin/license/:key        — hard delete
 *
 *   GET  /                       — health check
 */

import type { Env } from './env'
import { handleHeartbeat } from './routes/heartbeat'
import { handleEvents } from './routes/events'
import { handleLicenseActivate, handleLicenseValidate } from './routes/license'
import { handleAdminDashboard, handleAdminInstallationsJson } from './routes/admin'
import {
  handleIssueLicense,
  handleListLicenses,
  handleRevokeLicense,
  handleUnbindLicense,
  handleExtendLicense,
  handleReactivateLicense,
  handleRebindLicense,
  handleDeleteLicense,
} from './routes/admin-licenses'

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname

    // ── Public app routes ────────────────────────────────────────────
    if (req.method === 'POST') {
      if (path === '/heartbeat')          return handleHeartbeat(req, env)
      if (path === '/events')             return handleEvents(req, env)
      if (path === '/license/activate')   return handleLicenseActivate(req, env)
      if (path === '/license/validate')   return handleLicenseValidate(req, env)
      if (path === '/admin/license')      return handleIssueLicense(req, env)

      // /admin/license/<key>/{revoke,unbind,extend,reactivate,rebind}
      const m = path.match(/^\/admin\/license\/([^/]+)\/(revoke|unbind|extend|reactivate|rebind)$/)
      if (m) {
        const key = decodeURIComponent(m[1])
        if (m[2] === 'revoke')     return handleRevokeLicense(req, env, key)
        if (m[2] === 'unbind')     return handleUnbindLicense(req, env, key)
        if (m[2] === 'extend')     return handleExtendLicense(req, env, key)
        if (m[2] === 'reactivate') return handleReactivateLicense(req, env, key)
        if (m[2] === 'rebind')     return handleRebindLicense(req, env, key)
      }
    }

    if (req.method === 'DELETE') {
      const m = path.match(/^\/admin\/license\/([^/]+)$/)
      if (m) return handleDeleteLicense(req, env, decodeURIComponent(m[1]))
    }

    if (req.method === 'GET') {
      if (path === '/admin')                       return handleAdminDashboard(req, env)
      if (path === '/admin/installations.json')    return handleAdminInstallationsJson(req, env)
      if (path === '/admin/licenses.json')         return handleListLicenses(req, env)
      if (path === '/') {
        return new Response(
          JSON.stringify({
            name: 'shg-manager-api',
            status: 'ok',
            time: new Date().toISOString(),
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      }
    }

    return new Response('Not Found', { status: 404 })
  },
} satisfies ExportedHandler<Env>
