'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { GuarantorFields } from '@/components/forms/guarantor-fields'
import {
  getChitMemberGuarantors, setChitMemberGuarantors, toGuarantorInputs,
  type GuarantorInput,
} from '@/lib/api/guarantors'
import { getMembers } from '@/lib/api/members'

interface Props {
  chitGroupId: string
  memberId: string | null
  memberName?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => void
}

export function ChitMemberGuarantorsDialog({ chitGroupId, memberId, memberName, open, onOpenChange, onSaved }: Props) {
  const [guarantors, setGuarantors] = useState<GuarantorInput[]>([])
  const [members, setMembers] = useState<{ id: string; name: string; code?: string; memberType?: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || !memberId) return
    setLoading(true)
    Promise.all([
      getChitMemberGuarantors(chitGroupId, memberId),
      getMembers(),
    ]).then(([gRes, mRes]) => {
      if (gRes.success && gRes.data) setGuarantors(toGuarantorInputs(gRes.data))
      else setGuarantors([])
      if (mRes.success && mRes.data) {
        setMembers(mRes.data.map(m => ({ id: m.id, name: m.name, code: m.code, memberType: m.memberType })))
      }
    }).finally(() => setLoading(false))
  }, [open, memberId, chitGroupId])

  const handleSave = async () => {
    if (!memberId) return
    setSaving(true)
    try {
      const res = await setChitMemberGuarantors(chitGroupId, memberId, guarantors)
      if (res.success) {
        toast.success('Guarantors saved')
        onSaved?.()
        onOpenChange(false)
      } else {
        toast.error(res.error || 'Failed to save guarantors')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Guarantors{memberName ? ` — ${memberName}` : ''}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10"><Spinner className="h-6 w-6" /></div>
        ) : (
          <GuarantorFields
            value={guarantors}
            onChange={setGuarantors}
            members={members}
            selfMemberId={memberId ?? undefined}
          />
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving && <Spinner className="mr-2 h-4 w-4" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
