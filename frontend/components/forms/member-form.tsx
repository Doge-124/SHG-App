'use client'

import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import type { Member, MemberFormData } from '@/lib/types'

const memberSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  phone: z
    .string()
    .min(10, 'Phone number must be 10 digits')
    .max(10, 'Phone number must be 10 digits')
    .regex(/^\d+$/, 'Phone number must contain only digits'),
  address: z.string().trim().min(1, 'Address is required'),
  // Role set is assigned by context (the tab you add from) and managed afterwards
  // on the member's profile, so the form doesn't show a role picker.
  memberType: z.string().min(1).default('SHG'),
})

interface MemberFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: MemberFormData) => Promise<void>
  member?: Member
  isLoading?: boolean
}

export function MemberForm({
  open,
  onOpenChange,
  onSubmit,
  member,
  isLoading = false,
}: MemberFormProps) {
  const form = useForm<MemberFormData>({
    resolver: zodResolver(memberSchema),
    defaultValues: {
      name: '',
      phone: '',
      address: '',
      memberType: 'SHG',
    },
  })

  // Reset form when member changes (for editing) or dialog opens
  useEffect(() => {
    if (open) {
      form.reset({
        name: member?.name ?? '',
        phone: member?.phone ?? '',
        address: member?.address ?? '',
        memberType: member?.memberType ?? 'SHG',
      })
    }
  }, [open, member, form])

  const handleSubmit = async (data: MemberFormData) => {
    try {
      await onSubmit(data)
      // Only reset form if it's for adding a new member, not editing
      if (!member) {
        form.reset()
      }
    } catch (error) {
      console.error('Form submission error:', error)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{member ? 'Edit Member' : 'Add New Member'}</DialogTitle>
          <DialogDescription>
            {member
              ? 'Update the member information below.'
              : 'Fill in the details to add a new member to the group.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter full name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone Number</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="10-digit mobile number"
                      maxLength={10}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Address</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Enter address"
                      className="resize-none"
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <p className="text-xs text-muted-foreground">
              Roles (SHG / Chit / Loan) can be adjusted any time from the member&apos;s profile.
            </p>

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
                {member ? 'Save Changes' : 'Add Member'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
