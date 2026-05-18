import { invoke } from '@tauri-apps/api/core'

export interface AuditEntry {
  id: number
  action: string
  entity: string
  entityId: number | null
  details: string | null
  timestamp: string
}

export async function getAuditLog(params?: {
  from?: string
  to?: string
  entity?: string
}): Promise<{ success: boolean; data?: AuditEntry[]; error?: string }> {
  try {
    const data = await invoke('get_audit_log', {
      from: params?.from ?? null,
      to: params?.to ?? null,
      entity: params?.entity ?? null,
    }) as AuditEntry[]
    return { success: true, data }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

// Human-readable label for each action code
export const ACTION_LABELS: Record<string, string> = {
  MEMBER_ADDED:        'Member Added',
  MEMBER_UPDATED:      'Member Updated',
  LOAN_ISSUED:         'Loan Issued',
  LOAN_REPAYMENT:      'Loan Repayment',
  LOAN_PAST_ENTRY:     'Past Loan Entry',
  RECEIPT:             'Receipt',
  VOUCHER:             'Voucher',
  CONTRIBUTION:        'Weekly Contribution',
  CHIT_GROUP_CREATED:  'Chit Group Created',
  CHIT_PAYMENT:        'Chit Payment',
  CHIT_WINNER_PAID:    'Chit Winner Paid',
  CHIT_PAST_CYCLE:     'Past Chit Cycle',
}

// Tailwind variant class per action for badge colouring
export function actionVariant(action: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (action) {
    case 'MEMBER_ADDED':
    case 'MEMBER_UPDATED':
      return 'secondary'
    case 'VOUCHER':
    case 'CHIT_WINNER_PAID':
      return 'destructive'
    default:
      return 'default'
  }
}

export const ENTITY_OPTIONS = [
  { value: 'all', label: 'All Entities' },
  { value: 'member', label: 'Members' },
  { value: 'loan', label: 'Loans' },
  { value: 'receipt', label: 'Receipts' },
  { value: 'voucher', label: 'Vouchers' },
  { value: 'contribution', label: 'Contributions' },
  { value: 'chit_group', label: 'Chit Groups' },
  { value: 'chit_cycle', label: 'Chit Cycles' },
]
