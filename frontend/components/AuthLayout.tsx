'use client'

import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import PinScreen from './PinScreen'
import SetPinScreen from './SetPinScreen'
import ResetPinScreen from './ResetPinScreen'
import { useAppearance } from '@/lib/appearance-context'

type Mode = 'checking' | 'set' | 'unlock' | 'reset' | 'app'

type Props = {
  children: React.ReactNode
}

export default function AuthLayout({ children }: Props) {
  const [mode, setMode] = useState<Mode>('checking')
  const { refreshSettings } = useAppearance()

  useEffect(() => {
    ;(async () => {
      try {
        const exists = await invoke<boolean>('has_security')
        setMode(exists ? 'unlock' : 'set')
      } catch {
        setMode('set')
      }
    })()
  }, [])

  const handleUnlocked = () => {
    refreshSettings()
    setMode('app')
    // Fire-and-forget: pick up any pending remote support requests for
    // this install (admin-queued diagnostics, integrity checks). DB is
    // unlocked at this point so commands that need it can run.
    invoke('run_support_inbox').catch(() => {})
    // Run an automatic cloud backup if one is due per the user's schedule.
    invoke('run_cloud_backup_if_due').catch(() => {})
  }

  // While the app stays open, re-check whether a scheduled cloud backup is due
  // (covers long-running sessions that cross a day/week boundary).
  useEffect(() => {
    if (mode !== 'app') return
    const id = setInterval(() => {
      invoke('run_cloud_backup_if_due').catch(() => {})
    }, 6 * 60 * 60 * 1000) // every 6 hours
    return () => clearInterval(id)
  }, [mode])

  if (mode === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-lg">Loading...</div>
      </div>
    )
  }

  if (mode === 'set') {
    return <SetPinScreen onDone={handleUnlocked} />
  }

  if (mode === 'unlock') {
    return (
      <PinScreen
        onUnlocked={handleUnlocked}
        onForgotPin={() => setMode('reset')}
      />
    )
  }

  if (mode === 'reset') {
    return (
      <ResetPinScreen
        onReset={handleUnlocked}
        onBack={() => setMode('unlock')}
      />
    )
  }

  return <>{children}</>
}
