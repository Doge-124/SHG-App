import { invoke } from '@tauri-apps/api/core'
import type { ApiResponse } from '@/lib/types'

export type GuarantorType = 'self' | 'member' | 'other'

/** Editable guarantor entry used by forms. */
export interface GuarantorInput {
  guarantorType: GuarantorType
  memberId?: string | null   // when type = member
  name?: string | null       // when type = other
  details?: string | null    // when type = other
}

/** Stored guarantor returned from the backend (member names resolved). */
export interface Guarantor {
  slot: number
  guarantorType: 'SELF' | 'MEMBER' | 'OTHER'
  memberId: number | null
  memberName: string | null
  name: string | null
  details: string | null
}

function toBackend(items: GuarantorInput[]) {
  return items
    // drop incomplete rows so empty slots aren't saved
    .filter(g =>
      g.guarantorType === 'self' ||
      (g.guarantorType === 'member' && !!g.memberId) ||
      (g.guarantorType === 'other' && !!(g.name && g.name.trim()))
    )
    .map(g => ({
      guarantorType: g.guarantorType,
      memberId: g.guarantorType === 'member' && g.memberId ? parseInt(g.memberId) : null,
      name: g.guarantorType === 'other' ? (g.name ?? null) : null,
      details: g.guarantorType === 'other' ? (g.details ?? null) : null,
    }))
}

/** Convert stored guarantors back into editable form rows. */
export function toGuarantorInputs(items: Guarantor[]): GuarantorInput[] {
  return items.map(g => ({
    guarantorType: g.guarantorType.toLowerCase() as GuarantorType,
    memberId: g.memberId != null ? g.memberId.toString() : null,
    name: g.name,
    details: g.details,
  }))
}

export async function setLoanGuarantors(loanId: string, guarantors: GuarantorInput[]): Promise<ApiResponse<void>> {
  try {
    await invoke('set_loan_guarantors', { loanId: parseInt(loanId), guarantors: toBackend(guarantors) })
    return { success: true }
  } catch (error) {
    return { success: false, error: typeof error === 'string' ? error : 'Failed to save guarantors' }
  }
}

export async function getLoanGuarantors(loanId: string): Promise<ApiResponse<Guarantor[]>> {
  try {
    const data = await invoke<Guarantor[]>('get_loan_guarantors', { loanId: parseInt(loanId) })
    return { success: true, data }
  } catch (error) {
    return { success: false, error: typeof error === 'string' ? error : 'Failed to load guarantors' }
  }
}

export async function setChitMemberGuarantors(
  chitGroupId: string,
  memberId: string,
  guarantors: GuarantorInput[],
): Promise<ApiResponse<void>> {
  try {
    await invoke('set_chit_member_guarantors', {
      chitId: parseInt(chitGroupId),
      memberId: parseInt(memberId),
      guarantors: toBackend(guarantors),
    })
    return { success: true }
  } catch (error) {
    return { success: false, error: typeof error === 'string' ? error : 'Failed to save guarantors' }
  }
}

export async function getChitMemberGuarantors(
  chitGroupId: string,
  memberId: string,
): Promise<ApiResponse<Guarantor[]>> {
  try {
    const data = await invoke<Guarantor[]>('get_chit_member_guarantors', {
      chitId: parseInt(chitGroupId),
      memberId: parseInt(memberId),
    })
    return { success: true, data }
  } catch (error) {
    return { success: false, error: typeof error === 'string' ? error : 'Failed to load guarantors' }
  }
}
