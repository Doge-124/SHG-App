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
import { AlertTriangle, Coins } from 'lucide-react'
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription,
} from '@/components/ui/form'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { formatCurrency, formatDate } from '@/lib/format'
import {
  previewRepayment, previewPrepayInterest, prepayLoanInterest,
  type LoanPaymentPreview, type PrepayResult,
} from '@/lib/api/loans'
import {
  PaymentMethodFields, isPaymentSplitValid, paymentInvokeArgs,
  emptyPaymentSplit, type PaymentSplit,
} from '@/components/forms/payment-method-fields'
import type { Loan } from '@/lib/types'

export interface RepaymentSubmit {
  amount: number
  paymentMethod: string
  cashAmount: number | null
  bankAmount: number | null
  bankTxnId: string | null
  note: string
}

interface RepaymentFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: RepaymentSubmit) => Promise<void>
  loan: Loan | null
  isLoading?: boolean
  /** Called after a successful prepayment so the parent can refresh. */
  onPrepaid?: () => void
}

const repaymentSchema = z.object({
  amount: z.coerce.number().positive('Amount must be greater than 0'),
})

type Mode = 'repay' | 'prepay'

export function RepaymentForm({ open, onOpenChange, onSubmit, loan, isLoading = false, onPrepaid }: RepaymentFormProps) {
  const [mode, setMode] = useState<Mode>('repay')
  const [preview, setPreview] = useState<LoanPaymentPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [split, setSplit] = useState<PaymentSplit>(emptyPaymentSplit)
  // Prepay state
  const [prepay, setPrepay] = useState<PrepayResult | null>(null)
  const [prepayBusy, setPrepayBusy] = useState(false)

  const form = useForm<{ amount: number }>({
    resolver: zodResolver(repaymentSchema),
    defaultValues: { amount: 0 },
  })

  const amount = form.watch('amount')

  useEffect(() => {
    if (!open || !loan) { setPreview(null); setPreviewError(null); return }
    const parsed = Number(amount)
    if (!isFinite(parsed) || parsed <= 0) { setPreview(null); setPreviewError(null); return }
    setLoadingPreview(true)
    const t = setTimeout(async () => {
      const r = await previewRepayment(loan.id, parsed)
      if (r.success && r.data) { setPreview(r.data); setPreviewError(null) }
      else { setPreview(null); setPreviewError(r.error ?? 'Preview failed') }
      setLoadingPreview(false)
    }, 250)
    return () => { clearTimeout(t); setLoadingPreview(false) }
  }, [open, loan?.id, amount])

  // Seed amount = interest + outstanding on open; reset split + mode.
  useEffect(() => {
    if (!open || !loan) return
    setSplit(emptyPaymentSplit)
    setMode('repay')
    setPrepay(null)
    ;(async () => {
      const r = await previewRepayment(loan.id, 0.01)
      const seed = r.success && r.data
        ? Math.round((r.data.interestDue + loan.outstandingAmount) * 100) / 100
        : loan.outstandingAmount
      form.reset({ amount: seed })
    })()
  }, [open, loan?.id])

  // When switching to prepay mode, fetch the previewed prepayment.
  useEffect(() => {
    if (mode !== 'prepay' || !loan) return
    setSplit(emptyPaymentSplit)
    ;(async () => {
      const r = await previewPrepayInterest(loan.id)
      if (r.success && r.data) { setPrepay(r.data); setPreviewError(null) }
      else { setPrepay(null); setPreviewError(r.error ?? 'Could not compute prepayment') }
    })()
  }, [mode, loan?.id])

  const handleSubmit = async (data: { amount: number }) => {
    if (!loan) return
    if (!isPaymentSplitValid(split, data.amount)) {
      setPreviewError('Fix the cash/bank split — it must add up to the payment amount.')
      return
    }
    const args = paymentInvokeArgs(split)
    await onSubmit({
      amount: data.amount,
      ...args,
      note: 'Loan Repayment',
    })
    form.reset()
    setSplit(emptyPaymentSplit)
  }

  const handlePrepaySubmit = async () => {
    if (!loan || !prepay) return
    if (!isPaymentSplitValid(split, prepay.totalPaid)) {
      setPreviewError('Fix the cash/bank split — it must add up to the prepayment total.')
      return
    }
    setPrepayBusy(true)
    try {
      const args = paymentInvokeArgs(split)
      const r = await prepayLoanInterest(loan.id, {
        paymentMethod: args.paymentMethod,
        cashAmount: args.cashAmount,
        bankAmount: args.bankAmount,
        bankTxnId: args.bankTxnId,
      })
      if (r.success && r.data) {
        toast.success(`Interest prepaid — covered through ${formatDate(r.data.newPaidThrough)}`)
        onPrepaid?.()
        onOpenChange(false)
      } else {
        setPreviewError(r.error ?? 'Failed to prepay interest')
      }
    } finally {
      setPrepayBusy(false)
    }
  }

  if (!loan) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === 'prepay' ? 'Prepay Interest' : 'Record Loan Repayment'}</DialogTitle>
          <DialogDescription>
            {mode === 'prepay'
              ? `Pay one month of interest in advance for ${loan.memberName}'s loan.`
              : `Record a repayment for ${loan.memberName}'s loan.`}
          </DialogDescription>
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
        </div>

        {/* Mode toggle (monthly loans only offer prepay) */}
        {loan.loanType === 'monthly' && (
          <div className="flex gap-2">
            <Button type="button" size="sm" variant={mode === 'repay' ? 'default' : 'outline'}
              className="flex-1" onClick={() => { setMode('repay'); setPreviewError(null) }}>
              Repayment
            </Button>
            <Button type="button" size="sm" variant={mode === 'prepay' ? 'default' : 'outline'}
              className="flex-1" onClick={() => { setMode('prepay'); setPreviewError(null) }}>
              <Coins className="h-3.5 w-3.5 mr-1" />Prepay 1 month interest
            </Button>
          </div>
        )}

        {previewError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-sm">{previewError}</AlertDescription>
          </Alert>
        )}

        {mode === 'prepay' ? (
          <div className="space-y-4">
            {!prepay ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Spinner className="h-3 w-3" /> Calculating…
              </div>
            ) : (
              <div className="rounded-lg border p-3 space-y-1.5 text-sm">
                {prepay.arrearsCleared > 0.005 && (
                  <div className="flex justify-between text-orange-600">
                    <span>Interest accrued so far</span>
                    <span className="font-semibold">{formatCurrency(prepay.arrearsCleared)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">+ 30 days interest (advance)</span>
                  <span className="font-medium">{formatCurrency(prepay.monthInterest)}</span>
                </div>
                <Separator />
                <div className="flex justify-between font-semibold">
                  <span>Total to pay now</span>
                  <span>{formatCurrency(prepay.totalPaid)}</span>
                </div>
                <div className="flex justify-between text-green-700">
                  <span>Interest covered through</span>
                  <span className="font-medium">{formatDate(prepay.newPaidThrough)}</span>
                </div>
                <p className="text-[11px] text-muted-foreground pt-1">
                  No further interest accrues until that date. Principal is unchanged.
                </p>
              </div>
            )}

            <PaymentMethodFields
              total={prepay?.totalPaid ?? 0}
              value={split}
              onChange={setSplit}
              idPrefix="prepay"
            />

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={prepayBusy}>
                Cancel
              </Button>
              <Button type="button" onClick={handlePrepaySubmit} disabled={prepayBusy || !prepay}>
                {prepayBusy && <Spinner className="mr-2 h-4 w-4" />}
                Pay {prepay ? formatCurrency(prepay.totalPaid) : ''}
              </Button>
            </div>
          </div>
        ) : (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Repayment Amount (Rs.)</FormLabel>
                  <FormControl>
                    <Input type="number" placeholder="Enter amount" min={0.01} step="0.01" {...field} />
                  </FormControl>
                  <FormDescription>
                    Any positive amount accepted. Goes to interest first, then principal.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {loadingPreview && !preview && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Spinner className="h-3 w-3" /> Calculating split…
              </div>
            )}

            {preview && !previewError && (
              <div className="rounded-lg border p-3 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Interest due today</span>
                  <span className="font-medium">{formatCurrency(preview.interestDue)}</span>
                </div>
                <Separator />
                <div className="flex justify-between text-orange-600">
                  <span>→ Pays interest</span>
                  <span className="font-semibold">{formatCurrency(preview.interestPortion)}</span>
                </div>
                <div className="flex justify-between text-green-700">
                  <span>→ Pays principal</span>
                  <span className="font-semibold">{formatCurrency(preview.principalPortion)}</span>
                </div>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Remaining outstanding</span>
                  <span className="font-medium">{formatCurrency(preview.newOutstanding)}</span>
                </div>
                {preview.newUnpaidInterest > 0.005 && (
                  <div className="flex justify-between text-amber-700">
                    <span>Interest carrying over</span>
                    <span className="font-medium">{formatCurrency(preview.newUnpaidInterest)}</span>
                  </div>
                )}
              </div>
            )}

            <PaymentMethodFields
              total={Number(amount) || 0}
              value={split}
              onChange={setSplit}
              idPrefix="repay"
            />

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading || !!previewError}>
                {isLoading && <Spinner className="mr-2 h-4 w-4" />}
                Record Payment
              </Button>
            </div>
          </form>
        </Form>
        )}
      </DialogContent>
    </Dialog>
  )
}
