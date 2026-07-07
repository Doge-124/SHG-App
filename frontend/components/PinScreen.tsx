'use client'

import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { check as checkUpdate } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

type Props = {
  onUnlocked: () => void
  onForgotPin: () => void
}

export default function PinScreen({ onUnlocked, onForgotPin }: Props) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [updateMsg, setUpdateMsg] = useState('')

  // A "hard" failure (not a plain wrong PIN) can be the symptom of a bad update
  // that broke the database open — in which case pulling a fix-forward update is
  // the recovery path, even though the app never got past this screen.
  const unlockFailedHard = !!error && error !== 'Invalid PIN'

  async function checkForUpdates() {
    setUpdateMsg('')
    setUpdating(true)
    try {
      const update = await checkUpdate()
      if (!update) {
        setUpdateMsg('You are on the latest version. If the problem persists, contact support.')
        return
      }
      setUpdateMsg(`Downloading update to v${update.version}…`)
      await update.downloadAndInstall()
      await relaunch()
    } catch (e) {
      setUpdateMsg(typeof e === 'string' ? e : (e as Error)?.message ?? 'Could not check for updates')
    } finally {
      setUpdating(false)
    }
  }

  async function submit() {
    setError('')
    setLoading(true)
    try {
      await invoke('unlock_db', { pin })
      onUnlocked()
    } catch (e) {
      // A wrong PIN fails to decrypt; anything else (e.g. a migration error)
      // surfaces its real message so it isn't misdiagnosed as a bad PIN.
      const msg = typeof e === 'string' ? e : (e as Error)?.message ?? ''
      const looksLikeBadKey = /not a database|decrypt|HMAC|file is encrypted|malformed/i.test(msg)
      setError(!msg || looksLikeBadKey ? 'Invalid PIN' : msg)
      setPin('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl text-center">SHG Manager</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="pin" className="text-sm font-medium">Enter PIN</label>
            <Input
              id="pin"
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Enter your PIN"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>
                {error}
                {unlockFailedHard && (
                  <span className="block mt-1 text-xs">
                    If this started after an app update, check for a fix below.
                  </span>
                )}
              </AlertDescription>
            </Alert>
          )}

          <Button onClick={submit} className="w-full" disabled={loading || !pin}>
            {loading ? 'Unlocking...' : 'Unlock'}
          </Button>

          {unlockFailedHard && (
            <Button
              variant="outline"
              className="w-full"
              onClick={checkForUpdates}
              disabled={updating}
            >
              {updating ? 'Checking…' : 'Check for updates'}
            </Button>
          )}

          {updateMsg && (
            <p className="text-xs text-center text-muted-foreground">{updateMsg}</p>
          )}

          <button
            type="button"
            className="w-full text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline transition-colors"
            onClick={onForgotPin}
          >
            Forgot PIN? Reset using admin PIN
          </button>

          {!unlockFailedHard && (
            <button
              type="button"
              className="w-full text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline transition-colors"
              onClick={checkForUpdates}
              disabled={updating}
            >
              {updating ? 'Checking for updates…' : 'Check for updates'}
            </button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
