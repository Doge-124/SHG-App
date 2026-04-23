'use client'

import { useState, useEffect } from 'react'
import { X, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Spinner } from '@/components/ui/spinner'
import { recordWeeklyContribution } from '@/lib/api/receipts'
import { getMembers } from '@/lib/api/members'
import type { Member } from '@/lib/types'

interface WeeklyContributionFormProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

export function WeeklyContributionForm({ isOpen, onClose, onSuccess }: WeeklyContributionFormProps) {
  const [members, setMembers] = useState<Member[]>([])
  const [selectedMemberId, setSelectedMemberId] = useState<string>('')
  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'BANK'>('CASH')
  const [note, setNote] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingMembers, setIsLoadingMembers] = useState(false)

  useEffect(() => {
    if (isOpen) {
      loadMembers()
    }
  }, [isOpen])

  async function loadMembers() {
    setIsLoadingMembers(true)
    try {
      const response = await getMembers()
      if (response.success && response.data) {
        // Filter only active members
        setMembers(response.data.filter(m => m.status === 'active' && m.memberType === 'SHG'))
      }
    } catch (error) {
      toast.error('Failed to load members')
    } finally {
      setIsLoadingMembers(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    
    if (!selectedMemberId) {
      toast.error('Please select a member')
      return
    }

    const amountNum = parseFloat(amount)
    if (!amountNum || amountNum <= 0) {
      toast.error('Amount must be greater than 0')
      return
    }

    if (!paymentMethod) {
      toast.error('Please select a payment method')
      return
    }

    setIsLoading(true)
    try {
      const response = await recordWeeklyContribution({
        member_id: parseInt(selectedMemberId),
        amount: amountNum,
        payment_method: paymentMethod,
        note: note || undefined
      })

      if (response.success) {
        toast.success('Weekly contribution recorded successfully')
        onSuccess()
        handleClose()
      } else {
        toast.error(response.error || 'Failed to record contribution')
      }
    } catch (error) {
      toast.error('Failed to record contribution')
    } finally {
      setIsLoading(false)
    }
  }

  function handleClose() {
    setSelectedMemberId('')
    setAmount('')
    setPaymentMethod('CASH')
    setNote('')
    onClose()
  }

  const selectedMember = members.find(m => m.id.toString() === selectedMemberId)

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Record Weekly Contribution</DialogTitle>
          <DialogDescription>
            Record a member's weekly savings contribution to the SHG.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Member Selection */}
          <div className="space-y-2">
            <Label htmlFor="member">Member *</Label>
            <Select
              value={selectedMemberId}
              onValueChange={(value) => setSelectedMemberId(value)}
              disabled={isLoadingMembers}
            >
              <SelectTrigger>
                <SelectValue placeholder={isLoadingMembers ? "Loading members..." : "Select member"} />
              </SelectTrigger>
              <SelectContent>
                {members.map((member) => (
                  <SelectItem key={member.id} value={member.id.toString()}>
                    {member.name} ({member.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Amount */}
          <div className="space-y-2">
            <Label htmlFor="amount">Amount (₹) *</Label>
            <Input
              id="amount"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>

          {/* Payment Method */}
          <div className="space-y-2">
            <Label>Payment Method *</Label>
            <RadioGroup
              value={paymentMethod}
              onValueChange={(value) => setPaymentMethod(value as 'CASH' | 'BANK')}
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="CASH" id="cash" />
                <Label htmlFor="cash">Cash</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="BANK" id="bank" />
                <Label htmlFor="bank">Bank</Label>
              </div>
            </RadioGroup>
          </div>

          {/* Note */}
          <div className="space-y-2">
            <Label htmlFor="note">Note (optional)</Label>
            <Input
              id="note"
              type="text"
              placeholder="e.g., Week 12"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {/* Selected Member Info */}
          {selectedMember && (
            <div className="p-3 bg-muted rounded-md">
              <p className="text-sm font-medium">Selected Member:</p>
              <p className="text-sm">{selectedMember.name}</p>
              <p className="text-xs text-muted-foreground">
                Code: {selectedMember.code} | Phone: {selectedMember.phone}
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={handleClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading || selectedMemberId === '' || !amount}>
              {isLoading ? (
                <>
                  <Spinner className="mr-2 h-4 w-4" />
                  Recording...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Record Contribution
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
