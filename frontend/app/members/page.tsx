'use client'

import { MembersByTypeView } from '@/components/members-by-type-view'

// /members is the default landing page — shows SHG members (the most
// common type). Other types live at /members/chit and /members/loan.
// Renders the same component as /members/shg so the Dashboard's "Add
// Member" link (which historically points to /members) works without
// a client-side redirect, which doesn't reliably navigate in Tauri's
// static-export context.
export default function MembersDefaultPage() {
  return <MembersByTypeView type="SHG" />
}
