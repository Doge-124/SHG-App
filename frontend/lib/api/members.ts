import { invoke } from '@tauri-apps/api/core'
import { withAutoPrint } from '@/lib/auto-print'
import type { Member, MemberType, MemberFormData, OpeningDataInput, MemberProfile, ApiResponse } from '@/lib/types'

export async function getMembers(): Promise<ApiResponse<Member[]>> {
  try {
    const members = await invoke('list_members') as any[]
    
    const formattedMembers: Member[] = members.map(member => {
      return {
        id: member.id.toString(),
        code: member.memberCode,
        name: member.name,
        phone: member.phone || '',
        address: member.address,
        joinDate: member.joinedAt ? new Date(member.joinedAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        status: member.isActive ? 'active' : 'inactive',
        balance: 0, // Would need to fetch from member_balances table
        memberType: member.memberType || 'SHG',
        createdAt: member.joinedAt || new Date().toISOString(),
        updatedAt: member.joinedAt || new Date().toISOString(),
      }
    })
    
    return { success: true, data: formattedMembers }
  } catch (error) {
    console.error('❌ getMembers: Failed to get members:', error)
    return { success: false, error: 'Failed to load members' }
  }
}

export async function getMember(id: string): Promise<ApiResponse<Member>> {
  try {
    // Backend expects member code, not ID. We need to find the member by ID first to get their code
    const members = await invoke('list_members') as any[]
    const member = members.find((m: any) => m.id.toString() === id)
    
    if (!member) {
      return { success: false, error: 'Member not found' }
    }
    
    // Now use the member's code to get the full details
    const memberDetails = await invoke('get_member', { code: member.memberCode }) as any
    
    const formattedMember: Member = {
      id: memberDetails.id.toString(),
      code: memberDetails.memberCode,
      name: memberDetails.name,
      phone: memberDetails.phone || '',
      address: memberDetails.address,
      joinDate: memberDetails.joinedAt ? new Date(memberDetails.joinedAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      status: memberDetails.isActive ? 'active' : 'inactive',
      balance: 0, // Would need to fetch from member_balances
      memberType: memberDetails.memberType || 'SHG',
      createdAt: memberDetails.joinedAt || new Date().toISOString(),
      updatedAt: memberDetails.joinedAt || new Date().toISOString(),
    }
    
    return { success: true, data: formattedMember }
  } catch (error) {
    console.error('Failed to get member:', error)
    return { success: false, error: 'Failed to load member' }
  }
}

export async function addMember(data: MemberFormData): Promise<ApiResponse<Member>> {
  try {
    const joinedAt = new Date().toISOString()

    // Backend assigns the next serial number (1, 2, 3 …) and returns it.
    const code = await invoke<string>('add_member_auto', {
      name: data.name,
      phone: data.phone,
      address: data.address,
      joinedAt,
      memberType: data.memberType,
    })

    const created = await invoke('get_member', { code }) as any
    return {
      success: true,
      data: {
        id: created.id.toString(),
        code: created.memberCode,
        name: created.name,
        phone: created.phone || '',
        address: created.address || '',
        joinDate: created.joinedAt ? new Date(created.joinedAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        status: created.isActive ? 'active' : 'inactive',
        memberType: created.memberType || 'SHG',
        balance: 0,
        createdAt: created.joinedAt || new Date().toISOString(),
        updatedAt: created.joinedAt || new Date().toISOString(),
      },
    }
  } catch (error) {
    console.error('Failed to add member:', error)
    return { success: false, error: typeof error === 'string' ? error : 'Failed to add member' }
  }
}

export async function updateMember(
  id: string,
  data: Partial<MemberFormData>
): Promise<ApiResponse<Member>> {
  try {
    // First get the member to find their code
    const members = await invoke('list_members') as any[]
    const member = members.find((m: any) => m.id.toString() === id)
    
    if (!member) {
      return { success: false, error: 'Member not found' }
    }
    
    // Update the member using their code
    await invoke('update_member', {
      code: member.memberCode,
      name: data.name || member.name,
      phone: data.phone !== undefined ? data.phone : member.phone,
      address: data.address !== undefined ? data.address : member.address,
    })

    // Return the updated member
    const updatedMember: Member = {
      id: member.id.toString(),
      code: member.memberCode,
      name: data.name || member.name,
      phone: data.phone !== undefined ? data.phone : member.phone,
      address: data.address !== undefined ? data.address : member.address,
      joinDate: member.joinedAt ? new Date(member.joinedAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      status: member.isActive ? 'active' : 'inactive',
      balance: 0,
      memberType: member.memberType || 'SHG',
      createdAt: member.joinedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    
    return { success: true, data: updatedMember }
  } catch (error) {
    console.error('Failed to update member:', error)
    return { success: false, error: typeof error === 'string' ? error : 'Failed to update member' }
  }
}

export async function deactivateMember(id: string): Promise<ApiResponse<void>> {
  try {
    await invoke('set_member_active', { memberId: parseInt(id), active: false })
    return { success: true }
  } catch (error) {
    console.error('Failed to deactivate member:', error)
    return { success: false, error: typeof error === 'string' ? error : 'Failed to deactivate member' }
  }
}

/** Current accrued savings balance for a member. */
export async function getMemberSavings(id: string): Promise<ApiResponse<number>> {
  try {
    const balance = await invoke<number>('member_balance', { memberId: parseInt(id) })
    return { success: true, data: balance }
  } catch (error) {
    console.error('Failed to get member savings:', error)
    return { success: false, error: typeof error === 'string' ? error : 'Failed to load savings balance' }
  }
}

/** Pay out a member's accrued savings as a voucher (reduces their savings). */
export async function payoutMemberSavings(
  id: string,
  amount: number,
  opts: {
    paymentMethod: string            // CASH | BANK | MIXED
    cashAmount?: number | null
    bankAmount?: number | null
    bankTxnId?: string | null
  },
): Promise<ApiResponse<void>> {
  try {
    await withAutoPrint(() => invoke('payout_member_savings_cmd', {
      memberId: parseInt(id),
      amount,
      paymentMethod: opts.paymentMethod.toUpperCase(),
      bankTxnId: opts.bankTxnId ?? null,
      createdAt: new Date().toISOString(),
      cashAmount: opts.cashAmount ?? null,
      bankAmount: opts.bankAmount ?? null,
    }))
    return { success: true }
  } catch (error) {
    console.error('Failed to pay out savings:', error)
    return { success: false, error: typeof error === 'string' ? error : 'Failed to pay out savings' }
  }
}

export async function reactivateMember(id: string): Promise<ApiResponse<void>> {
  try {
    await invoke('set_member_active', { memberId: parseInt(id), active: true })
    return { success: true }
  } catch (error) {
    console.error('Failed to reactivate member:', error)
    return { success: false, error: typeof error === 'string' ? error : 'Failed to reactivate member' }
  }
}

export async function searchMembers(query: string): Promise<ApiResponse<Member[]>> {
  try {
    const members = await invoke('list_members') as any[]
    
    const filtered = members.filter(
      (member: any) =>
        member.name.toLowerCase().includes(query.toLowerCase()) ||
        (member.code && member.code.toLowerCase().includes(query.toLowerCase())) ||
        (member.phone && member.phone.includes(query))
    )
    
    const formattedMembers: Member[] = filtered.map(member => ({
      id: member.id.toString(),
      code: member.code || `SHG${member.id}`,
      name: member.name,
      phone: member.phone || '',
      address: member.address,
      joinDate: member.created_at ? new Date(member.created_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      status: member.is_active ? 'active' : 'inactive',
      balance: member.balance || 0,
      memberType: member.memberType || 'SHG',
      createdAt: member.created_at || new Date().toISOString(),
      updatedAt: member.updated_at || new Date().toISOString(),
    }))
    
    return { success: true, data: formattedMembers }
  } catch (error) {
    console.error('Failed to search members:', error)
    return { success: false, error: 'Failed to search members' }
  }
}

export async function getMemberProfile(memberId: number): Promise<MemberProfile> {
  try {
    const profile = await invoke('get_member_profile', { memberId }) as any
    
    
    if (!profile) {
      throw new Error('Profile is null or undefined')
    }
    
    if (!profile.member) {
      throw new Error('Profile.member is null or undefined')
    }
    
    // Format the member data (backend now returns camelCase)
    const member: Member = {
      id: profile.member.id?.toString() || '',
      code: profile.member.memberCode || '',
      name: profile.member.name || '',
      phone: profile.member.phone || '',
      address: profile.member.address,
      joinDate: profile.member.joinedAt ? new Date(profile.member.joinedAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      status: profile.member.isActive ? 'active' : 'inactive',
      memberType: profile.member.memberType || 'SHG',
      balance: profile.currentBalance || 0,
      createdAt: profile.member.joinedAt || new Date().toISOString(),
      updatedAt: profile.member.joinedAt || new Date().toISOString(),
    }
    
    return {
      member,
      currentBalance: profile.currentBalance || 0,
      openingBalance: profile.openingBalance || 0,
      regularBalance: profile.regularBalance ?? ((profile.currentBalance || 0) - (profile.openingBalance || 0)),
      openingBalanceMethod: profile.openingBalanceMethod,
      openingBalanceSetAt: profile.openingBalanceSetAt,
      initialInstallments: profile.initialInstallments || 0,
      currentInstallments: profile.currentInstallments || 0,
      totalInstallments: profile.totalInstallments || 0,
      openingDataLocked: profile.openingDataLocked || false,
      recentTransactions: (profile.recentTransactions || []).map((txn: any) => ({
        id: txn?.id,
        memberId: txn?.memberId,
        amount: txn?.amount,
        txnType: txn?.txnType,
        reason: txn?.reason,
        createdAt: txn?.createdAt,
      }))
    }
  } catch (error) {
    console.error('Failed to get member profile:', error)
    throw error
  }
}

export async function setMemberOpeningData(input: OpeningDataInput): Promise<void> {
  try {
    await invoke('set_member_opening_data', { 
      input: {
        member_id: input.memberId,
        opening_balance: input.openingBalance,
        payment_method: input.paymentMethod,
        past_installments: input.pastInstallments
      }
    })
  } catch (error) {
    console.error('Failed to set opening data:', error)
    throw new Error(typeof error === 'string' ? error : 'Failed to set opening data')
  }
}

/**
 * List members filtered by member type
 */
export async function getMembersByType(memberType: MemberType): Promise<ApiResponse<Member[]>> {
  try {
    const members = await invoke('list_members_by_type_cmd', { memberType }) as any[]
    
    const formattedMembers: Member[] = members.map(member => ({
      id: member.id.toString(),
      code: member.memberCode,
      name: member.name,
      phone: member.phone || '',
      address: member.address,
      joinDate: member.joinedAt ? new Date(member.joinedAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      status: member.isActive ? 'active' : 'inactive',
      balance: 0,
      memberType: member.memberType || 'SHG',
      createdAt: member.joinedAt || new Date().toISOString(),
      updatedAt: member.joinedAt || new Date().toISOString(),
    }))
    
    return { success: true, data: formattedMembers }
  } catch (error) {
    console.error('Failed to get members by type:', error)
    return { success: false, error: 'Failed to load members by type' }
  }
}

/**
 * Update a member's type
 */
export async function updateMemberType(memberId: number, memberType: MemberType): Promise<ApiResponse<void>> {
  try {
    await invoke('update_member_type', { memberId, memberType })
    return { success: true }
  } catch (error: any) {
    console.error('Failed to update member type:', error)
    return { success: false, error: error.toString() }
  }
}
