'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
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
import { formatCurrency } from '@/lib/format'
import type { ChitGroupFormData } from '@/lib/types'

const chitGroupSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  totalAmount: z.coerce.number().min(1000, 'Minimum prize amount is Rs. 1,000'),
  monthlyContribution: z.coerce.number().min(100, 'Minimum contribution is Rs. 100'),
  totalMembers: z.coerce.number().min(2, 'Minimum 2 members').max(500, 'Maximum 500 members'),
  durationMonths: z.coerce.number().min(1, 'Minimum 1 month').max(360, 'Maximum 360 months'),
  winnersPerCycle: z.coerce.number().min(1, 'At least 1 winner per cycle').max(10, 'Maximum 10 winners per cycle'),
  commissionPerWinner: z.coerce.number().min(0, 'Commission cannot be negative'),
  startDate: z.string().min(1, 'Start date is required'),
})

interface ChitGroupFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: ChitGroupFormData) => Promise<void>
  isLoading?: boolean
}

export function ChitGroupForm({ open, onOpenChange, onSubmit, isLoading = false }: ChitGroupFormProps) {
  const form = useForm<ChitGroupFormData>({
    resolver: zodResolver(chitGroupSchema),
    defaultValues: {
      name: '',
      totalAmount: 100000,
      monthlyContribution: 5000,
      totalMembers: 20,
      durationMonths: 20,
      winnersPerCycle: 1,
      commissionPerWinner: 0,
      startDate: '',
    },
  })

  const totalAmount = form.watch('totalAmount') || 0
  const monthlyContribution = form.watch('monthlyContribution') || 0
  const totalMembers = form.watch('totalMembers') || 0
  const winnersPerCycle = form.watch('winnersPerCycle') || 1
  const commissionPerWinner = form.watch('commissionPerWinner') || 0

  const totalPool = totalMembers * monthlyContribution
  const fixedWinnerPayout = totalAmount - commissionPerWinner
  const totalCycles = Math.floor(totalMembers / winnersPerCycle)

  const handleSubmit = async (data: ChitGroupFormData) => {
    await onSubmit(data)
    form.reset()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Chit Group</DialogTitle>
          <DialogDescription>Set up a new configurable chit fund group.</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Group Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Golden Savings Chit" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="totalMembers"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Total Members (N)</FormLabel>
                    <FormControl><Input type="number" min={2} max={500} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="monthlyContribution"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contribution per Member (C)</FormLabel>
                    <FormControl><Input type="number" min={100} {...field} /></FormControl>
                    <FormDescription>Per member per cycle</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="totalAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fixed Prize Amount (P)</FormLabel>
                    <FormControl><Input type="number" min={1000} {...field} /></FormControl>
                    <FormDescription>Prize each winner is eligible for</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="commissionPerWinner"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Commission per Winner (F)</FormLabel>
                    <FormControl><Input type="number" min={0} step="0.01" {...field} /></FormControl>
                    <FormDescription>SHG keeps this per winner</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="winnersPerCycle"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Winners per Cycle (W)</FormLabel>
                    <FormControl><Input type="number" min={1} max={10} {...field} /></FormControl>
                    <FormDescription>1 fixed + (W-1) auction</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="durationMonths"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Duration (Months)</FormLabel>
                    <FormControl><Input type="number" min={1} max={360} {...field} /></FormControl>
                    <FormDescription>Typically = floor(N ÷ W) = {totalCycles}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {totalMembers > 0 && monthlyContribution > 0 && (
              <div className="rounded-lg bg-muted p-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total pool per cycle (N × C):</span>
                  <span className="font-medium">{formatCurrency(totalPool)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Fixed winner gets (P − F):</span>
                  <span className="font-medium">{formatCurrency(fixedWinnerPayout)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total cycles (floor(N ÷ W)):</span>
                  <span className="font-medium">{totalCycles}</span>
                </div>
                {totalMembers % winnersPerCycle !== 0 && (
                  <div className="flex justify-between text-orange-600">
                    <span>Remaining members after {totalCycles} cycles:</span>
                    <span className="font-medium">{totalMembers % winnersPerCycle}</span>
                  </div>
                )}
              </div>
            )}

            <Separator />

            <FormField
              control={form.control}
              name="startDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Start Date</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
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
                Create Group
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
