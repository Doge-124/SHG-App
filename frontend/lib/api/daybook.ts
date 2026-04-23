/**
 * Day Book API
 * 
 * API layer for fetching day book data from the backend.
 */

import { invoke } from '@tauri-apps/api/core'
import type { DayBookSummary, DayBookFilters, DayBookEntry } from '@/lib/types/daybook'

export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

/**
 * Get day book summary for a date range
 */
export async function getDayBook(
  startDate: string,
  endDate: string
): Promise<ApiResponse<DayBookSummary>> {
  try {
    const result = await invoke<DayBookSummary>('get_day_book', {
      startDate,
      endDate,
    })
    return { success: true, data: result }
  } catch (error: any) {
    return {
      success: false,
      error: error.toString(),
    }
  }
}

/**
 * Get day book for a single date
 */
export async function getDayBookForDate(
  date: string
): Promise<ApiResponse<DayBookSummary>> {
  try {
    const result = await invoke<DayBookSummary>('get_day_book_for_date', {
      date,
    })
    return { success: true, data: result }
  } catch (error: any) {
    return {
      success: false,
      error: error.toString(),
    }
  }
}

/**
 * Export day book to CSV
 */
export async function exportDayBookCSV(
  startDate: string,
  endDate: string
): Promise<ApiResponse<string>> {
  try {
    const result = await invoke<string>('export_day_book_csv', {
      startDate,
      endDate,
    })
    return { success: true, data: result }
  } catch (error: any) {
    return {
      success: false,
      error: error.toString(),
    }
  }
}

/**
 * Download CSV content as a file
 */
export function downloadCSV(csvContent: string, filename: string) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  
  link.setAttribute('href', url)
  link.setAttribute('download', filename)
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

/**
 * Filter day book entries client-side
 */
export function filterDayBookEntries(
  entries: DayBookEntry[],
  filters: Partial<DayBookFilters>
): DayBookEntry[] {
  return entries.filter((entry) => {
    if (filters.txnType && filters.txnType !== 'ALL') {
      if (entry.txn_type !== filters.txnType) return false
    }
    
    if (filters.category && entry.category !== filters.category) {
      return false
    }
    
    if (filters.memberId && entry.member_id !== filters.memberId) {
      return false
    }
    
    return true
  })
}

/**
 * Get unique categories from entries
 */
export function getCategories(entries: DayBookEntry[]): string[] {
  const categories = new Set(entries.map((e) => e.category))
  return Array.from(categories).sort()
}

/**
 * Calculate running balance for each transaction
 */
export function calculateRunningBalances(
  entries: DayBookEntry[],
  openingBalance: number
): Array<DayBookEntry & { running_balance: number }> {
  let balance = openingBalance
  
  return entries.map((entry) => {
    if (entry.txn_type === 'RECEIPT') {
      balance += entry.amount
    } else {
      balance -= entry.amount
    }
    
    return {
      ...entry,
      running_balance: balance,
    }
  })
}

/**
 * Format date for display
 */
export function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return dateString
  }
}

/**
 * Format time for display
 */
export function formatTime(dateString: string): string {
  try {
    const date = new Date(dateString)
    return date.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

/**
 * Format datetime for display
 */
export function formatDateTime(dateString: string): string {
  try {
    const date = new Date(dateString)
    return date.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return dateString
  }
}
