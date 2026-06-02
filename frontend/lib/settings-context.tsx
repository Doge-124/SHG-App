'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { getAllSettings, getPastDataLockStatus } from '@/lib/api/settings'
import { cacheGroupName } from '@/lib/auto-print'
import type { AppSettings } from '@/lib/types'

interface SettingsContextType {
  settings: AppSettings | null
  isLoading: boolean
  error: string | null
  pastDataLocked: boolean
  refreshSettings: () => Promise<void>
  updateSettings: (newSettings: AppSettings) => void
  refreshPastDataLock: () => Promise<void>
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pastDataLocked, setPastDataLocked] = useState(false)

  const loadSettings = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const [settingsRes, lockRes] = await Promise.all([
        getAllSettings(),
        getPastDataLockStatus(),
      ])
      if (settingsRes.success && settingsRes.data) {
        setSettings(settingsRes.data)
        // Cache the group name so auto-printed receipts/vouchers carry the
        // same header as manually printed ones.
        cacheGroupName(settingsRes.data.general?.groupName)
      } else {
        setError(settingsRes.error || 'Failed to load settings')
      }
      if (lockRes.success && lockRes.data !== undefined) {
        setPastDataLocked(lockRes.data)
      }
    } catch (error) {
      setError('Failed to load settings')
    } finally {
      setIsLoading(false)
    }
  }

  const refreshSettings = async () => { await loadSettings() }

  const refreshPastDataLock = async () => {
    const res = await getPastDataLockStatus()
    if (res.success && res.data !== undefined) setPastDataLocked(res.data)
  }

  const updateSettings = (newSettings: AppSettings) => { setSettings(newSettings) }

  useEffect(() => { loadSettings() }, [])

  return (
    <SettingsContext.Provider value={{
      settings,
      isLoading,
      error,
      pastDataLocked,
      refreshSettings,
      updateSettings,
      refreshPastDataLock,
    }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  const context = useContext(SettingsContext)
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider')
  }
  return context
}
