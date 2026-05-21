/**
 * SHG Manager backend — Cloudflare Worker entry point.
 *
 * Routes:
 *   POST /heartbeat       — anonymous, called by desktop app on launch
 *   GET  /admin           — server-rendered HTML dashboard (admin token auth)
 *   GET  /admin/installations.json — JSON API for the dashboard
 *   GET  /                — health check
 */

import type { Env } from './env'
import { handleHeartbeat } from './routes/heartbeat'
import { handleAdminDashboard, handleAdminInstallationsJson } from './routes/admin'

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)

    // Heartbeat — anonymous, no auth
    if (url.pathname === '/heartbeat' && req.method === 'POST') {
      return handleHeartbeat(req, env)
    }

    // Admin dashboard — bearer token auth
    if (url.pathname === '/admin' && req.method === 'GET') {
      return handleAdminDashboard(req, env)
    }

    if (url.pathname === '/admin/installations.json' && req.method === 'GET') {
      return handleAdminInstallationsJson(req, env)
    }

    // Health check
    if (url.pathname === '/' && req.method === 'GET') {
      return new Response(
        JSON.stringify({
          name: 'shg-manager-api',
          status: 'ok',
          time: new Date().toISOString(),
        }),
        { headers: { 'content-type': 'application/json' } },
      )
    }

    return new Response('Not Found', { status: 404 })
  },
} satisfies ExportedHandler<Env>
