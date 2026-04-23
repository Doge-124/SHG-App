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
import type { ChitGroupFormData } from '@/lib/types'

const chitGroupSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  totalAmount: z.coerce.number().min(10000, 'Minimum chit amount is Rs. 10,000'),
  monthlyContribution: z.coerce.number().min(500, 'Minimum contribution is Rs. 500'),
  totalMembers: z.coerce.number().min(5, 'Minimum 5 members required').max(50, 'Maximum 50 members'),
  durationMonths: z.coerce.number().min(5, 'Minimum 5 months').max(50, 'Maximum 50 months'),
  startDate: z.string().min(1, 'Start date is required'),
})

interface ChitGroupFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: ChitGroupFormData) => Promise<void>
  isLoading?: boolean
}

export function ChitGroupForm({
  open,
  onOpenChange,
  onSubmit,
  isLoading = false,
}: ChitGroupFormProps) {
  const form = useForm<ChitGroupFormData>({
    resolver: zodResolver(chitGroupSchema),
    defaultValues: {
      name: '',
      totalAmount: 100000,
      monthlyContribution: 5000,
      totalMembers: 20,
      durationMonths: 20,
      startDate: '',
    },
  })

  const handleSubmit = async (data: ChitGroupFormData) => {
    await onSubmit(data)
    form.reset()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Chit Group</DialogTitle>
          <DialogDescription>
            Set up a new chit fund group for members.
          </DialogDescription>
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
                name="totalAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Total Amount (Rs.)</FormLabel>
                    <FormControl>
                      <Input type="number" min={10000} {...field} />
                    </FormControl>
                    <FormDescription>Prize amount per cycle</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="monthlyContribution"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monthly Contribution</FormLabel>
                    <FormControl>
                      <Input type="number" min={500} {...field} />
                    </FormControl>
                    <FormDescription>Per member per month</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="totalMembers"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Total Members</FormLabel>
                    <FormControl>
                      <Input type="number" min={5} max={50} {...field} />
                    </FormControl>
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
                    <FormControl>
                      <Input type="number" min={5} max={50} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="startDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Start Date</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
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
                Create Group
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
