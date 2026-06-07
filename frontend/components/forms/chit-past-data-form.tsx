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
import { Calendar, Users, DollarSign, AlertTriangle, CheckCircle, Clock, Trophy, Gavel } from 'lucide-react'
import { Lock } from 'lucide-react'
import { recordPastChitCycle, getMemberPaymentStatus, getChitCyclesWithDetails, getChitMigrationStatus, getChitMembers } from '@/lib/api/chits'
import { useSettings } from '@/lib/settings-context'
import type { ChitMember, MemberPaymentStatus, ChitCycleDetail, ChitMigrationStatus } from '@/lib/types'
import { formatCurrency, formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'

interface ChitPastDataFormProps {
  chitGroupId: string
  chitGroupName: string
  monthlyContribution: number
  totalMembers: number
  totalAmount: number
  winnersPerCycle: number
  commissionPerWinner: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

interface AuctionWinnerRow {
  memberId: string
  bidDiscount: number
  paymentMethod: 'cash' | 'bank'
}

interface MemberPaymentEntry {
  memberId: string
  memberName: string
  amount: number
  paymentMethod: 'cash' | 'bank'
  hasPaid: boolean
}

const EMPTY_AUCTION_ROW: AuctionWinnerRow = { memberId: '', bidDiscount: 0, paymentMethod: 'cash' }

export function ChitPastDataForm({
  chitGroupId,
  chitGroupName,
  monthlyContribution,
  totalMembers,
  totalAmount,
  winnersPerCycle,
  commissionPerWinner,
  open,
  onOpenChange,
  onSuccess,
}: ChitPastDataFormProps) {
  const { pastDataLocked } = useSettings()

  // ── State ──────────────────────────────────────────────────────────────
  const [members, setMembers] = useState<ChitMember[]>([])
  const [paymentStatuses, setPaymentStatuses] = useState<MemberPaymentStatus[]>([])
  const [cyclesWithDetails, setCyclesWithDetails] = useState<ChitCycleDetail[]>([])
  const [migrationStatus, setMigrationStatus] = useState<ChitMigrationStatus | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [activeTab, setActiveTab] = useState<'enter' | 'status'>('enter')

  const [cycleNumber, setCycleNumber] = useState<number>(1)
  const [auctionDate, setAuctionDate] = useState<string>(new Date().toISOString().split('T')[0])

  const [fixedWinnerId, setFixedWinnerId] = useState<string>('')
  const [fixedWinnerPaymentMethod, setFixedWinnerPaymentMethod] = useState<'cash' | 'bank'>('cash')

  const auctionCount = Math.max(0, winnersPerCycle - 1)
  const [auctionWinners, setAuctionWinners] = useState<AuctionWinnerRow[]>(() =>
    Array.from({ length: auctionCount }, () => ({ ...EMPTY_AUCTION_ROW }))
  )

  const [memberPayments, setMemberPayments] = useState<MemberPaymentEntry[]>([])

  // ── Derived (declared before useEffects that use them) ──────────────────
  const totalBidDiscounts = auctionWinners.reduce((s, w) => s + w.bidDiscount, 0)
  const auctionDiscountPerMember = members.length > 0 ? totalBidDiscounts / members.length : 0
  // Chit discounts carry forward: a cycle's bid reduces the NEXT cycle's
  // contributions. So THIS cycle's member payments are reduced by the PREVIOUS
  // cycle's discount, not this cycle's own. The first cycle has no prior discount.
  const prevCycleDetail = cyclesWithDetails.find(c => c.cycleNumber === cycleNumber - 1)
  const prevDiscountPerMember = prevCycleDetail && members.length > 0
    ? prevCycleDetail.bidDiscount / members.length
    : 0
  // Bid-discount eligibility: a member only gets the carried-forward discount if
  // they have no outstanding dues from earlier cycles. Members with dues pay the
  // full contribution for this cycle.
  const memberHasDues = (memberId: string) => {
    const st = paymentStatuses.find(s => s.memberId === memberId)
    return !!st && st.lateCycles.some(c => c < cycleNumber)
  }
  const payableFor = (memberId: string) =>
    memberHasDues(memberId)
      ? monthlyContribution
      : Math.max(0, monthlyContribution - prevDiscountPerMember)
  // Passbook suffix for member labels, e.g. " (Passbook: 123)". Empty if none.
  const passbookSuffix = (memberId: string) => {
    const pb = members.find(m => m.memberId === memberId)?.passbookNumber
    return pb ? ` (Passbook: ${pb})` : ''
  }
  const fixedWinnerPayout = Math.max(0, totalAmount - commissionPerWinner)
  const auctionWinnerPayout = (bidDiscount: number) => Math.max(0, totalAmount - bidDiscount - commissionPerWinner)

  // Members already claimed as winners (to avoid duplicates in dropdowns)
  const selectedWinnerIds = new Set([
    fixedWinnerId,
    ...auctionWinners.map(w => w.memberId),
  ].filter(Boolean))
  // Members who have not yet won any previous cycle
  const nonWinnerMembers = members.filter(m => !m.isWinner)
  const isFinalCycle = migrationStatus !== null && cycleNumber === migrationStatus.totalMonths
  const mustWinMembers = nonWinnerMembers.filter(m => !selectedWinnerIds.has(m.memberId))

  // ── Effects ──────────────────────────────────────────────────────────────
  useEffect(() => {
    setAuctionWinners(Array.from({ length: auctionCount }, () => ({ ...EMPTY_AUCTION_ROW })))
  }, [auctionCount])

  useEffect(() => {
    if (open) loadData()
  }, [open, chitGroupId])

  // Recompute member payment defaults whenever members or discount changes
  useEffect(() => {
    if (members.length === 0) return
    setMemberPayments(members.map(m => ({
      memberId: m.memberId,
      memberName: m.memberName,
      amount: payableFor(m.memberId),
      paymentMethod: 'cash' as const,
      hasPaid: true,
    })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, monthlyContribution, prevDiscountPerMember, paymentStatuses, cycleNumber])

  useEffect(() => {
    if (migrationStatus) setCycleNumber(migrationStatus.cyclesEntered + 1)
  }, [migrationStatus])

  // ── Data loading ──────────────────────────────────────────────────────────
  const loadData = async () => {
    setIsLoading(true)
    try {
      const [membersRes, statusRes, cyclesRes, migrationRes] = await Promise.all([
        getChitMembers(chitGroupId),
        getMemberPaymentStatus(chitGroupId),
        getChitCyclesWithDetails(chitGroupId),
        getChitMigrationStatus(chitGroupId),
      ])
      if (membersRes.success && membersRes.data) setMembers(membersRes.data)
      if (statusRes.success && statusRes.data) setPaymentStatuses(statusRes.data)
      if (cyclesRes.success && cyclesRes.data) setCyclesWithDetails(cyclesRes.data)
      if (migrationRes.success && migrationRes.data) setMigrationStatus(migrationRes.data)
    } catch {
      toast.error('Failed to load chit data')
    } finally {
      setIsLoading(false)
    }
  }

  // ── Auction winner row helpers ────────────────────────────────────────────
  const updateAuctionWinner = (idx: number, field: keyof AuctionWinnerRow, value: string | number) => {
    setAuctionWinners(prev => prev.map((row, i) => i === idx ? { ...row, [field]: value } : row))
  }

  // ── Member payment helpers ────────────────────────────────────────────────
  const updatePayment = (memberId: string, field: keyof MemberPaymentEntry, value: any) => {
    setMemberPayments(prev => prev.map(p => p.memberId === memberId ? { ...p, [field]: value } : p))
  }

  const markAllPaid = () => {
    setMemberPayments(prev => prev.map(p => ({ ...p, amount: payableFor(p.memberId), hasPaid: true })))
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (cycleNumber <= 0) { toast.error('Enter a valid cycle number'); return }
    if (!auctionDate) { toast.error('Select an auction date'); return }

    const payments = memberPayments
      .filter(p => p.hasPaid)
      .map(p => ({ memberId: p.memberId, memberName: p.memberName, amount: p.amount, paymentMethod: p.paymentMethod }))

    if (payments.length === 0) { toast.error('At least one member must have paid'); return }

    const winners = []

    if (fixedWinnerId) {
      winners.push({
        memberId: fixedWinnerId,
        winnerType: 'FIXED' as const,
        bidDiscount: 0,
        commission: commissionPerWinner,
        payoutAmount: fixedWinnerPayout,
        paymentMethod: fixedWinnerPaymentMethod,
      })
    }

    for (const w of auctionWinners) {
      if (w.memberId) {
        winners.push({
          memberId: w.memberId,
          winnerType: 'AUCTION' as const,
          bidDiscount: w.bidDiscount,
          commission: commissionPerWinner,
          payoutAmount: auctionWinnerPayout(w.bidDiscount),
          paymentMethod: w.paymentMethod,
        })
      }
    }

    setIsSubmitting(true)
    try {
      const result = await recordPastChitCycle(chitGroupId, {
        cycleNumber,
        auctionDate,
        winners,
        auctionDiscountPerMember,
        memberPayments: payments,
      })

      if (result.success) {
        toast.success(`Cycle ${cycleNumber} recorded`)
        if (result.data) {
          toast.info(
            `Collected: ${formatCurrency(result.data.totalCollected)}, ` +
            `${result.data.winnerCount} winner(s), ` +
            `Discount: ${formatCurrency(result.data.auctionDiscountPerMember)}/member`
          )
        }
        setFixedWinnerId('')
        setFixedWinnerPaymentMethod('cash')
        setAuctionWinners(Array.from({ length: auctionCount }, () => ({ ...EMPTY_AUCTION_ROW })))
        await loadData()
        onSuccess?.()
      } else {
        toast.error(result.error || 'Failed to record cycle')
      }
    } catch {
      toast.error('An error occurred while recording the cycle')
    } finally {
      setIsSubmitting(false)
    }
  }

  const getLatePayerBadge = (status: MemberPaymentStatus) => {
    if (status.isUpToDate) return <Badge variant="outline" className="gap-1 border-green-500 text-green-700"><CheckCircle className="h-3 w-3" />Up to date</Badge>
    if (status.lateCycles.length > 0) return <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />{status.lateCycles.length} late</Badge>
    return <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" />New</Badge>
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Chit Past Data Entry — {chitGroupName}
          </DialogTitle>
        </DialogHeader>

        {pastDataLocked && (
          <Alert className="border-amber-400 bg-amber-50">
            <AlertDescription className="flex items-center gap-2 text-amber-700">
              <Lock className="h-4 w-4 flex-shrink-0" />
              Past data entry is locked. Go to Settings → Data to unlock.
            </AlertDescription>
          </Alert>
        )}

        {migrationStatus && (
          <Alert className={cn(migrationStatus.isComplete ? 'border-green-500' : 'border-blue-500')}>
            <AlertDescription className="flex items-center justify-between">
              <span>
                <strong>{migrationStatus.cyclesEntered}</strong> of <strong>{migrationStatus.totalMonths}</strong> cycles entered
                {migrationStatus.isComplete && <span className="text-green-600 ml-2">(Complete)</span>}
              </span>
              <span className="text-muted-foreground">Collected: {formatCurrency(migrationStatus.totalCollected)}</span>
            </AlertDescription>
          </Alert>
        )}

        <div className="flex gap-2">
          <Button variant={activeTab === 'enter' ? 'default' : 'outline'} onClick={() => setActiveTab('enter')} className="flex-1">
            <DollarSign className="h-4 w-4 mr-2" />Enter Cycle Data
          </Button>
          <Button variant={activeTab === 'status' ? 'default' : 'outline'} onClick={() => setActiveTab('status')} className="flex-1">
            <Users className="h-4 w-4 mr-2" />Member Status
          </Button>
        </div>

        {activeTab === 'enter' ? (
          <ScrollArea className="h-[55vh]">
            <div className="space-y-5 pr-1">

              {/* ── Cycle meta ─────────────────────────────────────────── */}
              <Card>
                <CardHeader><CardTitle className="text-base">Cycle Information</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Cycle Number</Label>
                      <Input type="number" min={1} value={cycleNumber}
                        onChange={e => setCycleNumber(parseInt(e.target.value) || 1)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Auction Date</Label>
                      <Input type="date" value={auctionDate}
                        onChange={e => setAuctionDate(e.target.value)} />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Final cycle warning */}
              {isFinalCycle && mustWinMembers.length > 0 && (
                <Alert className="border-orange-500 bg-orange-50">
                  <AlertDescription className="text-orange-800">
                    <p className="font-semibold">Final cycle — these members have not yet won and must win this cycle:</p>
                    <p className="mt-1">{mustWinMembers.map(m => m.memberName).join(', ')}</p>
                  </AlertDescription>
                </Alert>
              )}

              {/* ── Winners ────────────────────────────────────────────── */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Trophy className="h-4 w-4" />
                    Winners ({winnersPerCycle} per cycle)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">

                  {/* Fixed winner */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium flex items-center gap-1">
                      <Trophy className="h-3.5 w-3.5 text-yellow-500" />
                      Fixed Prize Winner
                    </p>
                    <div className="grid grid-cols-3 gap-3 p-3 rounded-lg border bg-muted/30">
                      <div className="col-span-2 space-y-1">
                        <Label className="text-xs text-muted-foreground">Member</Label>
                        <Select value={fixedWinnerId || 'none'}
                          onValueChange={v => setFixedWinnerId(v === 'none' ? '' : v)}>
                          <SelectTrigger><SelectValue placeholder="Select member (optional)" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No winner yet</SelectItem>
                            {nonWinnerMembers
                              .filter(m => !selectedWinnerIds.has(m.memberId) || m.memberId === fixedWinnerId)
                              .map(m => (
                                <SelectItem key={m.memberId} value={m.memberId}>{m.memberName}{passbookSuffix(m.memberId)}</SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Payout via</Label>
                        <Select value={fixedWinnerPaymentMethod}
                          onValueChange={(v: 'cash' | 'bank') => setFixedWinnerPaymentMethod(v)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="cash">Cash</SelectItem>
                            <SelectItem value="bank">Bank</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {fixedWinnerId && (
                        <div className="col-span-3 text-sm flex justify-between border-t pt-2">
                          <span className="text-muted-foreground">Prize − commission ({formatCurrency(commissionPerWinner)})</span>
                          <span className="font-medium text-green-700">{formatCurrency(fixedWinnerPayout)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Auction winners */}
                  {auctionCount > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium flex items-center gap-1">
                        <Gavel className="h-3.5 w-3.5 text-blue-500" />
                        Auction Winner{auctionCount > 1 ? 's' : ''}
                      </p>
                      {auctionWinners.map((row, idx) => (
                        <div key={idx} className="grid grid-cols-4 gap-3 p-3 rounded-lg border bg-blue-50/30">
                          <div className="col-span-2 space-y-1">
                            <Label className="text-xs text-muted-foreground">Member</Label>
                            <Select value={row.memberId || 'none'}
                              onValueChange={v => updateAuctionWinner(idx, 'memberId', v === 'none' ? '' : v)}>
                              <SelectTrigger><SelectValue placeholder="Select member" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">No winner yet</SelectItem>
                                {nonWinnerMembers
                                  .filter(m => !selectedWinnerIds.has(m.memberId) || m.memberId === row.memberId)
                                  .map(m => (
                                    <SelectItem key={m.memberId} value={m.memberId}>{m.memberName}{passbookSuffix(m.memberId)}</SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Bid Discount</Label>
                            <Input type="number" min={0} step="0.01"
                              value={row.bidDiscount}
                              onChange={e => updateAuctionWinner(idx, 'bidDiscount', parseFloat(e.target.value) || 0)} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Payout via</Label>
                            <Select value={row.paymentMethod}
                              onValueChange={(v: 'cash' | 'bank') => updateAuctionWinner(idx, 'paymentMethod', v)}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="cash">Cash</SelectItem>
                                <SelectItem value="bank">Bank</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          {row.memberId && (
                            <div className="col-span-4 text-sm flex justify-between border-t pt-2">
                              <span className="text-muted-foreground">
                                Prize − bid ({formatCurrency(row.bidDiscount)}) − commission ({formatCurrency(commissionPerWinner)})
                              </span>
                              <span className="font-medium text-green-700">{formatCurrency(auctionWinnerPayout(row.bidDiscount))}</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Auction discount summary */}
                  {auctionCount > 0 && totalBidDiscounts > 0 && (
                    <div className="rounded-lg bg-muted p-3 space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Total bid discounts:</span>
                        <span>{formatCurrency(totalBidDiscounts)}</span>
                      </div>
                      <div className="flex justify-between font-medium">
                        <span className="text-muted-foreground">
                          Auction discount per member (÷ {members.length || totalMembers}):
                        </span>
                        <span className="text-blue-700">{formatCurrency(auctionDiscountPerMember)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        This discount reduces each member's instalment in the <strong>next</strong> cycle (not this one).
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* ── Member Payments ────────────────────────────────────── */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      Member Payments
                    </span>
                    <Button variant="outline" size="sm" onClick={markAllPaid}>Mark All Paid</Button>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {memberPayments.map(payment => (
                      <div key={payment.memberId}
                        className={cn(
                          'flex items-center gap-4 p-3 rounded-lg border',
                          payment.hasPaid ? 'bg-background' : 'bg-muted/50 opacity-60'
                        )}>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{payment.memberName}{passbookSuffix(payment.memberId)}</p>
                          <p className="text-xs text-muted-foreground">
                            {!payment.hasPaid ? 'Not paid'
                              : memberHasDues(payment.memberId) ? 'Full instalment — has dues, no discount'
                              : prevDiscountPerMember > 0
                                ? `${formatCurrency(monthlyContribution)} − ${formatCurrency(prevDiscountPerMember)} prev-cycle discount`
                                : 'Standard instalment'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Input
                            type="number"
                            value={payment.amount}
                            onChange={e => updatePayment(payment.memberId, 'amount', parseFloat(e.target.value) || 0)}
                            disabled={!payment.hasPaid}
                            className="w-24"
                          />
                          <Select
                            value={payment.paymentMethod}
                            onValueChange={v => updatePayment(payment.memberId, 'paymentMethod', v)}
                            disabled={!payment.hasPaid}
                          >
                            <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="cash">Cash</SelectItem>
                              <SelectItem value="bank">Bank</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            variant={payment.hasPaid ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => updatePayment(payment.memberId, 'hasPaid', !payment.hasPaid)}
                          >
                            {payment.hasPaid ? 'Paid' : 'Not Paid'}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {memberPayments.length > 0 && (
                    <div className="flex justify-between text-sm mt-3 pt-3 border-t font-medium">
                      <span>Total collected</span>
                      <span>{formatCurrency(memberPayments.filter(p => p.hasPaid).reduce((s, p) => s + p.amount, 0))}</span>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* ── Previous Cycles ────────────────────────────────────── */}
              {cyclesWithDetails.length > 0 && (
                <Card>
                  <CardHeader><CardTitle className="text-base">Previously Entered Cycles</CardTitle></CardHeader>
                  <CardContent>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {cyclesWithDetails.map(cycle => (
                        <div key={cycle.id}
                          className="flex items-center justify-between p-2 rounded border text-sm">
                          <span>Cycle {cycle.cycleNumber}</span>
                          <span className="text-muted-foreground">{formatDate(cycle.auctionDate)}</span>
                          <span>{formatCurrency(cycle.totalCollected)}</span>
                          {cycle.bidDiscount > 0 && (
                            <Badge variant="secondary">Discount: {formatCurrency(cycle.bidDiscount)}</Badge>
                          )}
                          {cycle.winningMemberName && (
                            <Badge variant="outline">Winner: {cycle.winningMemberName}</Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </ScrollArea>
        ) : (
          <ScrollArea className="h-[55vh]">
            <div className="space-y-4 pr-1">
              {paymentStatuses.map(status => (
                <Card key={status.memberId}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium">{status.memberName}</h4>
                      {getLatePayerBadge(status)}
                    </div>
                    <div className="text-sm text-muted-foreground space-y-1">
                      <p>Paid {status.cyclesPaid} of {status.currentCycle} cycles</p>
                      {status.lateCycles.length > 0 && (
                        <p className="text-destructive">Late cycles: {status.lateCycles.join(', ')}</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {activeTab === 'enter' && (
            <Button onClick={handleSubmit} disabled={isSubmitting || isLoading || pastDataLocked}>
              {isSubmitting ? 'Recording...' : pastDataLocked ? 'Locked' : 'Record Cycle'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
