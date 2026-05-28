'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
  Users,
  Calendar,
  Trophy,
  CreditCard,
  CircleDollarSign,
  CheckCircle,
  Clock,
  History,
  Gavel,
  Zap,
  Trash2,
} from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { AdminPinDialog } from '@/components/admin-pin-dialog'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Checkbox } from '@/components/ui/checkbox'
import { PageHeader } from '@/components/page-header'
import { DataTable, type Column } from '@/components/data-table'
import { getChitGroup, getChitMembers, getChitCycles, getChitPayments, addMemberToChit, recordChitPayment, getMemberPaymentStatus, getChitCycleWinners } from '@/lib/api/chits'
import { getMembers } from '@/lib/api/members'
import { ChitPastDataForm } from '@/components/forms/chit-past-data-form'
import { ChitBulkPastEntryForm } from '@/components/forms/chit-bulk-past-entry-form'
import { ChitManualCycleForm } from '@/components/forms/chit-manual-cycle-form'
import { formatCurrency, formatDate } from '@/lib/format'
import type { ChitGroup, ChitMember, ChitCycle, ChitPayment, Member, MemberPaymentStatus, ChitCycleWinner } from '@/lib/types'
import { cn } from '@/lib/utils'

export default function ChitDetailPage() {
  // Works for both /chits/[id] (route param) and /chits/detail?id=... (query param).
  const params = useParams() as { id?: string }
  const searchParams = useSearchParams()
  const id = params?.id || searchParams?.get('id') || ''
  const router = useRouter()
  const [group, setGroup] = useState<ChitGroup | null>(null)
  const [members, setMembers] = useState<ChitMember[]>([])
  const [cycles, setCycles] = useState<ChitCycle[]>([])
  const [payments, setPayments] = useState<ChitPayment[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showAddMemberDialog, setShowAddMemberDialog] = useState(false)
  const [availableMembers, setAvailableMembers] = useState<Member[]>([])
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set())
  const [isAddingMembers, setIsAddingMembers] = useState(false)
  const [showPaymentDialog, setShowPaymentDialog] = useState(false)
  const [paymentData, setPaymentData] = useState({
    memberId: '',
    amount: '',
    paymentMethod: 'cash' as 'cash' | 'bank'
  })
  const [showPastDataForm, setShowPastDataForm] = useState(false)
  const [showBulkEntry, setShowBulkEntry] = useState(false)
  const [showManualCycleForm, setShowManualCycleForm] = useState(false)
  const [paymentStatuses, setPaymentStatuses] = useState<MemberPaymentStatus[]>([])
  const [cycleWinners, setCycleWinners] = useState<Record<string, ChitCycleWinner[]>>({})
  const [deleteCycleId, setDeleteCycleId] = useState<string | null>(null)

  useEffect(() => {
    async function loadData() {
      setIsLoading(true)
      try {
        const [groupRes, membersRes, cyclesRes, paymentsRes, statusRes] = await Promise.all([
          getChitGroup(id),
          getChitMembers(id),
          getChitCycles(id),
          getChitPayments(id),
          getMemberPaymentStatus(id),
        ])
        if (groupRes.success && groupRes.data) setGroup(groupRes.data)
        if (membersRes.success && membersRes.data) setMembers(membersRes.data)
        if (paymentsRes.success && paymentsRes.data) setPayments(paymentsRes.data)
        if (statusRes.success && statusRes.data) setPaymentStatuses(statusRes.data)
        if (cyclesRes.success && cyclesRes.data) {
          setCycles(cyclesRes.data)
          const winnerMap: Record<string, ChitCycleWinner[]> = {}
          await Promise.all(cyclesRes.data.map(async c => {
            const wr = await getChitCycleWinners(c.id)
            if (wr.success && wr.data) winnerMap[c.id] = wr.data
          }))
          setCycleWinners(winnerMap)
        }
      } catch (error) {
        console.error('Failed to load chit data:', error)
      } finally {
        setIsLoading(false)
      }
    }
    loadData()
  }, [id])

  const handleAddMember = async () => {
    try {
      const membersRes = await getMembers()
      if (membersRes.success && membersRes.data) {
        const existingMemberIds = members.map(m => m.memberId)
        const available = membersRes.data.filter(member =>
          !existingMemberIds.includes(member.id) &&
          (member.memberType === 'SHG' || member.memberType === 'CHIT')
        )
        setAvailableMembers(available)
        setShowAddMemberDialog(true)
        setSelectedMembers(new Set())
      }
    } catch (error) {
      console.error('Failed to load members:', error)
    }
  }

  const handleConfirmAddMember = async () => {
    if (selectedMembers.size === 0) return
    setIsAddingMembers(true)
    try {
      const results = await Promise.all(
        [...selectedMembers].map(memberId => addMemberToChit(id, memberId))
      )
      const added = results
        .filter(r => r.success && r.data)
        .map(r => r.data!)
      if (added.length > 0) {
        setMembers(prev => [...prev, ...added])
      }
      const failed = results.filter(r => !r.success).length
      if (failed > 0) {
        toast.error(`${failed} member(s) could not be added`)
      }
      setShowAddMemberDialog(false)
      setSelectedMembers(new Set())
    } catch (error) {
      console.error('Failed to add members:', error)
      toast.error('An error occurred')
    } finally {
      setIsAddingMembers(false)
    }
  }

  const handleRecordPayment = async () => {
    try {
      const membersRes = await getMembers()
      if (membersRes.success && membersRes.data) {
        const chitMemberIds = members.map(m => m.memberId)
        const available = membersRes.data.filter(member =>
          chitMemberIds.includes(member.id)
        )
        setAvailableMembers(available)
        setShowPaymentDialog(true)
        setPaymentData({ memberId: '', amount: '', paymentMethod: 'cash' })
      }
    } catch (error) {
      console.error('Failed to load members:', error)
    }
  }

  const handleConfirmPayment = async () => {
    if (!paymentData.memberId || !paymentData.amount) return
    try {
      const cycleId = "1"
      const response = await recordChitPayment(
        id, cycleId, paymentData.memberId,
        parseFloat(paymentData.amount), paymentData.paymentMethod
      )
      if (response.success && response.data) {
        setPayments(prev => [...prev, response.data!])
        setShowPaymentDialog(false)
        setPaymentData({ memberId: '', amount: '', paymentMethod: 'cash' })
      }
    } catch (error) {
      console.error('Failed to record payment:', error)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      </div>
    )
  }

  if (!group) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-lg text-muted-foreground">Chit group not found</p>
        <Button variant="link" onClick={() => router.push('/chits')}>Go back to chit funds</Button>
      </div>
    )
  }

  const progress = (group.currentCycle / group.durationMonths) * 100
  const currentCycle = cycles.find((c) => c.status === 'active')
  const completedCycles = cycles.filter((c) => c.status === 'completed')

  const memberColumns: Column<ChitMember>[] = [
    {
      key: 'memberName',
      header: 'Member',
      cell: (member) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-medium">
            {member.memberName.charAt(0)}
          </div>
          <span className="font-medium">{member.memberName}</span>
        </div>
      ),
    },
    { key: 'joinedAt', header: 'Joined', cell: (member) => formatDate(member.joinedAt) },
    {
      key: 'isWinner',
      header: 'Status',
      cell: (member) => (
        member.isWinner ? (
          <Badge className="bg-success/10 text-success">
            <Trophy className="mr-1 h-3 w-3" />Won (Cycle {member.winCycle})
          </Badge>
        ) : <Badge variant="outline">Active</Badge>
      ),
    },
  ]

  const CycleList = () => (
    <div className="space-y-3">
      {cycles.length === 0 && (
        <p className="text-center text-muted-foreground py-8 text-sm">No cycles recorded yet</p>
      )}
      {cycles.map(cycle => {
        const winners = cycleWinners[cycle.id] ?? []
        const isCompleted = cycle.status === 'completed' || winners.length > 0
        return (
          <div key={cycle.id} className={cn(
            'rounded-lg border p-4 space-y-3',
            isCompleted ? 'bg-background' : 'bg-muted/30'
          )}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="font-mono font-semibold text-sm">Cycle #{cycle.cycleNumber}</span>
                <span className="text-sm text-muted-foreground">{formatDate(cycle.dueDate)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant={isCompleted ? 'secondary' : 'default'}
                  className={cn(isCompleted && 'bg-green-100 text-green-700 border-green-200')}
                >
                  {isCompleted ? <><CheckCircle className="mr-1 h-3 w-3" />Completed</> : <><Clock className="mr-1 h-3 w-3" />Active</>}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-red-600 hover:text-red-700"
                  title="Delete past-data cycle (admin PIN required)"
                  onClick={() => setDeleteCycleId(cycle.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {winners.length > 0 ? (
              <div className="space-y-2">
                {winners.map((w, i) => (
                  <div key={w.id} className="flex items-center justify-between text-sm bg-muted/40 rounded-md px-3 py-2">
                    <div className="flex items-center gap-2">
                      {w.winnerType === 'FIXED'
                        ? <Trophy className="h-3.5 w-3.5 text-yellow-500 flex-shrink-0" />
                        : <Gavel className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />}
                      <span className="font-medium">{w.memberName}</span>
                      <Badge variant="outline" className="text-xs h-5">
                        {w.winnerType === 'FIXED' ? 'Fixed' : `Auction ${i}`}
                      </Badge>
                      {w.bidDiscount > 0 && (
                        <span className="text-muted-foreground text-xs">bid: {formatCurrency(w.bidDiscount)}</span>
                      )}
                    </div>
                    <span className="font-semibold text-green-700">{formatCurrency(w.payoutAmount)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">No winners recorded yet</p>
            )}
          </div>
        )
      })}
    </div>
  )

  const paymentColumns: Column<ChitPayment>[] = [
    { key: 'memberName', header: 'Member', cell: (p) => p.memberName },
    { key: 'amount', header: 'Amount', cell: (p) => <span className="font-medium">{formatCurrency(p.amount)}</span> },
    { key: 'paymentMethod', header: 'Method', cell: (p) => <Badge variant="outline">{p.paymentMethod.toUpperCase()}</Badge> },
    {
      key: 'status',
      header: 'Status',
      cell: (p) => <Badge variant={p.status === 'paid' ? 'default' : 'secondary'} className={cn(p.status === 'paid' && 'bg-success/10 text-success')}>{p.status}</Badge>,
    },
    { key: 'paidAt', header: 'Paid On', cell: (p) => p.paidAt ? formatDate(p.paidAt) : '-' },
  ]

  const reload = async () => {
    setIsLoading(true)
    try {
      const [g, m, c, p, s] = await Promise.all([
        getChitGroup(id), getChitMembers(id), getChitCycles(id), getChitPayments(id), getMemberPaymentStatus(id)
      ])
      if (g.success && g.data) setGroup(g.data)
      if (m.success && m.data) setMembers(m.data)
      if (p.success && p.data) setPayments(p.data)
      if (s.success && s.data) setPaymentStatuses(s.data)
      if (c.success && c.data) {
        setCycles(c.data)
        const winnerMap: Record<string, ChitCycleWinner[]> = {}
        await Promise.all(c.data.map(async cyc => {
          const wr = await getChitCycleWinners(cyc.id)
          if (wr.success && wr.data) winnerMap[cyc.id] = wr.data
        }))
        setCycleWinners(winnerMap)
      }
    } catch (e) { console.error(e) } finally { setIsLoading(false) }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <PageHeader title={group.name} description={`Started ${formatDate(group.startDate)}`}>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowBulkEntry(true)}>
              <Zap className="mr-2 h-4 w-4" />Quick Past Entry
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowPastDataForm(true)}>
              <History className="mr-2 h-4 w-4" />Past Data Entry
            </Button>
            <Button variant="default" size="sm" onClick={() => setShowManualCycleForm(true)}>
              <CreditCard className="mr-2 h-4 w-4" />Manage Cycle
            </Button>
            <Badge variant={group.status === 'active' ? 'default' : 'secondary'} className={cn('text-sm', group.status === 'active' && 'bg-success/10 text-success')}>
              {group.status}
            </Badge>
          </div>
        </PageHeader>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Total Amount', value: formatCurrency(group.totalAmount), icon: CircleDollarSign },
          { label: 'Monthly', value: formatCurrency(group.monthlyContribution), icon: CreditCard },
          { label: 'Members', value: `${group.currentMembers} / ${group.totalMembers}`, icon: Users },
          { label: 'Current Cycle', value: `${group.currentCycle} / ${group.durationMonths}`, icon: Calendar },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{label}</p>
                  <p className="font-semibold">{value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-lg">Chit Progress</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{completedCycles.length} cycles completed</span>
              <span className="font-medium">{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-3" />
          </div>
          {currentCycle && (
            <div className="mt-4 p-4 rounded-lg bg-primary/5 border border-primary/10">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Current Cycle #{currentCycle.cycleNumber}</p>
                  <p className="text-sm text-muted-foreground">Due: {formatDate(currentCycle.dueDate)}</p>
                </div>
                <Button size="sm" onClick={() => setShowManualCycleForm(true)}>Manage Cycle</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="members" className="space-y-4">
        <TabsList>
          <TabsTrigger value="members" className="gap-2"><Users className="h-4 w-4" />Members ({members.length})</TabsTrigger>
          <TabsTrigger value="cycles" className="gap-2"><Calendar className="h-4 w-4" />Cycles ({cycles.length})</TabsTrigger>
          <TabsTrigger value="payments" className="gap-2"><CreditCard className="h-4 w-4" />Payments ({payments.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="members">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Chit Members</CardTitle>
              <Button size="sm" onClick={handleAddMember}>Add Member</Button>
            </CardHeader>
            <CardContent><DataTable data={members} columns={memberColumns} emptyMessage="No members in this chit" /></CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="cycles">
          <Card>
            <CardHeader><CardTitle>Chit Cycles</CardTitle></CardHeader>
            <CardContent><CycleList /></CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="payments">
          <Card>
            <CardHeader><CardTitle>Payments</CardTitle></CardHeader>
            <CardContent><DataTable data={payments} columns={paymentColumns} emptyMessage="No payments recorded yet" /></CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={showAddMemberDialog} onOpenChange={setShowAddMemberDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Members to Chit Group</DialogTitle>
          </DialogHeader>
          {availableMembers.length === 0 ? (
            <p className="text-muted-foreground text-sm py-4">No available members to add.</p>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">
                  {selectedMembers.size} of {availableMembers.length} selected
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (selectedMembers.size === availableMembers.length) {
                      setSelectedMembers(new Set())
                    } else {
                      setSelectedMembers(new Set(availableMembers.map(m => m.id)))
                    }
                  }}
                >
                  {selectedMembers.size === availableMembers.length ? 'Deselect All' : 'Select All'}
                </Button>
              </div>
              <ScrollArea className="h-64 rounded-md border">
                <div className="p-2 space-y-1">
                  {availableMembers.map(m => (
                    <label
                      key={m.id}
                      className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedMembers.has(m.id)}
                        onCheckedChange={(checked) => {
                          setSelectedMembers(prev => {
                            const next = new Set(prev)
                            if (checked) next.add(m.id)
                            else next.delete(m.id)
                            return next
                          })
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{m.name}</p>
                        <p className="text-xs text-muted-foreground">{m.code}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </ScrollArea>
            </>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddMemberDialog(false)} disabled={isAddingMembers}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirmAddMember}
              disabled={selectedMembers.size === 0 || isAddingMembers}
            >
              {isAddingMembers
                ? 'Adding...'
                : `Add ${selectedMembers.size > 0 ? selectedMembers.size : ''} Member${selectedMembers.size !== 1 ? 's' : ''}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Chit Payment</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {availableMembers.length === 0 ? <p className="text-muted-foreground">No members available.</p> : (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Select Member</label>
                  <select className="w-full p-2 border rounded-md" value={paymentData.memberId} onChange={e => setPaymentData(p => ({ ...p, memberId: e.target.value }))}>
                    <option value="">Choose a member...</option>
                    {availableMembers.map(m => <option key={m.id} value={m.id}>{m.name} ({m.code})</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Amount</label>
                  <input type="number" className="w-full p-2 border rounded-md" placeholder="Enter amount" value={paymentData.amount} onChange={e => setPaymentData(p => ({ ...p, amount: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Payment Method</label>
                  <select className="w-full p-2 border rounded-md" value={paymentData.paymentMethod} onChange={e => setPaymentData(p => ({ ...p, paymentMethod: e.target.value as 'cash' | 'bank' }))}>
                    <option value="cash">Cash</option>
                    <option value="bank">Bank</option>
                  </select>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPaymentDialog(false)}>Cancel</Button>
            <Button onClick={handleConfirmPayment} disabled={!paymentData.memberId || !paymentData.amount}>Record Payment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {group && (
        <ChitPastDataForm
          chitGroupId={id} chitGroupName={group.name}
          monthlyContribution={group.monthlyContribution} totalMembers={group.totalMembers}
          totalAmount={group.totalAmount}
          winnersPerCycle={group.winnersPerCycle ?? 1}
          commissionPerWinner={group.commissionPerWinner ?? 0}
          open={showPastDataForm} onOpenChange={setShowPastDataForm} onSuccess={reload}
        />
      )}
      {group && (
        <ChitBulkPastEntryForm
          chitGroupId={id}
          chitGroupName={group.name}
          monthlyContribution={group.monthlyContribution}
          totalAmount={group.totalAmount}
          commissionPerWinner={group.commissionPerWinner ?? 0}
          winnersPerCycle={group.winnersPerCycle ?? 1}
          durationMonths={group.durationMonths}
          startDate={group.startDate}
          open={showBulkEntry}
          onOpenChange={setShowBulkEntry}
          onSuccess={reload}
        />
      )}
      {group && (
        <ChitManualCycleForm
          chitGroupId={id} chitGroupName={group.name}
          monthlyContribution={group.monthlyContribution}
          totalAmount={group.totalAmount}
          winnersPerCycle={group.winnersPerCycle ?? 1}
          commissionPerWinner={group.commissionPerWinner ?? 0}
          durationMonths={group.durationMonths}
          open={showManualCycleForm} onOpenChange={setShowManualCycleForm} onSuccess={reload}
        />
      )}

      <AdminPinDialog
        open={!!deleteCycleId}
        onOpenChange={(open) => { if (!open) setDeleteCycleId(null) }}
        title="Delete past chit cycle"
        description="Past-data chit cycles (including their winners and member payments) can be deleted with the admin PIN. Live cycles will be refused by the server."
        destructive
        confirmLabel="Delete"
        onConfirm={async (adminPin) => {
          await invoke('delete_past_chit_cycle', {
            cycleId: parseInt(deleteCycleId!),
            adminPin,
          })
          toast.success('Past cycle deleted')
          setDeleteCycleId(null)
          reload()
        }}
      />
    </div>
  )
}
