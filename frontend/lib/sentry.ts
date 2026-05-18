/**
 * Sentry initialisation for the frontend.
 *
 * Activates only when NEXT_PUBLIC_SENTRY_DSN is set at build time.
 * Without it, the app runs normally with no Sentry calls.
 *
 * Respects the per-installation `crash_reporting_enabled` flag via beforeSend,
 * which is queried from the Tauri backend (cached after first call).
 */
'use client'

import * as Sentry from '@sentry/react'
import { invoke } from '@tauri-apps/api/core'

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN

let crashReportingEnabled: boolean | null = null
let installationId: string | null = null
let initialised = false

async function refreshFlags() {
  try {
    const status = await invoke<{ configured: boolean; enabled: boolean }>('get_crash_reporting_status')
    crashReportingEnabled = status.enabled
  } catch {
    crashReportingEnabled = false
  }
  try {
    const info = await invoke<{ installationId: string }>('get_installation_id')
    installationId = info.installationId
    if (installationId) {
      Sentry.setUser({ id: installationId })
      Sentry.setTag('installation_id', installationId)
    }
  } catch {
    // ignore
  }
}

/** Re-read the toggle from the backend (after the user changes it in Settings). */
export async function refreshCrashReportingFlag() {
  await refreshFlags()
}

export function initSentry() {
  if (initialised) return
  initialised = true

  if (!DSN) {
    // Build was made without SENTRY_DSN env var — no-op.
    return
  }

  Sentry.init({
    dsn: DSN,
    environment: process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_APP_VERSION || 'unknown',
    sampleRate: 1.0,
    tracesSampleRate: 0,      // no performance traces — preserves quota
    sendDefaultPii: false,    // never send IP, username, etc.
    maxBreadcrumbs: 50,
    beforeSend(event) {
      // Honour the user's runtime opt-out. Block until first read completes.
      if (crashReportingEnabled === false) return null
      return scrubEvent(event)
    },
  })

  // Kick off async flag load — events that fire before this completes will be
  // queued by the SDK and re-evaluated when sent.
  void refreshFlags()
}

function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  // Strip 10+ digit runs from message/exception strings — likely phone numbers.
  const scrub = (s: string | undefined): string | undefined =>
    s?.replace(/\d{10,}/g, '[REDACTED_PHONE]')

  if (event.message) event.message = scrub(event.message) ?? event.message
  if (event.exception?.values) {
    event.exception.values = event.exception.values.map(v => ({
      ...v,
      value: scrub(v.value) ?? v.value,
    }))
  }
  return event
}

export { Sentry }
