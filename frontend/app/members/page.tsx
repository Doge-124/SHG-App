'use client'

import { useEffect, useState } from 'react'
import { Plus, Eye, Pencil, UserX, MoreHorizontal, PiggyBank, Users, Banknote } from 'lucide-react'
import { toast } from 'sonner'
import { track } from '@/lib/track'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DataTable, type Column } from '@/components/data-table'
import { PageHeader } from '@/components/page-header'
import { MemberForm } from '@/components/forms/member-form'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { useApp } from '@/context/app-context'
import { addMember, updateMember, deactivateMember } from '@/lib/api/members'
import { formatCurrency, formatPhone } from '@/lib/format'
import type { Member, MemberFormData, MemberType } from '@/lib/types'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

export default function MembersPage() {
  const router = useRouter()
  const { members, loadingMembers, refreshMembers } = useApp()
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingMember, setEditingMember] = useState<Member | undefined>()
  const [memberToDeactivate, setMemberToDeactivate] = useState<Member | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')

  useEffect(() => {
    refreshMembers()
  }, [refreshMembers])

  const filteredMembers = statusFilter === 'all'
    ? members
    : members.filter((m) => m.status === statusFilter)

  // Group members by type
  const shgMembers = filteredMembers.filter((m) => m.memberType === 'SHG')
  const chitMembers = filteredMembers.filter((m) => m.memberType === 'CHIT')
  const loanMembers = filteredMembers.filter((m) => m.memberType === 'LOAN')

  const handleAddMember = async (data: MemberFormData) => {
    setIsSubmitting(true)
    try {
      const response = await addMember(data)
      if (response.success) {
        toast.success('Member added successfully')
        track('member.created', { member_type: data.memberType })
        setIsFormOpen(false)
        refreshMembers()
      } else {
        toast.error(response.error || 'Failed to add member')
      }
    } catch {
      toast.error('An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleEditMember = async (data: MemberFormData) => {
    if (!editingMember) return
    setIsSubmitting(true)
    try {
      const response = await updateMember(editingMember.id, data)
      if (response.success) {
        toast.success('Member updated successfully')
        // Close dialog after successful update
        setEditingMember(undefined)
        // Then refresh the members list
        refreshMembers()
      } else {
        toast.error(response.error || 'Failed to update member')
      }
    } catch {
      toast.error('An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeactivateMember = async () => {
    if (!memberToDeactivate) return
    setIsSubmitting(true)
    try {
      const response = await deactivateMember(memberToDeactivate.id)
      if (response.success) {
        toast.success('Member deactivated successfully')
        setMemberToDeactivate(null)
        refreshMembers()
      } else {
        toast.error(response.error || 'Failed to deactivate member')
      }
    } catch {
      toast.error('An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  const columns: Column<Member>[] = [
    {
      key: 'code',
      header: 'Member Code',
      cell: (member) => (
        <span className="font-mono text-sm font-medium">{member.code}</span>
      ),
      sortable: true,
    },
    {
      key: 'name',
      header: 'Name',
      cell: (member) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-medium">
            {member.name.charAt(0)}
          </div>
          <div>
            <p className="font-medium">{member.name}</p>
            <p className="text-xs text-muted-foreground">{formatPhone(member.phone)}</p>
          </div>
        </div>
      ),
      sortable: true,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (member) => (
        <Badge
          variant={member.status === 'active' ? 'default' : 'secondary'}
          className={cn(
            member.status === 'active' && 'bg-success/10 text-success hover:bg-success/20'
          )}
        >
          {member.status}
        </Badge>
      ),
    },
    {
      key: 'memberType',
      header: 'Type',
      cell: (member) => (
        <Badge
          variant="outline"
          className={cn(
            'text-xs',
            member.memberType === 'SHG' && 'bg-blue-50 text-blue-700 border-blue-200',
            member.memberType === 'CHIT' && 'bg-purple-50 text-purple-700 border-purple-200',
            member.memberType === 'LOAN' && 'bg-orange-50 text-orange-700 border-orange-200'
          )}
        >
          {member.memberType === 'SHG' && 'Savings'}
          {member.memberType === 'CHIT' && 'Chit'}
          {member.memberType === 'LOAN' && 'Loan'}
        </Badge>
      ),
    },
    {
      key: 'balance',
      header: 'Balance',
      cell: (member) => (
        <span
          className={cn(
            'font-medium',
            member.balance > 0 && 'text-success',
            member.balance < 0 && 'text-destructive'
          )}
        >
          {formatCurrency(member.balance)}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'actions',
      header: 'Actions',
      cell: (member) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">Open menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={(e) => {
              e.stopPropagation()
              router.push(`/members/detail?id=${member.id}`)
            }}>
              <Eye className="mr-2 h-4 w-4" />
              View Details
            </DropdownMenuItem>
            <DropdownMenuItem onClick={(e) => {
              e.stopPropagation()
              setEditingMember(member)
            }}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit Member
            </DropdownMenuItem>
            {member.status === 'active' && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    setMemberToDeactivate(member)
                  }}
                  className="text-destructive focus:text-destructive"
                >
                  <UserX className="mr-2 h-4 w-4" />
                  Deactivate
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
      className: 'w-12',
    },
  ]

  const renderMemberSection = (
    title: string,
    icon: React.ReactNode,
    memberList: Member[],
    typeColor: string,
    typeLabel: string
  ) => (
    <Card className="overflow-hidden">
      <CardHeader className={`${typeColor} border-b`}>
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
          <Badge variant="secondary" className="ml-auto">
            {memberList.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <DataTable
          data={memberList}
          columns={columns.filter((c) => c.key !== 'memberType')}
          searchKey="name"
          searchPlaceholder={`Search ${typeLabel.toLowerCase()}...`}
          isLoading={loadingMembers}
          emptyMessage={`No ${typeLabel.toLowerCase()} members`}
          onRowClick={(member) => router.push(`/members/detail?id=${member.id}`)}
        />
      </CardContent>
    </Card>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Members"
        description="Manage your Self Help Group members by type"
      >
        <Button onClick={() => setIsFormOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Member
        </Button>
      </PageHeader>

      <div className="flex items-center gap-4">
        <Select
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Members</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 3 Sections for each member type */}
      <div className="grid gap-6 lg:grid-cols-3">
        {renderMemberSection(
          'SHG Members (Full Access)',
          <PiggyBank className="h-5 w-5 text-blue-600" />,
          shgMembers,
          'bg-blue-50/50',
          'SHG'
        )}
        {renderMemberSection(
          'Chit Members (Chit Only)',
          <Users className="h-5 w-5 text-purple-600" />,
          chitMembers,
          'bg-purple-50/50',
          'Chit'
        )}
        {renderMemberSection(
          'Loan Members (Loans Only)',
          <Banknote className="h-5 w-5 text-orange-600" />,
          loanMembers,
          'bg-orange-50/50',
          'Loan'
        )}
      </div>

      <MemberForm
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        onSubmit={handleAddMember}
        isLoading={isSubmitting}
      />

      <MemberForm
        open={!!editingMember}
        onOpenChange={(open) => {
          if (!open) {
            setEditingMember(undefined)
          }
        }}
        onSubmit={handleEditMember}
        member={editingMember}
        isLoading={isSubmitting}
      />

      <ConfirmDialog
        open={!!memberToDeactivate}
        onOpenChange={(open) => !open && setMemberToDeactivate(null)}
        title="Deactivate Member"
        description={`Are you sure you want to deactivate ${memberToDeactivate?.name}? They will no longer be able to participate in group activities.`}
        confirmText="Deactivate"
        variant="destructive"
        isLoading={isSubmitting}
        onConfirm={handleDeactivateMember}
      />
    </div>
  )
}
