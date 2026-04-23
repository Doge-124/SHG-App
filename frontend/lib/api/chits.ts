import { invoke } from '@tauri-apps/api/core'
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
        const totalMembers = group.months
        const currentMembers = chitMembers.length
        const currentCycle = chitCyclesRaw.length > 0 ? Math.max(...chitCyclesRaw.map((c: any) => c.cycle_no)) : 0


        return {
          id: group.id.toString(),
          name: group.name,
          totalAmount: group.total_amount,
          monthlyContribution: group.monthly_contribution,
          totalMembers,
          currentMembers,
          durationMonths: group.months,
          currentCycle,
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
    
    // Calculate member counts from chit_members data
    const totalMembers = chitGroup.months // Total members should equal the duration in months
    const currentMembers = chitMembers.length // Current members are those actually added
    
    
    const frontendChitGroup: ChitGroup = {
      id: chitGroup.id.toString(),
      name: chitGroup.name,
      totalAmount: chitGroup.total_amount,
      monthlyContribution: chitGroup.monthly_contribution,
      totalMembers,
      currentMembers,
      durationMonths: chitGroup.months,
      currentCycle: chitCyclesRaw.length > 0 ? Math.max(...chitCyclesRaw.map((c: any) => c.cycle_no)) : 0,
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
    })).sort((a, b) => new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime())
    
    if (frontendChitMembers.length > 0) {
    }
    
    return { success: true, data: frontendChitMembers }
  } catch (error) {
    console.error('Failed to get chit members:', error)
    return { success: false, error: 'Failed to load chit members' }
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
      commissionPercent: 5, // Default commission
      startDate: data.startDate,
    })
    
    const newChitGroup: ChitGroup = {
      id: Date.now().toString(),
      name: data.name,
      totalAmount: data.totalAmount,
      monthlyContribution: data.monthlyContribution,
      totalMembers: data.totalMembers,
      currentMembers: 0,
      durationMonths: data.durationMonths,
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

export async function recordChitPayment(
  chitGroupId: string,
  cycleId: string,
  memberId: string,
  amount: number,
  paymentMethod: 'cash' | 'bank',
): Promise<ApiResponse<ChitPayment>> {
  try {
    const paymentData = await invoke('record_chit_payment', {
      chitId: parseInt(chitGroupId),
      cycleId: parseInt(cycleId),
      memberId: parseInt(memberId),
      amount,
      paymentMethod: paymentMethod.toUpperCase(), // Convert to uppercase for backend
      paidAt: new Date().toISOString(),
    }) as any
    
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
    await invoke('payout_chit_winner', {
      chitId: parseInt(chitGroupId),
      cycleId: parseInt(cycleId),
      winningMemberId: parseInt(winningMemberId),
      payoutAmount,
      paymentMethod: paymentMethod.toUpperCase(), // Convert to uppercase for backend
      payoutDate: new Date().toISOString(),
      note,
    })
    
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
  paymentMethod: 'cash' | 'bank'
): Promise<ApiResponse<{
  paymentId: string;
  netAmount: number;
  receiptGenerated: boolean;
  message: string;
}>> {
  try {
    
    const result = await invoke('record_member_payment_with_discount', {
      input: {
        chit_id: parseInt(chitGroupId),
        cycle_id: parseInt(cycleId),
        member_id: parseInt(memberId),
        gross_amount: grossAmount,
        auction_discount: auctionDiscount,
        payment_method: paymentMethod.toUpperCase(),
      }
    }) as any
    
    
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

export async function processWinnerPayout(
  chitGroupId: string,
  cycleId: string,
  winningMemberId: string,
  winnerAmount: number,
  paymentMethod: 'cash' | 'bank',
  note: string
): Promise<ApiResponse<{
  voucherGenerated: boolean;
  bidDiscount: number;
  message: string;
}>> {
  try {
    
    const result = await invoke('process_winner_payout', {
      input: {
        chit_id: parseInt(chitGroupId),
        cycle_id: parseInt(cycleId),
        winning_member_id: parseInt(winningMemberId),
        winner_amount: winnerAmount,
        payment_method: paymentMethod.toUpperCase(),
        note,
      }
    }) as any
    
    
    return {
      success: true,
      data: {
        voucherGenerated: result.voucher_generated,
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
): Promise<ApiResponse<{ cycleId: string; totalCollected: number; bidDiscount: number; payoutAmount: number; netToShg: number }>> {
  try {

    // Calculate default winner payout if not provided (total - bidDiscount)
    const totalCollected = data.memberPayments.reduce((sum, p) => sum + p.amount, 0)
    const winnerPayout = data.winnerPayout ?? (totalCollected - data.bidDiscount)

    const result = await invoke('record_past_chit_cycle', {
      chitId: parseInt(chitGroupId),
      cycleNo: data.cycleNumber,
      auctionDate: data.auctionDate,
      winningMemberId: data.winningMemberId ? parseInt(data.winningMemberId) : null,
      bidDiscount: data.bidDiscount,
      winnerPayout: winnerPayout,
      memberPayments: data.memberPayments.map((p: { memberId: string; amount: number; paymentMethod: string }) => ({
        memberId: parseInt(p.memberId),
        amount: p.amount,
        paymentMethod: p.paymentMethod.toUpperCase(),
      })),
    }) as {
      cycle_id: string;
      total_collected: number;
      bid_discount: number;
      payout_amount: number;
      net_to_shg: number;
    }


    return {
      success: true,
      data: {
        cycleId: result.cycle_id.toString(),
        totalCollected: result.total_collected,
        bidDiscount: result.bid_discount,
        payoutAmount: result.payout_amount,
        netToShg: result.net_to_shg,
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
