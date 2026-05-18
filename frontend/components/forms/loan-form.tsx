'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
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
import { getMembers } from '@/lib/api/members'
import { formatCurrency } from '@/lib/format'
import type { Member, LoanFormData } from '@/lib/types'

const loanSchema = z.object({
  memberId: z.string().min(1, 'Please select a member'),
  amount: z.coerce.number().min(100, 'Minimum loan amount is Rs. 100'),
  dailyInterestRate: z.coerce.number().min(0, 'Rate must be 0 or higher').max(10, 'Daily rate cannot exceed 10%'),
  paymentMethod: z.enum(['cash', 'bank']),
  loanType: z.enum(['monthly', 'weekly']),
  note: z.string().optional(),
})

interface LoanFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: LoanFormData) => Promise<void>
  isLoading?: boolean
}

export function LoanForm({ open, onOpenChange, onSubmit, isLoading = false }: LoanFormProps) {
  const [members, setMembers] = useState<Member[]>([])
  const [loadingMembers, setLoadingMembers] = useState(true)

  const form = useForm<LoanFormData>({
    resolver: zodResolver(loanSchema),
    defaultValues: {
      memberId: '',
      amount: 0,
      dailyInterestRate: 0.06,
      paymentMethod: 'cash',
      loanType: 'monthly',
      note: '',
    },
  })

  const amount = Number(form.watch('amount')) || 0
  const dailyInterestRate = Number(form.watch('dailyInterestRate')) || 0
  const loanType = form.watch('loanType')

  const upfrontDays = loanType === 'weekly' ? 100 : 30
  const upfrontInterest = Math.round(amount * dailyInterestRate / 100 * upfrontDays * 100) / 100
  const borrowerReceives = amount - upfrontInterest
  const dailyInterestAmount = Math.round(amount * dailyInterestRate / 100 * 100) / 100

  useEffect(() => {
    if (!open) return
    setLoadingMembers(true)
    getMembers().then(res => {
      if (res.success && res.data) {
        setMembers(res.data.filter(m =>
          m.status === 'active' && (m.memberType === 'SHG' || m.memberType === 'LOAN')
        ))
      }
    }).finally(() => setLoadingMembers(false))
  }, [open])

  const handleSubmit = async (data: LoanFormData) => {
    await onSubmit(data)
    form.reset()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Issue New Loan</DialogTitle>
          <DialogDescription>Create a new loan for a group member.</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="memberId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Member</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value} disabled={loadingMembers}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a member" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {members.map(m => (
                        <SelectItem key={m.id} value={m.id}>{m.name} ({m.code})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="loanType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Loan Type</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="monthly">Monthly (open-ended)</SelectItem>
                      <SelectItem value="weekly">Weekly (100-day term, 20-day grace)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Loan Amount (Rs.)</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="Amount" min={100} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="dailyInterestRate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Daily Interest (%/day)</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="e.g. 0.06" min={0} max={10} step={0.01} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {amount > 0 && (
              <div className="rounded-lg bg-muted p-3 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Loan Amount:</span>
                  <span className="font-medium">{formatCurrency(amount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Daily Interest:</span>
                  <span className="font-medium">{formatCurrency(dailyInterestAmount)}/day</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Upfront Interest ({upfrontDays} days):</span>
                  <span className="font-medium text-orange-600">− {formatCurrency(upfrontInterest)}</span>
                </div>
                <Separator />
                <div className="flex justify-between font-semibold">
                  <span>Borrower Receives:</span>
                  <span className="text-green-700">{formatCurrency(borrowerReceives)}</span>
                </div>
                {loanType === 'weekly' && (
                  <p className="text-xs text-muted-foreground pt-1">
                    Fine starts after 120 days: outstanding × 0.07% × days overdue
                  </p>
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

            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Note (Optional)</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Purpose of the loan" className="resize-none" rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading && <Spinner className="mr-2 h-4 w-4" />}
                Issue Loan
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
