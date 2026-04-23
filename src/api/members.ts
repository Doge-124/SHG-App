import { invoke } from '@tauri-apps/api/core'
import type { Member, MemberProfile, OpeningDataInput } from '../types/member'

export async function addMember(input: {
  code: string
  name: string
  phone?: string | null
  address?: string | null
  joinedAt: string
}): Promise<void> {
  await invoke('add_member', {
    code: input.code,
    name: input.name,
    phone: input.phone ?? null,
    address: input.address ?? null,
    joinedAt: input.joinedAt,
  })
}

export async function getMember(code: string): Promise<Member> {
  return await invoke<Member>('get_member', { code })
}

export async function listMembers(): Promise<Member[]> {
  return await invoke<Member[]>('list_members')
}

export async function getMemberBalance(memberId: number): Promise<number> {
  return await invoke<number>('member_balance', { memberId })
}

export async function setMemberOpeningData(input: OpeningDataInput): Promise<void> {
  await invoke('set_member_opening_data', { input })
}

export async function getMemberProfile(memberId: number): Promise<MemberProfile> {
  return await invoke<MemberProfile>('get_member_profile', { memberId })
}

