'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { getAllSettings } from '@/lib/api/settings'

type Theme = 'light' | 'dark' | 'system'
type Language = 'english' | 'hindi' | 'tamil'

interface AppearanceContextType {
  theme: Theme
  language: Language
  setTheme: (theme: Theme) => void
  setLanguage: (language: Language) => void
  isLoading: boolean
  refreshSettings: () => Promise<void>
}

const AppearanceContext = createContext<AppearanceContextType | undefined>(undefined)

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light')
  const [language, setLanguageState] = useState<Language>('english')
  const [isLoading, setIsLoading] = useState(true)

  const loadSettings = async (silent = false) => {
    if (!silent) setIsLoading(true)
    try {
      const response = await getAllSettings()
      if (response.success && response.data) {
        setThemeState(response.data.appearance.theme as Theme)
        setLanguageState(response.data.appearance.language as Language)
      }
      // If DB is not unlocked yet, settings stay at defaults — caller is responsible
      // for calling refreshSettings() once the DB is available.
    } catch {
      // Silently ignore — DB may not be unlocked yet on first mount.
    } finally {
      if (!silent) setIsLoading(false)
    }
  }

  // Load once on mount (may be a no-op if DB is not yet unlocked).
  useEffect(() => {
    loadSettings()
  }, [])

  // Apply theme class to <html> whenever theme state changes.
  useEffect(() => {
    const root = window.document.documentElement
    root.classList.remove('light', 'dark')
    if (theme === 'system') {
      root.classList.add(
        window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      )
    } else {
      root.classList.add(theme)
    }
  }, [theme])

  const setTheme = (newTheme: Theme) => setThemeState(newTheme)
  const setLanguage = (newLanguage: Language) => setLanguageState(newLanguage)
  const refreshSettings = () => loadSettings(true)

  return (
    <AppearanceContext.Provider value={{ theme, language, setTheme, setLanguage, isLoading, refreshSettings }}>
      {children}
    </AppearanceContext.Provider>
  )
}

export function useAppearance() {
  const context = useContext(AppearanceContext)
  if (context === undefined) {
    throw new Error('useAppearance must be used within an AppearanceProvider')
  }
  return context
}
