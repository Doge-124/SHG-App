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
import { MemberTypeTag } from '@/components/member-type-tag'
import { invoke } from '@tauri-apps/api/core'
import { getMembers } from '@/lib/api/members'
import { formatCurrency } from '@/lib/format'
import {
  PaymentMethodFields, isPaymentSplitValid, paymentInvokeArgs, emptyPaymentSplit, type PaymentSplit,
} from '@/components/forms/payment-method-fields'
import { toast } from 'sonner'
import type { Member, VoucherFormData } from '@/lib/types'

/** Special voucher reason that withdraws a member's accrued savings. */
export const SAVINGS_PAYOUT_REASON = 'Member savings payout'

// Payment method is handled by the PaymentMethodFields component (cash/bank/
// mixed) outside RHF, so it's not in this schema.
const voucherSchema = z.object({
  isExternal: z.boolean().default(false),
  memberId: z.string().optional(),
  payee: z.string().optional(),
  amount: z.coerce.number().min(1, 'Amount must be at least Rs. 1'),
  reasonType: z.string().min(2, 'Reason is required'),
  customReason: z.string().optional(),
  reference: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.isExternal) {
    if (!data.payee || data.payee.trim().length < 2) {
      ctx.addIssue({ path: ['payee'], code: z.ZodIssueCode.custom, message: 'Enter who the voucher is paid to' })
    }
  } else if (!data.memberId) {
    ctx.addIssue({ path: ['memberId'], code: z.ZodIssueCode.custom, message: 'Please select a member' })
  }
})

// Preset reasons for vouchers
const voucherReasons = [
  SAVINGS_PAYOUT_REASON,
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
  const [savings, setSavings] = useState<number | null>(null)
  const [paySplit, setPaySplit] = useState<PaymentSplit>(emptyPaymentSplit)

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
      isExternal: false,
      memberId: '',
      payee: '',
      amount: 0,
      reasonType: '',
      customReason: '',
      reference: '',
    },
  })

  const amount = Number(form.watch('amount')) || 0
  const memberId = form.watch('memberId')
  const isExternal = form.watch('isExternal')
  // Savings payout only applies to members; never for an external voucher.
  const isPayout = !isExternal && selectedReason === SAVINGS_PAYOUT_REASON
  // External vouchers can't pay out a member's savings, so hide that reason.
  const reasonOptions = isExternal
    ? voucherReasons.filter((r) => r !== SAVINGS_PAYOUT_REASON)
    : voucherReasons

  // When paying out savings, look up the member's available balance.
  useEffect(() => {
    if (!isPayout || !memberId) { setSavings(null); return }
    let cancelled = false
    invoke<number>('member_balance', { memberId: parseInt(memberId) })
      .then(bal => { if (!cancelled) setSavings(bal) })
      .catch(() => { if (!cancelled) setSavings(null) })
    return () => { cancelled = true }
  }, [isPayout, memberId])

  const handleSubmit = async (data: VoucherFormData) => {
    if (!isPaymentSplitValid(paySplit, amount)) {
      toast.error('For a mixed payment, cash + bank must equal the amount')
      return
    }
    const pay = paymentInvokeArgs(paySplit)
    const finalData: VoucherFormData = {
      ...data,
      // For an external voucher there's no member; clear it so the backend
      // records a member-less GENERAL_VOUCHER.
      memberId: data.isExternal ? '' : (data.memberId ?? ''),
      paymentMethod: paySplit.method,
      cashAmount: paySplit.method === 'mixed' ? paySplit.cashAmount : undefined,
      bankAmount: paySplit.method === 'mixed' ? paySplit.bankAmount : undefined,
      bankTxnId: pay.bankTxnId ?? undefined,
    }
    await onSubmit(finalData)
    form.reset()
    setSelectedReason('')
    setSavings(null)
    setPaySplit(emptyPaymentSplit)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Voucher</DialogTitle>
          <DialogDescription>
            Record money paid to a member, or an external (general) voucher for an
            SHG purchase paid to an outside vendor.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            {/* Voucher type: member vs external/general. */}
            <FormField
              control={form.control}
              name="isExternal"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Voucher Type</FormLabel>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant={!field.value ? 'default' : 'outline'}
                      onClick={() => {
                        field.onChange(false)
                        // Clear external-only state and any payout reason.
                        form.setValue('payee', '')
                        form.clearErrors(['payee', 'memberId'])
                      }}
                    >
                      Member
                    </Button>
                    <Button
                      type="button"
                      variant={field.value ? 'default' : 'outline'}
                      onClick={() => {
                        field.onChange(true)
                        form.setValue('memberId', '')
                        if (selectedReason === SAVINGS_PAYOUT_REASON) {
                          setSelectedReason('')
                          form.setValue('reasonType', '')
                        }
                        setSavings(null)
                        form.clearErrors(['payee', 'memberId'])
                      }}
                    >
                      External / General
                    </Button>
                  </div>
                </FormItem>
              )}
            />

            {isExternal ? (
              <FormField
                control={form.control}
                name="payee"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Paid To (vendor / entity)</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. ABC Stationers" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : (
              <FormField
                control={form.control}
                name="memberId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Member</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
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
                              {member.name} ({member.code})<MemberTypeTag type={member.memberType} />
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

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
                  {isPayout && savings !== null && (
                    <p className="text-xs text-muted-foreground">
                      Available savings: <span className="font-medium">{formatCurrency(savings)}</span>
                      {savings > 0 && (
                        <button
                          type="button"
                          className="ml-2 text-primary underline"
                          onClick={() => form.setValue('amount', savings, { shouldValidate: true })}
                        >
                          Withdraw all
                        </button>
                      )}
                    </p>
                  )}
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
                      {reasonOptions.map((reason) => (
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

            <PaymentMethodFields
              total={amount}
              value={paySplit}
              onChange={setPaySplit}
              idPrefix="voucher"
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
