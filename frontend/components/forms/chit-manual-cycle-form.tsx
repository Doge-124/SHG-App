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
import { Plus, ArrowRight, DollarSign, Users, Trophy, CheckCircle, Clock, AlertTriangle } from 'lucide-react'
import { 
  getCurrentCycleWithSummary, 
  advanceToNextCycle, 
  recordMemberPaymentWithDiscount, 
  processWinnerPayout 
} from '@/lib/api/chits'
import { getChitMembers } from '@/lib/api/chits'
import type { ChitMember, ChitCycle } from '@/lib/types'
import { formatCurrency, formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'

interface ChitManualCycleFormProps {
  chitGroupId: string
  chitGroupName: string
  monthlyContribution: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

interface PaymentSummaryItem {
  memberId: string
  memberName: string
  hasPaid: boolean
  amountPaid: number
  paymentMethod?: string
  paidAt?: string
}

export function ChitManualCycleForm({
  chitGroupId,
  chitGroupName,
  monthlyContribution,
  open,
  onOpenChange,
  onSuccess,
}: ChitManualCycleFormProps) {
  const [members, setMembers] = useState<ChitMember[]>([])
  const [currentCycle, setCurrentCycle] = useState<ChitCycle | null>(null)
  const [paymentSummary, setPaymentSummary] = useState<PaymentSummaryItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [activeTab, setActiveTab] = useState<'current' | 'payment' | 'winner'>('current')

  // Payment form state
  const [selectedMemberId, setSelectedMemberId] = useState<string>('')
  const [grossAmount, setGrossAmount] = useState<number>(monthlyContribution)
  const [auctionDiscount, setAuctionDiscount] = useState<number>(0)
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'bank'>('cash')

  // Winner form state
  const [winningMemberId, setWinningMemberId] = useState<string>('')
  const [winnerAmount, setWinnerAmount] = useState<number>(0)
  const [winnerPaymentMethod, setWinnerPaymentMethod] = useState<'cash' | 'bank'>('cash')
  const [winnerNote, setWinnerNote] = useState<string>('')

  useEffect(() => {
    if (open) {
      loadData()
    }
  }, [open, chitGroupId])

  useEffect(() => {
    if (currentCycle) {
      const totalCollected = paymentSummary
        .filter(p => p.hasPaid)
        .reduce((sum, p) => sum + p.amountPaid, 0)
      setWinnerAmount(totalCollected - auctionDiscount)
    }
  }, [currentCycle, paymentSummary, auctionDiscount])

  const loadData = async () => {
    setIsLoading(true)
    try {
      // Load members
      const membersRes = await getChitMembers(chitGroupId)
      if (membersRes.success && membersRes.data) {
        setMembers(membersRes.data)
      }

      // Load current cycle with payment summary
      const cycleRes = await getCurrentCycleWithSummary(chitGroupId)
      if (cycleRes.success && cycleRes.data) {
        setCurrentCycle(cycleRes.data.cycle)
        setPaymentSummary(cycleRes.data.paymentSummary)
      }
    } catch (error) {
      console.error('Failed to load chit data:', error)
      toast.error('Failed to load chit data')
    } finally {
      setIsLoading(false)
    }
  }

  const handleAdvanceCycle = async () => {
    setIsSubmitting(true)
    try {
      const result = await advanceToNextCycle(chitGroupId)
      if (result.success && result.data) {
        toast.success(result.data.message)
        await loadData()
        setActiveTab('current')
        onSuccess?.()
      } else {
        toast.error(result.error || 'Failed to advance cycle')
      }
    } catch (error) {
      console.error('Failed to advance cycle:', error)
      toast.error('An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRecordPayment = async () => {
    if (!currentCycle || !selectedMemberId) {
      toast.error('Please select a member')
      return
    }

    if (grossAmount <= 0) {
      toast.error('Please enter a valid amount')
      return
    }

    if (auctionDiscount < 0 || auctionDiscount >= grossAmount) {
      toast.error('Auction discount must be less than gross amount')
      return
    }

    setIsSubmitting(true)
    try {
      const result = await recordMemberPaymentWithDiscount(
        chitGroupId,
        currentCycle.id,
        selectedMemberId,
        grossAmount,
        auctionDiscount,
        paymentMethod
      )

      if (result.success && result.data) {
        toast.success(result.data.message)
        // Reset only the member selector — keep gross amount and discount so
        // the user doesn't have to re-enter them for the next member.
        setSelectedMemberId('')
        await loadData()
        onSuccess?.()
      } else {
        toast.error(result.error || 'Failed to record payment')
      }
    } catch (error) {
      console.error('Failed to record payment:', error)
      toast.error('An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleProcessWinner = async () => {
    if (!currentCycle || !winningMemberId) {
      toast.error('Please select a winning member')
      return
    }

    if (winnerAmount <= 0) {
      toast.error('Please enter a valid winner amount')
      return
    }

    setIsSubmitting(true)
    try {
      const result = await processWinnerPayout(
        chitGroupId,
        currentCycle.id,
        winningMemberId,
        winnerAmount,
        winnerPaymentMethod,
        winnerNote || `Chit payout for cycle ${currentCycle.cycleNumber}`
      )

      if (result.success && result.data) {
        toast.success(result.data.message)
        // Reset form
        setWinningMemberId('')
        setWinnerAmount(0)
        setWinnerNote('')
        await loadData()
        onSuccess?.()
      } else {
        toast.error(result.error || 'Failed to process winner payout')
      }
    } catch (error) {
      console.error('Failed to process winner:', error)
      toast.error('An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  const unpaidMembers = paymentSummary.filter(p => !p.hasPaid)
  const paidMembers = paymentSummary.filter(p => p.hasPaid)
  const allPaid = unpaidMembers.length === 0 && paymentSummary.length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRight className="h-5 w-5" />
            Manual Cycle Management - {chitGroupName}
          </DialogTitle>
        </DialogHeader>

        {currentCycle ? (
          <Alert className="border-blue-500">
            <AlertDescription className="flex items-center justify-between">
              <span>
                <strong>Current Cycle:</strong> {currentCycle.cycleNumber} | 
                <strong> Due Date:</strong> {formatDate(currentCycle.dueDate)}
              </span>
              <Badge variant={currentCycle.winnerId ? "secondary" : "default"}>
                {currentCycle.winnerId ? "Completed" : "Active"}
              </Badge>
            </AlertDescription>
          </Alert>
        ) : (
          <Alert className="border-yellow-500">
            <AlertDescription>
              No active cycle. Click "Start New Cycle" to begin.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex gap-2 mb-4">
          <Button
            variant={activeTab === 'current' ? 'default' : 'outline'}
            onClick={() => setActiveTab('current')}
            className="flex-1"
          >
            <Clock className="h-4 w-4 mr-2" />
            Current Cycle
          </Button>
          <Button
            variant={activeTab === 'payment' ? 'default' : 'outline'}
            onClick={() => setActiveTab('payment')}
            className="flex-1"
            disabled={!currentCycle || currentCycle.winnerId !== undefined}
          >
            <DollarSign className="h-4 w-4 mr-2" />
            Record Payment
          </Button>
          <Button
            variant={activeTab === 'winner' ? 'default' : 'outline'}
            onClick={() => setActiveTab('winner')}
            className="flex-1"
            disabled={!currentCycle || !allPaid}
          >
            <Trophy className="h-4 w-4 mr-2" />
            Process Winner
          </Button>
        </div>

        <ScrollArea className="h-[60vh]">
          {activeTab === 'current' && (
            <div className="space-y-4">
              {currentCycle ? (
                <>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Payment Summary</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {paymentSummary.map((payment) => (
                          <div
                            key={payment.memberId}
                            className={cn(
                              "flex items-center justify-between p-3 rounded-lg border",
                              payment.hasPaid ? "bg-green-50 border-green-200" : "bg-muted/50"
                            )}
                          >
                            <div className="flex items-center gap-2">
                              {payment.hasPaid ? (
                                <CheckCircle className="h-4 w-4 text-green-500" />
                              ) : (
                                <Clock className="h-4 w-4 text-muted-foreground" />
                              )}
                              <span>{payment.memberName}</span>
                            </div>
                            <div className="flex items-center gap-4">
                              {payment.hasPaid ? (
                                <>
                                  <Badge variant="outline">{payment.paymentMethod}</Badge>
                                  <span className="font-medium">{formatCurrency(payment.amountPaid)}</span>
                                </>
                              ) : (
                                <Badge variant="secondary">Pending</Badge>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>

                      <Separator className="my-4" />

                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">
                          Paid: {paidMembers.length} / {paymentSummary.length} members
                        </span>
                        <span className="font-medium">
                          Total Collected: {formatCurrency(
                            paidMembers.reduce((sum, p) => sum + p.amountPaid, 0)
                          )}
                        </span>
                      </div>
                    </CardContent>
                  </Card>

                  {!currentCycle.winnerId && allPaid && (
                    <Alert className="border-green-500 bg-green-50">
                      <AlertDescription className="flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          <CheckCircle className="h-4 w-4 text-green-500" />
                          All members have paid! You can now process the winner.
                        </span>
                        <Button onClick={() => setActiveTab('winner')} size="sm">
                          Process Winner
                        </Button>
                      </AlertDescription>
                    </Alert>
                  )}

                  {currentCycle.winnerId && (
                    <Alert className="border-green-500 bg-green-50">
                      <AlertDescription className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-green-500" />
                        Cycle completed! Winner has been paid.
                      </AlertDescription>
                    </Alert>
                  )}
                </>
              ) : null}

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Cycle Control</CardTitle>
                </CardHeader>
                <CardContent className="flex gap-2">
                  <Button
                    onClick={handleAdvanceCycle}
                    disabled={isSubmitting || !!(currentCycle && !currentCycle.winnerId)}
                    className="flex-1"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    {currentCycle ? 'Start Next Cycle' : 'Start First Cycle'}
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}

          {activeTab === 'payment' && currentCycle && (
            <div className="space-y-4">
              {/* Cycle-level discount — set once, applied to every member's payment */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Cycle Settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="grossAmount">Monthly Contribution</Label>
                      <Input
                        id="grossAmount"
                        type="number"
                        min={0}
                        step="0.01"
                        value={grossAmount}
                        onChange={(e) => setGrossAmount(parseFloat(e.target.value) || 0)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="auctionDiscount">Auction Discount (per member)</Label>
                      <Input
                        id="auctionDiscount"
                        type="number"
                        min={0}
                        max={grossAmount - 1}
                        step="0.01"
                        value={auctionDiscount}
                        onChange={(e) => setAuctionDiscount(parseFloat(e.target.value) || 0)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Applied to every member this cycle
                      </p>
                    </div>
                  </div>
                  {auctionDiscount > 0 && (
                    <Alert>
                      <AlertDescription>
                        Each member pays{' '}
                        <strong>{formatCurrency(grossAmount - auctionDiscount)}</strong>
                        {' '}(contribution {formatCurrency(grossAmount)} − discount {formatCurrency(auctionDiscount)})
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>

              {/* Per-member payment recording */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Record Member Payment</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Select Member</Label>
                    <Select value={selectedMemberId} onValueChange={setSelectedMemberId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select member" />
                      </SelectTrigger>
                      <SelectContent>
                        {unpaidMembers.map((member) => (
                          <SelectItem key={member.memberId} value={member.memberId}>
                            {member.memberName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Payment Method</Label>
                    <Select
                      value={paymentMethod}
                      onValueChange={(value: 'cash' | 'bank') => setPaymentMethod(value)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="bank">Bank</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <Button
                    onClick={handleRecordPayment}
                    disabled={isSubmitting || !selectedMemberId}
                    className="w-full"
                  >
                    Record Payment & Generate Receipt
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}

          {activeTab === 'winner' && currentCycle && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Process Winner Payout</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Alert className="border-yellow-500">
                  <AlertDescription className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    This will complete the current cycle and generate a voucher.
                  </AlertDescription>
                </Alert>

                <div className="space-y-2">
                  <Label>Select Winning Member</Label>
                  <Select value={winningMemberId} onValueChange={setWinningMemberId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select winner" />
                    </SelectTrigger>
                    <SelectContent>
                      {members.map((member) => (
                        <SelectItem key={member.memberId} value={member.memberId}>
                          {member.memberName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="winnerAmount">Winner Amount</Label>
                  <Input
                    id="winnerAmount"
                    type="number"
                    min={0}
                    step="0.01"
                    value={winnerAmount}
                    onChange={(e) => setWinnerAmount(parseFloat(e.target.value) || 0)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Total amount collected minus auction discount
                  </p>
                </div>

                {winningMemberId && winnerAmount > 0 && (
                  <Alert className="border-blue-500 bg-blue-50">
                    <AlertDescription>
                      <strong>Total Collected:</strong> {formatCurrency(
                        paidMembers.reduce((sum, p) => sum + p.amountPaid, 0)
                      )}
                      <br />
                      <strong>Winner Amount:</strong> {formatCurrency(winnerAmount)}
                      <br />
                      <strong>Bid Discount:</strong> {formatCurrency(
                        paidMembers.reduce((sum, p) => sum + p.amountPaid, 0) - winnerAmount
                      )}
                    </AlertDescription>
                  </Alert>
                )}

                <div className="space-y-2">
                  <Label>Payment Method</Label>
                  <Select 
                    value={winnerPaymentMethod} 
                    onValueChange={(value: 'cash' | 'bank') => setWinnerPaymentMethod(value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="bank">Bank</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="winnerNote">Note</Label>
                  <Input
                    id="winnerNote"
                    value={winnerNote}
                    onChange={(e) => setWinnerNote(e.target.value)}
                    placeholder={`Payout for cycle ${currentCycle.cycleNumber}`}
                  />
                </div>

                <Button 
                  onClick={handleProcessWinner} 
                  disabled={isSubmitting || !winningMemberId || winnerAmount <= 0}
                  className="w-full"
                >
                  <Trophy className="h-4 w-4 mr-2" />
                  Process Winner & Generate Voucher
                </Button>
              </CardContent>
            </Card>
          )}
        </ScrollArea>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
