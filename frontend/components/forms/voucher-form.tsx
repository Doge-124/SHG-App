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
import type { Member, VoucherFormData } from '@/lib/types'

const voucherSchema = z.object({
  memberId: z.string().min(1, 'Please select a member'),
  amount: z.coerce.number().min(1, 'Amount must be at least Rs. 1'),
  reasonType: z.string().min(2, 'Reason is required'),
  customReason: z.string().optional(),
  paymentMethod: z.enum(['cash', 'bank']),
  reference: z.string().optional(),
})

// Preset reasons for vouchers
const voucherReasons = [
  'Office supplies',
  'Administrative expenses',
  'Bank charges',
  'Stationery',
  'Printing costs',
  'Travel expenses',
  'Telephone bills',
  'Internet bills',
  'Electricity bills',
  'Water bills',
  'Rent expenses',
  'Maintenance expenses',
  'Refreshment expenses',
  'Meeting expenses',
  'Other'
]

interface VoucherFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: VoucherFormData) => Promise<void>
  isLoading?: boolean
}

export function VoucherForm({
  open,
  onOpenChange,
  onSubmit,
  isLoading = false,
}: VoucherFormProps) {
  const [members, setMembers] = useState<Member[]>([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [selectedReason, setSelectedReason] = useState('')

  useEffect(() => {
    const loadMembers = async () => {
      setLoadingMembers(true)
      try {
        const response = await getMembers()
        if (response.success && response.data) {
          setMembers(response.data.filter(m => m.status === 'active'))
        }
      } catch (error) {
        console.error('Failed to load members:', error)
      } finally {
        setLoadingMembers(false)
      }
    }

    if (open) {
      loadMembers()
    }
  }, [open])

  const form = useForm<VoucherFormData>({
    resolver: zodResolver(voucherSchema),
    defaultValues: {
      memberId: '',
      amount: 0,
      reasonType: '',
      customReason: '',
      paymentMethod: 'cash',
      reference: '',
    },
  })

  const paymentMethod = form.watch('paymentMethod')

  const handleSubmit = async (data: VoucherFormData) => {
    await onSubmit(data)
    form.reset()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Voucher</DialogTitle>
          <DialogDescription>
            Record money paid to a member or spent on behalf of a member.
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
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a member" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {loadingMembers ? (
                        <SelectItem value="loading" disabled>Loading members...</SelectItem>
                      ) : members.length === 0 ? (
                        <SelectItem value="none" disabled>No active members found</SelectItem>
                      ) : (
                        members.map((member) => (
                          <SelectItem key={member.id} value={member.id}>
                            {member.name} ({member.code})
                          </SelectItem>
                        ))
                      )}
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
                  <FormLabel>Amount (Rs.)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      placeholder="Enter amount"
                      min={1}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="reasonType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason</FormLabel>
                  <Select
                    onValueChange={(value) => {
                      setSelectedReason(value)
                      field.onChange(value)
                    }}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a reason" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {voucherReasons.map((reason) => (
                        <SelectItem key={reason} value={reason}>
                          {reason}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {selectedReason === 'Other' && (
              <FormField
                control={form.control}
                name="customReason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Custom Description</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Enter custom description"
                        className="resize-none"
                        rows={2}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="paymentMethod"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Payment Method</FormLabel>
                  <Select
                    onValueChange={(v) => field.onChange(v)}
                    value={field.value}
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

            {paymentMethod === 'bank' && (
              <FormField
                control={form.control}
                name="bankTxnId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bank Transaction ID (optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="UTR / cheque / reference no." maxLength={64} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading} variant="destructive">
                {isLoading && <Spinner className="mr-2 h-4 w-4" />}
                Create Voucher
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
