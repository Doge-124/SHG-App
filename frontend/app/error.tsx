'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log to console in dev; in production a real error service could go here
    console.error('[GlobalError]', error)
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">Something went wrong</h1>
          <p className="text-muted-foreground">
            An unexpected error occurred. Your data is safe — this is a display issue only.
          </p>
          {error.message && (
            <p className="text-xs text-muted-foreground font-mono bg-muted rounded px-3 py-2 mt-3">
              {error.message}
            </p>
          )}
        </div>
        <Button onClick={reset}>Try Again</Button>
      </div>
    </div>
  )
}
