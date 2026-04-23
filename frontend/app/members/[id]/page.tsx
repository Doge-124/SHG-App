'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Phone, MapPin, Calendar, Wallet, History, CircleDollarSign, AlertCircle, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PageHeader } from '@/components/page-header'
import { getMemberProfile, setMemberOpeningData, updateMemberType } from '@/lib/api/members'
import { getMemberLoans } from '@/lib/api/loans'
import { invoke } from '@tauri-apps/api/core'
import { formatCurrency, formatPhone, formatDate } from '@/lib/format'
import { useToast } from '@/hooks/use-toast'
import type { MemberProfile, Loan, OpeningDataInput } from '@/lib/types'
import { cn } from '@/lib/utils'
import Link from 'next/link'

export default function MemberDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { toast } = useToast()
  const [profile, setProfile] = useState<MemberProfile | null>(null)
  const [loans, setLoans] = useState<Loan[]>([])
  const [chitGroups, setChitGroups] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Opening data form state (SHG only)
  const [openingBalance, setOpeningBalance] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'BANK'>('CASH')
  const [pastInstallments, setPastInstallments] = useState('')

  useEffect(() => {
    async function loadData() {
      setIsLoading(true)
      try {
        const profileData = await getMemberProfile(parseInt(id))
        setProfile(profileData)

        const memberType = profileData.member.memberType

        if (memberType === 'SHG' || memberType === 'LOAN') {
          const loansRes = await getMemberLoans(id)
          if (loansRes.success && loansRes.data) setLoans(loansRes.data)
        }

        if (memberType === 'SHG' || memberType === 'CHIT') {
          const groups = await invoke('get_member_chit_groups', { memberId: parseInt(id) }) as any[]
          setChitGroups(groups)
        }
      } catch (error) {
        console.error('Failed to load member data:', error)
        toast({ title: 'Error', description: 'Failed to load member profile', variant: 'destructive' })
      } finally {
        setIsLoading(false)
      }
    }
    loadData()
  }, [id, toast])

  const handleSubmitOpeningData = async () => {
    if (!profile) return
    const openingBalanceNum = parseFloat(openingBalance)
    const pastInstallmentsNum = parseInt(pastInstallments)
    if (isNaN(openingBalanceNum) || openingBalanceNum < 0) {
      toast({ title: 'Validation Error', description: 'Opening balance must be >= 0', variant: 'destructive' })
      return
    }
    if (isNaN(pastInstallmentsNum) || pastInstallmentsNum < 0) {
      toast({ title: 'Validation Error', description: 'Past installments must be >= 0', variant: 'destructive' })
      return
    }
    setIsSubmitting(true)
    try {
      await setMemberOpeningData({
        memberId: parseInt(id),
        openingBalance: openingBalanceNum,
        paymentMethod: openingBalanceNum > 0 ? paymentMethod : undefined,
        pastInstallments: pastInstallmentsNum,
      } as OpeningDataInput)
      toast({ title: 'Success', description: 'Opening data saved successfully' })
      const updatedProfile = await getMemberProfile(parseInt(id))
      setProfile(updatedProfile)
      setOpeningBalance('')
      setPaymentMethod('CASH')
      setPastInstallments('')
    } catch (error) {
      toast({ title: 'Error', description: typeof error === 'string' ? error : 'Failed to save opening data', variant: 'destructive' })
    } finally {
      setIsSubmitting(false)
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
        <div className="grid gap-4 sm:grid-cols-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-32" />)}
        </div>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-lg text-muted-foreground">Member not found</p>
        <Button variant="link" onClick={() => router.push('/members')}>Go back to members</Button>
      </div>
    )
  }

  const memberType = profile.member.memberType
  const isSHG  = memberType === 'SHG'
  const isLOAN = memberType === 'LOAN'
  const isCHIT = memberType === 'CHIT'

  const activeLoans = loans.filter(l => l.status === 'active')
  const totalOutstanding = activeLoans.reduce((sum, l) => sum + l.outstandingAmount, 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <PageHeader title={profile.member.name} description={`Member Code: ${profile.member.code}`}>
          <Badge
            variant={profile.member.status === 'active' ? 'default' : 'secondary'}
            className={cn('text-sm', profile.member.status === 'active' && 'bg-success/10 text-success')}
          >
            {profile.member.status}
          </Badge>
          <Badge
            variant="outline"
            className={cn(
              'text-sm',
              isSHG  && 'bg-blue-50 text-blue-700 border-blue-200',
              isCHIT && 'bg-purple-50 text-purple-700 border-purple-200',
              isLOAN && 'bg-orange-50 text-orange-700 border-orange-200',
            )}
          >
            {isSHG  && 'Savings Member'}
            {isCHIT && 'Chit Member'}
            {isLOAN && 'Loan Member'}
          </Badge>
        </PageHeader>
      </div>

      {/* Info cards — always shown */}
      <div className={cn('grid gap-4', isSHG ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3')}>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <Phone className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Phone</p>
                <p className="font-medium">{formatPhone(profile.member.phone)}</p>
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
                <p className="text-sm text-muted-foreground">Join Date</p>
                <p className="font-medium">{formatDate(profile.member.joinDate)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Installments — SHG only */}
        {isSHG && (
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning/10">
                  <History className="h-5 w-5 text-warning-foreground" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Installments</p>
                  <p className="font-medium text-warning-foreground">{profile.totalInstallments}</p>
                  <p className="text-xs text-muted-foreground">
                    Initial: {profile.initialInstallments} + Current: {profile.currentInstallments}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Outstanding loans — SHG and LOAN */}
        {(isSHG || isLOAN) && (
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-info/10">
                  <Wallet className="h-5 w-5 text-info" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Outstanding Loans</p>
                  <p className="font-medium text-info">{formatCurrency(totalOutstanding)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Active chits — CHIT only */}
        {isCHIT && (
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-50">
                  <CircleDollarSign className="h-5 w-5 text-purple-700" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Active Chit Groups</p>
                  <p className="font-medium text-purple-700">
                    {chitGroups.filter(g => g.status === 'ACTIVE').length}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Balance Breakdown — SHG only */}
      {isSHG && (
        <Card>
          <CardHeader><CardTitle>Balance Breakdown</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="text-center">
                <p className="text-sm text-muted-foreground">Opening Balance</p>
                <p className="text-lg font-semibold">{formatCurrency(profile.openingBalance)}</p>
              </div>
              <div className="text-center">
                <p className="text-sm text-muted-foreground">Regular Balance</p>
                <p className={cn('text-lg font-semibold', (profile.currentBalance - profile.openingBalance) < 0 && 'text-red-600')}>
                  {formatCurrency(profile.currentBalance - profile.openingBalance)}
                </p>
              </div>
              <div className="text-center">
                <p className="text-sm text-muted-foreground">Total Balance</p>
                <p className={cn('text-lg font-semibold', profile.currentBalance > 0 && 'text-green-600', profile.currentBalance < 0 && 'text-red-600')}>
                  {formatCurrency(profile.currentBalance)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Member Type selector — always shown */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CircleDollarSign className="h-5 w-5" />
            Member Type
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground">
            SHG members have full access (Savings, Loans &amp; Chit). CHIT members can only do chit funds. LOAN members can only take loans.
          </div>
          <Select
            value={profile.member.memberType}
            onValueChange={async (type: 'SHG' | 'CHIT' | 'LOAN') => {
              try {
                await updateMemberType(parseInt(profile.member.id), type)
                toast({ title: 'Member type updated', description: `Changed to ${type} member` })
                const updatedProfile = await getMemberProfile(parseInt(id))
                setProfile(updatedProfile)
              } catch (error) {
                toast({ title: 'Error', description: typeof error === 'string' ? error : 'Failed to update member type', variant: 'destructive' })
              }
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select member type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="SHG">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-blue-500" />
                  Savings (SHG)
                </div>
              </SelectItem>
              <SelectItem value="CHIT">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-purple-500" />
                  Chit Fund
                </div>
              </SelectItem>
              <SelectItem value="LOAN">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-orange-500" />
                  Loan
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Past Data Entry — SHG only */}
      {isSHG && (
        !profile.openingDataLocked ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5" />
                Enter Past Data (One-Time Migration)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-sm text-muted-foreground bg-blue-50 p-3 rounded-lg">
                One-time entry for records that existed before this app was adopted. Once saved, this cannot be modified.
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="openingBalance">Opening Balance (₹)</Label>
                  <Input id="openingBalance" type="number" step="0.01" min="0" placeholder="0.00"
                    value={openingBalance} onChange={e => setOpeningBalance(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pastInstallments">Past Number of Installments</Label>
                  <Input id="pastInstallments" type="number" min="0" placeholder="0"
                    value={pastInstallments} onChange={e => setPastInstallments(e.target.value)} />
                </div>
              </div>
              {openingBalance && parseFloat(openingBalance) > 0 && (
                <div className="space-y-2">
                  <Label>Payment Method</Label>
                  <RadioGroup value={paymentMethod} onValueChange={v => setPaymentMethod(v as 'CASH' | 'BANK')}>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="CASH" id="cash" />
                      <Label htmlFor="cash">Cash</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="BANK" id="bank" />
                      <Label htmlFor="bank">Bank</Label>
                    </div>
                  </RadioGroup>
                </div>
              )}
              <Button onClick={handleSubmitOpeningData} disabled={isSubmitting || (!openingBalance && !pastInstallments)} className="w-full">
                {isSubmitting ? 'Saving...' : 'Save Past Data'}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5" />
                Past Data (Migration Record)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-sm text-muted-foreground">Opening Balance</p>
                  <p className="font-medium">₹{profile.openingBalance} via {profile.openingBalanceMethod || 'Unknown'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Migration Recorded On</p>
                  <p className="font-medium">{profile.openingBalanceSetAt ? formatDate(profile.openingBalanceSetAt) : 'Unknown'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Initial Installments Seeded</p>
                  <p className="font-medium">{profile.initialInstallments} installments</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Current Installments</p>
                  <p className="font-medium">{profile.currentInstallments} installments</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Migration Status</p>
                  <p className="font-medium text-green-600">✓ Locked</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )
      )}

      {/* Address */}
      {profile.member.address && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <MapPin className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm text-muted-foreground">Address</p>
                <p className="font-medium">{profile.member.address}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── SHG: full tabs ───────────────────────────────────────────────── */}
      {isSHG && (
        <Tabs defaultValue="loans" className="space-y-4">
          <TabsList>
            <TabsTrigger value="loans" className="gap-2">
              <Wallet className="h-4 w-4" />
              Loans ({loans.length})
            </TabsTrigger>
            <TabsTrigger value="transactions" className="gap-2">
              <History className="h-4 w-4" />
              Transactions ({profile.recentTransactions.length})
            </TabsTrigger>
            <TabsTrigger value="chits" className="gap-2">
              <CircleDollarSign className="h-4 w-4" />
              Chits ({chitGroups.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="loans"><LoanList loans={loans} /></TabsContent>
          <TabsContent value="transactions"><TransactionList txns={profile.recentTransactions} /></TabsContent>
          <TabsContent value="chits"><ChitList chitGroups={chitGroups} /></TabsContent>
        </Tabs>
      )}

      {/* ── LOAN: loans + transactions ───────────────────────────────────── */}
      {isLOAN && (
        <Tabs defaultValue="loans" className="space-y-4">
          <TabsList>
            <TabsTrigger value="loans" className="gap-2">
              <Wallet className="h-4 w-4" />
              Loans ({loans.length})
            </TabsTrigger>
            <TabsTrigger value="transactions" className="gap-2">
              <History className="h-4 w-4" />
              Transactions ({profile.recentTransactions.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="loans"><LoanList loans={loans} /></TabsContent>
          <TabsContent value="transactions"><TransactionList txns={profile.recentTransactions} /></TabsContent>
        </Tabs>
      )}

      {/* ── CHIT: chit memberships only ──────────────────────────────────── */}
      {isCHIT && <ChitList chitGroups={chitGroups} />}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LoanList({ loans }: { loans: Loan[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>Loan History</CardTitle></CardHeader>
      <CardContent>
        {loans.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No loan history</p>
        ) : (
          <div className="space-y-4">
            {loans.map(loan => (
              <div key={loan.id} className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{formatCurrency(loan.amount)}</p>
                    <Badge
                      variant={loan.status === 'active' ? 'default' : 'secondary'}
                      className={cn(loan.status === 'paid' && 'bg-success/10 text-success')}
                    >
                      {loan.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Issued {formatDate(loan.issuedAt)} · {loan.paymentMethod.toUpperCase()}
                  </p>
                  {loan.note && <p className="text-sm text-muted-foreground mt-1">{loan.note}</p>}
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Outstanding</p>
                  <p className={cn('font-medium', loan.outstandingAmount > 0 && 'text-warning-foreground')}>
                    {formatCurrency(loan.outstandingAmount)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function TransactionList({ txns }: { txns: any[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>Recent Transactions</CardTitle></CardHeader>
      <CardContent>
        {txns.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No transaction history</p>
        ) : (
          <div className="space-y-4">
            {txns.map(txn => (
              <div key={txn.id} className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{formatCurrency(txn.amount)}</p>
                    <Badge
                      variant={txn.txnType === 'OPENING' ? 'secondary' : 'default'}
                      className={cn(
                        txn.txnType === 'LOAN'         && 'bg-warning/10 text-warning',
                        txn.txnType === 'PAYMENT'      && 'bg-success/10 text-success',
                        txn.txnType === 'CONTRIBUTION' && 'bg-primary/10 text-primary',
                      )}
                    >
                      {txn.txnType === 'CONTRIBUTION' ? 'Weekly Contribution' : txn.txnType}
                    </Badge>
                  </div>
                  {txn.reason && <p className="text-sm text-muted-foreground mt-1">{txn.reason}</p>}
                  <p className="text-sm text-muted-foreground mt-1">{formatDate(txn.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ChitList({ chitGroups }: { chitGroups: any[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>Chit Fund Memberships</CardTitle></CardHeader>
      <CardContent>
        {chitGroups.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">Not a member of any chit group</p>
        ) : (
          <div className="space-y-4">
            {chitGroups.map(group => (
              <div key={group.id} className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
                <div>
                  <p className="font-medium">{group.name}</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Monthly: {formatCurrency(group.monthlyContribution)} · Cycle {group.currentCycle}/{group.months}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Joined {formatDate(group.joinedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge
                    variant="outline"
                    className={cn(
                      group.status === 'ACTIVE' && 'bg-success/10 text-success border-success/20',
                      group.status === 'CLOSED' && 'bg-muted text-muted-foreground',
                    )}
                  >
                    {group.status}
                  </Badge>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/chits/${group.id}`}>
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
