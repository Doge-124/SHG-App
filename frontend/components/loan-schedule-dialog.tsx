'use client'

import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Separator } from '@/components/ui/separator'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { formatCurrency, formatDate } from '@/lib/format'
import {
  CalendarClock, CheckCircle2, AlertTriangle, Clock, ArrowDownLeft,
  Banknote, TrendingUp, Info,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface ScheduleEntry {
  date: string
  label: string
  entryType: string
  daysElapsed: number
  daysAfterUpfront: number
  interestAccrued: number
  projectedOutstanding: number
  dailyInterest: number
  isPast: boolean
  isOverdue: boolean
  paymentAmount: number
  paymentMethod: string
}

interface LoanRepaymentSchedule {
  loanId: number
  memberName: string
  principal: number
  dailyRate: number
  dailyInterest: number
  loanType: string
  issuedAt: string
  upfrontDays: number
  upfrontEndDate: string
  upfrontInterest: number
  outstandingAtIssue: number
  dueDate: string | null
  currentOutstanding: number
  totalRepaid: number
  status: string
  entries: ScheduleEntry[]
}

interface Props {
  loanId: number | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function entryIcon(type: string, overdue: boolean) {
  if (type === 'payment') return <ArrowDownLeft className="h-3.5 w-3.5 text-green-600" />
  if (type === 'issued') return <Banknote className="h-3.5 w-3.5 text-blue-600" />
  if (type === 'due_date') return overdue
    ? <AlertTriangle className="h-3.5 w-3.5 text-red-600" />
    : <CalendarClock className="h-3.5 w-3.5 text-orange-500" />
  if (type === 'today') return <Clock className="h-3.5 w-3.5 text-primary" />
  if (type === 'upfront_end') return <TrendingUp className="h-3.5 w-3.5 text-purple-500" />
  return <Info className="h-3.5 w-3.5 text-muted-foreground" />
}

function rowClass(entry: ScheduleEntry) {
  if (entry.entryType === 'today') return 'bg-blue-50 font-medium'
  if (entry.entryType === 'due_date' && entry.isOverdue) return 'bg-red-50'
  if (entry.entryType === 'due_date') return 'bg-orange-50'
  if (entry.entryType === 'payment') return 'bg-green-50'
  if (entry.entryType === 'issued') return 'bg-slate-50'
  if (entry.entryType === 'upfront_end') return 'bg-purple-50/30'
  if (!entry.isPast) return 'text-muted-foreground'
  return ''
}

export function LoanScheduleDialog({ loanId, open, onOpenChange }: Props) {
  const [schedule, setSchedule] = useState<LoanRepaymentSchedule | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (open && loanId !== null) {
      setIsLoading(true)
      invoke<LoanRepaymentSchedule>('get_loan_repayment_schedule', { loanId })
        .then(s => setSchedule(s))
        .catch(err => toast.error(err?.toString() || 'Failed to load schedule'))
        .finally(() => setIsLoading(false))
    } else {
      setSchedule(null)
    }
  }, [open, loanId])

  const s = schedule

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5" />
            Repayment Schedule
            {s && <span className="text-muted-foreground font-normal text-sm">— {s.memberName}</span>}
          </DialogTitle>
        </DialogHeader>

        {isLoading && (
          <div className="flex justify-center py-12">
            <Spinner className="h-8 w-8" />
          </div>
        )}

        {!isLoading && s && (
          <div className="flex flex-col gap-4 overflow-y-auto">

            {/* Loan summary */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm">
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Principal</p>
                <p className="font-semibold">{formatCurrency(s.principal)}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Daily Rate</p>
                <p className="font-semibold">{s.dailyRate}% <span className="text-muted-foreground font-normal">({formatCurrency(s.dailyInterest)}/day)</span></p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Upfront Interest</p>
                <p className="font-semibold">{formatCurrency(s.upfrontInterest)}
                  <span className="text-muted-foreground font-normal text-xs ml-1">({s.upfrontDays}d)</span>
                </p>
              </div>
              <div className={cn('rounded-lg p-3', s.currentOutstanding > 0 ? 'bg-orange-50 border border-orange-200' : 'bg-green-50 border border-green-200')}>
                <p className="text-xs text-muted-foreground">Current Outstanding</p>
                <p className={cn('font-bold', s.currentOutstanding > 0 ? 'text-orange-700' : 'text-green-700')}>
                  {formatCurrency(s.currentOutstanding)}
                </p>
              </div>
            </div>

            {/* Key dates strip */}
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline" className="gap-1">
                <Banknote className="h-3 w-3" />
                Issued: {formatDate(s.issuedAt)}
              </Badge>
              <Badge variant="outline" className="gap-1 border-purple-300 text-purple-700">
                <TrendingUp className="h-3 w-3" />
                Upfront ends: {formatDate(s.upfrontEndDate)}
              </Badge>
              {s.dueDate && (
                <Badge variant="outline" className={cn('gap-1', new Date(s.dueDate) < new Date() ? 'border-red-400 text-red-700' : 'border-orange-400 text-orange-700')}>
                  <CalendarClock className="h-3 w-3" />
                  Due: {formatDate(s.dueDate)}
                </Badge>
              )}
              {(s.totalRepaid + s.upfrontInterest) > 0 && (
                <Badge variant="outline" className="gap-1 border-green-400 text-green-700">
                  <CheckCircle2 className="h-3 w-3" />
                  Total Paid: {formatCurrency(s.totalRepaid + s.upfrontInterest)}
                  {s.upfrontInterest > 0 && (
                    <span className="font-normal opacity-80 ml-1">
                      (incl. {formatCurrency(s.upfrontInterest)} upfront)
                    </span>
                  )}
                </Badge>
              )}
              <Badge variant={s.status === 'active' ? 'default' : 'secondary'} className={cn(s.status === 'paid' && 'bg-green-100 text-green-700')}>
                {s.status}
              </Badge>
            </div>

            {/* Interest note */}
            <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground space-y-1">
              <p>
                <strong>Interest accrual:</strong> {formatCurrency(s.dailyInterest)}/day on principal
                after the {s.upfrontDays}-day upfront period.
                Projected outstanding = original outstanding + cumulative interest (before repayments).
              </p>
              {s.loanType === 'weekly' && s.dueDate && (
                <p>
                  <strong>Fine:</strong> After due date, outstanding × 7%/100 per overdue day applies.
                </p>
              )}
            </div>

            <Separator />

            {/* Schedule table */}
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 text-xs">
                    <TableHead className="w-7" />
                    <TableHead>Date</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead className="text-right">Days</TableHead>
                    <TableHead className="text-right">Interest Accrued</TableHead>
                    <TableHead className="text-right">Projected Outstanding</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.entries.map((entry, idx) => (
                    <TableRow key={idx} className={cn('text-sm', rowClass(entry))}>
                      <TableCell className="pl-3">
                        {entryIcon(entry.entryType, entry.isOverdue)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs">
                        {formatDate(entry.date)}
                      </TableCell>
                      <TableCell>
                        <span className="font-medium">{entry.label}</span>
                        {entry.entryType === 'payment' && (
                          <span className="ml-2 text-green-700 font-semibold">
                            −{formatCurrency(entry.paymentAmount)}
                          </span>
                        )}
                        {entry.entryType === 'today' && (
                          <Badge variant="default" className="ml-2 text-xs h-5">Today</Badge>
                        )}
                        {entry.entryType === 'due_date' && entry.isOverdue && (
                          <Badge variant="destructive" className="ml-2 text-xs h-5">Overdue</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {entry.daysElapsed}
                      </TableCell>
                      <TableCell className="text-right">
                        {entry.entryType === 'issued' ? (
                          <span className="text-muted-foreground text-xs">
                            {formatCurrency(s.upfrontInterest)} upfront (paid)
                          </span>
                        ) : entry.entryType === 'payment' || entry.daysAfterUpfront === 0 ? (
                          // Interest Accrued is a projection (assumes no repayments),
                          // so it's meaningless on an actual payment row — show "—"
                          // to match the Projected Outstanding column.
                          <span className="text-muted-foreground text-xs">—</span>
                        ) : (
                          <span className={cn('font-medium', entry.isOverdue && 'text-red-600')}>
                            {formatCurrency(entry.interestAccrued)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {entry.entryType === 'payment' ? (
                          <span className="text-muted-foreground text-xs">—</span>
                        ) : (
                          <span className={cn(
                            entry.isOverdue && 'text-red-600',
                            entry.entryType === 'today' && 'text-primary',
                          )}>
                            {formatCurrency(entry.projectedOutstanding)}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {s.loanType === 'monthly' && (
              <p className="text-xs text-muted-foreground">
                Monthly loans are open-ended — no fixed due date. Interest accrues daily after the 30-day upfront period.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
