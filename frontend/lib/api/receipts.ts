import { invoke } from '@tauri-apps/api/core'
import type { WeeklyContributionInput, Receipt, ReceiptWithMember } from '@/lib/types/receipts'

export async function recordWeeklyContribution(
  input: WeeklyContributionInput
): Promise<{ success: boolean; data?: number; error?: string }> {
  try {
    const result = await invoke<number>('record_weekly_contribution_cmd', { input })
    return { success: true, data: result }
  } catch (error: any) {
    console.error('Failed to record weekly contribution:', error)
    return { success: false, error: error.toString() }
  }
}

export async function getReceipts(
  from?: string,
  to?: string
): Promise<{ success: boolean; data?: ReceiptWithMember[]; error?: string }> {
  try {
    const result = await invoke<any[]>('get_receipts', { from, to })
    return { success: true, data: result }
  } catch (error: any) {
    console.error('Failed to get receipts:', error)
    return { success: false, error: error.toString() }
  }
}
