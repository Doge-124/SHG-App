export interface WeeklyContributionInput {
  member_id: number
  amount: number
  payment_method: 'CASH' | 'BANK'
  note?: string
}

export interface Receipt {
  id: number
  txn_type: 'RECEIPT' | 'VOUCHER'
  amount: number
  reason: string
  payment_method: 'CASH' | 'BANK'
  reference_type?: string
  reference_id?: number
  created_at: string
}

export interface ReceiptWithMember extends Receipt {
  member_name?: string
  member_code?: string
}

// Re-export from main types file for backward compatibility
export type { Receipt as ReceiptType } from '@/lib/types'
