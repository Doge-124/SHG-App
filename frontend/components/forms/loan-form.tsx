'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
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
import type { Member, LoanFormData } from '@/lib/types'

const loanSchema = z.object({
  memberId: z.string().min(1, 'Please select a member'),
  amount: z.coerce.number().min(100, 'Minimum loan amount is Rs. 100'),
  interestRate: z.coerce.number().min(0, 'Interest rate must be 0 or higher').max(100, 'Interest rate cannot exceed 100%'),
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

export function LoanForm({
  open,
  onOpenChange,
  onSubmit,
  isLoading = false,
}: LoanFormProps) {
  const [members, setMembers] = useState<Member[]>([])
  const [loadingMembers, setLoadingMembers] = useState(true)

  const form = useForm<LoanFormData>({
    resolver: zodResolver(loanSchema),
    defaultValues: {
      memberId: '',
      amount: 0,
      interestRate: 12, // Default 12% annual interest
      paymentMethod: 'cash',
      loanType: 'monthly',
      note: '',
    },
  })

  // Watch form values for dynamic calculation
  const amount = Number(form.watch('amount')) || 0
  const interestRate = Number(form.watch('interestRate')) || 0
  const loanType = form.watch('loanType')

  // Calculate interest and total repayable
  const interestAmount = loanType === 'weekly'
    ? amount * (interestRate / 100) * (12 / 52) // 12 weeks term
    : amount * (interestRate / 100) // 12 months term
  const totalRepayable = amount + interestAmount

  useEffect(() => {
    async function loadMembers() {
      setLoadingMembers(true)
      try {
        const response = await getMembers()
        if (response.success && response.data) {
          setMembers(response.data.filter((m) =>
            m.status === 'active' &&
            (m.memberType === 'SHG' || m.memberType === 'LOAN')
          ))
        }
      } catch {
        console.error('Failed to load members')
      } finally {
        setLoadingMembers(false)
      }
    }
    if (open) {
      loadMembers()
    }
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
          <DialogDescription>
            Create a new loan for a group member.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="memberId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Member</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    disabled={loadingMembers}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a member" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {members.map((member) => (
                        <SelectItem key={member.id} value={member.id}>
                          {member.name} ({member.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Loan Amount (Rs.)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      placeholder="Enter amount"
                      min={100}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="interestRate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Interest Rate (% per year)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      placeholder="Enter interest rate"
                      min={0}
                      max={100}
                      step={0.5}
                      {...field}
                    />
                  </FormControl>
                  <p className="text-xs text-muted-foreground mt-1">
                    {loanType === 'weekly' ? '12 week term' : '12 month term'}
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            {amount > 0 && (
              <div className="rounded-lg bg-muted p-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Principal:</span>
                  <span className="font-medium">Rs. {amount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Interest ({interestRate}%):</span>
                  <span className="font-medium text-warning-foreground">Rs. {interestAmount.toFixed(2)}</span>
                </div>
                <div className="border-t pt-2 flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Repayable:</span>
                  <span className="font-semibold text-success-foreground">Rs. {totalRepayable.toFixed(2)}</span>
                </div>
              </div>
            )}

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

            <FormField
              control={form.control}
              name="loanType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Loan Type</FormLabel>
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
                      <SelectItem value="monthly">Monthly Loan</SelectItem>
                      <SelectItem value="weekly">Weekly Loan</SelectItem>
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
                    <Textarea
                      placeholder="Purpose of the loan"
                      className="resize-none"
                      rows={2}
                      {...field}
                    />
                  </FormControl>
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
                Issue Loan
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
