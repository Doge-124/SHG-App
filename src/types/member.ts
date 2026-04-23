export type PaymentMethod = 'CASH' | 'BANK'

export interface Member {
  id: number
  member_code: string
  name: string
  phone?: string | null
  address?: string | null
  joined_at: string
  is_active: boolean
  opening_balance: number
  opening_balance_method?: string | null
  opening_balance_set_at?: string | null
  past_installments: number
}

export interface MemberTxn {
  id: number
  member_id: number
  amount: number
  txn_type: 'LOAN' | 'PAYMENT' | 'OPENING' | string
  reason: string
  created_at: string
}

export interface MemberProfile {
  member: Member
  current_balance: number
  opening_balance: number
  opening_balance_method?: string | null
  opening_balance_set_at?: string | null
  total_installments: number
  opening_data_locked: boolean
  recent_transactions: MemberTxn[]
}

export interface OpeningDataInput {
  member_id: number
  opening_balance: number
  payment_method?: PaymentMethod | null
  past_installments: number
}

