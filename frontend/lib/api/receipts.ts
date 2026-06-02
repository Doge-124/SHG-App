import { invoke } from '@tauri-apps/api/core'
import { withAutoPrint } from '@/lib/auto-print'
import type { WeeklyContributionInput, Receipt, ReceiptWithMember } from '@/lib/types/receipts'

export async function recordWeeklyContribution(
  input: WeeklyContributionInput
): Promise<{ success: boolean; data?: number; error?: string }> {
  try {
    const result = await withAutoPrint(() => invoke<number>('record_weekly_contribution_cmd', { input }))
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
    return { success: true, data: combineMixedReceipts(result) }
  } catch (error: any) {
    console.error('Failed to get receipts:', error)
    return { success: false, error: error.toString() }
  }
}

/**
 * A mixed (cash + bank) payment is stored as two RECEIPT rows sharing a
 * group_id. Collapse each such pair into a single receipt that carries the
 * combined amount plus the cash/bank breakdown, so the list and the printed
 * receipt show one document with both payment details instead of two.
 */
export function combineMixedReceipts(rows: any[]): ReceiptWithMember[] {
  const out: ReceiptWithMember[] = []
  const groups = new Map<string, ReceiptWithMember>()

  for (const r of rows) {
    const gid = r.group_id
    if (!gid) { out.push(r); continue }

    const isCash = String(r.payment_method).toUpperCase() === 'CASH'
    const existing = groups.get(gid)
    if (!existing) {
      // Seed the combined receipt from the first row of the group. Keep the
      // lowest id as the representative so cancelling it voids the whole group.
      const combined: ReceiptWithMember = {
        ...r,
        payment_method: 'MIXED',
        amount: r.amount,
        cash_amount: isCash ? r.amount : 0,
        bank_amount: isCash ? 0 : r.amount,
        bank_txn_id: isCash ? null : r.bank_txn_id,
      }
      groups.set(gid, combined)
      out.push(combined)
    } else {
      existing.amount += r.amount
      if (isCash) {
        existing.cash_amount = (existing.cash_amount ?? 0) + r.amount
      } else {
        existing.bank_amount = (existing.bank_amount ?? 0) + r.amount
        if (r.bank_txn_id) existing.bank_txn_id = r.bank_txn_id
      }
      if (r.id < existing.id) existing.id = r.id
      // If either half is voided, the whole logical receipt is voided.
      if (r.voided_at) { existing.voided_at = r.voided_at; existing.voided_reason = r.voided_reason }
    }
  }

  return out
}
