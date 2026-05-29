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
import { previewRepayment, type LoanPaymentPreview } from '@/lib/api/loans'
import type { Loan } from '@/lib/types'

interface RepaymentFormData {
  amount: number
  paymentMethod: 'cash' | 'bank'
}

interface RepaymentFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: RepaymentFormData) => Promise<void>
  loan: Loan | null
  isLoading?: boolean
}

const repaymentSchema = z.object({
  // Any positive amount is allowed. Backend rejects overpayment beyond
  // interest_due + outstanding; partial payments (less than interest due)
  // are accepted and the shortfall carries over to the next payment.
  amount: z.coerce.number().positive('Amount must be greater than 0'),
  paymentMethod: z.enum(['cash', 'bank']),
})

export function RepaymentForm({ open, onOpenChange, onSubmit, loan, isLoading = false }: RepaymentFormProps) {
  const [preview, setPreview] = useState<LoanPaymentPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)

  const form = useForm<RepaymentFormData>({
    resolver: zodResolver(repaymentSchema),
    defaultValues: { amount: 0, paymentMethod: 'cash' },
  })

  const amount = form.watch('amount')

  // Re-fetch preview whenever the amount or loan changes (with a small debounce).
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

  // When the dialog opens, suggest "interest only" as a starting amount —
  // gives the loan officer the smallest payment that keeps interest current.
  useEffect(() => {
    if (!open || !loan) return
    ;(async () => {
      // Fetch the current interest due by previewing a tiny payment.
      // We use 0.01 so the preview returns interest_due without rejecting.
      const r = await previewRepayment(loan.id, 0.01)
      const seed = r.success && r.data
        ? Math.round((r.data.interestDue + loan.outstandingAmount) * 100) / 100
        : loan.outstandingAmount
      form.reset({ amount: seed, paymentMethod: 'cash' })
    })()
  }, [open, loan?.id])

  const handleSubmit = async (data: RepaymentFormData) => {
    await onSubmit(data)
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
        </div>

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

            {previewError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-sm">{previewError}</AlertDescription>
              </Alert>
            )}

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
              <Button type="submit" disabled={isLoading || !!previewError}>
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
