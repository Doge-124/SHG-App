'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { invoke } from '@tauri-apps/api/core'
import { Plus, Trash2, History, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { getMembersByType } from '@/lib/api/members'
import { formatCurrency, formatDate } from '@/lib/format'
import { useSettings } from '@/lib/settings-context'
import type { Member } from '@/lib/types'

interface Repayment {
  id: string
  amount: number
  paymentMethod: 'CASH' | 'BANK'
  paidAt: string
}

interface PastLoanFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function PastLoanForm({ open, onOpenChange, onSuccess }: PastLoanFormProps) {
  const { pastDataLocked } = useSettings()
  const [members, setMembers] = useState<Member[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Loan details
  const [memberId, setMemberId] = useState('')
  const [amount, setAmount] = useState<number>(0)
  const [interestRate, setInterestRate] = useState<number>(0.06)
  const [loanType, setLoanType] = useState<'monthly' | 'weekly'>('monthly')
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'BANK'>('CASH')
  const [note, setNote] = useState('')
  const [issuedAt, setIssuedAt] = useState(new Date().toISOString().split('T')[0])

  // Repayments
  const [repayments, setRepayments] = useState<Repayment[]>([])

  // Derived values
  const upfrontDays = loanType === 'weekly' ? 100 : 30
  const upfrontInterest = Math.round(amount * interestRate / 100 * upfrontDays * 100) / 100
  const totalRepaid = repayments.reduce((s, r) => s + r.amount, 0)
  const outstanding = Math.max(0, (amount - upfrontInterest) - totalRepaid)
  const isFullyRepaid = outstanding <= 0.01

  useEffect(() => {
    if (!open) return
    setIsLoading(true)
    Promise.all([
      getMembersByType('SHG'),
      getMembersByType('LOAN'),
    ]).then(([shgRes, loanRes]) => {
      const all: Member[] = [
        ...(shgRes.success && shgRes.data ? shgRes.data : []),
        ...(loanRes.success && loanRes.data ? loanRes.data : []),
      ].filter(m => m.status === 'active')
        .sort((a, b) => a.name.localeCompare(b.name))
      setMembers(all)
    }).catch(() => toast.error('Failed to load members'))
      .finally(() => setIsLoading(false))
  }, [open])

  const addRepayment = () => {
    setRepayments(prev => [
      ...prev,
      {
        id: Date.now().toString(),
        amount: 0,
        paymentMethod: 'CASH',
        paidAt: new Date().toISOString().split('T')[0],
      },
    ])
  }

  const updateRepayment = (id: string, field: keyof Repayment, value: any) => {
    setRepayments(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r))
  }

  const removeRepayment = (id: string) => {
    setRepayments(prev => prev.filter(r => r.id !== id))
  }

  const reset = () => {
    setMemberId('')
    setAmount(0)
    setInterestRate(12)
    setLoanType('monthly')
    setPaymentMethod('CASH')
    setNote('')
    setIssuedAt(new Date().toISOString().split('T')[0])
    setRepayments([])
  }

  const handleSubmit = async () => {
    if (!memberId) { toast.error('Please select a member'); return }
    if (amount <= 0) { toast.error('Loan amount must be greater than 0'); return }
    if (interestRate < 0) { toast.error('Daily interest rate cannot be negative'); return }

    // Validate repayments
    for (const r of repayments) {
      if (r.amount <= 0) { toast.error('All repayment amounts must be > 0'); return }
      if (r.paidAt < issuedAt) { toast.error('Repayment date cannot be before the loan issue date'); return }
    }

    // Sort repayments by date ascending before submitting
    const sorted = [...repayments].sort((a, b) => a.paidAt.localeCompare(b.paidAt))

    setIsSubmitting(true)
    try {
      await invoke('record_past_loan', {
        memberId: parseInt(memberId),
        amount,
        dailyInterestRate: interestRate,
        paymentMethod,
        loanType,
        note: note || 'Past loan entry',
        issuedAt,
        repayments: sorted.map(r => ({
          amount: r.amount,
          paymentMethod: r.paymentMethod,
          paidAt: r.paidAt,
        })),
      })

      toast.success('Past loan recorded successfully')
      reset()
      onSuccess()
      onOpenChange(false)
    } catch (err: any) {
      toast.error(typeof err === 'string' ? err : 'Failed to record past loan')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Past Loan Data Entry
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="h-[68vh] pr-1">
          <div className="space-y-5">

            {pastDataLocked && (
              <Alert className="border-amber-400 bg-amber-50">
                <AlertDescription className="flex items-center gap-2 text-amber-700">
                  <Lock className="h-4 w-4 flex-shrink-0" />
                  Past data entry is locked. Go to Settings → Data to unlock.
                </AlertDescription>
              </Alert>
            )}

            {/* Loan details */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Loan Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Member</Label>
                  <Select value={memberId} onValueChange={setMemberId} disabled={isLoading}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select member (SHG or LOAN type)" />
                    </SelectTrigger>
                    <SelectContent>
                      {members.map(m => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name} ({m.code}) —{' '}
                          <span className="text-muted-foreground">{m.memberType}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Issue Date</Label>
                    <Input
                      type="date"
                      value={issuedAt}
                      max={new Date().toISOString().split('T')[0]}
                      onChange={e => setIssuedAt(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Loan Type</Label>
                    <Select value={loanType} onValueChange={(v: any) => setLoanType(v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="monthly">Monthly (open-ended)</SelectItem>
                        <SelectItem value="weekly">Weekly (100-day term, 20-day grace)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Principal Amount (₹)</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={amount || ''}
                      onChange={e => setAmount(parseFloat(e.target.value) || 0)}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Daily Interest Rate (%/day)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={10}
                      step="0.01"
                      value={interestRate}
                      onChange={e => setInterestRate(parseFloat(e.target.value) || 0)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Disbursement Method</Label>
                    <Select value={paymentMethod} onValueChange={(v: any) => setPaymentMethod(v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CASH">Cash</SelectItem>
                        <SelectItem value="BANK">Bank</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Note (optional)</Label>
                    <Input
                      value={note}
                      onChange={e => setNote(e.target.value)}
                      placeholder="e.g. agriculture loan"
                    />
                  </div>
                </div>

                {amount > 0 && (
                  <div className="rounded-lg bg-muted p-3 grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <p className="text-muted-foreground">Principal</p>
                      <p className="font-semibold">{formatCurrency(amount)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Upfront Interest (30 days)</p>
                      <p className="font-semibold text-orange-600">{formatCurrency(upfrontInterest)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Borrower Received</p>
                      <p className="font-semibold text-green-700">{formatCurrency(amount - upfrontInterest)}</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Repayments */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between">
                  Repayment History
                  <Button variant="outline" size="sm" onClick={addRepayment} type="button">
                    <Plus className="h-4 w-4 mr-1" />
                    Add Repayment
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {repayments.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No repayments recorded — loan will be marked as active.
                  </p>
                )}
                {repayments.map((r, idx) => (
                  <div key={r.id} className="grid grid-cols-[auto_1fr_1fr_1fr_auto] gap-3 items-end">
                    <span className="text-sm text-muted-foreground pb-2">#{idx + 1}</span>
                    <div className="space-y-1">
                      <Label className="text-xs">Date</Label>
                      <Input
                        type="date"
                        value={r.paidAt}
                        min={issuedAt}
                        max={new Date().toISOString().split('T')[0]}
                        onChange={e => updateRepayment(r.id, 'paidAt', e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Amount (₹)</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={r.amount || ''}
                        onChange={e => updateRepayment(r.id, 'amount', parseFloat(e.target.value) || 0)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Method</Label>
                      <Select
                        value={r.paymentMethod}
                        onValueChange={v => updateRepayment(r.id, 'paymentMethod', v)}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="CASH">Cash</SelectItem>
                          <SelectItem value="BANK">Bank</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => removeRepayment(r.id)} type="button">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}

                {/* Repayment summary */}
                {amount > 0 && (
                  <>
                    <Separator />
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <p className="text-muted-foreground">Principal</p>
                        <p className="font-semibold">{formatCurrency(amount)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Total Repaid</p>
                        <p className="font-semibold text-success">{formatCurrency(totalRepaid)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Outstanding</p>
                        <p className={`font-semibold ${isFullyRepaid ? 'text-success' : 'text-warning-foreground'}`}>
                          {formatCurrency(outstanding)}
                        </p>
                      </div>
                    </div>
                    <Alert className={isFullyRepaid ? 'border-green-500 bg-green-50' : 'border-blue-500'}>
                      <AlertDescription>
                        Loan will be marked as{' '}
                        <Badge variant={isFullyRepaid ? 'default' : 'secondary'} className={isFullyRepaid ? 'bg-success/20 text-success' : ''}>
                          {isFullyRepaid ? 'paid' : 'active'}
                        </Badge>
                      </AlertDescription>
                    </Alert>
                  </>
                )}
              </CardContent>
            </Card>

          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || pastDataLocked || !memberId || amount <= 0}>
            {isSubmitting ? 'Recording...' : pastDataLocked ? 'Locked' : 'Record Past Loan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
