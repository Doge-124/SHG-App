'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
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

export function RepaymentForm({
  open,
  onOpenChange,
  onSubmit,
  loan,
  isLoading = false,
}: RepaymentFormProps) {
  const repaymentSchema = z.object({
    amount: z.coerce
      .number()
      .min(1, 'Amount must be at least Rs. 1')
      .max(loan?.outstandingAmount ?? 0, `Amount cannot exceed ${formatCurrency(loan?.outstandingAmount ?? 0)}`),
    paymentMethod: z.enum(['cash', 'bank']),
  })

  const form = useForm<RepaymentFormData>({
    resolver: zodResolver(repaymentSchema),
    defaultValues: {
      amount: loan?.outstandingAmount ?? 0,
      paymentMethod: 'cash',
    },
  })

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
          <DialogDescription>
            Record a repayment for {loan.memberName}&apos;s loan.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg bg-muted p-4 mb-4 space-y-3">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Principal</p>
              <p className="font-medium">{formatCurrency(loan.amount)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Interest Rate</p>
              <p className="font-medium">{loan.interestRate}%</p>
            </div>
          </div>
          {loan.interestAmount > 0 && (
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Interest Amount</p>
                <p className="font-medium text-warning-foreground">
                  {formatCurrency(loan.interestAmount)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Total Repayable</p>
                <p className="font-medium">{formatCurrency(loan.totalRepayable)}</p>
              </div>
            </div>
          )}
          <div className="border-t pt-2">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground text-sm">Current Outstanding</span>
              <span className="font-semibold text-warning-foreground text-lg">
                {formatCurrency(loan.outstandingAmount)}
              </span>
            </div>
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
                    <Input
                      type="number"
                      placeholder="Enter amount"
                      min={1}
                      max={loan.outstandingAmount}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Maximum: {formatCurrency(loan.outstandingAmount)}
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
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
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

            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading}>
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
