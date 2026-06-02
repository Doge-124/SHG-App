'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Eye, Pencil, UserX, UserCheck, MoreHorizontal, PiggyBank, Users, Banknote } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
import { addMember, updateMember, deactivateMember, reactivateMember } from '@/lib/api/members'
import { formatCurrency, formatPhone } from '@/lib/format'
import { track } from '@/lib/track'
import type { Member, MemberFormData, MemberType } from '@/lib/types'
import { cn } from '@/lib/utils'

const TYPE_META: Record<MemberType, {
  title: string
  description: string
  icon: React.ReactNode
}> = {
  SHG: {
    title: 'SHG Members',
    description: 'Savings members with full access — savings, loans, and chit groups.',
    icon: <PiggyBank className="h-6 w-6 text-blue-600" />,
  },
  CHIT: {
    title: 'Chit Members',
    description: 'Members enrolled only in chit fund groups.',
    icon: <Users className="h-6 w-6 text-purple-600" />,
  },
  LOAN: {
    title: 'Loan Members',
    description: 'Members who only take loans — no savings, no chits.',
    icon: <Banknote className="h-6 w-6 text-orange-600" />,
  },
}

/**
 * Renders a full-width DataTable for a single member type. The /members/[type]
 * route files are thin wrappers around this component.
 */
export function MembersByTypeView({ type }: { type: MemberType }) {
  const router = useRouter()
  const { members, loadingMembers, refreshMembers } = useApp()
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingMember, setEditingMember] = useState<Member | undefined>()
  const [memberToDeactivate, setMemberToDeactivate] = useState<Member | null>(null)
  const [memberToReactivate, setMemberToReactivate] = useState<Member | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')

  useEffect(() => { refreshMembers() }, [refreshMembers])

  const meta = TYPE_META[type]

  const visibleMembers = members
    .filter((m) => m.memberType === type)
    .filter((m) => statusFilter === 'all' ? true : m.status === statusFilter)

  const handleAddMember = async (data: MemberFormData) => {
    setIsSubmitting(true)
    try {
      // Force the type — the form still shows the selector but we override
      // to keep "new member here" predictable when added from a typed page.
      const response = await addMember({ ...data, memberType: type })
      if (response.success) {
        toast.success(`${meta.title.replace(' Members', '')} member added`)
        track('member.created', { member_type: type })
        setIsFormOpen(false)
        refreshMembers()
      } else {
        toast.error(response.error || 'Failed to add member')
      }
    } catch { toast.error('An error occurred') } finally { setIsSubmitting(false) }
  }

  const handleEditMember = async (data: MemberFormData) => {
    if (!editingMember) return
    setIsSubmitting(true)
    try {
      const response = await updateMember(editingMember.id, data)
      if (response.success) {
        toast.success('Member updated')
        setEditingMember(undefined)
        refreshMembers()
      } else {
        toast.error(response.error || 'Failed to update')
      }
    } catch { toast.error('An error occurred') } finally { setIsSubmitting(false) }
  }

  const handleDeactivate = async () => {
    if (!memberToDeactivate) return
    setIsSubmitting(true)
    try {
      const response = await deactivateMember(memberToDeactivate.id)
      if (response.success) {
        toast.success('Member deactivated')
        setMemberToDeactivate(null)
        refreshMembers()
      } else {
        toast.error(response.error || 'Failed to deactivate')
      }
    } catch { toast.error('An error occurred') } finally { setIsSubmitting(false) }
  }

  const handleReactivate = async () => {
    if (!memberToReactivate) return
    setIsSubmitting(true)
    try {
      const response = await reactivateMember(memberToReactivate.id)
      if (response.success) {
        toast.success('Member reactivated')
        setMemberToReactivate(null)
        refreshMembers()
      } else {
        toast.error(response.error || 'Failed to reactivate')
      }
    } catch { toast.error('An error occurred') } finally { setIsSubmitting(false) }
  }

  const columns: Column<Member>[] = [
    {
      key: 'code',
      header: 'Member #',
      cell: (member) => <span className="font-mono text-sm font-medium">{member.code}</span>,
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
          className={cn(member.status === 'active' && 'bg-success/10 text-success hover:bg-success/20')}
        >
          {member.status}
        </Badge>
      ),
    },
    {
      key: 'balance',
      header: 'Balance',
      cell: (member) => (
        <span className={cn(
          'font-medium',
          member.balance > 0 && 'text-success',
          member.balance < 0 && 'text-destructive'
        )}>
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
              <Eye className="mr-2 h-4 w-4" />View Details
            </DropdownMenuItem>
            <DropdownMenuItem onClick={(e) => {
              e.stopPropagation()
              setEditingMember(member)
            }}>
              <Pencil className="mr-2 h-4 w-4" />Edit Member
            </DropdownMenuItem>
            {member.status === 'active' ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={(e) => { e.stopPropagation(); setMemberToDeactivate(member) }}
                  className="text-destructive focus:text-destructive"
                >
                  <UserX className="mr-2 h-4 w-4" />Deactivate
                </DropdownMenuItem>
              </>
            ) : (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={(e) => { e.stopPropagation(); setMemberToReactivate(member) }}
                >
                  <UserCheck className="mr-2 h-4 w-4" />Reactivate
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
      className: 'w-12',
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {meta.icon}
            {meta.title}
            <Badge variant="secondary">{visibleMembers.length}</Badge>
          </span>
        }
        description={meta.description}
      >
        <Button onClick={() => setIsFormOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add {meta.title.replace(' Members', '')} Member
        </Button>
      </PageHeader>

      <div className="flex items-center gap-4">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable
        data={visibleMembers}
        columns={columns}
        searchKey="name"
        searchPlaceholder={`Search ${meta.title.toLowerCase()}...`}
        isLoading={loadingMembers}
        emptyMessage={`No ${meta.title.toLowerCase()} yet`}
        onRowClick={(member) => router.push(`/members/detail?id=${member.id}`)}
      />

      <MemberForm
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        onSubmit={handleAddMember}
        isLoading={isSubmitting}
      />
      <MemberForm
        open={!!editingMember}
        onOpenChange={(open) => { if (!open) setEditingMember(undefined) }}
        onSubmit={handleEditMember}
        member={editingMember}
        isLoading={isSubmitting}
      />
      <ConfirmDialog
        open={!!memberToDeactivate}
        onOpenChange={(open) => !open && setMemberToDeactivate(null)}
        title="Deactivate Member"
        description={`Are you sure you want to deactivate ${memberToDeactivate?.name}? Their history is kept, and they can be reactivated later.`}
        confirmText="Deactivate"
        variant="destructive"
        isLoading={isSubmitting}
        onConfirm={handleDeactivate}
      />
      <ConfirmDialog
        open={!!memberToReactivate}
        onOpenChange={(open) => !open && setMemberToReactivate(null)}
        title="Reactivate Member"
        description={`Reactivate ${memberToReactivate?.name}? They will appear in active member lists again.`}
        confirmText="Reactivate"
        isLoading={isSubmitting}
        onConfirm={handleReactivate}
      />
    </div>
  )
}
