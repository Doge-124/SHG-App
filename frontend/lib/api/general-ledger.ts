import { invoke } from '@tauri-apps/api/core'

export type GlKind = 'income' | 'expense' | 'transfer'

export interface GlEntry {
  id: number
  date: string
  category: string
  kind: GlKind
  description: string
  amount: number
  paymentMethod: string
  txnType: string
}

export interface GlCategory {
  category: string
  kind: GlKind
  count: number
  total: number
}

export interface GeneralLedger {
  from: string
  to: string
  categories: GlCategory[]
  entries: GlEntry[]
  totalIncome: number
  totalExpense: number
}

/** All receipts/vouchers in [from, to] categorised by type. Dates are YYYY-MM-DD. */
export async function getGeneralLedger(from: string, to: string): Promise<GeneralLedger> {
  return await invoke<GeneralLedger>('get_general_ledger_cmd', { from, to })
}
