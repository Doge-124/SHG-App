// Cloudflare bindings + secrets surface for the Worker.

export interface Env {
  DB: D1Database
  // Set via `wrangler secret put ADMIN_TOKEN`
  ADMIN_TOKEN: string
  // Public env
  ENV: string
}
