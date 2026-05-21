'use client'

import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { check as checkUpdate } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, ArrowDownToLine, AlertTriangle } from 'lucide-react'

interface VersionPolicy {
  currentVersion: string
  minSupportedVersion: string | null
  allowed: boolean
  message: string | null
}

/**
 * Force-update gate. Sits above LicenseGate so an obsolete client is blocked
 * before any other server interaction. Fail-open on network errors — a flaky
 * connection won't lock anyone out.
 */
export function VersionGate({ children }: { children: React.ReactNode }) {
  const [policy, setPolicy] = useState<VersionPolicy | null>(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)

  useEffect(() => {
    invoke<VersionPolicy>('get_version_policy')
      .then(setPolicy)
      .catch(() => setPolicy({
        currentVersion: '?',
        minSupportedVersion: null,
        allowed: true,
        message: null,
      }))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!policy || policy.allowed) return <>{children}</>

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2"><AlertTriangle className="h-12 w-12 text-amber-600" /></div>
          <CardTitle>Update Required</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground text-center">
            {policy.message ?? 'A required update is available.'}
          </p>
          <div className="text-xs text-muted-foreground text-center space-y-1">
            <div>Installed: <span className="font-mono">v{policy.currentVersion}</span></div>
            {policy.minSupportedVersion && (
              <div>Required: <span className="font-mono">v{policy.minSupportedVersion}</span> or later</div>
            )}
          </div>
          {updateError && (
            <Alert variant="destructive">
              <AlertDescription>{updateError}</AlertDescription>
            </Alert>
          )}
          <Button
            disabled={updating}
            className="w-full"
            onClick={async () => {
              setUpdateError(null)
              setUpdating(true)
              try {
                const update = await checkUpdate()
                if (!update) {
                  setUpdateError('No installer found on the latest release yet. Try again shortly.')
                  return
                }
                await update.downloadAndInstall()
                await relaunch()
              } catch (e) {
                setUpdateError(e instanceof Error ? e.message : String(e))
              } finally {
                setUpdating(false)
              }
            }}
          >
            {updating
              ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Downloading…</>
              : <><ArrowDownToLine className="h-4 w-4 mr-2" />Update Now</>}
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            The app will restart automatically once the update is installed.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
