'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertTriangle } from 'lucide-react'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@/components/ui/form'
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
import { formatCurrency } from '@/lib/format'
import { getLoanRepayments, calculateAccruedInterest, calculateWeeklyFine } from '@/lib/api/loans'
import type { Loan } from '@/lib/types'

interface RepaymentFormData {
  amount: number
  paymentMethod: 'cash' | 'bank'
}

interface RepaymentFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: RepaymentFormData & { interestAmount: number }) => Promise<void>
  loan: Loan | null
  isLoading?: boolean
}

export function RepaymentForm({ open, onOpenChange, onSubmit, loan, isLoading = false }: RepaymentFormProps) {
  const [lastPaymentAt, setLastPaymentAt] = useState<string | null>(null)
  const [loadingHistory, setLoadingHistory] = useState(false)

  useEffect(() => {
    if (!open || !loan) return
    setLoadingHistory(true)
    getLoanRepayments(loan.id).then(res => {
      if (res.success && res.data && res.data.length > 0) {
        const sorted = [...res.data].sort((a, b) => b.paidAt.localeCompare(a.paidAt))
        setLastPaymentAt(sorted[0].paidAt)
      } else {
        setLastPaymentAt(null)
      }
    }).finally(() => setLoadingHistory(false))
  }, [open, loan?.id])

  const { accruedInterest, daysAccruing } = loan
    ? calculateAccruedInterest(loan, lastPaymentAt)
    : { accruedInterest: 0, daysAccruing: 0 }

  const fine = loan?.loanType === 'weekly'
    ? calculateWeeklyFine(loan.outstandingAmount, loan.issuedAt)
    : 0

  const daysOverdue = loan?.loanType === 'weekly'
    ? Math.max(0, Math.floor((Date.now() - new Date(loan.issuedAt).getTime()) / 86400000) - 120)
    : 0

  const totalDue = (loan?.outstandingAmount ?? 0) + accruedInterest + fine

  const repaymentSchema = z.object({
    amount: z.coerce.number().min(1, 'Amount must be at least Rs. 1'),
    paymentMethod: z.enum(['cash', 'bank']),
  })

  const form = useForm<RepaymentFormData>({
    resolver: zodResolver(repaymentSchema),
    defaultValues: {
      amount: Math.round(totalDue * 100) / 100,
      paymentMethod: 'cash',
    },
  })

  // Re-sync default amount when accrued interest loads
  useEffect(() => {
    if (!loadingHistory) {
      form.setValue('amount', Math.round(totalDue * 100) / 100)
    }
  }, [loadingHistory, totalDue])

  const handleSubmit = async (data: RepaymentFormData) => {
    await onSubmit({ ...data, interestAmount: accruedInterest })
    form.reset()
  }

  if (!loan) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record Loan Repayment</DialogTitle>
          <DialogDescription>Record a repayment for {loan.memberName}&apos;s loan.</DialogDescription>
        </DialogHeader>

        <div className="rounded-lg bg-muted p-4 space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-muted-foreground">Principal</p>
              <p className="font-medium">{formatCurrency(loan.amount)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Daily Interest</p>
              <p className="font-medium">{loan.dailyInterestRate}%/day</p>
            </div>
          </div>

          <Separator />

          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Outstanding Principal</span>
            <span className="font-semibold">{formatCurrency(loan.outstandingAmount)}</span>
          </div>

          {loadingHistory ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Spinner className="h-3 w-3" />
              <span className="text-xs">Calculating interest…</span>
            </div>
          ) : accruedInterest > 0 ? (
            <div className="flex justify-between items-center text-orange-600">
              <span>Accrued Interest ({daysAccruing} days)</span>
              <span className="font-semibold">+ {formatCurrency(accruedInterest)}</span>
            </div>
          ) : (
            <div className="flex justify-between items-center text-muted-foreground text-xs">
              <span>No interest accrued yet (within first {loan.loanType === 'weekly' ? 100 : 30} days)</span>
            </div>
          )}

          {fine > 0 && (
            <div className="flex justify-between items-center text-destructive">
              <span>Fine ({daysOverdue} days overdue)</span>
              <span className="font-semibold">+ {formatCurrency(fine)}</span>
            </div>
          )}

          <Separator />

          <div className="flex justify-between items-center font-bold">
            <span>Total Due</span>
            <span className={fine > 0 ? 'text-destructive' : 'text-orange-600'}>
              {formatCurrency(totalDue)}
            </span>
          </div>
        </div>

        {accruedInterest > 0 && (
          <Alert>
            <AlertDescription className="text-xs text-muted-foreground">
              Interest on principal: {formatCurrency(loan.amount)} × {loan.dailyInterestRate}%/day × {daysAccruing} days = {formatCurrency(accruedInterest)}
              {lastPaymentAt ? ` (since last payment)` : ` (since day 30)`}
            </AlertDescription>
          </Alert>
        )}

        {fine > 0 && (
          <Alert className="border-destructive/50">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <AlertDescription className="text-sm">
              Weekly loan overdue by {daysOverdue} days.
              Fine = (7% of {formatCurrency(loan.outstandingAmount)}) ÷ 100 × {daysOverdue} days
              = {formatCurrency(loan.outstandingAmount * 0.07)} ÷ 100 × {daysOverdue}
              = {formatCurrency(fine)}
            </AlertDescription>
          </Alert>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Repayment Amount (Rs.)</FormLabel>
                  <FormControl>
                    <Input type="number" placeholder="Enter amount" min={1} step="0.01" {...field} />
                  </FormControl>
                  <FormDescription>
                    Principal: {formatCurrency(loan.outstandingAmount)}
                    {accruedInterest > 0 && ` + Interest: ${formatCurrency(accruedInterest)}`}
                    {fine > 0 && ` + Fine: ${formatCurrency(fine)}`}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="paymentMethod"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Payment Method</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="bank">Bank Transfer</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading || loadingHistory}>
                {isLoading && <Spinner className="mr-2 h-4 w-4" />}
                Record Payment
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
