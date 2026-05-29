'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function MembersIndexRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/members/shg') }, [router])
  return null
}
