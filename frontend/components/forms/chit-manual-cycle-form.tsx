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
  updateChitCycleDate,
  setCycleCollectionDiscount,
  recordMemberPaymentWithDiscount,
  getCycleEligibility,
  overrideMemberEligibility,
  processCycleWinners,
  getChitCycleWinners,
  getChitPendingDues,
  recordChitLatePayment,
  recordChitLatePaymentsBatch,
  getChitClosingInfo,
  payClosingMembers,
  closeChit,
  type AuctionWinnerInput,
  type ChitPendingDue,
  type ChitClosingInfo,
} from '@/lib/api/chits'
import { getChitMembers } from '@/lib/api/chits'
import {
  PaymentMethodFields, isPaymentSplitValid, paymentInvokeArgs, emptyPaymentSplit,
  type PaymentSplit,
} from '@/components/forms/payment-method-fields'
import type { ChitMember, ChitCycle, MemberEligibility, ChitCycleWinner } from '@/lib/types'
import { formatCurrency, formatDate, roundToFive } from '@/lib/format'
import { MemberTypeTag } from '@/components/member-type-tag'
import { cn } from '@/lib/utils'

interface ChitManualCycleFormProps {
  chitGroupId: string
  chitGroupName: string
  monthlyContribution: number
  totalAmount: number
  winnersPerCycle: number
  commissionPerWinner: number
  durationMonths: number
  startDate?: string
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
  split: PaymentSplit
}

/** Local-date "YYYY-MM-DD" (avoids the UTC shift of Date.toISOString). */
function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/** Add `days` to an ISO date string, returning a local "YYYY-MM-DD". */
function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  return isoLocal(dt)
}

export function ChitManualCycleForm({
  chitGroupId, chitGroupName, monthlyContribution, totalAmount,
  winnersPerCycle, commissionPerWinner, durationMonths, startDate,
  open, onOpenChange, onSuccess,
}: ChitManualCycleFormProps) {
  const [members, setMembers] = useState<ChitMember[]>([])
  const [currentCycle, setCurrentCycle] = useState<ChitCycle | null>(null)
  const [paymentSummary, setPaymentSummary] = useState<PaymentSummaryItem[]>([])
  const [eligibility, setEligibility] = useState<MemberEligibility[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [activeTab, setActiveTab] = useState<'current' | 'payment' | 'winner'>('current')

  // Date for the next cycle being started (operator-selectable). Defaults to 30
  // days after the current cycle, or the chit's start date for the first cycle.
  const [newCycleDate, setNewCycleDate] = useState<string>('')

  // Editable date of the active cycle (changeable after it has been started).
  const [cycleDateEdit, setCycleDateEdit] = useState<string>('')
  const [savingCycleDate, setSavingCycleDate] = useState(false)

  // Auction discount for this cycle (from prev cycle, or a manual override).
  const [auctionDiscount, setAuctionDiscount] = useState<number>(0)
  // Editable value of the per-member auction discount for the active cycle.
  const [discountEdit, setDiscountEdit] = useState<string>('')
  const [savingDiscount, setSavingDiscount] = useState(false)
  const [paySplit, setPaySplit] = useState<PaymentSplit>(emptyPaymentSplit)
  const [selectedMemberId, setSelectedMemberId] = useState<string>('')

  // Winner tab
  const [fixedWinnerId, setFixedWinnerId] = useState<string>('')
  const [fixedWinnerSplit, setFixedWinnerSplit] = useState<PaymentSplit>(emptyPaymentSplit)
  const [auctionWinners, setAuctionWinners] = useState<AuctionWinnerRow[]>([])
  const [overrideDiscount, setOverrideDiscount] = useState<string>('')
  // Winners already paid for the active cycle. Winners collect on different days,
  // so a cycle can sit part-recorded until the last of them turns up.
  const [recordedWinners, setRecordedWinners] = useState<ChitCycleWinner[]>([])
  // Which slot is mid-submit, so only that button shows a spinner.
  const [recordingSlot, setRecordingSlot] = useState<string | null>(null)

  // Pending dues from earlier (completed) cycles
  const [pendingDues, setPendingDues] = useState<ChitPendingDue[]>([])
  const [collectDue, setCollectDue] = useState<ChitPendingDue | null>(null)
  const [collectSplit, setCollectSplit] = useState<PaymentSplit>(emptyPaymentSplit)
  // false → collect the amount after this cycle's bid discount; true → collect the
  // full monthly contribution (SHG's discretion for late payers).
  const [collectFull, setCollectFull] = useState(false)

  // Batch collection: pay several overdue cycles for one member in a single receipt.
  const [batchTarget, setBatchTarget] = useState<{ memberId: string; memberName: string; dues: ChitPendingDue[] } | null>(null)
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set())  // cycleIds
  const [batchFull, setBatchFull] = useState(false)
  const [batchSplit, setBatchSplit] = useState<PaymentSplit>(emptyPaymentSplit)
  const [batchSubmitting, setBatchSubmitting] = useState(false)

  // Closing cycle / final settlement
  const [closingInfo, setClosingInfo] = useState<ChitClosingInfo | null>(null)
  const [closingSplits, setClosingSplits] = useState<Record<string, PaymentSplit>>({})

  const perMemberAmount = (memberId: string) => {
    const summary = paymentSummary.find(p => p.memberId === memberId)
    return summary ? summary.payableAmount : roundToFive(monthlyContribution - auctionDiscount)
  }

  // Passbook suffix for member dropdowns, e.g. " (Passbook: 123)". Empty if none.
  const passbookSuffix = (memberId: string) => {
    const pb = members.find(m => m.memberId === memberId)?.passbookNumber
    return pb ? ` (Passbook: ${pb})` : ''
  }
  const memberTypeOf = (memberId: string) => members.find(m => m.memberId === memberId)?.memberType

  const closingSplit = (memberId: string): PaymentSplit => closingSplits[memberId] ?? emptyPaymentSplit
  const setClosingSplit = (memberId: string, v: PaymentSplit) =>
    setClosingSplits(prev => ({ ...prev, [memberId]: v }))

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

  // Default the next cycle's date: 30 days after the current cycle, or the chit's
  // start date for the very first cycle (today as a last resort).
  useEffect(() => {
    const def = currentCycle?.dueDate
      ? addDaysIso(currentCycle.dueDate, 30)
      : (startDate ? startDate.slice(0, 10) : isoLocal(new Date()))
    setNewCycleDate(def)
  }, [currentCycle, startDate, open])

  // Keep the active-cycle date editor in sync with the loaded cycle.
  useEffect(() => {
    setCycleDateEdit(currentCycle?.dueDate ? currentCycle.dueDate.slice(0, 10) : '')
  }, [currentCycle])

  // Keep the editable discount in sync with the applied value from the backend.
  useEffect(() => {
    setDiscountEdit(String(auctionDiscount))
  }, [auctionDiscount])

  const loadData = async () => {
    setIsLoading(true)
    try {
      const [membersRes, cycleRes, duesRes, closingRes] = await Promise.all([
        getChitMembers(chitGroupId),
        getCurrentCycleWithSummary(chitGroupId),
        getChitPendingDues(chitGroupId),
        getChitClosingInfo(chitGroupId),
      ])
      if (duesRes.success && duesRes.data) setPendingDues(duesRes.data)
      if (closingRes.success && closingRes.data) setClosingInfo(closingRes.data)
      if (membersRes.success && membersRes.data) setMembers(membersRes.data)
      if (cycleRes.success && cycleRes.data) {
        setCurrentCycle(cycleRes.data.cycle)
        const summary = cycleRes.data.paymentSummary as PaymentSummaryItem[]
        setPaymentSummary(summary)

        // Sync the displayed auction discount to what the backend actually applies
        // to eligible members this cycle (derived from the previous cycle's bid),
        // so the "Eligible member pays" header matches each member's amount to
        // collect. Eligible members all share one discount; derive it from any one.
        const elig = summary.find(p => p.isEligibleForDiscount && !p.hasWon)
        setAuctionDiscount(elig ? Math.max(0, monthlyContribution - elig.payableAmount) : 0)

        // Load eligibility + already-paid winners if cycle exists
        if (cycleRes.data.cycle) {
          const [eligRes, winnersRes] = await Promise.all([
            getCycleEligibility(chitGroupId, cycleRes.data.cycle.id),
            getChitCycleWinners(cycleRes.data.cycle.id),
          ])
          if (eligRes.success && eligRes.data) setEligibility(eligRes.data)
          setRecordedWinners(winnersRes.success && winnersRes.data ? winnersRes.data : [])
        } else {
          setRecordedWinners([])
        }
      }
    } catch (error) {
      toast.error('Failed to load chit data')
    } finally {
      setIsLoading(false)
    }
  }

  const handleUpdateCycleDate = async () => {
    if (!currentCycle || !cycleDateEdit) return
    setSavingCycleDate(true)
    try {
      const res = await updateChitCycleDate(chitGroupId, currentCycle.id, cycleDateEdit)
      if (res.success) {
        toast.success('Cycle date updated')
        await loadData()
        onSuccess?.()
      } else {
        toast.error(res.error || 'Failed to update cycle date')
      }
    } finally {
      setSavingCycleDate(false)
    }
  }

  const handleSaveDiscount = async () => {
    if (!currentCycle) return
    const val = parseFloat(discountEdit)
    if (isNaN(val) || val < 0) { toast.error('Enter a valid discount amount'); return }
    if (val > monthlyContribution) { toast.error('Discount cannot exceed the monthly contribution'); return }
    setSavingDiscount(true)
    try {
      const res = await setCycleCollectionDiscount(chitGroupId, currentCycle.id, val)
      if (res.success) {
        toast.success('Auction discount updated for this cycle')
        await loadData()
      } else {
        toast.error(res.error || 'Failed to update the auction discount')
      }
    } finally {
      setSavingDiscount(false)
    }
  }

  const handleResetDiscount = async () => {
    if (!currentCycle) return
    setSavingDiscount(true)
    try {
      const res = await setCycleCollectionDiscount(chitGroupId, currentCycle.id, null)
      if (res.success) {
        toast.success('Reverted to the carried-forward discount')
        await loadData()
      } else {
        toast.error(res.error || 'Failed to reset the auction discount')
      }
    } finally {
      setSavingDiscount(false)
    }
  }

  const handleAdvanceCycle = async () => {
    if (!newCycleDate) { toast.error('Please choose a date for the cycle'); return }
    setIsSubmitting(true)
    try {
      const result = await advanceToNextCycle(chitGroupId, newCycleDate)
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

  const openCollectDue = (due: ChitPendingDue) => {
    setCollectDue(due)
    setCollectSplit(emptyPaymentSplit)
    setCollectFull(false)
  }

  // The amount to collect for the open due, per the full/discounted choice.
  const collectAmount = collectDue
    ? (collectFull ? collectDue.fullAmount : collectDue.amountOwed)
    : 0

  const handleCollectDue = async () => {
    if (!collectDue) return
    if (!isPaymentSplitValid(collectSplit, collectAmount)) {
      toast.error('For a mixed payment, cash + bank must equal the amount owed')
      return
    }
    setIsSubmitting(true)
    try {
      const result = await recordChitLatePayment(
        chitGroupId, collectDue.cycleId, collectDue.memberId, collectAmount,
        paymentInvokeArgs(collectSplit),
      )
      if (result.success) {
        toast.success(`Collected cycle ${collectDue.cycleNo} dues from ${collectDue.memberName}`)
        setCollectDue(null)
        await loadData()
      } else {
        toast.error(result.error || 'Failed to collect dues')
      }
    } catch {
      toast.error('An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  // ── Batch dues collection (one receipt for several cycles) ──────────────
  const openBatch = (group: { memberId: string; memberName: string; dues: ChitPendingDue[] }) => {
    setBatchTarget(group)
    setBatchSelected(new Set(group.dues.map(d => d.cycleId)))  // all selected by default
    setBatchFull(false)
    setBatchSplit(emptyPaymentSplit)
  }
  const toggleBatchCycle = (cycleId: string) => {
    setBatchSelected(prev => {
      const next = new Set(prev)
      if (next.has(cycleId)) next.delete(cycleId); else next.add(cycleId)
      return next
    })
  }
  const batchDueAmount = (d: ChitPendingDue) => batchFull ? d.fullAmount : d.amountOwed
  const batchSelectedDues = (batchTarget?.dues ?? []).filter(d => batchSelected.has(d.cycleId))
  const batchTotal = batchSelectedDues.reduce((s, d) => s + batchDueAmount(d), 0)

  const handleBatchCollect = async () => {
    if (!batchTarget || batchSelectedDues.length === 0) { toast.error('Select at least one cycle'); return }
    if (!isPaymentSplitValid(batchSplit, batchTotal)) {
      toast.error(`For a mixed payment, cash + bank must equal ${formatCurrency(batchTotal)}`)
      return
    }
    setBatchSubmitting(true)
    try {
      const result = await recordChitLatePaymentsBatch(
        chitGroupId, batchTarget.memberId,
        batchSelectedDues.map(d => ({ cycleId: d.cycleId, amount: batchDueAmount(d) })),
        paymentInvokeArgs(batchSplit),
      )
      if (result.success) {
        toast.success(`Collected ${batchSelectedDues.length} cycle(s) from ${batchTarget.memberName} — one receipt`)
        setBatchTarget(null)
        await loadData()
      } else {
        toast.error(result.error || 'Failed to collect dues')
      }
    } catch {
      toast.error('An error occurred')
    } finally {
      setBatchSubmitting(false)
    }
  }

  // Pay out the leftover (never-won) members. Allowed even with pending dues —
  // they shouldn't be held up by late payers. Does not close the chit.
  const handlePayClosing = async () => {
    if (!closingInfo || closingInfo.leftoverMembers.length === 0) return
    const gross = closingGross
    for (const m of closingInfo.leftoverMembers) {
      if (!isPaymentSplitValid(closingSplit(m.memberId), gross)) {
        toast.error(`For ${m.memberName}, cash + bank must equal ${formatCurrency(gross)}`)
        return
      }
    }
    const payouts = closingInfo.leftoverMembers.map(m => {
      const args = paymentInvokeArgs(closingSplit(m.memberId))
      return {
        memberId: m.memberId,
        paymentMethod: args.paymentMethod.toLowerCase() as 'cash' | 'bank' | 'mixed',
        bankTxnId: args.bankTxnId,
        cashAmount: args.cashAmount,
        bankAmount: args.bankAmount,
      }
    })
    setIsSubmitting(true)
    try {
      const result = await payClosingMembers(chitGroupId, payouts)
      if (result.success) {
        toast.success(`Paid out ${payouts.length} remaining member(s)`)
        await loadData()
        onSuccess?.()
      } else {
        toast.error(result.error || 'Failed to pay out members')
      }
    } catch {
      toast.error('An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Mark the chit CLOSED — only once dues are clear and everyone has been paid.
  const handleCloseChit = async () => {
    if (!closingInfo) return
    setIsSubmitting(true)
    try {
      const result = await closeChit(chitGroupId)
      if (result.success) {
        toast.success('Chit closed')
        await loadData()
        onSuccess?.()
      } else {
        toast.error(result.error || 'Failed to close chit')
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
    if (!isPaymentSplitValid(paySplit, amount)) {
      toast.error('For a mixed payment, cash + bank must equal the amount to collect')
      return
    }

    setIsSubmitting(true)
    try {
      const result = await recordMemberPaymentWithDiscount(
        chitGroupId, currentCycle.id, selectedMemberId, amount, auctionDiscount,
        paymentInvokeArgs(paySplit),
      )
      if (result.success) {
        toast.success(result.data?.message ?? 'Payment recorded')
        setSelectedMemberId('')
        setPaySplit(emptyPaymentSplit)
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

  /// Record one or more winners' payouts. Each winner is independent — the fixed
  /// winner and every auction slot can be paid on the day that winner actually
  /// turns up, rather than all four having to be present at once.
  const recordWinners = async (
    slotKey: string,
    fixed: boolean,
    auctionRows: { index: number; row: AuctionWinnerRow }[],
  ) => {
    if (!currentCycle) return

    if (fixed) {
      if (!fixedWinnerId) { toast.error('Please select the fixed prize winner'); return }
      if (!isPaymentSplitValid(fixedWinnerSplit, fixedWinnerGross)) {
        toast.error(`For the fixed winner, cash + bank must equal ${formatCurrency(fixedWinnerGross)}`)
        return
      }
    }
    for (const { row } of auctionRows) {
      if (!row.memberId) { toast.error('Please select the auction winner'); return }
      if (!isPaymentSplitValid(row.split, auctionWinnerGross(row.bidDiscount))) {
        toast.error(`For an auction winner, cash + bank must equal ${formatCurrency(auctionWinnerGross(row.bidDiscount))}`)
        return
      }
    }
    if (!fixed && auctionRows.length === 0) {
      toast.error('Nothing to record — select a winner first')
      return
    }

    const payload: AuctionWinnerInput[] = auctionRows.map(({ row }) => {
      const args = paymentInvokeArgs(row.split)
      return {
        memberId: row.memberId,
        bidDiscount: row.bidDiscount,
        paymentMethod: args.paymentMethod.toLowerCase() as 'cash' | 'bank' | 'mixed',
        bankTxnId: args.bankTxnId,
        cashAmount: args.cashAmount,
        bankAmount: args.bankAmount,
      }
    })
    const fixedArgs = fixed ? paymentInvokeArgs(fixedWinnerSplit) : null

    setRecordingSlot(slotKey)
    try {
      const result = await processCycleWinners(
        chitGroupId, currentCycle.id,
        fixed ? fixedWinnerId : null,
        fixedArgs ? (fixedArgs.paymentMethod.toLowerCase() as 'cash' | 'bank' | 'mixed') : null,
        payload,
        overrideDiscount ? parseFloat(overrideDiscount) : undefined,
        fixedArgs ? fixedArgs.bankTxnId : null,
        fixedArgs ? fixedArgs.cashAmount : null,
        fixedArgs ? fixedArgs.bankAmount : null,
      )
      if (result.success && result.data) {
        toast.success(result.data.message)
        if (fixed) {
          setFixedWinnerId('')
          setFixedWinnerSplit(emptyPaymentSplit)
        }
        // Drop just the rows that were recorded; the remaining slots keep whatever
        // has already been typed into them.
        if (auctionRows.length > 0) {
          const done = new Set(auctionRows.map(a => a.index))
          setAuctionWinners(prev => prev.filter((_, j) => !done.has(j)))
        }
        await loadData()
        onSuccess?.()
      } else {
        toast.error(result.error || 'Failed to record winner')
      }
    } catch {
      toast.error('An error occurred')
    } finally {
      setRecordingSlot(null)
    }
  }

  /// Convenience for the common case where everyone does show up together.
  const handleProcessWinners = async () => {
    const filled = auctionWinners
      .map((row, index) => ({ index, row }))
      .filter(a => a.row.memberId)
    await recordWinners('all', !!fixedWinnerId && !recordedFixed, filled)
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
  // Recorded winners for the active cycle, split by slot type.
  const recordedFixed = recordedWinners.find(w => w.winnerType === 'FIXED')
  const recordedAuction = recordedWinners.filter(w => w.winnerType === 'AUCTION')
  // A cycle is complete only once EVERY winner slot has been paid. Using
  // `winnerId` here would lock the cycle after the very first winner, because the
  // backend sets that column as soon as one winner is recorded.
  const cycleCompleted = winnersPerCycle > 0
    ? recordedWinners.length >= winnersPerCycle
    : !!currentCycle?.winnerId
  // How many auction slots are still waiting for their winner to collect.
  const auctionSlotsRemaining = Math.max(0, (winnersPerCycle - 1) - recordedAuction.length)
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

  // Pending dues grouped by member, so a member repaying several cycles can be
  // collected in one receipt.
  const duesByMember = (() => {
    const m = new Map<string, { memberId: string; memberName: string; dues: ChitPendingDue[] }>()
    for (const d of pendingDues) {
      if (!m.has(d.memberId)) m.set(d.memberId, { memberId: d.memberId, memberName: d.memberName, dues: [] })
      m.get(d.memberId)!.dues.push(d)
    }
    return Array.from(m.values())
  })()

  const fixedWinnerPayout = totalAmount - commissionPerWinner
  const auctionWinnerPayout = (bidDiscount: number) => Math.max(0, totalAmount - bidDiscount - commissionPerWinner)
  // GROSS payout voucher amounts (before commission). The mixed split is of the
  // gross, so the commission can go in the cash slot and cancel against the cash
  // commission receipt — leaving only the bank (cheque) as a real movement.
  const fixedWinnerGross = totalAmount
  const auctionWinnerGross = (bidDiscount: number) => Math.max(0, totalAmount - bidDiscount)
  const closingGross = (closingInfo?.payoutEach ?? 0) + commissionPerWinner

  return (
    <>
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
              <span className="flex items-center gap-2 flex-wrap">
                {cycleCompleted && <Lock className="h-4 w-4 text-green-600" />}
                <strong>Cycle {currentCycle.cycleNumber}</strong>
                {cycleCompleted ? (
                  currentCycle.dueDate && <span className="text-muted-foreground">· {formatDate(currentCycle.dueDate)}</span>
                ) : (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    ·
                    <Input
                      type="date"
                      value={cycleDateEdit}
                      onChange={e => setCycleDateEdit(e.target.value)}
                      className="h-7 w-[9.5rem] py-0"
                    />
                    {cycleDateEdit && cycleDateEdit !== (currentCycle.dueDate?.slice(0, 10) ?? '') && (
                      <Button
                        size="sm" variant="outline" className="h-7 px-2"
                        onClick={handleUpdateCycleDate}
                        disabled={savingCycleDate}
                      >
                        {savingCycleDate ? 'Saving…' : 'Save date'}
                      </Button>
                    )}
                  </span>
                )}
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
              {tab === 'current' ? <><Clock className="h-4 w-4 mr-2" />Pending</>
               : tab === 'payment' ? <><DollarSign className="h-4 w-4 mr-2" />Payments</>
               : <><Trophy className="h-4 w-4 mr-2" />Winners</>}
            </Button>
          ))}
        </div>

        <ScrollArea className="h-[55vh]">
          {/* ── Current Cycle Tab ── */}
          {activeTab === 'current' && (
            <div className="space-y-4">
              {/* Pending dues from earlier (completed) cycles — e.g. someone who
                  missed a past cycle paying it now. Collecting records cash today. */}
              {pendingDues.length > 0 && (
                <Card className="border-amber-300">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                      Pending Dues — Earlier Cycles
                      <Badge variant="secondary">{pendingDues.length}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground mb-3">
                      Overdue installments from completed cycles. A member with several dues can be
                      cleared in one receipt — use “Collect all”, or open it to pick specific cycles.
                    </p>
                    <div className="space-y-2">
                      {duesByMember.map(g => {
                        const total = g.dues.reduce((s, d) => s + d.amountOwed, 0)
                        return (
                          <div key={g.memberId} className="p-2 rounded border text-sm space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium">{g.memberName}</span>
                                {g.dues.map(d => (
                                  <Badge key={d.cycleId} variant="outline" className="text-xs">Cycle {d.cycleNo}</Badge>
                                ))}
                              </div>
                              <span className="text-muted-foreground whitespace-nowrap">
                                {g.dues.length} · {formatCurrency(total)}
                              </span>
                            </div>
                            <div className="flex justify-end gap-2">
                              {g.dues.length === 1 ? (
                                <Button size="sm" variant="outline" onClick={() => openCollectDue(g.dues[0])}>Collect</Button>
                              ) : (
                                <Button size="sm" variant="outline" onClick={() => openBatch(g)}>
                                  Collect all ({g.dues.length})
                                </Button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}

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
                <CardHeader><CardTitle className="text-base">
                  {closingInfo?.allCyclesComplete && !closingInfo.alreadyClosed ? 'Closing Cycle — Final Settlement' : 'Cycle Control'}
                </CardTitle></CardHeader>
                <CardContent>
                  {closingInfo?.alreadyClosed ? (
                    <p className="text-sm text-green-700 font-medium text-center">
                      This chit is closed — all cycles complete and remaining members paid out.
                    </p>
                  ) : closingInfo?.allCyclesComplete ? (
                    <div className="space-y-3">
                      {/* Pay out leftover (never-won) members — allowed even while
                          dues are still pending; they shouldn't wait on late payers. */}
                      {closingInfo.leftoverMembers.length > 0 ? (
                        <>
                          <p className="text-xs text-muted-foreground">
                            These members never won — each receives {formatCurrency(closingInfo.payoutEach)} (net). You can pay them out now even if some dues are still pending.
                            {commissionPerWinner > 0 && ` For a mixed payout, split the gross prize (${formatCurrency(closingGross)}) and keep cash = commission (${formatCurrency(commissionPerWinner)}) so only the bank portion moves.`}
                          </p>
                          <div className="space-y-2">
                            {closingInfo.leftoverMembers.map(m => (
                              <div key={m.memberId} className="space-y-2 p-2 rounded border text-sm">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-medium">{m.memberName}{passbookSuffix(m.memberId)}</span>
                                  <span className="text-muted-foreground">{formatCurrency(closingInfo.payoutEach)}</span>
                                </div>
                                <PaymentMethodFields
                                  total={closingGross}
                                  value={closingSplit(m.memberId)}
                                  onChange={v => setClosingSplit(m.memberId, v)}
                                  idPrefix={`chit-closing-${m.memberId}`}
                                  mixedSeedCash={commissionPerWinner}
                                />
                              </div>
                            ))}
                          </div>
                          <Button onClick={handlePayClosing} disabled={isSubmitting} variant="outline" className="w-full">
                            <Trophy className="h-4 w-4 mr-2" />Pay Out Remaining Member(s)
                          </Button>
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground">All members have been paid out.</p>
                      )}

                      {closingInfo.outstandingDues > 0 && (
                        <p className="text-xs text-amber-700">
                          {closingInfo.outstandingDues} pending due(s) must still be collected (see Pending Dues above) before the chit can be closed.
                        </p>
                      )}

                      {closingInfo.leftoverMembers.length === 0 && closingInfo.outstandingDues === 0 ? (
                        <Button onClick={handleCloseChit} disabled={isSubmitting} className="w-full">
                          <Trophy className="h-4 w-4 mr-2" />Close Chit
                        </Button>
                      ) : (
                        <Button disabled variant="secondary" className="w-full">
                          Close Chit (settle all dues &amp; payouts first)
                        </Button>
                      )}
                    </div>
                  ) : isFinalCycle ? (
                    <p className="text-sm text-muted-foreground text-center">
                      Final cycle ({durationMonths} of {durationMonths}) — process its winner in the Winners tab, then close the chit.
                    </p>
                  ) : (
                    <>
                      {currentCycle && cycleCompleted && (
                        <p className="text-xs text-muted-foreground mb-2">
                          This cycle is complete — start the next cycle to continue. The discount carries forward automatically.
                        </p>
                      )}
                      <div className="space-y-1 mb-3">
                        <Label htmlFor="new-cycle-date">Cycle date</Label>
                        <Input
                          id="new-cycle-date"
                          type="date"
                          value={newCycleDate}
                          onChange={e => setNewCycleDate(e.target.value)}
                          disabled={isSubmitting || !!(currentCycle && !cycleCompleted)}
                        />
                        <p className="text-xs text-muted-foreground">
                          Defaults to {currentCycle ? '30 days after the current cycle' : "the chit's start date"} — change it to set the actual auction date.
                        </p>
                      </div>
                      <Button
                        onClick={handleAdvanceCycle}
                        disabled={isSubmitting || !newCycleDate || !!(currentCycle && !cycleCompleted)}
                        className="w-full"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        {currentCycle ? 'Start Next Cycle' : 'Start First Cycle'}
                      </Button>
                    </>
                  )}
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
                  {(() => {
                    const editVal = parseFloat(discountEdit)
                    const previewDiscount = isNaN(editVal) ? auctionDiscount : editVal
                    const changed = !isNaN(editVal) && Math.abs(editVal - auctionDiscount) > 0.005
                    return (
                      <>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <Label htmlFor="auction-discount">Auction Discount (per member)</Label>
                            <Input
                              id="auction-discount"
                              type="number" min={0} step="0.01" max={monthlyContribution}
                              value={discountEdit}
                              onChange={e => setDiscountEdit(e.target.value)}
                              disabled={savingDiscount}
                            />
                            <p className="text-xs text-muted-foreground">Carried from the previous cycle's bid discount — edit to override what each eligible member pays this cycle.</p>
                          </div>
                          <div className="space-y-1">
                            <Label>Eligible member pays</Label>
                            <div className="flex items-center h-9 px-3 rounded-md border bg-muted text-sm font-medium">
                              {formatCurrency(roundToFive(monthlyContribution - previewDiscount))}
                            </div>
                            <p className="text-xs text-muted-foreground">{formatCurrency(monthlyContribution)} − {formatCurrency(previewDiscount)}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button size="sm" onClick={handleSaveDiscount} disabled={savingDiscount || !changed}>
                            {savingDiscount ? 'Saving…' : 'Apply discount'}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={handleResetDiscount} disabled={savingDiscount}>
                            Reset to carried value
                          </Button>
                          {changed && (
                            <span className="text-xs text-amber-600">Apply to update each member's amount below.</span>
                          )}
                        </div>
                      </>
                    )
                  })()}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Record Member Payment</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1">
                    <Label>Select Member</Label>
                    <Select value={selectedMemberId} onValueChange={(v) => { setSelectedMemberId(v); setPaySplit(emptyPaymentSplit) }}>
                      <SelectTrigger><SelectValue placeholder="Select member" /></SelectTrigger>
                      <SelectContent>
                        {unpaidMembers.map(m => (
                          <SelectItem key={m.memberId} value={m.memberId}>
                            {m.memberName}<MemberTypeTag type={memberTypeOf(m.memberId)} />{passbookSuffix(m.memberId)}
                            {m.isEligibleForDiscount
                              ? ` (${formatCurrency(m.payableAmount)})`
                              : ` (${formatCurrency(m.payableAmount)} — no discount)`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {selectedMemberId && (
                    <>
                      <Alert>
                        <AlertDescription className="text-sm">
                          Amount to collect: <strong>{formatCurrency(perMemberAmount(selectedMemberId))}</strong>
                          {auctionDiscount > 0 && paymentSummary.find(p => p.memberId === selectedMemberId)?.isEligibleForDiscount
                            ? <span className="text-muted-foreground ml-2">(discount applied)</span>
                            : auctionDiscount > 0 ? <span className="text-orange-600 ml-2">(ineligible — full rate)</span>
                            : null}
                        </AlertDescription>
                      </Alert>
                      <PaymentMethodFields
                        total={perMemberAmount(selectedMemberId)}
                        value={paySplit}
                        onChange={setPaySplit}
                        idPrefix="chit-pay"
                      />
                    </>
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
                  {winnersPerCycle} winner(s) this cycle: 1 fixed prize + {winnersPerCycle - 1} auction winner(s).
                  Record each one as they collect — every payout creates its own voucher and
                  commission receipt. The cycle completes once all {winnersPerCycle} are paid
                  ({recordedWinners.length} of {winnersPerCycle} done).
                </AlertDescription>
              </Alert>

              {/* Fixed winner */}
              <Card>
                <CardHeader><CardTitle className="text-base">Fixed Prize Winner</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {recordedFixed ? (
                    <div className="flex items-center gap-3 rounded border border-green-200 bg-green-50/50 p-3">
                      <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{recordedFixed.memberName}</p>
                        <p className="text-xs text-muted-foreground">
                          Paid {formatCurrency(recordedFixed.payoutAmount)} · {formatDate(recordedFixed.paidAt)}
                        </p>
                      </div>
                      <Badge variant="secondary" className="bg-green-100 text-green-700">Paid</Badge>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-1">
                        <Label>Member</Label>
                        <Select value={fixedWinnerId} onValueChange={setFixedWinnerId}>
                          <SelectTrigger><SelectValue placeholder="Select winner" /></SelectTrigger>
                          <SelectContent>
                            {eligibleMembersWithoutWin
                              .filter(m => !auctionWinners.find(w => w.memberId === m.memberId))
                              .map(m => <SelectItem key={m.memberId} value={m.memberId}>{m.memberName}<MemberTypeTag type={memberTypeOf(m.memberId)} />{passbookSuffix(m.memberId)}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Payout: {formatCurrency(totalAmount)} − {formatCurrency(commissionPerWinner)} commission = <strong>{formatCurrency(fixedWinnerPayout)}</strong>
                      </div>
                      <PaymentMethodFields
                        total={fixedWinnerGross}
                        value={fixedWinnerSplit}
                        onChange={setFixedWinnerSplit}
                        idPrefix="chit-fixed-winner"
                        mixedSeedCash={commissionPerWinner}
                      />
                      {fixedWinnerSplit.method === 'mixed' && commissionPerWinner > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Split is of the gross prize ({formatCurrency(fixedWinnerGross)}). Keep cash =
                          commission ({formatCurrency(commissionPerWinner)}) so it cancels against the cash
                          commission receipt — the winner then gets {formatCurrency(fixedWinnerPayout)} by bank only.
                        </p>
                      )}
                      <Button
                        onClick={() => recordWinners('fixed', true, [])}
                        disabled={recordingSlot !== null || !fixedWinnerId}
                        className="w-full"
                        variant="secondary"
                      >
                        <Trophy className="h-4 w-4 mr-2" />
                        {recordingSlot === 'fixed' ? 'Recording…' : 'Record This Payout'}
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Auction winners */}
              {winnersPerCycle > 1 && (
                <Card>
                  <CardHeader><CardTitle className="text-base">
                    Auction Winners ({recordedAuction.length} of {winnersPerCycle - 1} paid)
                  </CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    {/* Already collected */}
                    {recordedAuction.map(w => (
                      <div key={w.id} className="flex items-center gap-3 rounded border border-green-200 bg-green-50/50 p-3">
                        <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{w.memberName}</p>
                          <p className="text-xs text-muted-foreground">
                            Paid {formatCurrency(w.payoutAmount)}
                            {w.bidDiscount > 0 && ` · bid discount ${formatCurrency(w.bidDiscount)}`}
                            {' · '}{formatDate(w.paidAt)}
                          </p>
                        </div>
                        <Badge variant="secondary" className="bg-green-100 text-green-700">Paid</Badge>
                      </div>
                    ))}

                    {/* Still to collect — each slot records on its own */}
                    {Array.from({ length: auctionSlotsRemaining }, (_, i) => {
                      const row: AuctionWinnerRow = auctionWinners[i] ?? { memberId: '', bidDiscount: 0, split: emptyPaymentSplit }
                      const update = (field: keyof AuctionWinnerRow, value: any) => {
                        setAuctionWinners(prev => {
                          const next = [...prev]
                          while (next.length <= i) next.push({ memberId: '', bidDiscount: 0, split: emptyPaymentSplit })
                          next[i] = { ...next[i], [field]: value }
                          return next
                        })
                      }
                      const slotKey = `auction-${i}`
                      return (
                        <div key={i} className="space-y-3 p-3 rounded border bg-muted/30">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <Label className="text-xs">Auction Winner {recordedAuction.length + i + 1}</Label>
                              <Select value={row.memberId} onValueChange={v => update('memberId', v)}>
                                <SelectTrigger className="h-8"><SelectValue placeholder="Select" /></SelectTrigger>
                                <SelectContent>
                                  {eligibleMembersWithoutWin
                                    .filter(m => m.memberId !== fixedWinnerId &&
                                      !auctionWinners.find((w, j) => j !== i && w.memberId === m.memberId))
                                    .map(m => <SelectItem key={m.memberId} value={m.memberId}>{m.memberName}<MemberTypeTag type={memberTypeOf(m.memberId)} />{passbookSuffix(m.memberId)}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Bid Discount (Rs.)</Label>
                              <Input type="number" min={0} className="h-8"
                                value={row.bidDiscount || ''}
                                onChange={e => update('bidDiscount', parseFloat(e.target.value) || 0)} />
                              <p className="text-xs text-muted-foreground">Gets: {formatCurrency(auctionWinnerPayout(row.bidDiscount))}</p>
                            </div>
                          </div>
                          {row.memberId && (
                            <PaymentMethodFields
                              total={auctionWinnerGross(row.bidDiscount)}
                              value={row.split}
                              onChange={v => update('split', v)}
                              idPrefix={`chit-auction-${i}`}
                              mixedSeedCash={commissionPerWinner}
                            />
                          )}
                          <Button
                            onClick={() => recordWinners(slotKey, false, [{ index: i, row }])}
                            disabled={recordingSlot !== null || !row.memberId}
                            className="w-full"
                            variant="secondary"
                          >
                            <Trophy className="h-4 w-4 mr-2" />
                            {recordingSlot === slotKey ? 'Recording…' : 'Record This Payout'}
                          </Button>
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

              {(( !recordedFixed && !!fixedWinnerId) || auctionWinners.some(w => w.memberId)) && (
                <Button
                  onClick={handleProcessWinners}
                  disabled={recordingSlot !== null}
                  className="w-full"
                >
                  <Trophy className="h-4 w-4 mr-2" />
                  {recordingSlot === 'all' ? 'Recording…' : 'Record All Selected Winners'}
                </Button>
              )}
              <p className="text-xs text-muted-foreground text-center">
                Use the button on each winner to pay them separately, or this one to record
                everyone you have selected at once.
              </p>
            </div>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Collect overdue dues for an earlier cycle */}
    <Dialog open={!!collectDue} onOpenChange={open => { if (!open) setCollectDue(null) }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Collect Cycle {collectDue?.cycleNo} Dues</DialogTitle>
        </DialogHeader>
        {collectDue && (
          <div className="space-y-4">
            <div className="rounded-lg bg-muted p-3 text-sm">
              <p className="font-medium">{collectDue.memberName}</p>
              <p className="text-muted-foreground text-xs mt-0.5">
                Overdue installment for cycle {collectDue.cycleNo}
              </p>
              <p className="text-sm mt-1">Amount: <strong>{formatCurrency(collectAmount)}</strong></p>
            </div>

            {/* When a bid discount applied to this cycle, the SHG can choose to
                still charge a late payer the full contribution. */}
            {collectDue.discount > 0.005 && (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  This cycle had a {formatCurrency(collectDue.discount)} bid discount. Collect:
                </p>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant={!collectFull ? 'default' : 'outline'}
                    className="flex-1" onClick={() => { setCollectFull(false); setCollectSplit(emptyPaymentSplit) }}>
                    After discount ({formatCurrency(collectDue.amountOwed)})
                  </Button>
                  <Button type="button" size="sm" variant={collectFull ? 'default' : 'outline'}
                    className="flex-1" onClick={() => { setCollectFull(true); setCollectSplit(emptyPaymentSplit) }}>
                    Full ({formatCurrency(collectDue.fullAmount)})
                  </Button>
                </div>
              </div>
            )}

            <PaymentMethodFields
              total={collectAmount}
              value={collectSplit}
              onChange={setCollectSplit}
              idPrefix="chit-due"
            />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setCollectDue(null)} disabled={isSubmitting}>Cancel</Button>
          <Button onClick={handleCollectDue} disabled={isSubmitting}>
            Collect Payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Collect several overdue cycles for one member in a single receipt */}
    <Dialog open={!!batchTarget} onOpenChange={open => { if (!open) setBatchTarget(null) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Collect Dues — {batchTarget?.memberName}</DialogTitle>
        </DialogHeader>
        {batchTarget && (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Select the cycles being paid. One receipt is generated for the whole total.
            </p>

            {/* Charge full or after-discount for cycles that had a bid discount. */}
            {batchTarget.dues.some(d => d.discount > 0.005) && (
              <div className="flex gap-2">
                <Button type="button" size="sm" variant={!batchFull ? 'default' : 'outline'}
                  className="flex-1" onClick={() => { setBatchFull(false); setBatchSplit(emptyPaymentSplit) }}>
                  After discount
                </Button>
                <Button type="button" size="sm" variant={batchFull ? 'default' : 'outline'}
                  className="flex-1" onClick={() => { setBatchFull(true); setBatchSplit(emptyPaymentSplit) }}>
                  Full amount
                </Button>
              </div>
            )}

            <div className="max-h-52 overflow-y-auto rounded-md border divide-y">
              {batchTarget.dues.map(d => (
                <label key={d.cycleId} className="flex items-center justify-between gap-2 p-2 text-sm cursor-pointer">
                  <span className="flex items-center gap-2">
                    <Checkbox
                      checked={batchSelected.has(d.cycleId)}
                      onCheckedChange={() => { toggleBatchCycle(d.cycleId); setBatchSplit(emptyPaymentSplit) }}
                    />
                    Cycle {d.cycleNo}
                  </span>
                  <span className="text-muted-foreground">{formatCurrency(batchDueAmount(d))}</span>
                </label>
              ))}
            </div>

            <div className="flex items-center justify-between rounded-md bg-muted p-2 text-sm font-medium">
              <span>{batchSelectedDues.length} cycle(s)</span>
              <span>{formatCurrency(batchTotal)}</span>
            </div>

            {batchTotal > 0 && (
              <PaymentMethodFields
                total={batchTotal}
                value={batchSplit}
                onChange={setBatchSplit}
                idPrefix="chit-due-batch"
              />
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setBatchTarget(null)} disabled={batchSubmitting}>Cancel</Button>
          <Button onClick={handleBatchCollect} disabled={batchSubmitting || batchSelectedDues.length === 0}>
            {batchSubmitting ? 'Collecting…' : `Collect ${formatCurrency(batchTotal)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}
