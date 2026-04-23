'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { getAllSettings } from '@/lib/api/settings'
import type { AppSettings } from '@/lib/types'

interface SettingsContextType {
  settings: AppSettings | null
  isLoading: boolean
  error: string | null
  refreshSettings: () => Promise<void>
  updateSettings: (newSettings: AppSettings) => void
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadSettings = async () => {
    setIsLoading(true)
    setError(null)
    
    try {
      const response = await getAllSettings()
      if (response.success && response.data) {
        setSettings(response.data)
      } else {
        setError(response.error || 'Failed to load settings')
      }
    } catch (error) {
      console.error('Failed to load settings:', error)
      setError('Failed to load settings')
    } finally {
      setIsLoading(false)
    }
  }

  const refreshSettings = async () => {
    await loadSettings()
  }

  const updateSettings = (newSettings: AppSettings) => {
    setSettings(newSettings)
  }

  useEffect(() => {
    loadSettings()
  }, [])

  return (
    <SettingsContext.Provider value={{ 
      settings, 
      isLoading, 
      error, 
      refreshSettings,
      updateSettings
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
