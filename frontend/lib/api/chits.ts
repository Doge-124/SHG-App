import { invoke } from '@tauri-apps/api/core'
import { withAutoPrint } from '@/lib/auto-print'
import type {
  ChitGroup,
  ChitGroupFormData,
  ChitMember,
  ChitCycle,
  ChitPayment,
  ApiResponse,
  MemberPaymentStatus,
  ChitCycleDetail,
  ChitMigrationStatus,
  PastChitCycleData,
} from '@/lib/types'

export async function getChitGroups(): Promise<ApiResponse<ChitGroup[]>> {
  try {
    const chitGroups = await invoke('get_chit_groups') as any[]
    
    
    if (chitGroups.length > 0) {
      chitGroups.forEach((group, i) => {
      })
    }
    
    // Convert backend chit groups to frontend format
    const frontendChitGroups: ChitGroup[] = (await Promise.all(
      chitGroups.map(async (group: any) => {
        // Get member count and cycles for this chit group
        const [chitMembers, chitCyclesRaw] = await Promise.all([
          invoke('get_chit_members', { chitId: group.id }) as Promise<any[]>,
          invoke('get_chit_cycles', { chitId: group.id }) as Promise<any[]>,
        ])
        const totalMembers = group.total_members
        const currentMembers = chitMembers.length
        // Cap at the chit's duration so the closing/settlement cycle (cycle_no =
        // months + 1) doesn't push progress past 100%.
        const currentCycle = chitCyclesRaw.length > 0
          ? Math.min(group.months, Math.max(...chitCyclesRaw.map((c: any) => c.cycle_no)))
          : 0

        return {
          id: group.id.toString(),
          name: group.name,
          totalAmount: group.total_amount,
          monthlyContribution: group.monthly_contribution,
          totalMembers,
          currentMembers,
          durationMonths: group.months,
          currentCycle,
          winnersPerCycle: group.winners_per_cycle ?? 1,
          commissionPerWinner: group.commission_per_winner ?? 0,
          fixedPrizeAmount: group.fixed_prize_amount ?? group.total_amount,
          status: group.status.toLowerCase() as 'active' | 'completed' | 'cancelled',
          startDate: group.start_date,
          createdAt: group.start_date,
        }
      })
    )).sort((a: ChitGroup, b: ChitGroup) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())
    
    if (frontendChitGroups.length > 0) {
    }
    
    return { success: true, data: frontendChitGroups }
  } catch (error) {
    console.error('Failed to get chit groups:', error)
    return { success: false, error: 'Failed to load chit groups' }
  }
}

export async function getChitGroup(id: string): Promise<ApiResponse<ChitGroup>> {
  try {
    const chitMembersParams = { chitId: parseInt(id) }
    
    const [chitGroup, chitMembers, chitCyclesRaw] = await Promise.all([
      invoke('get_chit_group', { id: parseInt(id) }) as Promise<any>,
      invoke('get_chit_members', chitMembersParams) as Promise<any[]>,
      invoke('get_chit_cycles', { chitId: parseInt(id) }) as Promise<any[]>,
    ])
    
    
    if (!chitGroup) {
      return { success: false, error: 'Chit group not found' }
    }
    
    const totalMembers = chitGroup.total_members
    const currentMembers = chitMembers.length

    
    
    const frontendChitGroup: ChitGroup = {
      id: chitGroup.id.toString(),
      name: chitGroup.name,
      totalAmount: chitGroup.total_amount,
      monthlyContribution: chitGroup.monthly_contribution,
      totalMembers,
      currentMembers,
      durationMonths: chitGroup.months,
      // Capped at duration so the closing/settlement cycle doesn't exceed 100%.
      currentCycle: chitCyclesRaw.length > 0
        ? Math.min(chitGroup.months, Math.max(...chitCyclesRaw.map((c: any) => c.cycle_no)))
        : 0,
      winnersPerCycle: chitGroup.winners_per_cycle ?? 1,
      commissionPerWinner: chitGroup.commission_per_winner ?? 0,
      fixedPrizeAmount: chitGroup.fixed_prize_amount ?? chitGroup.total_amount,
      status: chitGroup.status.toLowerCase() as 'active' | 'completed' | 'cancelled',
      startDate: chitGroup.start_date,
      createdAt: chitGroup.start_date,
    }
    
    
    return { success: true, data: frontendChitGroup }
  } catch (error) {
    console.error('Failed to get chit group:', error)
    return { success: false, error: 'Failed to load chit group' }
  }
}

export async function getChitMembers(chitGroupId: string): Promise<ApiResponse<ChitMember[]>> {
  try {
    const params = { chitId: parseInt(chitGroupId) }
    
    const chitMembers = await invoke('get_chit_members', params) as any[]
    
    
    if (chitMembers.length > 0) {
      chitMembers.forEach((member, i) => {
      })
    }
    
    // Convert backend chit members to frontend format
    const frontendChitMembers: ChitMember[] = chitMembers.map((member: any) => ({
      id: member.id,
      chitGroupId: member.chit_group_id,
      memberId: member.member_id,
      memberName: member.member_name,
      joinedAt: member.joined_at,
      isWinner: member.is_winner,
      passbookNumber: member.passbook_number ?? null,
      memberType: member.member_type ?? undefined,
    })).sort((a, b) => a.memberName.localeCompare(b.memberName, undefined, { sensitivity: 'base' }))

    if (frontendChitMembers.length > 0) {
    }
    
    return { success: true, data: frontendChitMembers }
  } catch (error) {
    console.error('Failed to get chit members:', error)
    return { success: false, error: 'Failed to load chit members' }
  }
}

/** Set or clear a member's passbook number for a chit. Empty string clears it. */
export async function setChitPassbookNumber(
  chitGroupId: string,
  memberId: string,
  passbookNumber: string,
): Promise<ApiResponse<void>> {
  try {
    await invoke('set_chit_passbook_number', {
      chitId: parseInt(chitGroupId),
      memberId: parseInt(memberId),
      passbookNumber,
    })
    return { success: true }
  } catch (error) {
    return { success: false, error: typeof error === 'string' ? error : 'Failed to set passbook number' }
  }
}

export async function getChitCycles(chitGroupId: string): Promise<ApiResponse<ChitCycle[]>> {
  try {
    const chitCycles = await invoke('get_chit_cycles', { chitId: parseInt(chitGroupId) }) as any[]
    
    
    // Convert backend chit cycles to frontend format
    const frontendChitCycles: ChitCycle[] = chitCycles.map((cycle: any) => ({
      id: cycle.id.toString(),
      chitGroupId: cycle.chit_id.toString(),
      cycleNumber: cycle.cycle_no,
      winnerId: cycle.winning_member_id ? cycle.winning_member_id.toString() : undefined,
      winnerName: cycle.winner_name || undefined,
      winnerAmount: cycle.payout_amount || undefined,
      status: cycle.winning_member_id ? 'completed' as const : 'active' as const,
      dueDate: cycle.auction_date,
      completedAt: cycle.winning_member_id ? cycle.auction_date : undefined,
    }))
    
    
    return { success: true, data: frontendChitCycles }
  } catch (error) {
    console.error('Failed to get chit cycles:', error)
    return { success: false, error: 'Failed to load chit cycles' }
  }
}

export async function getChitPayments(chitGroupId: string): Promise<ApiResponse<ChitPayment[]>> {
  try {
    const params = { chitId: parseInt(chitGroupId) }
    
    const chitPayments = await invoke('get_chit_payments', params) as any[]
    
    
    if (chitPayments.length > 0) {
      chitPayments.forEach((payment, i) => {
      })
    }
    
    // Convert backend chit payments to frontend format
    const frontendChitPayments: ChitPayment[] = chitPayments.map((payment: any) => ({
      id: payment.id,
      chitGroupId: payment.chitGroupId,
      chitCycleId: payment.chitCycleId,
      memberId: payment.memberId,
      memberName: payment.memberName,
      amount: payment.amount,
      paymentMethod: payment.paymentMethod,
      status: payment.status,
      paidAt: payment.paidAt,
    })).sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime())
    
    if (frontendChitPayments.length > 0) {
    }
    
    return { success: true, data: frontendChitPayments }
  } catch (error) {
    console.error('Failed to get chit payments:', error)
    return { success: false, error: 'Failed to load chit payments' }
  }
}

export async function createChitGroup(data: ChitGroupFormData): Promise<ApiResponse<ChitGroup>> {
  try {
    await invoke('create_chit_group', {
      name: data.name,
      totalAmount: data.totalAmount,
      months: data.durationMonths,
      totalMembers: data.totalMembers,
      commissionPercent: 0,
      startDate: data.startDate,
      winnersPerCycle: data.winnersPerCycle,
      commissionPerWinner: data.commissionPerWinner,
      fixedPrizeAmount: data.totalAmount, // fixed prize = total prize amount
    })

    const newChitGroup: ChitGroup = {
      id: Date.now().toString(),
      name: data.name,
      totalAmount: data.totalAmount,
      monthlyContribution: data.monthlyContribution,
      totalMembers: data.totalMembers,
      currentMembers: 0,
      durationMonths: data.durationMonths,
      winnersPerCycle: data.winnersPerCycle,
      commissionPerWinner: data.commissionPerWinner,
      fixedPrizeAmount: data.totalAmount,
      currentCycle: 0,
      status: 'active',
      startDate: data.startDate,
      createdAt: new Date().toISOString(),
    }
    
    return { success: true, data: newChitGroup }
  } catch (error) {
    console.error('Failed to create chit group:', error)
    return { success: false, error: 'Failed to create chit group' }
  }
}

export async function addMemberToChit(chitGroupId: string, memberId: string): Promise<ApiResponse<ChitMember>> {
  try {
    const memberData = await invoke('add_member_to_chit', {
      chitId: parseInt(chitGroupId),
      memberId: parseInt(memberId),
      joinedAt: new Date().toISOString(),
    }) as any
    
    const chitMember: ChitMember = {
      id: memberData.id,
      chitGroupId: memberData.chit_group_id,
      memberId: memberData.member_id,
      memberName: memberData.member_name,
      joinedAt: memberData.joined_at,
      isWinner: memberData.is_winner,
    }
    
    return { success: true, data: chitMember }
  } catch (error) {
    console.error('Failed to add member to chit:', error)
    return { success: false, error: 'Failed to add member to chit' }
  }
}

export async function createChitCycle(
  chitGroupId: string,
  cycleNumber: number,
  auctionDate: string,
  winningMemberId?: string,
  bidDiscount?: number,
  payoutAmount?: number
): Promise<ApiResponse<ChitCycle>> {
  try {
    await invoke('create_chit_cycle', {
      chitId: parseInt(chitGroupId),
      cycleNo: cycleNumber,
      auctionDate,
      winningMemberId: winningMemberId ? parseInt(winningMemberId) : null,
      bidDiscount: bidDiscount || 0,
      payoutAmount: payoutAmount || 0,
    })
    
    const chitCycle: ChitCycle = {
      id: Date.now().toString(),
      chitGroupId,
      cycleNumber,
      winnerId: winningMemberId,
      winnerName: winningMemberId ? 'Winner' : undefined,
      winnerAmount: payoutAmount,
      status: 'pending',
      dueDate: auctionDate,
    }
    
    return { success: true, data: chitCycle }
  } catch (error) {
    console.error('Failed to create chit cycle:', error)
    return { success: false, error: 'Failed to create chit cycle' }
  }
}

export interface ChitPaymentOptions {
  paymentMethod: string                 // CASH | BANK | MIXED
  cashAmount?: number | null
  bankAmount?: number | null
  bankTxnId?: string | null
}

export async function recordChitPayment(
  chitGroupId: string,
  cycleId: string,
  memberId: string,
  amount: number,
  opts: ChitPaymentOptions,
): Promise<ApiResponse<ChitPayment>> {
  try {
    const paymentData = await withAutoPrint(() => invoke('record_chit_payment', {
      chitId: parseInt(chitGroupId),
      cycleId: parseInt(cycleId),
      memberId: parseInt(memberId),
      amount,
      paymentMethod: opts.paymentMethod,
      paidAt: new Date().toISOString(),
      cashAmount: opts.cashAmount ?? null,
      bankAmount: opts.bankAmount ?? null,
      bankTxnId: opts.bankTxnId ?? null,
    })) as any
    
    const chitPayment: ChitPayment = {
      id: paymentData.id,
      chitGroupId: paymentData.chitGroupId,
      chitCycleId: paymentData.chitCycleId,
      memberId: paymentData.memberId,
      memberName: paymentData.memberName,
      amount: paymentData.amount,
      paymentMethod: paymentData.paymentMethod,
      status: paymentData.status,
      paidAt: paymentData.paidAt,
    }
    
    return { success: true, data: chitPayment }
  } catch (error) {
    console.error('Failed to record chit payment:', error)
    return { success: false, error: 'Failed to record chit payment' }
  }
}

export async function payoutChitWinner(
  chitGroupId: string,
  cycleId: string,
  winningMemberId: string,
  payoutAmount: number,
  paymentMethod: 'cash' | 'bank',
  note: string
): Promise<ApiResponse<void>> {
  try {
    await withAutoPrint(() => invoke('payout_chit_winner', {
      chitId: parseInt(chitGroupId),
      cycleId: parseInt(cycleId),
      winningMemberId: parseInt(winningMemberId),
      payoutAmount,
      paymentMethod: paymentMethod.toUpperCase(), // Convert to uppercase for backend
      payoutDate: new Date().toISOString(),
      note,
    }))
    
    return { success: true }
  } catch (error) {
    console.error('Failed to payout chit winner:', error)
    return { success: false, error: 'Failed to payout chit winner' }
  }
}

// Manual Cycle Management API Functions

export async function getCurrentCycleWithSummary(chitGroupId: string): Promise<ApiResponse<{
  cycle: ChitCycle | null;
  paymentSummary: Array<{
    memberId: string;
    memberName: string;
    hasPaid: boolean;
    amountPaid: number;
    paymentMethod?: string;
    paidAt?: string;
  }>;
}>> {
  try {
    
    const result = await invoke('get_current_cycle_with_summary', { chitId: parseInt(chitGroupId) }) as any
    
    
    const frontendResult = {
      cycle: result.cycle ? {
        id: result.cycle.id.toString(),
        chitGroupId: result.cycle.chit_id.toString(),
        cycleNumber: result.cycle.cycle_no,
        auctionDate: result.cycle.auction_date,
        winnerId: result.cycle.winning_member_id?.toString(),
        winnerName: undefined,
        winnerAmount: result.cycle.payout_amount,
        status: result.cycle.winning_member_id ? 'completed' as const : 'active' as const,
        dueDate: result.cycle.auction_date,
      } : null,
      paymentSummary: result.payment_summary.map((p: any) => ({
        memberId: p.member_id.toString(),
        memberName: p.member_name,
        hasPaid: p.has_paid,
        amountPaid: p.amount_paid,
        paymentMethod: p.payment_method,
        paidAt: p.paid_at,
        isEligibleForDiscount: p.is_eligible_for_discount ?? true,
        payableAmount: p.payable_amount ?? 0,
        hasWon: p.has_won ?? false,
      })),
    }
    
    return { success: true, data: frontendResult }
  } catch (error) {
    console.error('Failed to get current cycle:', error)
    return { success: false, error: 'Failed to get current cycle' }
  }
}

export async function advanceToNextCycle(chitGroupId: string): Promise<ApiResponse<{
  cycle: ChitCycle;
  message: string;
}>> {
  try {
    
    const result = await invoke('advance_to_next_cycle', { chitId: parseInt(chitGroupId) }) as any
    
    
    const cycle: ChitCycle = {
      id: result.cycle.id.toString(),
      chitGroupId: result.cycle.chit_id.toString(),
      cycleNumber: result.cycle.cycle_no,
      status: 'active',
      dueDate: result.cycle.auction_date,
    }
    
    return { success: true, data: { cycle, message: result.message } }
  } catch (error) {
    console.error('Failed to advance cycle:', error)
    return { success: false, error: 'Failed to advance cycle' }
  }
}

export async function recordMemberPaymentWithDiscount(
  chitGroupId: string,
  cycleId: string,
  memberId: string,
  grossAmount: number,
  auctionDiscount: number,
  opts: {
    paymentMethod: string                 // CASH | BANK | MIXED
    cashAmount?: number | null
    bankAmount?: number | null
    bankTxnId?: string | null
  },
): Promise<ApiResponse<{
  paymentId: string;
  netAmount: number;
  receiptGenerated: boolean;
  message: string;
}>> {
  try {
    const result = await withAutoPrint(() => invoke('record_member_payment_with_discount', {
      input: {
        chit_id: parseInt(chitGroupId),
        cycle_id: parseInt(cycleId),
        member_id: parseInt(memberId),
        gross_amount: grossAmount,
        auction_discount: auctionDiscount,
        payment_method: opts.paymentMethod.toUpperCase(),
        cash_amount: opts.cashAmount ?? null,
        bank_amount: opts.bankAmount ?? null,
        bank_txn_id: opts.bankTxnId ?? null,
      }
    })) as any
    
    
    return {
      success: true,
      data: {
        paymentId: result.payment_id.toString(),
        netAmount: result.net_amount,
        receiptGenerated: result.receipt_generated,
        message: result.message,
      }
    }
  } catch (error) {
    console.error('Failed to record payment:', error)
    return { success: false, error: 'Failed to record payment' }
  }
}

export interface ChitPendingDue {
  cycleId: string
  cycleNo: number
  memberId: string
  memberName: string
  amountOwed: number
}

/** Overdue installments for already-completed cycles in a chit. */
export async function getChitPendingDues(chitGroupId: string): Promise<ApiResponse<ChitPendingDue[]>> {
  try {
    const rows = await invoke<any[]>('get_chit_pending_dues', { chitId: parseInt(chitGroupId) })
    const dues: ChitPendingDue[] = (rows ?? []).map(r => ({
      cycleId: r.cycleId.toString(),
      cycleNo: r.cycleNo,
      memberId: r.memberId.toString(),
      memberName: r.memberName,
      amountOwed: r.amountOwed,
    }))
    return { success: true, data: dues }
  } catch (error) {
    console.error('Failed to load pending dues:', error)
    return { success: false, error: typeof error === 'string' ? error : 'Failed to load pending dues' }
  }
}

export interface ChitLedgerRow {
  cycleNo: number
  date: string
  particulars: string
  debit: number
  credit: number
  balance: number
  isPayout: boolean
}

export interface MemberChitLedger {
  chitId: number
  memberId: number
  memberName: string
  memberCode: string
  chitName: string
  passbookNumber: string | null
  monthlyContribution: number
  totalCycles: number
  wonCycleNo: number | null
  payoutAmount: number
  totalDebit: number
  totalCredit: number
  totalPayout: number
  closingBalance: number
  guarantors: import('@/lib/api/guarantors').Guarantor[]
  rows: ChitLedgerRow[]
}

/** A member's detailed debit/credit ledger within one chit (includes past data). */
export async function getMemberChitLedger(
  chitGroupId: string,
  memberId: string,
): Promise<ApiResponse<MemberChitLedger>> {
  try {
    const data = await invoke<MemberChitLedger>('get_member_chit_ledger', {
      chitId: parseInt(chitGroupId),
      memberId: parseInt(memberId),
    })
    return { success: true, data }
  } catch (error) {
    console.error('Failed to load chit ledger:', error)
    return { success: false, error: typeof error === 'string' ? error : 'Failed to load chit ledger' }
  }
}

/** Collect an overdue installment for a completed (past/prior) cycle — real cash today. */
export async function recordChitLatePayment(
  chitGroupId: string,
  cycleId: string,
  memberId: string,
  amount: number,
  opts: {
    paymentMethod: string                 // CASH | BANK | MIXED
    cashAmount?: number | null
    bankAmount?: number | null
    bankTxnId?: string | null
  },
): Promise<ApiResponse<void>> {
  try {
    await withAutoPrint(() => invoke('record_chit_late_payment', {
      input: {
        chit_id: parseInt(chitGroupId),
        cycle_id: parseInt(cycleId),
        member_id: parseInt(memberId),
        amount,
        payment_method: opts.paymentMethod.toUpperCase(),
        cash_amount: opts.cashAmount ?? null,
        bank_amount: opts.bankAmount ?? null,
        bank_txn_id: opts.bankTxnId ?? null,
      },
    }))
    return { success: true }
  } catch (error) {
    console.error('Failed to record late payment:', error)
    return { success: false, error: typeof error === 'string' ? error : 'Failed to record late payment' }
  }
}

export interface ChitClosingInfo {
  allCyclesComplete: boolean
  outstandingDues: number
  payoutEach: number
  alreadyClosed: boolean
  leftoverMembers: { memberId: string; memberName: string }[]
}

/** What a chit needs to close: cycle completeness, dues, and leftover winners. */
export async function getChitClosingInfo(chitGroupId: string): Promise<ApiResponse<ChitClosingInfo>> {
  try {
    const r = await invoke<any>('get_chit_closing_info', { chitId: parseInt(chitGroupId) })
    return {
      success: true,
      data: {
        allCyclesComplete: r.allCyclesComplete,
        outstandingDues: r.outstandingDues,
        payoutEach: r.payoutEach,
        alreadyClosed: r.alreadyClosed,
        leftoverMembers: (r.leftoverMembers ?? []).map((m: any) => ({
          memberId: m.memberId.toString(),
          memberName: m.memberName,
        })),
      },
    }
  } catch (error) {
    console.error('Failed to load closing info:', error)
    return { success: false, error: typeof error === 'string' ? error : 'Failed to load closing info' }
  }
}

/** Pay out leftover (never-won) members in the closing cycle. Allowed even while
 *  other members still owe dues; does not close the chit. */
export async function payClosingMembers(
  chitGroupId: string,
  payouts: { memberId: string; paymentMethod: 'cash' | 'bank'; bankTxnId?: string | null }[],
): Promise<ApiResponse<void>> {
  try {
    await withAutoPrint(() => invoke('pay_closing_members', {
      chitId: parseInt(chitGroupId),
      payouts: payouts.map(p => ({
        member_id: parseInt(p.memberId),
        payment_method: p.paymentMethod.toUpperCase(),
        bank_txn_id: p.bankTxnId ?? null,
      })),
    }))
    return { success: true }
  } catch (error) {
    console.error('Failed to pay out closing members:', error)
    return { success: false, error: typeof error === 'string' ? error : 'Failed to pay out members' }
  }
}

/** Mark a chit CLOSED — only once all dues are collected and every leftover
 *  member has been paid out. */
export async function closeChit(chitGroupId: string): Promise<ApiResponse<void>> {
  try {
    await invoke('close_chit', { chitId: parseInt(chitGroupId) })
    return { success: true }
  } catch (error) {
    console.error('Failed to close chit:', error)
    return { success: false, error: typeof error === 'string' ? error : 'Failed to close chit' }
  }
}

export async function processWinnerPayout(
  chitGroupId: string,
  cycleId: string,
  winningMemberId: string,
  bidDiscount: number,
  commission: number,
  paymentMethod: 'cash' | 'bank',
  note: string
): Promise<ApiResponse<{
  voucherGenerated: boolean;
  receiptGenerated: boolean;
  winnerAmount: number;
  commission: number;
  bidDiscount: number;
  message: string;
}>> {
  try {
    const result = await withAutoPrint(() => invoke('process_winner_payout', {
      input: {
        chit_id: parseInt(chitGroupId),
        cycle_id: parseInt(cycleId),
        winning_member_id: parseInt(winningMemberId),
        bid_discount: bidDiscount,
        commission,
        payment_method: paymentMethod.toUpperCase(),
        note,
      }
    })) as any

    return {
      success: true,
      data: {
        voucherGenerated: result.voucher_generated,
        receiptGenerated: result.receipt_generated,
        winnerAmount: result.winner_amount,
        commission: result.commission,
        bidDiscount: result.bid_discount,
        message: result.message,
      }
    }
  } catch (error) {
    console.error('Failed to process winner payout:', error)
    return { success: false, error: 'Failed to process winner payout' }
  }
}

// Chit Past Data Entry API Functions

export async function recordPastChitCycle(
  chitGroupId: string,
  data: PastChitCycleData
): Promise<ApiResponse<{ cycleId: string; totalCollected: number; totalBidDiscounts: number; auctionDiscountPerMember: number; winnerCount: number }>> {
  try {
    const result = await invoke('record_past_chit_cycle', {
      chitId: parseInt(chitGroupId),
      cycleNo: data.cycleNumber,
      auctionDate: data.auctionDate,
      winners: data.winners.map(w => ({
        memberId: parseInt(w.memberId),
        winnerType: w.winnerType,
        bidDiscount: w.bidDiscount,
        commission: w.commission,
        payoutAmount: w.payoutAmount,
        paymentMethod: w.paymentMethod.toUpperCase(),
      })),
      auctionDiscountPerMember: data.auctionDiscountPerMember,
      memberPayments: data.memberPayments.map(p => ({
        memberId: parseInt(p.memberId),
        amount: p.amount,
        paymentMethod: p.paymentMethod.toUpperCase(),
      })),
    }) as {
      cycle_id: number;
      total_collected: number;
      total_bid_discounts: number;
      auction_discount_per_member: number;
      winner_count: number;
    }

    return {
      success: true,
      data: {
        cycleId: result.cycle_id.toString(),
        totalCollected: result.total_collected,
        totalBidDiscounts: result.total_bid_discounts,
        auctionDiscountPerMember: result.auction_discount_per_member,
        winnerCount: result.winner_count,
      }
    }
  } catch (error) {
    console.error('Failed to record past chit cycle:', error)
    return { success: false, error: 'Failed to record past chit cycle' }
  }
}

export async function getMemberPaymentStatus(chitGroupId: string): Promise<ApiResponse<MemberPaymentStatus[]>> {
  try {
    
    const statuses = await invoke('get_member_payment_status', { chitId: parseInt(chitGroupId) }) as any[]
    
    
    const frontendStatuses: MemberPaymentStatus[] = statuses.map((status: any) => ({
      memberId: status.member_id.toString(),
      memberName: status.member_name,
      cyclesPaid: status.cycles_paid,
      currentCycle: status.current_cycle,
      lateCycles: status.late_cycles,
      isUpToDate: status.is_up_to_date,
    }))
    
    
    return { success: true, data: frontendStatuses }
  } catch (error) {
    console.error('Failed to get member payment status:', error)
    return { success: false, error: 'Failed to get member payment status' }
  }
}

export async function getChitCyclesWithDetails(chitGroupId: string): Promise<ApiResponse<ChitCycleDetail[]>> {
  try {
    
    const cycles = await invoke('get_chit_cycles_with_details', { chitId: parseInt(chitGroupId) }) as any[]
    
    
    const frontendCycles: ChitCycleDetail[] = cycles.map((cycle: any) => ({
      id: cycle.id.toString(),
      chitGroupId: cycle.chit_id.toString(),
      cycleNumber: cycle.cycle_no,
      auctionDate: cycle.auction_date,
      winningMemberId: cycle.winning_member_id?.toString(),
      winningMemberName: cycle.winning_member_name,
      bidDiscount: cycle.bid_discount,
      payoutAmount: cycle.payout_amount,
      totalCollected: cycle.total_collected,
      numberOfPayers: cycle.number_of_payers,
      expectedCollection: cycle.expected_collection,
    }))
    
    
    return { success: true, data: frontendCycles }
  } catch (error) {
    console.error('Failed to get chit cycles with details:', error)
    return { success: false, error: 'Failed to get chit cycles with details' }
  }
}

export async function getChitMigrationStatus(chitGroupId: string): Promise<ApiResponse<ChitMigrationStatus>> {
  try {
    
    const status = await invoke('get_chit_migration_status', { chitId: parseInt(chitGroupId) }) as any
    
    
    const frontendStatus: ChitMigrationStatus = {
      chitId: status.chit_id.toString(),
      chitName: status.chit_name,
      totalMonths: status.total_months,
      cyclesEntered: status.cycles_entered,
      cyclesRemaining: status.cycles_remaining,
      totalMembers: status.total_members,
      membersUpToDate: status.members_up_to_date,
      membersWithPending: status.members_with_pending,
      totalBidDiscounts: status.total_bid_discounts,
      totalCollected: status.total_collected,
      isComplete: status.is_complete,
    }
    
    
    return { success: true, data: frontendStatus }
  } catch (error) {
    console.error('Failed to get chit migration status:', error)
    return { success: false, error: 'Failed to get chit migration status' }
  }
}

// ── New configurable chit API ─────────────────────────────────────────────

export async function getChitCycleWinners(cycleId: string): Promise<ApiResponse<import('@/lib/types').ChitCycleWinner[]>> {
  try {
    const rows = await invoke('get_chit_cycle_winners', { cycleId: parseInt(cycleId) }) as any[]
    return {
      success: true,
      data: rows.map((w: any) => ({
        id: w.id.toString(),
        chitGroupId: w.chit_id.toString(),
        cycleId: w.cycle_id.toString(),
        memberId: w.member_id.toString(),
        memberName: w.member_name,
        winnerType: w.winner_type as 'FIXED' | 'AUCTION',
        bidDiscount: w.bid_discount,
        commission: w.commission,
        payoutAmount: w.payout_amount,
        paymentMethod: w.payment_method.toLowerCase() as 'cash' | 'bank',
        paidAt: w.paid_at,
      })),
    }
  } catch (error) {
    return { success: false, error: 'Failed to get cycle winners' }
  }
}

export async function getCycleEligibility(chitGroupId: string, cycleId: string): Promise<ApiResponse<import('@/lib/types').MemberEligibility[]>> {
  try {
    const rows = await invoke('get_cycle_eligibility', { chitId: parseInt(chitGroupId), cycleId: parseInt(cycleId) }) as any[]
    return {
      success: true,
      data: rows.map(r => ({
        memberId: r.member_id.toString(),
        memberName: r.member_name,
        isEligible: !!r.is_eligible,
        adminOverride: !!r.admin_override,
      })),
    }
  } catch (error) {
    return { success: false, error: 'Failed to get eligibility' }
  }
}

export async function overrideMemberEligibility(chitGroupId: string, cycleId: string, memberId: string, eligible: boolean, reason: string): Promise<ApiResponse<void>> {
  try {
    await invoke('override_member_eligibility', {
      chitId: parseInt(chitGroupId), cycleId: parseInt(cycleId),
      memberId: parseInt(memberId), eligible, reason,
    })
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error?.toString() }
  }
}

export interface AuctionWinnerInput {
  memberId: string
  bidDiscount: number
  paymentMethod: 'cash' | 'bank'
  bankTxnId?: string | null
}

export async function processCycleWinners(
  chitGroupId: string,
  cycleId: string,
  fixedWinnerMemberId: string | null,
  fixedWinnerPaymentMethod: 'cash' | 'bank' | null,
  auctionWinners: AuctionWinnerInput[],
  overrideDiscountPerMember?: number,
  fixedWinnerBankTxnId?: string | null,
): Promise<ApiResponse<{ auctionDiscountPerMember: number; winners: import('@/lib/types').ChitCycleWinner[]; message: string }>> {
  try {
    const result = await withAutoPrint(() => invoke('process_chit_cycle_winners', {
      chitId: parseInt(chitGroupId),
      cycleId: parseInt(cycleId),
      fixedWinnerMemberId: fixedWinnerMemberId ? parseInt(fixedWinnerMemberId) : null,
      fixedWinnerPaymentMethod: fixedWinnerPaymentMethod?.toUpperCase() ?? null,
      fixedWinnerBankTxnId: fixedWinnerBankTxnId ?? null,
      auctionWinners: auctionWinners.map(w => ({
        member_id: parseInt(w.memberId),
        bid_discount: w.bidDiscount,
        payment_method: w.paymentMethod.toUpperCase(),
        bank_txn_id: w.bankTxnId ?? null,
      })),
      overrideDiscountPerMember: overrideDiscountPerMember ?? null,
    })) as any

    const winners: import('@/lib/types').ChitCycleWinner[] = (result.winners ?? []).map((w: any) => ({
      id: w.id.toString(),
      chitGroupId: w.chit_id.toString(),
      cycleId: w.cycle_id.toString(),
      memberId: w.member_id.toString(),
      memberName: w.member_name,
      winnerType: w.winner_type as 'FIXED' | 'AUCTION',
      bidDiscount: w.bid_discount,
      commission: w.commission,
      payoutAmount: w.payout_amount,
      paymentMethod: w.payment_method.toLowerCase() as 'cash' | 'bank',
      paidAt: w.paid_at,
    }))

    return { success: true, data: { auctionDiscountPerMember: result.auction_discount_per_member, winners, message: result.message } }
  } catch (error: any) {
    return { success: false, error: error?.toString() || 'Failed to process winners' }
  }
}
