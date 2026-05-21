/**
 * Lightweight wrapper around the `track_event` Tauri command.
 *
 * Usage:
 *   import { track } from '@/lib/track'
 *   track('loan.issued', { loan_type: 'weekly', amount_bucket: 'medium' })
 *
 * Privacy:
 *   - NEVER pass member names, phone numbers, addresses, or specific amounts.
 *   - Bucket numeric values (e.g. amount_bucket: small/medium/large) instead
 *     of sending exact figures.
 *   - Properties stay on the customer's machine for ~5 min then go to our
 *     own backend (Cloudflare Worker → D1). Not visible to anyone but us.
 *
 * Failure mode:
 *   Track calls never throw. If the backend is unconfigured, the queue file
 *   can't be written, or the network is offline, the event is simply lost
 *   (or queued for next flush). UI code can always safely call `track(...)`.
 */
import { invoke } from '@tauri-apps/api/core'

type EventProps = Record<string, string | number | boolean | null>

export function track(name: string, properties?: EventProps): void {
  // Fire-and-forget. Don't await — Tauri call should be fast (~ms) but we
  // never want a UI action to wait on telemetry.
  invoke('track_event', { name, properties: properties ?? null }).catch(err => {
    // Log but never re-throw. Telemetry failures must not break the app.
    console.debug('[track]', name, 'failed:', err)
  })
}
