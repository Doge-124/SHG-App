'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
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
import { Checkbox } from '@/components/ui/checkbox'
import { Plus, ArrowRight, DollarSign, Users, Trophy, CheckCircle, Clock, AlertTriangle, Lock, ShieldCheck, ShieldX } from 'lucide-react'
import {
  getCurrentCycleWithSummary,
  advanceToNextCycle,
  recordMemberPaymentWithDiscount,
  getCycleEligibility,
  overrideMemberEligibility,
  processCycleWinners,
  type AuctionWinnerInput,
} from '@/lib/api/chits'
import { getChitMembers } from '@/lib/api/chits'
import type { ChitMember, ChitCycle, MemberEligibility } from '@/lib/types'
import { formatCurrency, formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'

interface ChitManualCycleFormProps {
  chitGroupId: string
  chitGroupName: string
  monthlyContribution: number
  totalAmount: number
  winnersPerCycle: number
  commissionPerWinner: number
  durationMonths: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

interface PaymentSummaryItem {
  memberId: string
  memberName: string
  hasPaid: boolean
  amountPaid: number
  paymentMethod?: string
  paidAt?: string
  isEligibleForDiscount: boolean
  payableAmount: number
  hasWon: boolean
}

interface AuctionWinnerRow {
  memberId: string
  bidDiscount: number
  paymentMethod: 'cash' | 'bank'
}

export function ChitManualCycleForm({
  chitGroupId, chitGroupName, monthlyContribution, totalAmount,
  winnersPerCycle, commissionPerWinner, durationMonths,
  open, onOpenChange, onSuccess,
}: ChitManualCycleFormProps) {
  const [members, setMembers] = useState<ChitMember[]>([])
  const [currentCycle, setCurrentCycle] = useState<ChitCycle | null>(null)
  const [paymentSummary, setPaymentSummary] = useState<PaymentSummaryItem[]>([])
  const [eligibility, setEligibility] = useState<MemberEligibility[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [activeTab, setActiveTab] = useState<'current' | 'payment' | 'winner'>('current')

  // Auction discount for this cycle (from prev cycle, shown in payment tab)
  const [auctionDiscount, setAuctionDiscount] = useState<number>(0)
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'bank'>('cash')
  const [selectedMemberId, setSelectedMemberId] = useState<string>('')

  // Winner tab
  const [fixedWinnerId, setFixedWinnerId] = useState<string>('')
  const [fixedWinnerMethod, setFixedWinnerMethod] = useState<'cash' | 'bank'>('cash')
  const [auctionWinners, setAuctionWinners] = useState<AuctionWinnerRow[]>([])
  const [overrideDiscount, setOverrideDiscount] = useState<string>('')

  const perMemberAmount = (memberId: string) => {
    const summary = paymentSummary.find(p => p.memberId === memberId)
    return summary ? summary.payableAmount : monthlyContribution - auctionDiscount
  }

  useEffect(() => {
    if (open) loadData()
  }, [open, chitGroupId])

  // Auto-select next unpaid member
  useEffect(() => {
    if (activeTab === 'payment' && !selectedMemberId) {
      const next = unpaidMembers[0]
      if (next) setSelectedMemberId(next.memberId)
    }
  }, [paymentSummary])

  const loadData = async () => {
    setIsLoading(true)
    try {
      const [membersRes, cycleRes] = await Promise.all([
        getChitMembers(chitGroupId),
        getCurrentCycleWithSummary(chitGroupId),
      ])
      if (membersRes.success && membersRes.data) setMembers(membersRes.data)
      if (cycleRes.success && cycleRes.data) {
        setCurrentCycle(cycleRes.data.cycle)
        const summary = cycleRes.data.paymentSummary as PaymentSummaryItem[]
        setPaymentSummary(summary)

        // Load eligibility if cycle exists
        if (cycleRes.data.cycle) {
          const eligRes = await getCycleEligibility(chitGroupId, cycleRes.data.cycle.id)
          if (eligRes.success && eligRes.data) setEligibility(eligRes.data)
        }
      }
    } catch (error) {
      toast.error('Failed to load chit data')
    } finally {
      setIsLoading(false)
    }
  }

  const handleAdvanceCycle = async () => {
    setIsSubmitting(true)
    try {
      const result = await advanceToNextCycle(chitGroupId)
      if (result.success && result.data) {
        toast.success(result.data.message)
        setAuctionDiscount(0)
        setFixedWinnerId('')
        setAuctionWinners([])
        await loadData()
        setActiveTab('current')
        onSuccess?.()
      } else {
        toast.error(result.error || 'Failed to advance cycle')
      }
    } catch {
      toast.error('An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRecordPayment = async () => {
    if (!currentCycle || !selectedMemberId) { toast.error('Please select a member'); return }
    const amount = perMemberAmount(selectedMemberId)
    if (amount <= 0) { toast.error('Payment amount must be positive'); return }

    setIsSubmitting(true)
    try {
      const result = await recordMemberPaymentWithDiscount(
        chitGroupId, currentCycle.id, selectedMemberId, amount, auctionDiscount, paymentMethod
      )
      if (result.success) {
        toast.success(result.data?.message ?? 'Payment recorded')
        setSelectedMemberId('')
        await loadData()
      } else {
        toast.error(result.error || 'Failed to record payment')
      }
    } catch {
      toast.error('An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleProcessWinners = async () => {
    if (!currentCycle) return
    const numAuctionSlots = winnersPerCycle - 1
    if (winnersPerCycle > 1 && auctionWinners.filter(w => w.memberId).length < numAuctionSlots) {
      toast.error(`Please select all ${numAuctionSlots} auction winner(s)`)
      return
    }
    if (!fixedWinnerId && winnersPerCycle >= 1) {
      toast.error('Please select the fixed prize winner')
      return
    }

    const validAuctionWinners: AuctionWinnerInput[] = auctionWinners
      .filter(w => w.memberId)
      .map(w => ({ memberId: w.memberId, bidDiscount: w.bidDiscount, paymentMethod: w.paymentMethod }))

    setIsSubmitting(true)
    try {
      const result = await processCycleWinners(
        chitGroupId, currentCycle.id,
        fixedWinnerId || null,
        fixedWinnerId ? fixedWinnerMethod : null,
        validAuctionWinners,
        overrideDiscount ? parseFloat(overrideDiscount) : undefined,
      )
      if (result.success && result.data) {
        toast.success(result.data.message)
        setFixedWinnerId('')
        setAuctionWinners([])
        setOverrideDiscount('')
        await loadData()
        onSuccess?.()
      } else {
        toast.error(result.error || 'Failed to process winners')
      }
    } catch {
      toast.error('An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleEligibilityOverride = async (memberId: string, eligible: boolean) => {
    if (!currentCycle) return
    try {
      await overrideMemberEligibility(chitGroupId, currentCycle.id, memberId, eligible, 'Admin override')
      toast.success(`Eligibility updated`)
      await loadData()
    } catch { toast.error('Failed to update eligibility') }
  }

  const unpaidMembers = paymentSummary.filter(p => !p.hasPaid)
  const paidMembers = paymentSummary.filter(p => p.hasPaid)
  const allPaid = unpaidMembers.length === 0 && paymentSummary.length > 0
  const cycleCompleted = !!currentCycle?.winnerId
  // Members who have not yet won any cycle in this chit
  const eligibleMembersWithoutWin = members.filter(m =>
    !paymentSummary.find(p => p.memberId === m.memberId)?.hasWon
  )
  const isFinalCycle = durationMonths > 0 && currentCycle?.cycleNumber === durationMonths
  // Members who still haven't won and must win by end of chit
  const mustWinMembers = eligibleMembersWithoutWin.filter(
    m => !paymentSummary.find(p => p.memberId === m.memberId)?.hasWon
  )

  // Auction discount sum from current winner inputs
  const totalBidDiscounts = auctionWinners.reduce((s, w) => s + (w.bidDiscount || 0), 0)
  const calculatedDiscountPerMember = members.length > 0 ? Math.round(totalBidDiscounts / members.length * 100) / 100 : 0
  const effectiveDiscountPerMember = overrideDiscount ? parseFloat(overrideDiscount) || 0 : calculatedDiscountPerMember

  const fixedWinnerPayout = totalAmount - commissionPerWinner
  const auctionWinnerPayout = (bidDiscount: number) => Math.max(0, totalAmount - bidDiscount - commissionPerWinner)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRight className="h-5 w-5" />
            Cycle Management — {chitGroupName}
          </DialogTitle>
        </DialogHeader>

        {currentCycle ? (
          <Alert className={cycleCompleted ? 'border-green-500 bg-green-50' : 'border-blue-500'}>
            <AlertDescription className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                {cycleCompleted && <Lock className="h-4 w-4 text-green-600" />}
                <strong>Cycle {currentCycle.cycleNumber}</strong>
                {currentCycle.dueDate && <span className="text-muted-foreground">· {formatDate(currentCycle.dueDate)}</span>}
                {cycleCompleted && <span className="text-green-700 text-sm">— Completed & locked</span>}
              </span>
              <Badge variant={cycleCompleted ? 'secondary' : 'default'}
                className={cycleCompleted ? 'bg-green-100 text-green-700' : ''}>
                {cycleCompleted ? 'Completed 🔒' : 'Active'}
              </Badge>
            </AlertDescription>
          </Alert>
        ) : (
          <Alert className="border-yellow-500">
            <AlertDescription>No active cycle. Click "Start New Cycle" to begin.</AlertDescription>
          </Alert>
        )}

        <div className="flex gap-2 mb-4">
          {(['current', 'payment', 'winner'] as const).map(tab => (
            <Button
              key={tab}
              variant={activeTab === tab ? 'default' : 'outline'}
              onClick={() => setActiveTab(tab)}
              className="flex-1"
              disabled={tab !== 'current' && (!currentCycle || cycleCompleted)}
            >
              {tab === 'current' ? <><Clock className="h-4 w-4 mr-2" />Current</>
               : tab === 'payment' ? <><DollarSign className="h-4 w-4 mr-2" />Payments</>
               : <><Trophy className="h-4 w-4 mr-2" />Winners</>}
            </Button>
          ))}
        </div>

        <ScrollArea className="h-[55vh]">
          {/* ── Current Cycle Tab ── */}
          {activeTab === 'current' && (
            <div className="space-y-4">
              {currentCycle && (
                <Card>
                  <CardHeader><CardTitle className="text-base">Payment Summary</CardTitle></CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {paymentSummary.map(p => (
                        <div key={p.memberId} className={cn(
                          'flex items-center justify-between p-3 rounded-lg border',
                          p.hasPaid ? 'bg-green-50 border-green-200' : 'bg-muted/50'
                        )}>
                          <div className="flex items-center gap-2">
                            {p.hasPaid ? <CheckCircle className="h-4 w-4 text-green-500" /> : <Clock className="h-4 w-4 text-muted-foreground" />}
                            <span>{p.memberName}</span>
                            {p.hasWon && <Badge variant="outline" className="text-xs">Won</Badge>}
                            {p.isEligibleForDiscount
                              ? <ShieldCheck className="h-3 w-3 text-green-500" />
                              : <ShieldX className="h-3 w-3 text-red-400" />}
                          </div>
                          <div className="flex items-center gap-3">
                            {p.hasPaid
                              ? <><Badge variant="outline">{p.paymentMethod}</Badge><span className="font-medium">{formatCurrency(p.amountPaid)}</span></>
                              : <><span className="text-xs text-muted-foreground">{formatCurrency(p.payableAmount)}</span><Badge variant="secondary">Pending</Badge></>}
                          </div>
                        </div>
                      ))}
                    </div>
                    <Separator className="my-4" />
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Paid: {paidMembers.length} / {paymentSummary.length}</span>
                      <span className="font-medium">Collected: {formatCurrency(paidMembers.reduce((s, p) => s + p.amountPaid, 0))}</span>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Eligibility overrides */}
              {currentCycle && eligibility.length > 0 && (
                <Card>
                  <CardHeader><CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="h-4 w-4" />Discount Eligibility (Admin)</CardTitle></CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {eligibility.map(e => (
                        <div key={e.memberId} className="flex items-center justify-between p-2 rounded border text-sm">
                          <span>{e.memberName}</span>
                          <div className="flex items-center gap-2">
                            {e.adminOverride && <Badge variant="outline" className="text-xs text-orange-600">Override</Badge>}
                            <Checkbox
                              checked={e.isEligible}
                              onCheckedChange={checked => handleEligibilityOverride(e.memberId, !!checked)}
                            />
                            <span className={e.isEligible ? 'text-green-600' : 'text-muted-foreground'}>
                              {e.isEligible ? 'Eligible' : 'Ineligible'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader><CardTitle className="text-base">Cycle Control</CardTitle></CardHeader>
                <CardContent>
                  <Button
                    onClick={handleAdvanceCycle}
                    disabled={isSubmitting || !!(currentCycle && !currentCycle.winnerId)}
                    className="w-full"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    {currentCycle ? 'Start Next Cycle' : 'Start First Cycle'}
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ── Payment Tab ── */}
          {activeTab === 'payment' && currentCycle && (
            <div className="space-y-4">
              <Card>
                <CardHeader><CardTitle className="text-base">Auction Discount for This Cycle</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label>Auction Discount (per member)</Label>
                      <Input type="number" min={0} step="0.01" value={auctionDiscount}
                        onChange={e => setAuctionDiscount(parseFloat(e.target.value) || 0)} />
                      <p className="text-xs text-muted-foreground">From previous cycle's bid discounts distributed to eligible members</p>
                    </div>
                    <div className="space-y-1">
                      <Label>Eligible member pays</Label>
                      <div className="flex items-center h-9 px-3 rounded-md border bg-muted text-sm font-medium">
                        {formatCurrency(monthlyContribution - auctionDiscount)}
                      </div>
                      <p className="text-xs text-muted-foreground">{formatCurrency(monthlyContribution)} − {formatCurrency(auctionDiscount)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Record Member Payment</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label>Select Member</Label>
                      <Select value={selectedMemberId} onValueChange={setSelectedMemberId}>
                        <SelectTrigger><SelectValue placeholder="Select member" /></SelectTrigger>
                        <SelectContent>
                          {unpaidMembers.map(m => (
                            <SelectItem key={m.memberId} value={m.memberId}>
                              {m.memberName}
                              {m.isEligibleForDiscount
                                ? ` (${formatCurrency(m.payableAmount)})`
                                : ` (${formatCurrency(monthlyContribution)} — no discount)`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Payment Method</Label>
                      <Select value={paymentMethod} onValueChange={(v: 'cash' | 'bank') => setPaymentMethod(v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cash">Cash</SelectItem>
                          <SelectItem value="bank">Bank</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {selectedMemberId && (
                    <Alert>
                      <AlertDescription className="text-sm">
                        Amount to collect: <strong>{formatCurrency(perMemberAmount(selectedMemberId))}</strong>
                        {auctionDiscount > 0 && paymentSummary.find(p => p.memberId === selectedMemberId)?.isEligibleForDiscount
                          ? <span className="text-muted-foreground ml-2">(discount applied)</span>
                          : auctionDiscount > 0 ? <span className="text-orange-600 ml-2">(ineligible — full rate)</span>
                          : null}
                      </AlertDescription>
                    </Alert>
                  )}
                  <Button onClick={handleRecordPayment} disabled={isSubmitting || !selectedMemberId} className="w-full">
                    Record Payment & Generate Receipt
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ── Winner Tab ── */}
          {activeTab === 'winner' && currentCycle && (
            <div className="space-y-4">
              {isFinalCycle && mustWinMembers.length > 0 && (
                <Alert className="border-orange-500 bg-orange-50">
                  <AlertDescription className="text-orange-800">
                    <p className="font-semibold flex items-center gap-1">
                      <AlertTriangle className="h-4 w-4" />
                      Final cycle — the following members have not yet won and must win this cycle:
                    </p>
                    <p className="mt-1">{mustWinMembers.map(m => m.memberName).join(', ')}</p>
                  </AlertDescription>
                </Alert>
              )}
              <Alert className="border-yellow-500">
                <AlertDescription className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Select {winnersPerCycle} winner(s): 1 fixed prize + {winnersPerCycle - 1} auction winner(s).
                  This completes the cycle and creates vouchers + commission receipts.
                </AlertDescription>
              </Alert>

              {/* Fixed winner */}
              <Card>
                <CardHeader><CardTitle className="text-base">Fixed Prize Winner</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label>Member</Label>
                      <Select value={fixedWinnerId} onValueChange={setFixedWinnerId}>
                        <SelectTrigger><SelectValue placeholder="Select winner" /></SelectTrigger>
                        <SelectContent>
                          {eligibleMembersWithoutWin
                            .filter(m => !auctionWinners.find(w => w.memberId === m.memberId))
                            .map(m => <SelectItem key={m.memberId} value={m.memberId}>{m.memberName}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Payment Method</Label>
                      <Select value={fixedWinnerMethod} onValueChange={(v: 'cash' | 'bank') => setFixedWinnerMethod(v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cash">Cash</SelectItem>
                          <SelectItem value="bank">Bank</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Payout: {formatCurrency(totalAmount)} − {formatCurrency(commissionPerWinner)} commission = <strong>{formatCurrency(fixedWinnerPayout)}</strong>
                  </div>
                </CardContent>
              </Card>

              {/* Auction winners */}
              {winnersPerCycle > 1 && (
                <Card>
                  <CardHeader><CardTitle className="text-base">Auction Winners ({winnersPerCycle - 1})</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    {Array.from({ length: winnersPerCycle - 1 }, (_, i) => {
                      const row = auctionWinners[i] ?? { memberId: '', bidDiscount: 0, paymentMethod: 'cash' as const }
                      const update = (field: keyof AuctionWinnerRow, value: any) => {
                        setAuctionWinners(prev => {
                          const next = [...prev]
                          while (next.length <= i) next.push({ memberId: '', bidDiscount: 0, paymentMethod: 'cash' })
                          next[i] = { ...next[i], [field]: value }
                          return next
                        })
                      }
                      return (
                        <div key={i} className="grid grid-cols-3 gap-3 p-3 rounded border bg-muted/30">
                          <div className="space-y-1">
                            <Label className="text-xs">Auction Winner {i + 1}</Label>
                            <Select value={row.memberId} onValueChange={v => update('memberId', v)}>
                              <SelectTrigger className="h-8"><SelectValue placeholder="Select" /></SelectTrigger>
                              <SelectContent>
                                {eligibleMembersWithoutWin
                                  .filter(m => m.memberId !== fixedWinnerId &&
                                    !auctionWinners.find((w, j) => j !== i && w.memberId === m.memberId))
                                  .map(m => <SelectItem key={m.memberId} value={m.memberId}>{m.memberName}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Bid Discount (Rs.)</Label>
                            <Input type="number" min={0} className="h-8"
                              value={row.bidDiscount || ''}
                              onChange={e => update('bidDiscount', parseFloat(e.target.value) || 0)} />
                            {row.bidDiscount > 0 && (
                              <p className="text-xs text-muted-foreground">Gets: {formatCurrency(auctionWinnerPayout(row.bidDiscount))}</p>
                            )}
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Method</Label>
                            <Select value={row.paymentMethod} onValueChange={v => update('paymentMethod', v)}>
                              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="cash">Cash</SelectItem>
                                <SelectItem value="bank">Bank</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      )
                    })}
                  </CardContent>
                </Card>
              )}

              {/* Auction discount summary */}
              {totalBidDiscounts > 0 && (
                <Card>
                  <CardHeader><CardTitle className="text-base">Auction Discount for Next Cycle</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <div className="text-sm space-y-1">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Total bid discounts:</span>
                        <span>{formatCurrency(totalBidDiscounts)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">÷ {members.length} members:</span>
                        <span className="font-medium">{formatCurrency(calculatedDiscountPerMember)}/member</span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Admin Override (per member discount)</Label>
                      <Input type="number" min={0} step="0.01" placeholder={calculatedDiscountPerMember.toFixed(2)}
                        value={overrideDiscount} onChange={e => setOverrideDiscount(e.target.value)} />
                      <p className="text-xs text-muted-foreground">Leave blank to use calculated value ({formatCurrency(calculatedDiscountPerMember)})</p>
                    </div>
                    <div className="bg-muted rounded p-2 text-sm font-medium">
                      Next cycle eligible members pay: {formatCurrency(monthlyContribution - effectiveDiscountPerMember)}
                    </div>
                  </CardContent>
                </Card>
              )}

              <Button
                onClick={handleProcessWinners}
                disabled={isSubmitting || !fixedWinnerId}
                className="w-full"
              >
                <Trophy className="h-4 w-4 mr-2" />
                Process All Winners & Complete Cycle
              </Button>
            </div>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
