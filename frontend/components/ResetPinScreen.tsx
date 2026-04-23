'use client'

import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

type Props = {
  onReset: () => void
  onBack: () => void
}

export default function ResetPinScreen({ onReset, onBack }: Props) {
  const [adminPin, setAdminPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit() {
    setError('')

    if (newPin.length < 4) {
      setError('New PIN must be at least 4 characters')
      return
    }
    if (newPin !== confirmPin) {
      setError('New PINs do not match')
      return
    }
    if (adminPin === newPin) {
      setError('New PIN must be different from the admin PIN')
      return
    }

    setLoading(true)
    try {
      await invoke('reset_pin', { adminPin, newPin })
      onReset()
    } catch (err: any) {
      const msg = typeof err === 'string' ? err : 'Reset failed'
      setError(msg.includes('Incorrect') ? 'Incorrect admin PIN' : msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl text-center">Reset PIN</CardTitle>
          <CardDescription className="text-center">
            Enter your admin PIN to set a new main PIN
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="adminPin" className="text-sm font-medium">Admin PIN</label>
            <Input
              id="adminPin"
              type="password"
              value={adminPin}
              onChange={(e) => setAdminPin(e.target.value)}
              placeholder="Enter your admin PIN"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="newPin" className="text-sm font-medium">New PIN</label>
            <Input
              id="newPin"
              type="password"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value)}
              placeholder="Enter new PIN"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="confirmPin" className="text-sm font-medium">Confirm New PIN</label>
            <Input
              id="confirmPin"
              type="password"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value)}
              placeholder="Confirm new PIN"
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button
            onClick={submit}
            className="w-full"
            disabled={loading || !adminPin || !newPin || !confirmPin}
          >
            {loading ? 'Resetting...' : 'Reset PIN'}
          </Button>

          <Button variant="ghost" className="w-full" onClick={onBack}>
            Back to Login
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
