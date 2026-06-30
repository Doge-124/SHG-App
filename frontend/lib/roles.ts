import type { MemberType } from '@/lib/types'

/** All assignable member roles, in canonical order. */
export const MEMBER_ROLES: MemberType[] = ['SHG', 'CHIT', 'LOAN']

/** Split a member's role field ("SHG" / "CHIT,LOAN") into role tokens. */
export function memberRoles(memberType: string | null | undefined): MemberType[] {
  return (memberType ?? '')
    .split(',')
    .map(r => r.trim().toUpperCase())
    .filter(Boolean)
    .filter((r): r is MemberType => (MEMBER_ROLES as string[]).includes(r))
}

/** True if the member holds the given role. */
export function memberHasRole(memberType: string | null | undefined, role: MemberType): boolean {
  return memberRoles(memberType).includes(role)
}

/** Loan privilege: SHG or LOAN. */
export function canMemberLoan(memberType: string | null | undefined): boolean {
  const r = memberRoles(memberType)
  return r.includes('SHG') || r.includes('LOAN')
}

/** Chit privilege: SHG or CHIT. */
export function canMemberChit(memberType: string | null | undefined): boolean {
  const r = memberRoles(memberType)
  return r.includes('SHG') || r.includes('CHIT')
}

/** Savings privilege: SHG only. */
export function canMemberSavings(memberType: string | null | undefined): boolean {
  return memberRoles(memberType).includes('SHG')
}
