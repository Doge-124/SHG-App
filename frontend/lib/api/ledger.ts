import { invoke } from '@tauri-apps/api/core'
import { formatCurrency, formatDateTime, generateReferenceNumber } from '@/lib/format'
import type {
  Receipt,
  ReceiptFormData,
  Voucher,
  VoucherFormData,
  Transaction,
  DashboardStats,
  ChitCycleAlert,
  ApiResponse,
} from '@/lib/types'


export async function recordReceipt(data: ReceiptFormData): Promise<ApiResponse<Receipt>> {
  try {
    const createdAt = new Date().toISOString()
    
    // Combine reasonType and customReason into a single reason
    const reason = data.reasonType === 'Other' ? (data.customReason || 'Other transaction') : data.reasonType
    
    
    // Determine the correct reference type based on the reason chosen.
    // MEMBER_CONTRIBUTION → updates both SHG balance AND member savings balance.
    // MEMBER_RECEIPT      → updates SHG balance only (generic inflow, no member savings effect).
    let referenceType: string
    const reasonLower = reason.toLowerCase()

    if (reasonLower === 'savings deposit') {
      // Savings deposits must update the member's balance as well as the SHG balance.
      referenceType = 'MEMBER_CONTRIBUTION'
    } else if (reasonLower.includes('donation') || reasonLower.includes('donate')) {
      referenceType = 'DONATION'
    } else if (reasonLower.includes('grant')) {
      referenceType = 'GRANT'
    } else {
      // Fine, Other, etc. — generic SHG inflow, no member balance effect.
      referenceType = 'MEMBER_RECEIPT'
    }
    
    
    await invoke('record_receipt', {
      amount: data.amount,
      reason: reason,
      paymentMethod: data.paymentMethod.toUpperCase(),
      referenceType: referenceType,
      referenceId: data.memberId ? parseInt(data.memberId) : null,
      createdAt: createdAt
    })
    
    const receipt: Receipt = {
      id: Date.now().toString(),
      amount: data.amount,
      reason: reason,
      paymentMethod: data.paymentMethod,
      referenceType: referenceType,
      referenceId: data.memberId,
      referenceNumber: generateReferenceNumber('receipt'),
      createdAt: createdAt,
    }
    
    
    
    return { success: true, data: receipt }
  } catch (error) {
    console.error('Failed to record receipt:', error)
    return { success: false, error: 'Failed to record receipt' }
  }
}

export async function recordVoucher(data: VoucherFormData): Promise<ApiResponse<Voucher>> {
  try {
    const createdAt = new Date().toISOString()
    
    // Combine reasonType and customReason into a single reason
    const reason = data.reasonType === 'Other' ? (data.customReason || 'Other expense') : data.reasonType
    
    
    await invoke('record_voucher', {
      amount: data.amount,
      reason: reason,
      paymentMethod: data.paymentMethod.toUpperCase(),
      referenceType: 'MEMBER_VOUCHER',
      referenceId: data.memberId ? parseInt(data.memberId) : null,
      createdAt: createdAt
    })
    
    const voucher: Voucher = {
      id: Date.now().toString(),
      amount: data.amount,
      reason: reason,
      paymentMethod: data.paymentMethod,
      reference: data.reference,
      referenceNumber: generateReferenceNumber('voucher'),
      createdAt: createdAt,
    }
    
    
    return { success: true, data: voucher }
  } catch (error) {
    console.error('Failed to record voucher:', error)
    const errorMessage = (error as Error).toString()
    
    // Provide more user-friendly error messages
    if (errorMessage.includes('Insufficient')) {
      return { success: false, error: errorMessage }
    } else if (errorMessage.includes('balance')) {
      return { success: false, error: 'Balance error: ' + errorMessage }
    } else {
      return { success: false, error: 'Failed to record voucher' }
    }
  }
}

export async function getReceipts(): Promise<ApiResponse<Receipt[]>> {
  try {
    // Get today's transactions
    const today = new Date().toISOString().split('T')[0]
    
    
    const dailyTxns = await invoke('daily_transactions', { 
      date: today,
      paymentMethod: null,
      transactionType: null,
      memberId: null
    }) as any[]
    
    
    // If no transactions today, try yesterday
    if (dailyTxns.length === 0) {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      
      const yesterdayTxns = await invoke('daily_transactions', { 
        date: yesterday,
        paymentMethod: null,
        transactionType: null,
        memberId: null
      }) as any[]
      
      dailyTxns.push(...yesterdayTxns)
    }
    
    // Filter for receipts only using the same logic as reports
    const receipts: Receipt[] = dailyTxns
      .filter((txn: any) => {
        const txnType = (txn.txn_type || '').toLowerCase()
        const referenceType = (txn.reference_type || '').toLowerCase()
        const reason = (txn.reason || '').toLowerCase()
        
        // Use the same classification logic as reports
        if (referenceType.includes('member_loan')) {
          return false // loan disbursement creates a voucher
        } else if (referenceType.includes('member_payment')) {
          return true // repayment creates a receipt
        } else if (txnType.includes('voucher') || txnType.includes('payout') || txnType.includes('expense')) {
          return false // voucher
        } else if (txnType.includes('loan') && !txnType.includes('payment') && !txnType.includes('repayment')) {
          return false // loan
        } else if (txnType.includes('payment') || txnType.includes('repayment') || txnType.includes('emi')) {
          return true // repayment
        } else if (txnType.includes('chit') && txnType.includes('payment')) {
          return true // chit_payment
        } else {
          return true // receipt
        }
      })
      .map((txn: any) => ({
        id: txn.id.toString(),
        amount: txn.amount,
        reason: txn.reason || txn.description || 'N/A',  // Use description field from backend, fallback to reason
        paymentMethod: txn.payment_method.toLowerCase(),
        referenceType: txn.reference_type,
        referenceId: txn.reference_id?.toString(),
        referenceNumber: `RCPT${txn.id.toString().padStart(6, '0')}`,
        createdAt: txn.created_at,
        memberName: txn.member_name,
      }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    
    return { success: true, data: receipts }
  } catch (error) {
    console.error('Failed to get receipts:', error)
    return { success: false, error: 'Failed to load receipts' }
  }
}

export async function getVouchers(): Promise<ApiResponse<Voucher[]>> {
  try {
    const rawVouchers = await invoke('get_vouchers') as any[]

    const vouchers: Voucher[] = rawVouchers.map((txn: any) => ({
      id: txn.id.toString(),
      amount: txn.amount,
      reason: txn.reason,
      paymentMethod: txn.payment_method.toLowerCase(),
      reference: txn.member_name || txn.reference_id?.toString() || '',
      referenceNumber: `VOU${txn.id.toString().padStart(6, '0')}`,
      referenceType: txn.reference_type,
      createdAt: txn.created_at,
      memberName: txn.member_name,
    }))

    return { success: true, data: vouchers }
  } catch (error) {
    console.error('Failed to get vouchers:', error)
    return { success: false, error: 'Failed to load vouchers' }
  }
}

export async function getShgBalances(): Promise<ApiResponse<{ cash: number; bank: number }>> {
  try {
    const balances = await invoke('get_shg_balances') as { cash: number; bank: number }
    return { success: true, data: balances }
  } catch (error) {
    console.error('Failed to get SHG balances:', error)
    return { success: false, error: 'Failed to load balances' }
  }
}

export async function getDashboardStats(): Promise<ApiResponse<DashboardStats>> {
  try {
    const [totalMembers, totalLoansOutstanding, balances, activeChitGroups] = await Promise.all([
      invoke('get_total_members') as Promise<number>,
      invoke('get_total_loans_outstanding') as Promise<number>,
      invoke('get_shg_balances') as Promise<{ cash: number; bank: number }>,
      invoke('get_active_chit_groups') as Promise<number>,
    ])
    
    const stats: DashboardStats = {
      totalMembers,
      totalLoansOutstanding,
      cashBalance: balances.cash,
      bankBalance: balances.bank,
      activeChitGroups,
    }
    
    
    return { success: true, data: stats }
  } catch (error) {
    console.error('Failed to get dashboard stats:', error)
    return { success: false, error: 'Failed to load dashboard stats' }
  }
}

export async function getRecentTransactions(): Promise<ApiResponse<Transaction[]>> {
  try {
    const raw = await invoke('get_recent_transactions', { limit: 20 }) as any[]

    const transactions: Transaction[] = raw.map((txn: any) => ({
      id: txn.id.toString(),
      type: txn.txn_type.toLowerCase(),
      amount: Math.abs(txn.amount),
      description: txn.member_name
        ? `${txn.reason} — ${txn.member_name}`
        : txn.reason,
      paymentMethod: txn.payment_method.toLowerCase(),
      createdAt: txn.created_at,
    }))

    return { success: true, data: transactions }
  } catch (error) {
    return { success: false, error: 'Failed to load recent transactions' }
  }
}

export async function getUpcomingChitAlerts(): Promise<ApiResponse<ChitCycleAlert[]>> {
  try {
    // Note: Backend doesn't have a get_chit_alerts function yet
    return { success: true, data: [] }
  } catch (error) {
    console.error('Failed to get chit alerts:', error)
    return { success: false, error: 'Failed to load chit alerts' }
  }
}

// Export aliases for compatibility
export const createReceipt = recordReceipt
export const createVoucher = recordVoucher
