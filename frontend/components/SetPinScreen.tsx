'use client'

import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'

type Props = {
  onDone: () => void
}

export default function SetPinScreen({ onDone }: Props) {
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [adminPin, setAdminPin] = useState('')
  const [confirmAdminPin, setConfirmAdminPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit() {
    setError('')

    if (pin.length < 4) {
      setError('PIN must be at least 4 characters')
      return
    }
    if (pin !== confirmPin) {
      setError('PINs do not match')
      return
    }
    if (adminPin.length < 4) {
      setError('Admin PIN must be at least 4 characters')
      return
    }
    if (adminPin !== confirmAdminPin) {
      setError('Admin PINs do not match')
      return
    }
    if (pin === adminPin) {
      setError('Admin PIN must be different from the main PIN')
      return
    }

    setLoading(true)
    try {
      await invoke('setup_db', { pin, adminPin })
      onDone()
    } catch (err: any) {
      setError(typeof err === 'string' ? err : 'Failed to set PIN')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl text-center">Set Up SHG Manager</CardTitle>
          <CardDescription className="text-center">
            Create a PIN to protect your data and an admin PIN for recovery
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Main PIN */}
          <div className="space-y-3">
            <p className="text-sm font-semibold text-foreground">Main PIN</p>
            <div className="space-y-2">
              <label htmlFor="pin" className="text-sm text-muted-foreground">PIN (min 4 characters)</label>
              <Input
                id="pin"
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Enter main PIN"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="confirmPin" className="text-sm text-muted-foreground">Confirm PIN</label>
              <Input
                id="confirmPin"
                type="password"
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value)}
                placeholder="Confirm main PIN"
              />
            </div>
          </div>

          <Separator />

          {/* Admin / Recovery PIN */}
          <div className="space-y-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Admin (Recovery) PIN</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Use this PIN to reset your main PIN if you forget it. Keep it safe and separate.
              </p>
            </div>
            <div className="space-y-2">
              <label htmlFor="adminPin" className="text-sm text-muted-foreground">Admin PIN (min 4 characters)</label>
              <Input
                id="adminPin"
                type="password"
                value={adminPin}
                onChange={(e) => setAdminPin(e.target.value)}
                placeholder="Enter admin PIN"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="confirmAdminPin" className="text-sm text-muted-foreground">Confirm Admin PIN</label>
              <Input
                id="confirmAdminPin"
                type="password"
                value={confirmAdminPin}
                onChange={(e) => setConfirmAdminPin(e.target.value)}
                placeholder="Confirm admin PIN"
                onKeyDown={(e) => e.key === 'Enter' && submit()}
              />
            </div>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button
            onClick={submit}
            className="w-full"
            disabled={loading || !pin || !confirmPin || !adminPin || !confirmAdminPin}
          >
            {loading ? 'Setting up...' : 'Set Up & Continue'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
