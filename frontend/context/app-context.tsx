'use client'

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import type {
  Member,
  Loan,
  ChitGroup,
  DashboardStats,
  Transaction,
  ChitCycleAlert,
} from '@/lib/types'
import { getMembers } from '@/lib/api/members'
import { getLoans } from '@/lib/api/loans'
import { getChitGroups } from '@/lib/api/chits'
import { getDashboardStats, getRecentTransactions, getUpcomingChitAlerts } from '@/lib/api/ledger'

interface AppContextType {
  // Members
  members: Member[]
  loadingMembers: boolean
  refreshMembers: () => Promise<void>
  
  // Loans
  loans: Loan[]
  loadingLoans: boolean
  refreshLoans: () => Promise<void>
  
  // Chit Groups
  chitGroups: ChitGroup[]
  loadingChitGroups: boolean
  refreshChitGroups: () => Promise<void>
  
  // Dashboard
  dashboardStats: DashboardStats | null
  recentTransactions: Transaction[]
  chitAlerts: ChitCycleAlert[]
  loadingDashboard: boolean
  refreshDashboard: () => Promise<void>
  
  // Global loading state
  isLoading: boolean
}

const AppContext = createContext<AppContextType | undefined>(undefined)

export function AppProvider({ children }: { children: ReactNode }) {
  // Members state
  const [members, setMembers] = useState<Member[]>([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  
  // Loans state
  const [loans, setLoans] = useState<Loan[]>([])
  const [loadingLoans, setLoadingLoans] = useState(false)
  
  // Chit Groups state
  const [chitGroups, setChitGroups] = useState<ChitGroup[]>([])
  const [loadingChitGroups, setLoadingChitGroups] = useState(false)
  
  // Dashboard state
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null)
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([])
  const [chitAlerts, setChitAlerts] = useState<ChitCycleAlert[]>([])
  const [loadingDashboard, setLoadingDashboard] = useState(false)

  const refreshMembers = useCallback(async () => {
    setLoadingMembers(true)
    try {
      const response = await getMembers()
      if (response.success && response.data) {
        setMembers(response.data)
      }
    } catch (error) {
      console.error('Failed to load members:', error)
    } finally {
      setLoadingMembers(false)
    }
  }, [])

  const refreshLoans = useCallback(async () => {
    setLoadingLoans(true)
    try {
      const response = await getLoans()
      if (response.success && response.data) {
        setLoans(response.data)
      }
    } catch (error) {
      console.error('Failed to load loans:', error)
    } finally {
      setLoadingLoans(false)
    }
  }, [])

  const refreshChitGroups = useCallback(async () => {
    setLoadingChitGroups(true)
    try {
      const response = await getChitGroups()
      if (response.success && response.data) {
        setChitGroups(response.data)
      }
    } catch (error) {
      console.error('Failed to load chit groups:', error)
    } finally {
      setLoadingChitGroups(false)
    }
  }, [])

  const refreshDashboard = useCallback(async () => {
    setLoadingDashboard(true)
    try {
      const [statsRes, transactionsRes, alertsRes] = await Promise.all([
        getDashboardStats(),
        getRecentTransactions(),
        getUpcomingChitAlerts(),
      ])

      if (statsRes.success && statsRes.data) {
        setDashboardStats(statsRes.data)
      }
      if (transactionsRes.success && transactionsRes.data) {
        setRecentTransactions(transactionsRes.data)
      }
      if (alertsRes.success && alertsRes.data) {
        setChitAlerts(alertsRes.data)
      }
    } catch (error) {
      console.error('Failed to load dashboard:', error)
    } finally {
      setLoadingDashboard(false)
    }
  }, [])

  const isLoading = loadingMembers || loadingLoans || loadingChitGroups || loadingDashboard

  return (
    <AppContext.Provider
      value={{
        members,
        loadingMembers,
        refreshMembers,
        loans,
        loadingLoans,
        refreshLoans,
        chitGroups,
        loadingChitGroups,
        refreshChitGroups,
        dashboardStats,
        recentTransactions,
        chitAlerts,
        loadingDashboard,
        refreshDashboard,
        isLoading,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const context = useContext(AppContext)
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider')
  }
  return context
}
