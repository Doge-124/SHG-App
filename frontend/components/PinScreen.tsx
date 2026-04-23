'use client'

import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
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

  async function submit() {
    setError('')
    setLoading(true)
    try {
      await invoke('unlock_db', { pin })
      onUnlocked()
    } catch {
      setError('Invalid PIN')
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
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button onClick={submit} className="w-full" disabled={loading || !pin}>
            {loading ? 'Unlocking...' : 'Unlock'}
          </Button>

          <button
            type="button"
            className="w-full text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline transition-colors"
            onClick={onForgotPin}
          >
            Forgot PIN? Reset using admin PIN
          </button>
        </CardContent>
      </Card>
    </div>
  )
}
