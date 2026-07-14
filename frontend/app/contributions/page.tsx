'use client'

import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { PageHeader } from '@/components/page-header'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { recordWeeklyContribution } from '@/lib/api/receipts'
import { formatCurrency, formatDate } from '@/lib/format'
import {
  CheckCircle2, Clock, ChevronLeft, ChevronRight, RefreshCw,
  Users, Banknote, AlertCircle, Plus, CalendarClock,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface MemberStatus {
  memberId: number
  memberName: string
  memberCode: string
  hasPaid: boolean
  amountPaid: number
  paymentMethod: string | null
  paidAt: string | null
  paymentCount: number
  totalSavings: number
  installmentsPaid: number
  behindBy: number
}

interface Summary {
  fromDate: string
  toDate: string
  totalMembers: number
  paidCount: number
  pendingCount: number
  totalCollected: number
  currentInstallmentNumber: number
  behindCount: number
  members: MemberStatus[]
}

interface SavingsPayoutRow {
  id: number
  memberId: number
  memberName: string
  memberCode: string
  amount: number
  date: string
  isPast: boolean
}

// Return Monday of the week containing the given date
function weekStart(d: Date): Date {
  const day = d.getDay() // 0=Sun
  const diff = (day === 0 ? -6 : 1 - day) // Monday
  const mon = new Date(d)
  mon.setDate(d.getDate() + diff)
  mon.setHours(0, 0, 0, 0)
  return mon
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function toISO(d: Date) {
  return d.toISOString().split('T')[0]
}

function formatRange(from: string, to: string) {
  return `${formatDate(from)} — ${formatDate(to)}`
}

export default function ContributionsPage() {
  const [weekOf, setWeekOf] = useState<Date>(() => weekStart(new Date()))
  const [summary, setSummary] = useState<Summary | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [filter, setFilter] = useState<'all' | 'paid' | 'pending' | 'behind'>('all')
  const [search, setSearch] = useState('')

  // Set-installment-number dialog
  const [numberDialogOpen, setNumberDialogOpen] = useState(false)
  const [numberInput, setNumberInput] = useState('')
  const [isSavingNumber, setIsSavingNumber] = useState(false)

  // Quick-pay dialog
  const [payDialog, setPayDialog] = useState<{ open: boolean; member: MemberStatus | null }>({ open: false, member: null })
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState<'CASH' | 'BANK'>('CASH')
  const [isPaying, setIsPaying] = useState(false)

  // Savings payouts (history + past-data entry)
  const [showPayouts, setShowPayouts] = useState(false)
  const [payoutHistory, setPayoutHistory] = useState<SavingsPayoutRow[]>([])
  const [loadingPayouts, setLoadingPayouts] = useState(false)
  const [ppMember, setPpMember] = useState('')
  const [ppAmount, setPpAmount] = useState('')
  const [ppDate, setPpDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [ppNote, setPpNote] = useState('')
  const [savingPp, setSavingPp] = useState(false)

  const fromDate = toISO(weekOf)
  const toDate = toISO(addDays(weekOf, 6))

  const load = useCallback(async (from: string, to: string) => {
    setIsLoading(true)
    try {
      const result = await invoke<Summary>('get_weekly_contribution_status_cmd', {
        fromDate: from,
        toDate: to,
      })
      setSummary(result)
    } catch (err: any) {
      toast.error(err?.toString() || 'Failed to load contributions')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { load(fromDate, toDate) }, [fromDate, toDate])

  const prevWeek = () => setWeekOf(w => addDays(w, -7))
  const nextWeek = () => setWeekOf(w => addDays(w, 7))
  const thisWeek = () => setWeekOf(weekStart(new Date()))
  const isCurrentWeek = toISO(weekOf) === toISO(weekStart(new Date()))
  const isInFuture = weekOf > weekStart(new Date())

  const handleSaveNumber = async () => {
    const n = parseInt(numberInput, 10)
    if (isNaN(n) || n < 0) { toast.error('Enter a valid number'); return }
    setIsSavingNumber(true)
    try {
      await invoke('set_installment_number_cmd', { number: n })
      toast.success(`Current installment set to #${n}`)
      setNumberDialogOpen(false)
      load(fromDate, toDate)
    } catch (e: any) {
      toast.error(e?.toString() || 'Failed to set installment number')
    } finally {
      setIsSavingNumber(false)
    }
  }

  // Filtered members
  const displayed = (summary?.members ?? []).filter(m => {
    if (filter === 'paid' && !m.hasPaid) return false
    if (filter === 'pending' && m.hasPaid) return false
    if (filter === 'behind' && m.behindBy <= 0) return false
    if (search) {
      const q = search.toLowerCase()
      return m.memberName.toLowerCase().includes(q) || m.memberCode.toLowerCase().includes(q)
    }
    return true
  })

  // Quick-pay submit
  const handlePay = async () => {
    if (!payDialog.member) return
    const amount = parseFloat(payAmount)
    if (!amount || amount <= 0) { toast.error('Enter a valid amount'); return }
    setIsPaying(true)
    try {
      const res = await recordWeeklyContribution({
        member_id: payDialog.member.memberId,
        amount,
        payment_method: payMethod,
      })
      if (res.success) {
        toast.success(`Recorded ${formatCurrency(amount)} for ${payDialog.member.memberName}`)
        setPayDialog({ open: false, member: null })
        setPayAmount('')
        setPayMethod('CASH')
        load(fromDate, toDate)
      } else {
        toast.error(res.error || 'Failed to record')
      }
    } catch (e: any) {
      toast.error(e?.toString() || 'Error')
    } finally {
      setIsPaying(false)
    }
  }

  const openPayDialog = (m: MemberStatus) => {
    setPayDialog({ open: true, member: m })
    setPayAmount('')
    setPayMethod('CASH')
  }

  const loadPayouts = useCallback(async () => {
    setLoadingPayouts(true)
    try {
      const rows = await invoke<SavingsPayoutRow[]>('get_savings_payout_history_cmd')
      setPayoutHistory(rows)
    } catch {
      /* ignore */
    } finally {
      setLoadingPayouts(false)
    }
  }, [])

  const openPayouts = () => { setShowPayouts(true); loadPayouts() }

  const handleRecordPastPayout = async () => {
    if (!ppMember) { toast.error('Select a member'); return }
    const amt = parseFloat(ppAmount)
    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return }
    if (!ppDate) { toast.error('Select a date'); return }
    setSavingPp(true)
    try {
      await invoke('record_past_member_payout_cmd', {
        memberId: parseInt(ppMember),
        amount: amt,
        paidAt: new Date(ppDate).toISOString(),
        note: ppNote.trim() || null,
      })
      toast.success('Past savings payout recorded')
      setPpMember(''); setPpAmount(''); setPpNote('')
      await loadPayouts()
      load(fromDate, toDate)
    } catch (e: any) {
      toast.error(typeof e === 'string' ? e : 'Failed to record payout')
    } finally {
      setSavingPp(false)
    }
  }

  const paidPct = summary ? Math.round((summary.paidCount / summary.totalMembers) * 100) : 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Weekly Contributions"
        description="Track who has paid their savings contribution for the week"
      >
        <Button variant="outline" onClick={openPayouts}>
          <Banknote className="mr-2 h-4 w-4" />
          Savings Payouts
        </Button>
        <Button variant="outline" onClick={() => load(fromDate, toDate)} disabled={isLoading}>
          {isLoading ? <Spinner className="mr-2 h-4 w-4" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
      </PageHeader>

      {/* Week navigator */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between gap-4">
            <Button variant="outline" size="icon" onClick={prevWeek}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="text-center flex-1">
              <p className="font-semibold text-base">
                {isCurrentWeek ? 'This Week' : isInFuture ? 'Upcoming Week' : 'Past Week'}
              </p>
              <p className="text-sm text-muted-foreground">{formatRange(fromDate, toDate)}</p>
            </div>
            <Button variant="outline" size="icon" onClick={nextWeek}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          {!isCurrentWeek && (
            <div className="flex justify-center mt-3">
              <Button variant="ghost" size="sm" onClick={thisWeek}>
                Jump to current week
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Installment tracker */}
      {summary && (
        <Card className="border-indigo-200">
          <CardContent className="pt-4 pb-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100">
                  <CalendarClock className="h-5 w-5 text-indigo-700" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Current Installment Number</p>
                  {summary.currentInstallmentNumber > 0 ? (
                    <p className="font-bold text-lg text-indigo-700">
                      #{summary.currentInstallmentNumber}
                      {summary.behindCount > 0 && (
                        <span className="text-xs font-normal text-orange-600 ml-2">
                          {summary.behindCount} member{summary.behindCount !== 1 ? 's' : ''} behind
                        </span>
                      )}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">Not set</p>
                  )}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setNumberInput(summary.currentInstallmentNumber > 0 ? String(summary.currentInstallmentNumber) : '')
                  setNumberDialogOpen(true)
                }}
              >
                Set Number
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Expected number of installments each member should have paid by now. It increases by one every Monday automatically.
            </p>
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <div className="flex justify-center py-12">
          <Spinner className="h-8 w-8" />
        </div>
      )}

      {!isLoading && summary && (
        <>
          {/* Summary cards */}
          <div className="grid gap-4 sm:grid-cols-4">
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                    <Users className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total Members</p>
                    <p className="font-bold text-lg">{summary.totalMembers}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-green-200">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100">
                    <CheckCircle2 className="h-5 w-5 text-green-700" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Paid</p>
                    <p className="font-bold text-lg text-green-700">
                      {summary.paidCount}
                      <span className="text-xs font-normal text-muted-foreground ml-1">({paidPct}%)</span>
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className={cn(summary.pendingCount > 0 ? 'border-orange-300' : 'border-green-200')}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', summary.pendingCount > 0 ? 'bg-orange-100' : 'bg-green-100')}>
                    <Clock className={cn('h-5 w-5', summary.pendingCount > 0 ? 'text-orange-600' : 'text-green-700')} />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Pending</p>
                    <p className={cn('font-bold text-lg', summary.pendingCount > 0 ? 'text-orange-600' : 'text-green-700')}>
                      {summary.pendingCount}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-blue-200">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
                    <Banknote className="h-5 w-5 text-blue-700" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Collected</p>
                    <p className="font-bold text-lg text-blue-700">{formatCurrency(summary.totalCollected)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Progress bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{summary.paidCount} of {summary.totalMembers} paid</span>
              <span>{paidPct}%</span>
            </div>
            <div className="h-2.5 rounded-full bg-muted overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all', paidPct === 100 ? 'bg-green-500' : 'bg-blue-500')}
                style={{ width: `${paidPct}%` }}
              />
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-3 items-center">
            <Input
              placeholder="Search member…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-48"
            />
            <div className="flex gap-1 rounded-lg border p-1">
              {(['all', 'paid', 'pending', 'behind'] as const).map(f => (
                <Button
                  key={f}
                  variant={filter === f ? 'default' : 'ghost'}
                  size="sm"
                  className="h-7 px-3"
                  onClick={() => setFilter(f)}
                >
                  {f === 'all' ? 'All'
                    : f === 'paid' ? `Paid (${summary.paidCount})`
                    : f === 'pending' ? `Pending (${summary.pendingCount})`
                    : `Behind (${summary.behindCount})`}
                </Button>
              ))}
            </div>
          </div>

          {/* Member list */}
          <div className="space-y-2">
            {displayed.length === 0 && (
              <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                <AlertCircle className="h-8 w-8 mb-2 opacity-40" />
                <p>No members match your filter</p>
              </div>
            )}
            {displayed.map(member => (
              <div
                key={member.memberId}
                className={cn(
                  'flex items-center gap-4 rounded-lg border px-4 py-3 transition-colors',
                  member.hasPaid
                    ? 'bg-green-50/40 border-green-200'
                    : 'bg-orange-50/30 border-orange-200'
                )}
              >
                {/* Status icon */}
                {member.hasPaid
                  ? <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
                  : <Clock className="h-5 w-5 text-orange-500 flex-shrink-0" />
                }

                {/* Member info */}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{member.memberName}</p>
                  <p className="text-xs text-muted-foreground">
                    {member.memberCode}
                    {summary.currentInstallmentNumber > 0 && (
                      <span className="ml-2">· {member.installmentsPaid}/{summary.currentInstallmentNumber} installments</span>
                    )}
                  </p>
                </div>

                {/* Behind badge */}
                {member.behindBy > 0 && (
                  <Badge variant="outline" className="text-xs flex-shrink-0 border-red-300 text-red-700">
                    Behind {member.behindBy}
                  </Badge>
                )}

                {/* Paid info or pending */}
                {member.hasPaid ? (
                  <div className="text-right flex-shrink-0">
                    <p className="font-semibold text-green-700 text-sm">{formatCurrency(member.amountPaid)}</p>
                    <p className="text-xs text-muted-foreground">
                      {member.paymentMethod} · {member.paidAt ? formatDate(member.paidAt) : ''}
                      {member.paymentCount > 1 && ` · ${member.paymentCount} entries`}
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-muted-foreground">Not paid</span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 text-xs"
                      onClick={() => openPayDialog(member)}
                    >
                      <Plus className="h-3 w-3" />Record
                    </Button>
                  </div>
                )}

                {/* Total savings badge */}
                <Badge variant="secondary" className="text-xs flex-shrink-0 hidden sm:flex">
                  Total: {formatCurrency(member.totalSavings)}
                </Badge>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Quick-pay dialog */}
      <Dialog open={payDialog.open} onOpenChange={open => !open && setPayDialog({ open: false, member: null })}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Record Contribution</DialogTitle>
          </DialogHeader>
          {payDialog.member && (
            <div className="space-y-4">
              <div className="rounded-lg bg-muted p-3 text-sm">
                <p className="font-medium">{payDialog.member.memberName}</p>
                <p className="text-muted-foreground text-xs">{payDialog.member.memberCode}</p>
                <p className="text-xs mt-1 text-muted-foreground">
                  Week: {formatRange(fromDate, toDate)}
                </p>
              </div>
              <div className="space-y-1">
                <Label>Amount</Label>
                <Input
                  type="number" min="1" step="0.01" placeholder="0.00"
                  value={payAmount}
                  onChange={e => setPayAmount(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <Label>Payment Method</Label>
                <RadioGroup value={payMethod} onValueChange={v => setPayMethod(v as 'CASH' | 'BANK')}
                  className="flex gap-4">
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="CASH" id="r-cash" /><Label htmlFor="r-cash">Cash</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="BANK" id="r-bank" /><Label htmlFor="r-bank">Bank</Label>
                  </div>
                </RadioGroup>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayDialog({ open: false, member: null })} disabled={isPaying}>
              Cancel
            </Button>
            <Button onClick={handlePay} disabled={isPaying || !payAmount}>
              {isPaying ? <Spinner className="mr-2 h-4 w-4" /> : null}
              Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Set installment number dialog */}
      <Dialog open={numberDialogOpen} onOpenChange={setNumberDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Set Current Installment Number</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Enter how many installments each member should have paid by now. From
              today it will automatically increase by one every Monday. Members who have
              paid fewer than this are flagged as behind.
            </p>
            <div className="space-y-1">
              <Label>Installment number</Label>
              <Input
                type="number" min="0" step="1" placeholder="e.g. 12"
                value={numberInput}
                onChange={e => setNumberInput(e.target.value)}
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter') handleSaveNumber() }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNumberDialogOpen(false)} disabled={isSavingNumber}>
              Cancel
            </Button>
            <Button onClick={handleSaveNumber} disabled={isSavingNumber || numberInput === ''}>
              {isSavingNumber ? <Spinner className="mr-2 h-4 w-4" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Savings payouts: history + past-data entry */}
      <Dialog open={showPayouts} onOpenChange={setShowPayouts}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Savings Payouts</DialogTitle>
          </DialogHeader>

          {/* Record a past payout (reference-only) */}
          <div className="rounded-md border p-3 space-y-2 bg-muted/30">
            <p className="text-sm font-medium">Record a past payout</p>
            <p className="text-xs text-muted-foreground">
              For savings paid out to a member before the app was in use. Reduces their savings balance;
              creates no voucher/receipt and does not affect the SHG ledger.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Select value={ppMember} onValueChange={setPpMember}>
                <SelectTrigger><SelectValue placeholder="Select member" /></SelectTrigger>
                <SelectContent>
                  {summary?.members.map(m => (
                    <SelectItem key={m.memberId} value={m.memberId.toString()}>
                      {m.memberName} ({m.memberCode})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input type="number" min="0" step="0.01" placeholder="Amount (₹)"
                value={ppAmount} onChange={e => setPpAmount(e.target.value)} />
              <Input type="date" value={ppDate} onChange={e => setPpDate(e.target.value)} />
              <Input placeholder="Note (optional)" value={ppNote} onChange={e => setPpNote(e.target.value)} />
            </div>
            <Button size="sm" onClick={handleRecordPastPayout} disabled={savingPp}>
              {savingPp && <Spinner className="mr-2 h-4 w-4" />}Record Past Payout
            </Button>
          </div>

          {/* History */}
          <div className="max-h-[45vh] overflow-y-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted sticky top-0">
                <tr className="text-left">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Member</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {loadingPayouts ? (
                  <tr><td colSpan={4} className="px-3 py-6 text-center"><Spinner className="h-5 w-5 inline" /></td></tr>
                ) : payoutHistory.length === 0 ? (
                  <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No savings payouts yet</td></tr>
                ) : payoutHistory.map(p => (
                  <tr key={p.id} className="border-t">
                    <td className="px-3 py-2 whitespace-nowrap">{formatDate(p.date)}</td>
                    <td className="px-3 py-2">{p.memberName} <span className="text-muted-foreground">({p.memberCode})</span></td>
                    <td className="px-3 py-2">
                      {p.isPast
                        ? <Badge variant="outline">Past</Badge>
                        : <Badge className="bg-success/10 text-success">Live</Badge>}
                    </td>
                    <td className="px-3 py-2 text-right text-destructive">{formatCurrency(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPayouts(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
