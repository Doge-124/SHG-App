'use client'

import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Loader2, ShieldCheck, ShieldAlert, ShieldX, WifiOff } from 'lucide-react'

export interface LicenseStatus {
  status:
    | 'not_activated'
    | 'active'
    | 'expired'
    | 'revoked'
    | 'wrong_machine'
    | 'suspended'
    | 'offline_grace_expired'
    | 'network_unreachable'
    | string
  licenseKey?: string | null
  customerName?: string | null
  expiresAt?: number | null
  gracePeriodEndsAt?: number | null
  daysUntilExpiry?: number | null
  daysInGraceRemaining?: number | null
  revokedReason?: string | null
  lastValidatedAt?: number | null
  offlineValidation: boolean
  message?: string | null
}

/**
 * Hard license gate. Runs before AuthLayout. Blocks the app entirely until a
 * valid, active license is confirmed (either live from the server or via the
 * 7-day offline cache).
 *
 * States that block the app: not_activated, revoked, wrong_machine, suspended,
 *                            offline_grace_expired.
 * States that warn but allow access: expired-with-grace.
 */
export function LicenseGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<LicenseStatus | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    setLoading(true)
    try {
      const s = await invoke<LicenseStatus>('get_license_status')
      setStatus(s)
    } catch (e) {
      setStatus({
        status: 'network_unreachable',
        offlineValidation: false,
        message: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!status) return null

  // ── Activation screen ────────────────────────────────────────────────
  if (status.status === 'not_activated') {
    return <ActivationScreen onActivated={refresh} />
  }

  // ── Hard blocks ──────────────────────────────────────────────────────
  if (status.status === 'revoked') {
    return (
      <BlockedScreen
        icon={<ShieldX className="h-12 w-12 text-red-600" />}
        title="License Revoked"
        message={status.revokedReason || status.message || 'This license has been revoked. Contact support.'}
        onRetry={refresh}
      />
    )
  }

  if (status.status === 'wrong_machine') {
    return (
      <BlockedScreen
        icon={<ShieldAlert className="h-12 w-12 text-amber-600" />}
        title="License Bound to Another Machine"
        message={status.message || 'This license is already activated on a different machine. Contact support to transfer.'}
        onRetry={refresh}
      />
    )
  }

  if (status.status === 'suspended') {
    return (
      <BlockedScreen
        icon={<ShieldAlert className="h-12 w-12 text-amber-600" />}
        title="License Suspended"
        message={status.message || 'This license has been suspended. Contact support.'}
        onRetry={refresh}
      />
    )
  }

  if (status.status === 'offline_grace_expired') {
    return (
      <BlockedScreen
        icon={<WifiOff className="h-12 w-12 text-amber-600" />}
        title="Offline Verification Expired"
        message={status.message || 'Cannot reach license server. Connect to the internet to continue.'}
        onRetry={refresh}
      />
    )
  }

  if (status.status === 'expired') {
    const inGrace = (status.daysInGraceRemaining ?? -1) >= 0
    if (!inGrace) {
      return (
        <BlockedScreen
          icon={<ShieldX className="h-12 w-12 text-red-600" />}
          title="License Expired"
          message={status.message || 'Your license has expired and the grace period has ended. Contact support to renew.'}
          onRetry={refresh}
        />
      )
    }
    // In grace: render a banner but allow access.
    return (
      <>
        <div className="bg-amber-100 border-b border-amber-300 text-amber-900 px-4 py-2 text-sm text-center">
          <ShieldAlert className="inline h-4 w-4 mr-1" />
          Your license expired. You have <strong>{status.daysInGraceRemaining}</strong> day(s) to renew before the app locks.
        </div>
        {children}
      </>
    )
  }

  // active (or any other unhandled non-blocking status)
  return <>{children}</>
}

// ─── Activation screen ──────────────────────────────────────────────────
function ActivationScreen({ onActivated }: { onActivated: () => void }) {
  const [key, setKey] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await invoke<LicenseStatus>('activate_license', { licenseKey: key.trim() })
      onActivated()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2"><ShieldCheck className="h-10 w-10 text-primary" /></div>
          <CardTitle>Activate SHG Manager</CardTitle>
          <CardDescription>Enter your license key to activate this installation.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Input
                value={key}
                onChange={(e) => setKey(e.target.value.toUpperCase())}
                placeholder="SHG-XXXX-XXXX-XXXX-XXXX"
                autoFocus
                disabled={submitting}
                className="font-mono text-center tracking-wider"
                maxLength={24}
              />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertTitle>Activation Failed</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" disabled={submitting || key.length < 5} className="w-full">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Activate
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Don&apos;t have a license? Contact your administrator.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Blocked screen ─────────────────────────────────────────────────────
function BlockedScreen({
  icon, title, message, onRetry,
}: {
  icon: React.ReactNode
  title: string
  message: string
  onRetry: () => void
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2">{icon}</div>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground text-center">{message}</p>
          <Button variant="outline" onClick={onRetry} className="w-full">
            Retry
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
