'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
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
  AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { PageHeader } from '@/components/page-header'
import { DataTable, type Column } from '@/components/data-table'
import { getChitGroup, getChitMembers, getChitCycles, getChitPayments, addMemberToChit, recordChitPayment, getMemberPaymentStatus } from '@/lib/api/chits'
import { getMembers } from '@/lib/api/members'
import { ChitPastDataForm } from '@/components/forms/chit-past-data-form'
import { ChitManualCycleForm } from '@/components/forms/chit-manual-cycle-form'
import { formatCurrency, formatDate } from '@/lib/format'
import type { ChitGroup, ChitMember, ChitCycle, ChitPayment, Member, MemberPaymentStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

export default function ChitDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [group, setGroup] = useState<ChitGroup | null>(null)
  const [members, setMembers] = useState<ChitMember[]>([])
  const [cycles, setCycles] = useState<ChitCycle[]>([])
  const [payments, setPayments] = useState<ChitPayment[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showAddMemberDialog, setShowAddMemberDialog] = useState(false)
  const [availableMembers, setAvailableMembers] = useState<Member[]>([])
  const [selectedMember, setSelectedMember] = useState<string | null>(null)
  const [showPaymentDialog, setShowPaymentDialog] = useState(false)
  const [paymentData, setPaymentData] = useState({
    memberId: '',
    amount: '',
    paymentMethod: 'cash' as 'cash' | 'bank'
  })
  const [showPastDataForm, setShowPastDataForm] = useState(false)
  const [showManualCycleForm, setShowManualCycleForm] = useState(false)
  const [paymentStatuses, setPaymentStatuses] = useState<MemberPaymentStatus[]>([])

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
        if (cyclesRes.success && cyclesRes.data) setCycles(cyclesRes.data)
        if (paymentsRes.success && paymentsRes.data) setPayments(paymentsRes.data)
        if (statusRes.success && statusRes.data) setPaymentStatuses(statusRes.data)
      } catch (error) {
        console.error('Failed to load chit data:', error)
      } finally {
        setIsLoading(false)
      }
    }
    loadData()
  }, [id])

  const handleAddMember = async () => {
    // Load available members
    try {
      const membersRes = await getMembers()
      if (membersRes.success && membersRes.data) {
        // Filter out members who are already in this chit
        const existingMemberIds = members.map(m => m.memberId)
        const available = membersRes.data.filter(member =>
          !existingMemberIds.includes(member.id) &&
          (member.memberType === 'SHG' || member.memberType === 'CHIT')
        )
        setAvailableMembers(available)
        setShowAddMemberDialog(true)
        setSelectedMember(null)
      }
    } catch (error) {
      console.error('Failed to load members:', error)
    }
  }

  const handleConfirmAddMember = async () => {
    if (!selectedMember) return
    
    try {
      const response = await addMemberToChit(id, selectedMember)
      if (response.success && response.data) {
        // Add the new member to the local state
        setMembers(prev => [...prev, response.data!])
        // Close dialog and reset selection
        setShowAddMemberDialog(false)
        setSelectedMember(null)
      }
    } catch (error) {
      console.error('Failed to add member:', error)
    }
  }

  // Member selection functionality

  const handleRecordPayment = async () => {
    // Load available members for payment
    try {
      const membersRes = await getMembers()
      if (membersRes.success && membersRes.data) {
        // Only show members who are in this chit group
        const chitMemberIds = members.map(m => m.memberId)
        const available = membersRes.data.filter(member => 
          chitMemberIds.includes(member.id)
        )
        setAvailableMembers(available)
        setShowPaymentDialog(true)
        setPaymentData({
          memberId: '',
          amount: '',
          paymentMethod: 'cash'
        })
      }
    } catch (error) {
      console.error('Failed to load members:', error)
    }
  }

  const handleConfirmPayment = async () => {
    if (!paymentData.memberId || !paymentData.amount) return
    
    try {
      // Use cycle ID 1 - backend will handle duplicates by updating existing payments
      const cycleId = "1"
      
      const response = await recordChitPayment(
        id,
        cycleId,
        paymentData.memberId,
        parseFloat(paymentData.amount),
        paymentData.paymentMethod
      )
      
      if (response.success && response.data) {
        // Add the new payment to the local state
        setPayments(prev => [...prev, response.data!])
        // Close dialog and reset form
        setShowPaymentDialog(false)
        setPaymentData({
          memberId: '',
          amount: '',
          paymentMethod: 'cash'
        })
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
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </div>
    )
  }

  if (!group) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-lg text-muted-foreground">Chit group not found</p>
        <Button variant="link" onClick={() => router.push('/chits')}>
          Go back to chit funds
        </Button>
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
    {
      key: 'joinedAt',
      header: 'Joined',
      cell: (member) => formatDate(member.joinedAt),
    },
    {
      key: 'isWinner',
      header: 'Status',
      cell: (member) => (
        member.isWinner ? (
          <Badge className="bg-success/10 text-success">
            <Trophy className="mr-1 h-3 w-3" />
            Won (Cycle {member.winCycle})
          </Badge>
        ) : (
          <Badge variant="outline">Active</Badge>
        )
      ),
    },
  ]

  const cycleColumns: Column<ChitCycle>[] = [
    {
      key: 'cycleNumber',
      header: 'Cycle',
      cell: (cycle) => (
        <span className="font-mono font-medium">#{cycle.cycleNumber}</span>
      ),
    },
    {
      key: 'dueDate',
      header: 'Due Date',
      cell: (cycle) => formatDate(cycle.dueDate),
    },
    {
      key: 'winnerName',
      header: 'Winner',
      cell: (cycle) => (
        cycle.winnerName ? (
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-warning-foreground" />
            <span>{cycle.winnerName}</span>
          </div>
        ) : (
          <span className="text-muted-foreground">-</span>
        )
      ),
    },
    {
      key: 'winnerAmount',
      header: 'Payout',
      cell: (cycle) => (
        cycle.winnerAmount ? (
          <span className="font-medium">{formatCurrency(cycle.winnerAmount)}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        )
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (cycle) => (
        <Badge
          variant={cycle.status === 'active' ? 'default' : 'secondary'}
          className={cn(
            cycle.status === 'completed' && 'bg-success/10 text-success'
          )}
        >
          {cycle.status === 'completed' && <CheckCircle className="mr-1 h-3 w-3" />}
          {cycle.status === 'active' && <Clock className="mr-1 h-3 w-3" />}
          {cycle.status}
        </Badge>
      ),
    },
  ]

  const paymentColumns: Column<ChitPayment>[] = [
    {
      key: 'memberName',
      header: 'Member',
      cell: (payment) => payment.memberName,
    },
    {
      key: 'amount',
      header: 'Amount',
      cell: (payment) => (
        <span className="font-medium">{formatCurrency(payment.amount)}</span>
      ),
    },
    {
      key: 'paymentMethod',
      header: 'Method',
      cell: (payment) => (
        <Badge variant="outline">{payment.paymentMethod.toUpperCase()}</Badge>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (payment) => (
        <Badge
          variant={payment.status === 'paid' ? 'default' : 'secondary'}
          className={cn(
            payment.status === 'paid' && 'bg-success/10 text-success'
          )}
        >
          {payment.status}
        </Badge>
      ),
    },
    {
      key: 'paidAt',
      header: 'Paid On',
      cell: (payment) => (
        payment.paidAt ? formatDate(payment.paidAt) : '-'
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <PageHeader title={group.name} description={`Started ${formatDate(group.startDate)}`}>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowPastDataForm(true)}
            >
              <History className="mr-2 h-4 w-4" />
              Past Data Entry
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => setShowManualCycleForm(true)}
            >
              <CreditCard className="mr-2 h-4 w-4" />
              Manage Cycle
            </Button>
            <Badge
              variant={group.status === 'active' ? 'default' : 'secondary'}
              className={cn(
                'text-sm',
                group.status === 'active' && 'bg-success/10 text-success'
              )}
            >
              {group.status}
            </Badge>
          </div>
        </PageHeader>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <CircleDollarSign className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Amount</p>
                <p className="font-semibold">{formatCurrency(group.totalAmount)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <CreditCard className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Monthly</p>
                <p className="font-semibold">{formatCurrency(group.monthlyContribution)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Members</p>
                <p className="font-semibold">{group.currentMembers} / {group.totalMembers}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <Calendar className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Current Cycle</p>
                <p className="font-semibold">{group.currentCycle} / {group.durationMonths}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Progress */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Chit Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                {completedCycles.length} cycles completed
              </span>
              <span className="font-medium">{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-3" />
          </div>

          {currentCycle && (
            <div className="mt-4 p-4 rounded-lg bg-primary/5 border border-primary/10">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Current Cycle #{currentCycle.cycleNumber}</p>
                  <p className="text-sm text-muted-foreground">
                    Due: {formatDate(currentCycle.dueDate)}
                  </p>
                </div>
                <Button size="sm">Manage Cycle</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="members" className="space-y-4">
        <TabsList>
          <TabsTrigger value="members" className="gap-2">
            <Users className="h-4 w-4" />
            Members ({members.length})
          </TabsTrigger>
          <TabsTrigger value="cycles" className="gap-2">
            <Calendar className="h-4 w-4" />
            Cycles ({cycles.length})
          </TabsTrigger>
          <TabsTrigger value="payments" className="gap-2">
            <CreditCard className="h-4 w-4" />
            Payments ({payments.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="members">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Chit Members</CardTitle>
              <Button size="sm" onClick={handleAddMember}>Add Member</Button>
            </CardHeader>
            <CardContent>
              <DataTable
                data={members}
                columns={memberColumns}
                emptyMessage="No members in this chit"
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cycles">
          <Card>
            <CardHeader>
              <CardTitle>Chit Cycles</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                data={cycles}
                columns={cycleColumns}
                emptyMessage="No cycles recorded yet"
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payments">
          <Card>
            <CardHeader>
              <CardTitle>Payments</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                data={payments}
                columns={paymentColumns}
                emptyMessage="No payments recorded yet"
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      
      {/* Add Member Dialog */}
      <Dialog open={showAddMemberDialog} onOpenChange={setShowAddMemberDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Member to Chit Group</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {availableMembers.length === 0 ? (
              <p className="text-muted-foreground">No available members to add. All members are already in this chit group.</p>
            ) : (
              <div className="space-y-2">
                <label className="text-sm font-medium">Select Member</label>
                <select
                  className="w-full p-2 border rounded-md"
                  value={selectedMember || ''}
                  onChange={(e) => setSelectedMember(e.target.value)}
                >
                  <option value="">Choose a member...</option>
                  {availableMembers.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name} ({member.code})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddMemberDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleConfirmAddMember}
              disabled={!selectedMember || availableMembers.length === 0}
            >
              Add Member
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Record Payment Dialog */}
      <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Chit Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {availableMembers.length === 0 ? (
              <p className="text-muted-foreground">No members available in this chit group.</p>
            ) : (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Select Member</label>
                  <select
                    className="w-full p-2 border rounded-md"
                    value={paymentData.memberId}
                    onChange={(e) => setPaymentData(prev => ({ ...prev, memberId: e.target.value }))}
                  >
                    <option value="">Choose a member...</option>
                    {availableMembers.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name} ({member.code})
                      </option>
                    ))}
                  </select>
                </div>
                
                <div className="space-y-2">
                  <label className="text-sm font-medium">Amount</label>
                  <input
                    type="number"
                    className="w-full p-2 border rounded-md"
                    placeholder="Enter amount"
                    value={paymentData.amount}
                    onChange={(e) => setPaymentData(prev => ({ ...prev, amount: e.target.value }))}
                  />
                </div>
                
                <div className="space-y-2">
                  <label className="text-sm font-medium">Payment Method</label>
                  <select
                    className="w-full p-2 border rounded-md"
                    value={paymentData.paymentMethod}
                    onChange={(e) => setPaymentData(prev => ({ ...prev, paymentMethod: e.target.value as 'cash' | 'bank' }))}
                  >
                    <option value="cash">Cash</option>
                    <option value="bank">Bank</option>
                  </select>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPaymentDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleConfirmPayment}
              disabled={!paymentData.memberId || !paymentData.amount || availableMembers.length === 0}
            >
              Record Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Past Data Entry Form */}
      {group && (
        <ChitPastDataForm
          chitGroupId={id}
          chitGroupName={group.name}
          monthlyContribution={group.monthlyContribution}
          totalMembers={group.totalMembers}
          open={showPastDataForm}
          onOpenChange={setShowPastDataForm}
          onSuccess={() => {
            // Reload data after successful past data entry
            setIsLoading(true)
            Promise.all([
              getChitGroup(id),
              getChitMembers(id),
              getChitCycles(id),
              getChitPayments(id),
              getMemberPaymentStatus(id),
            ]).then(([groupRes, membersRes, cyclesRes, paymentsRes, statusRes]) => {
              if (groupRes.success && groupRes.data) setGroup(groupRes.data)
              if (membersRes.success && membersRes.data) setMembers(membersRes.data)
              if (cyclesRes.success && cyclesRes.data) setCycles(cyclesRes.data)
              if (paymentsRes.success && paymentsRes.data) setPayments(paymentsRes.data)
              if (statusRes.success && statusRes.data) setPaymentStatuses(statusRes.data)
            }).catch(console.error).finally(() => setIsLoading(false))
          }}
        />
      )}

      {/* Manual Cycle Management Form */}
      {group && (
        <ChitManualCycleForm
          chitGroupId={id}
          chitGroupName={group.name}
          monthlyContribution={group.monthlyContribution}
          open={showManualCycleForm}
          onOpenChange={setShowManualCycleForm}
          onSuccess={() => {
            // Reload data after successful cycle management
            setIsLoading(true)
            Promise.all([
              getChitGroup(id),
              getChitMembers(id),
              getChitCycles(id),
              getChitPayments(id),
              getMemberPaymentStatus(id),
            ]).then(([groupRes, membersRes, cyclesRes, paymentsRes, statusRes]) => {
              if (groupRes.success && groupRes.data) setGroup(groupRes.data)
              if (membersRes.success && membersRes.data) setMembers(membersRes.data)
              if (cyclesRes.success && cyclesRes.data) setCycles(cyclesRes.data)
              if (paymentsRes.success && paymentsRes.data) setPayments(paymentsRes.data)
              if (statusRes.success && statusRes.data) setPaymentStatuses(statusRes.data)
            }).catch(console.error).finally(() => setIsLoading(false))
          }}
        />
      )}
    </div>
  )
}
