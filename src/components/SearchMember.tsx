import { useRef, useState } from 'react'

import { getMember } from '../api/members'
import MemberProfilePage from '../pages/MemberProfile'
import { useToast } from './Toast'

export default function SearchMember() {
  const { showToast } = useToast()
  const codeRef = useRef<HTMLInputElement>(null)
  const [memberId, setMemberId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  async function search() {
    const code = codeRef.current?.value.trim()
    if (!code) return

    setLoading(true)
    try {
      const m = await getMember(code)
      setMemberId(m.id)
    } catch (e) {
      setMemberId(null)
      showToast({ kind: 'error', title: 'Member not found', description: String(e) })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ marginTop: 16 }}>
      <h3>Search Member</h3>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input ref={codeRef} placeholder="Member Code" />
        <button onClick={search} disabled={loading}>
          {loading ? 'Searching…' : 'Search'}
        </button>
      </div>

      {memberId ? (
        <div style={{ marginTop: 12 }}>
          <MemberProfilePage memberId={memberId} />
        </div>
      ) : null}
    </div>
  )
}
