'use client'

import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, ShieldAlert } from 'lucide-react'

/**
 * Prompts for the admin PIN, then calls onConfirm with it. Designed for
 * gating sensitive actions (edit past data, delete past entries).
 *
 * The actual command invocation is the caller's job — this dialog just
 * collects the PIN and passes it along. That way the caller can wrap the
 * PIN into its own typed invoke() call without this component knowing
 * anything about the action being performed.
 */
export function AdminPinDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive = false,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  confirmLabel?: string
  destructive?: boolean
  onConfirm: (adminPin: string) => Promise<void>
}) {
  const [pin, setPin] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) { setPin(''); setError(null); setSubmitting(false) }
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pin) { setError('Admin PIN is required.'); return }
    setSubmitting(true)
    setError(null)
    try {
      // Verify first so we can show a clear error before running the action.
      const ok = await invoke<boolean>('verify_master_password', { password: pin })
      if (!ok) {
        setError('Incorrect admin PIN.')
        setSubmitting(false)
        return
      }
      await onConfirm(pin)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className={`h-5 w-5 ${destructive ? 'text-red-600' : 'text-amber-600'}`} />
            {title}
          </DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div>
            <Input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Admin PIN"
              autoFocus
              disabled={submitting}
              autoComplete="off"
            />
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter className="sm:justify-end gap-2">
            <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !pin} variant={destructive ? 'destructive' : 'default'}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
