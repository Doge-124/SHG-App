'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Calendar, Users, DollarSign, AlertTriangle, CheckCircle, Clock } from 'lucide-react'
import { recordPastChitCycle, getMemberPaymentStatus, getChitCyclesWithDetails, getChitMigrationStatus, getChitMembers } from '@/lib/api/chits'
import type { ChitMember, MemberPaymentStatus, ChitCycleDetail, ChitMigrationStatus } from '@/lib/types'
import { formatCurrency, formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'

interface ChitPastDataFormProps {
  chitGroupId: string
  chitGroupName: string
  monthlyContribution: number
  totalMembers: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

interface MemberPaymentEntry {
  memberId: string
  memberName: string
  amount: number
  paymentMethod: 'cash' | 'bank'
  hasPaid: boolean
}

export function ChitPastDataForm({
  chitGroupId,
  chitGroupName,
  monthlyContribution,
  totalMembers,
  open,
  onOpenChange,
  onSuccess,
}: ChitPastDataFormProps) {
  const [members, setMembers] = useState<ChitMember[]>([])
  const [paymentStatuses, setPaymentStatuses] = useState<MemberPaymentStatus[]>([])
  const [cyclesWithDetails, setCyclesWithDetails] = useState<ChitCycleDetail[]>([])
  const [migrationStatus, setMigrationStatus] = useState<ChitMigrationStatus | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  // Form state for new cycle entry
  const [cycleNumber, setCycleNumber] = useState<number>(1)
  const [auctionDate, setAuctionDate] = useState<string>(new Date().toISOString().split('T')[0])
  const [winningMemberId, setWinningMemberId] = useState<string>('')
  const [bidDiscount, setBidDiscount] = useState<number>(0)
  const [winnerPayout, setWinnerPayout] = useState<number>(0)
  const [memberPayments, setMemberPayments] = useState<MemberPaymentEntry[]>([])
  const [activeTab, setActiveTab] = useState<'enter' | 'status'>('enter')

  useEffect(() => {
    if (open) {
      loadData()
    }
  }, [open, chitGroupId])

  useEffect(() => {
    if (members.length > 0) {
      // Initialize member payments with default values
      setMemberPayments(members.map(m => ({
        memberId: m.memberId,
        memberName: m.memberName,
        amount: monthlyContribution,
        paymentMethod: 'cash' as const,
        hasPaid: true,
      })))
    }
  }, [members, monthlyContribution])

  useEffect(() => {
    if (migrationStatus) {
      // Set next cycle number based on cycles already entered
      setCycleNumber(migrationStatus.cyclesEntered + 1)
    }
  }, [migrationStatus])

  // Auto-calculate winner payout when bid discount or member payments change
  useEffect(() => {
    const totalCollected = memberPayments.filter(p => p.hasPaid).reduce((sum, p) => sum + p.amount, 0)
    const calculatedPayout = Math.max(0, totalCollected - bidDiscount)
    setWinnerPayout(calculatedPayout)
  }, [bidDiscount, memberPayments])

  const loadData = async () => {
    setIsLoading(true)
    try {
      // Load members
      const membersRes = await getChitMembers(chitGroupId)
      if (membersRes.success && membersRes.data) {
        setMembers(membersRes.data)
      }

      // Load payment status
      const statusRes = await getMemberPaymentStatus(chitGroupId)
      if (statusRes.success && statusRes.data) {
        setPaymentStatuses(statusRes.data)
      }

      // Load cycles with details
      const cyclesRes = await getChitCyclesWithDetails(chitGroupId)
      if (cyclesRes.success && cyclesRes.data) {
        setCyclesWithDetails(cyclesRes.data)
      }

      // Load migration status
      const migrationRes = await getChitMigrationStatus(chitGroupId)
      if (migrationRes.success && migrationRes.data) {
        setMigrationStatus(migrationRes.data)
      }
    } catch (error) {
      console.error('Failed to load chit data:', error)
      toast.error('Failed to load chit data')
    } finally {
      setIsLoading(false)
    }
  }

  const handlePaymentChange = (memberId: string, field: keyof MemberPaymentEntry, value: any) => {
    setMemberPayments(prev => prev.map(p => 
      p.memberId === memberId ? { ...p, [field]: value } : p
    ))
  }

  const handleSubmit = async () => {
    if (cycleNumber <= 0) {
      toast.error('Please enter a valid cycle number')
      return
    }

    if (!auctionDate) {
      toast.error('Please select an auction date')
      return
    }

    // Filter only members who have paid
    const payments = memberPayments
      .filter(p => p.hasPaid)
      .map(p => ({
        memberId: p.memberId,
        amount: p.amount,
        paymentMethod: p.paymentMethod,
      }))

    const totalCollected = payments.reduce((sum, p) => sum + p.amount, 0)

    if (payments.length === 0) {
      toast.error('At least one member must have paid')
      return
    }

    setIsSubmitting(true)
    try {
      const result = await recordPastChitCycle(chitGroupId, {
        cycleNumber,
        auctionDate,
        winningMemberId: winningMemberId || undefined,
        bidDiscount,
        winnerPayout,
        memberPayments: payments,
      })

      if (result.success) {
        toast.success(`Cycle ${cycleNumber} recorded successfully`)
        
        // Show summary
        if (result.data) {
          toast.info(
            `Total collected: ${formatCurrency(result.data.totalCollected)}, ` +
            `Auction discount: ${formatCurrency(result.data.bidDiscount)}, ` +
            `Net to SHG: ${formatCurrency(result.data.payoutAmount)}`
          )
        }

        // Clear form and reload data
        setWinningMemberId('')
        setBidDiscount(0)
        setMemberPayments(members.map(m => ({
          memberId: m.memberId,
          memberName: m.memberName,
          amount: monthlyContribution,
          paymentMethod: 'cash' as const,
          hasPaid: true,
        })))
        
        await loadData()
        onSuccess?.()
      } else {
        toast.error(result.error || 'Failed to record cycle')
      }
    } catch (error) {
      console.error('Failed to record past cycle:', error)
      toast.error('An error occurred while recording the cycle')
    } finally {
      setIsSubmitting(false)
    }
  }

  const getLatePayerStatus = (status: MemberPaymentStatus) => {
    if (status.isUpToDate) {
      return <Badge variant="success" className="gap-1"><CheckCircle className="h-3 w-3" /> Up to date</Badge>
    }
    if (status.lateCycles.length > 0) {
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertTriangle className="h-3 w-3" />
          {status.lateCycles.length} late payment{status.lateCycles.length > 1 ? 's' : ''}
        </Badge>
      )
    }
    return <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" /> New</Badge>
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Chit Past Data Entry - {chitGroupName}
          </DialogTitle>
        </DialogHeader>

        {migrationStatus && (
          <Alert className={cn(
            migrationStatus.isComplete ? "border-green-500" : "border-blue-500"
          )}>
            <AlertDescription className="flex items-center justify-between">
              <span>
                <strong>{migrationStatus.cyclesEntered}</strong> of <strong>{migrationStatus.totalMonths}</strong> cycles entered
                {migrationStatus.isComplete && (
                  <span className="text-green-600 ml-2">(Complete!)</span>
                )}
              </span>
              <span className="text-muted-foreground">
                Total collected: {formatCurrency(migrationStatus.totalCollected)}
              </span>
            </AlertDescription>
          </Alert>
        )}

        <div className="flex gap-2 mb-4">
          <Button
            variant={activeTab === 'enter' ? 'default' : 'outline'}
            onClick={() => setActiveTab('enter')}
            className="flex-1"
          >
            <DollarSign className="h-4 w-4 mr-2" />
            Enter Cycle Data
          </Button>
          <Button
            variant={activeTab === 'status' ? 'default' : 'outline'}
            onClick={() => setActiveTab('status')}
            className="flex-1"
          >
            <Users className="h-4 w-4 mr-2" />
            Member Status
          </Button>
        </div>

        {activeTab === 'enter' ? (
          <ScrollArea className="h-[60vh]">
            <div className="space-y-6">
              {/* Cycle Information */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Cycle Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="cycleNumber">Cycle Number</Label>
                      <Input
                        id="cycleNumber"
                        type="number"
                        min={1}
                        value={cycleNumber}
                        onChange={(e) => setCycleNumber(parseInt(e.target.value) || 1)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="auctionDate">Auction Date</Label>
                      <Input
                        id="auctionDate"
                        type="date"
                        value={auctionDate}
                        onChange={(e) => setAuctionDate(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="winningMember">Winning Member (Optional)</Label>
                      <Select value={winningMemberId || "none"} onValueChange={(v) => setWinningMemberId(v === "none" ? "" : v)}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select winner (optional)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No winner yet</SelectItem>
                          {members.map((member) => (
                            <SelectItem key={member.memberId} value={member.memberId}>
                              {member.memberName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bidDiscount">Auction Discount (Bid Discount)</Label>
                      <Input
                        id="bidDiscount"
                        type="number"
                        min={0}
                        step="0.01"
                        value={bidDiscount}
                        onChange={(e) => setBidDiscount(parseFloat(e.target.value) || 0)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Discount given to winning member
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="winnerPayout">Winner Payout Amount</Label>
                      <Input
                        id="winnerPayout"
                        type="number"
                        min={0}
                        step="0.01"
                        value={winnerPayout}
                        onChange={(e) => setWinnerPayout(parseFloat(e.target.value) || 0)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Amount paid to winner (auto-calculated as total - discount)
                      </p>
                    </div>
                  </div>

                  {(bidDiscount > 0 || winnerPayout > 0) && (
                    <Alert>
                      <AlertDescription>
                        Total collection: {formatCurrency(memberPayments.filter(p => p.hasPaid).reduce((sum, p) => sum + p.amount, 0))}
                        <br />
                        Auction discount: {formatCurrency(bidDiscount)}
                        <br />
                        Winner payout: {formatCurrency(winnerPayout)}
                        <br />
                        Net to SHG: {formatCurrency(memberPayments.filter(p => p.hasPaid).reduce((sum, p) => sum + p.amount, 0) - bidDiscount - winnerPayout)}
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>

              {/* Member Payments */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      Member Payments
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setMemberPayments(prev => prev.map(p => ({
                          ...p,
                          amount: monthlyContribution,
                          hasPaid: true,
                        })))
                      }}
                    >
                      Mark All Paid
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {memberPayments.map((payment) => (
                      <div
                        key={payment.memberId}
                        className={cn(
                          "flex items-center gap-4 p-3 rounded-lg border",
                          payment.hasPaid ? "bg-background" : "bg-muted/50 opacity-60"
                        )}
                      >
                        <div className="flex-1">
                          <p className="font-medium">{payment.memberName}</p>
                          <p className="text-sm text-muted-foreground">
                            {payment.hasPaid ? 'Paid' : 'Not paid'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            value={payment.amount}
                            onChange={(e) => handlePaymentChange(payment.memberId, 'amount', parseFloat(e.target.value) || 0)}
                            disabled={!payment.hasPaid}
                            className="w-24"
                          />
                          <Select
                            value={payment.paymentMethod}
                            onValueChange={(value) => handlePaymentChange(payment.memberId, 'paymentMethod', value)}
                            disabled={!payment.hasPaid}
                          >
                            <SelectTrigger className="w-28">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="cash">Cash</SelectItem>
                              <SelectItem value="bank">Bank</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            variant={payment.hasPaid ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => handlePaymentChange(payment.memberId, 'hasPaid', !payment.hasPaid)}
                          >
                            {payment.hasPaid ? 'Paid' : 'Not Paid'}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Previous Cycles Summary */}
              {cyclesWithDetails.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Previously Entered Cycles</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {cyclesWithDetails.map((cycle) => (
                        <div
                          key={cycle.id}
                          className="flex items-center justify-between p-2 rounded border text-sm"
                        >
                          <span>Cycle {cycle.cycleNumber}</span>
                          <span className="text-muted-foreground">{formatDate(cycle.auctionDate)}</span>
                          <span>{formatCurrency(cycle.totalCollected)}</span>
                          {cycle.bidDiscount > 0 && (
                            <Badge variant="secondary">Discount: {formatCurrency(cycle.bidDiscount)}</Badge>
                          )}
                          {cycle.winningMemberName && (
                            <Badge variant="outline">Winner: {cycle.winningMemberName}</Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </ScrollArea>
        ) : (
          <ScrollArea className="h-[60vh]">
            <div className="space-y-4">
              {paymentStatuses.map((status) => (
                <Card key={status.memberId}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium">{status.memberName}</h4>
                      {getLatePayerStatus(status)}
                    </div>
                    <div className="text-sm text-muted-foreground space-y-1">
                      <p>Paid {status.cyclesPaid} of {status.currentCycle} cycles</p>
                      {status.lateCycles.length > 0 && (
                        <p className="text-destructive">
                          Late cycles: {status.lateCycles.join(', ')}
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {activeTab === 'enter' && (
            <Button onClick={handleSubmit} disabled={isSubmitting || isLoading}>
              {isSubmitting ? 'Recording...' : 'Record Cycle'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
