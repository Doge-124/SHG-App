/**
 * Day Book Types
 * 
 * The Day Book is a derived view of all SHG financial transactions.
 * All values are computed from the transactions tables.
 */

/** Transaction entry in day book */
export interface DayBookEntry {
  id: number
  date: string
  txn_type: 'RECEIPT' | 'VOUCHER'
  amount: number
  category: string
  payment_method: 'CASH' | 'BANK'
  member_id: number | null
  member_name: string | null
  reference_id: number
  reference_type: string | null
  description: string
}

/** Day book summary for a date range */
export interface DayBookSummary {
  opening_balance: number
  total_receipts: number
  total_vouchers: number
  closing_balance: number
  transactions: DayBookEntry[]
}

/** Filter options for day book */
export interface DayBookFilters {
  startDate: string
  endDate: string
  txnType?: 'RECEIPT' | 'VOUCHER' | 'ALL'
  category?: string
  memberId?: number
}

/** Category summary for aggregated view */
export interface CategorySummary {
  category: string
  receipt_count: number
  receipt_total: number
  voucher_count: number
  voucher_total: number
  net_amount: number
}

/** Payment method breakdown */
export interface PaymentMethodSummary {
  method: string
  receipts: number
  vouchers: number
  total: number
}
