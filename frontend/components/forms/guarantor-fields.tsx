'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Plus, X, ShieldCheck } from 'lucide-react'
import { MemberTypeTag } from '@/components/member-type-tag'
import type { GuarantorInput, GuarantorType } from '@/lib/api/guarantors'

interface Props {
  value: GuarantorInput[]
  onChange: (v: GuarantorInput[]) => void
  members: { id: string; name: string; code?: string; memberType?: string }[]
  /** Member this guarantor is for (excluded from the "SHG member" dropdown). */
  selfMemberId?: string
  max?: number
}

const EMPTY: GuarantorInput = { guarantorType: 'self', memberId: null, name: '', details: '' }

export function GuarantorFields({ value, onChange, members, selfMemberId, max = 2 }: Props) {
  const update = (i: number, patch: Partial<GuarantorInput>) => {
    onChange(value.map((g, idx) => (idx === i ? { ...g, ...patch } : g)))
  }
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i))
  const add = () => onChange([...value, { ...EMPTY }])

  const memberOptions = members.filter(m => m.id !== selfMemberId)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-2 text-sm">
          <ShieldCheck className="h-4 w-4" />Guarantors <span className="text-muted-foreground font-normal">(optional, up to {max})</span>
        </Label>
        {value.length < max && (
          <Button type="button" variant="outline" size="sm" onClick={add}>
            <Plus className="mr-1 h-4 w-4" />Add guarantor
          </Button>
        )}
      </div>

      {value.length === 0 && (
        <p className="text-xs text-muted-foreground">No guarantors added.</p>
      )}

      {value.map((g, i) => (
        <div key={i} className="rounded-md border p-3 space-y-2 bg-muted/30">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground w-16">Guarantor {i + 1}</span>
            <Select value={g.guarantorType} onValueChange={(t) => update(i, { guarantorType: t as GuarantorType })}>
              <SelectTrigger className="h-8 flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="self">Self</SelectItem>
                <SelectItem value="member">SHG member</SelectItem>
                <SelectItem value="other">Other (enter details)</SelectItem>
              </SelectContent>
            </Select>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => remove(i)}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {g.guarantorType === 'member' && (
            <Select value={g.memberId ?? ''} onValueChange={(v) => update(i, { memberId: v })}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Select member" /></SelectTrigger>
              <SelectContent>
                {memberOptions.map(m => (
                  <SelectItem key={m.id} value={m.id}>{m.name}{m.code ? ` (${m.code})` : ''}<MemberTypeTag type={m.memberType} /></SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {g.guarantorType === 'other' && (
            <div className="grid grid-cols-1 gap-2">
              <Input
                className="h-8"
                placeholder="Guarantor name"
                value={g.name ?? ''}
                onChange={(e) => update(i, { name: e.target.value })}
                maxLength={120}
              />
              <Input
                className="h-8"
                placeholder="Phone / address / details (optional)"
                value={g.details ?? ''}
                onChange={(e) => update(i, { details: e.target.value })}
                maxLength={250}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
