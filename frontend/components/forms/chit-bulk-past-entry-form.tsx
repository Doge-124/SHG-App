'use client'

import { useState, useEffect, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { CheckCircle2, Zap, Info, Trophy, Gavel, Lock } from 'lucide-react'
import { getChitMembers, getChitMigrationStatus } from '@/lib/api/chits'
import { useSettings } from '@/lib/settings-context'
import type { ChitMember, ChitMigrationStatus } from '@/lib/types'
import { formatCurrency } from '@/lib/format'
import { cn } from '@/lib/utils'

interface AuctionWinnerEntry {
  memberId: string
  bidDiscount: number
  paymentMethod: 'cash' | 'bank'
}

interface BulkRow {
  cycleNo: number
  auctionDate: string
  fixedWinnerId: string
  fixedWinnerPaymentMethod: 'cash' | 'bank'
  auctionWinners: AuctionWinnerEntry[]
  alreadyDone: boolean
}

interface Props {
  chitGroupId: string
  chitGroupName: string
  monthlyContribution: number
  totalAmount: number
  commissionPerWinner: number
  winnersPerCycle: number
  durationMonths: number
  startDate: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

function addMonths(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setMonth(d.getMonth() + n)
  return d.toISOString().split('T')[0]
}

function emptyAuctionWinners(count: number): AuctionWinnerEntry[] {
  return Array.from({ length: count }, () => ({ memberId: '', bidDiscount: 0, paymentMethod: 'cash' as const }))
}

export function ChitBulkPastEntryForm({
  chitGroupId, chitGroupName, monthlyContribution, totalAmount,
  commissionPerWinner, winnersPerCycle, durationMonths, startDate,
  open, onOpenChange, onSuccess,
}: Props) {
  const { pastDataLocked } = useSettings()
  const [members, setMembers] = useState<ChitMember[]>([])
  const [migrationStatus, setMigrationStatus] = useState<ChitMigrationStatus | null>(null)
  const [rows, setRows] = useState<BulkRow[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const auctionCount = Math.max(0, winnersPerCycle - 1)
  const fixedPrize = Math.max(0, totalAmount - commissionPerWinner)

  useEffect(() => {
    if (open) loadData()
  }, [open, chitGroupId])

  const loadData = async () => {
    setIsLoading(true)
    try {
      const [membersRes, statusRes] = await Promise.all([
        getChitMembers(chitGroupId),
        getChitMigrationStatus(chitGroupId),
      ])
      const m = membersRes.success && membersRes.data ? membersRes.data : []
      const s = statusRes.success && statusRes.data ? statusRes.data : null
      setMembers(m)
      setMigrationStatus(s)
      initRows(s?.cyclesEntered ?? 0, durationMonths, startDate, auctionCount)
    } catch {
      toast.error('Failed to load chit data')
    } finally {
      setIsLoading(false)
    }
  }

  const initRows = (cyclesEntered: number, total: number, start: string, ac: number) => {
    setRows(Array.from({ length: total }, (_, i) => ({
      cycleNo: i + 1,
      auctionDate: addMonths(start, i),
      fixedWinnerId: '',
      fixedWinnerPaymentMethod: 'cash',
      auctionWinners: emptyAuctionWinners(ac),
      alreadyDone: i + 1 <= cyclesEntered,
    })))
  }

  const updateRow = (idx: number, field: keyof BulkRow, value: any) =>
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r))

  const updateAuctionWinner = (rowIdx: number, awIdx: number, field: keyof AuctionWinnerEntry, value: any) =>
    setRows(prev => prev.map((r, i) => {
      if (i !== rowIdx) return r
      const aw = [...r.auctionWinners]
      aw[awIdx] = { ...aw[awIdx], [field]: value }
      return { ...r, auctionWinners: aw }
    }))

  // All member IDs that have been selected as winners across all rows (for enforcing one-win rule)
  const allSelectedWinnerIds = useMemo(() => {
    const set = new Set<string>()
    rows.forEach(r => {
      if (!r.alreadyDone) {
        if (r.fixedWinnerId) set.add(r.fixedWinnerId)
        r.auctionWinners.forEach(w => { if (w.memberId) set.add(w.memberId) })
      }
    })
    return set
  }, [rows])

  // Members available for a specific slot.
  // Excluded: (1) already won in a DB-stored cycle (isWinner = true),
  //           (2) selected as winner in any earlier editable row,
  //           (3) selected in another slot of the same row.
  // Always included: the slot's own current selection so it remains visible.
  const availableForSlot = (rowIdx: number, currentId: string, ownSlotIds: string[]) => {
    // Winners from prior editable rows (not alreadyDone)
    const usedInPriorRows = new Set<string>()
    rows.forEach((r, i) => {
      if (i >= rowIdx || r.alreadyDone) return
      if (r.fixedWinnerId) usedInPriorRows.add(r.fixedWinnerId)
      r.auctionWinners.forEach(w => { if (w.memberId) usedInPriorRows.add(w.memberId) })
    })
    // Other slots in the same row
    const sameRowOthers = new Set(ownSlotIds.filter(id => id && id !== currentId))
    return members.filter(m => {
      if (m.memberId === currentId) return true          // keep own selection visible
      if (m.isWinner) return false                       // already won in a past DB cycle
      if (usedInPriorRows.has(m.memberId)) return false  // won in an earlier row this session
      if (sameRowOthers.has(m.memberId)) return false    // another slot in same row
      return true
    })
  }

  const editableRows = rows.filter(r => !r.alreadyDone)
  const filledRows = editableRows.filter(r => r.fixedWinnerId)

  const isRowComplete = (r: BulkRow) => {
    if (!r.fixedWinnerId) return false
    return r.auctionWinners.every(w => w.memberId)
  }

  const completeRows = editableRows.filter(isRowComplete)

  const handleSubmit = async () => {
    const toSubmit = filledRows
    if (toSubmit.length === 0) { toast.error('Select at least one fixed winner to record'); return }

    // Warn if some auction winner slots are empty
    const incomplete = toSubmit.filter(r => !isRowComplete(r))
    if (incomplete.length > 0) {
      toast.warning(`${incomplete.length} cycle(s) have missing auction winners — they will be recorded without them`)
    }

    setIsSubmitting(true)
    try {
      const count = await invoke<number>('record_bulk_past_chit_cycles', {
        chitId: parseInt(chitGroupId),
        cycles: toSubmit.map(r => ({
          cycleNo: r.cycleNo,
          auctionDate: r.auctionDate,
          fixedWinnerMemberId: parseInt(r.fixedWinnerId),
          fixedWinnerPaymentMethod: r.fixedWinnerPaymentMethod.toUpperCase(),
          auctionWinners: r.auctionWinners
            .filter(w => w.memberId)
            .map(w => ({
              memberId: parseInt(w.memberId),
              bidDiscount: w.bidDiscount,
              paymentMethod: w.paymentMethod.toUpperCase(),
            })),
        })),
      })
      toast.success(`${count} cycle${count !== 1 ? 's' : ''} recorded`)
      onOpenChange(false)
      onSuccess?.()
    } catch (err: any) {
      toast.error(err?.toString() || 'Failed to record cycles')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl flex flex-col overflow-hidden" style={{ height: '90vh' }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-yellow-500" />
            Quick Past Data Entry — {chitGroupName}
          </DialogTitle>
        </DialogHeader>

        {pastDataLocked && (
          <Alert className="border-amber-400 bg-amber-50 flex-shrink-0">
            <AlertDescription className="flex items-center gap-2 text-amber-700">
              <Lock className="h-4 w-4" />Past data entry is locked. Go to Settings → Data to unlock.
            </AlertDescription>
          </Alert>
        )}

        {/* Info strip */}
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2 flex-shrink-0">
          <span><strong>Contribution:</strong> {formatCurrency(monthlyContribution)}/member</span>
          <span><strong>Fixed prize:</strong> {formatCurrency(fixedPrize)}</span>
          <span><strong>{winnersPerCycle}</strong> winner{winnersPerCycle > 1 ? 's' : ''}/cycle
            {auctionCount > 0 && ` (1 fixed + ${auctionCount} auction)`}</span>
          {migrationStatus && <span><strong>Done:</strong> {migrationStatus.cyclesEntered}/{durationMonths}</span>}
        </div>

        <Alert className="border-blue-300 bg-blue-50 flex-shrink-0">
          <AlertDescription className="text-blue-800 text-xs flex items-start gap-2">
            <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            All members assumed to have paid their standard contribution. Dates auto-fill monthly from start date.
            Each member can only win once. Only rows with a fixed winner selected will be submitted.
          </AlertDescription>
        </Alert>

        {isLoading ? (
          <div className="flex justify-center py-12"><Spinner className="h-8 w-8" /></div>
        ) : (
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="space-y-2 pr-1">
              {rows.map((row, rowIdx) => {
                const allSlotsInRow = [
                  row.fixedWinnerId,
                  ...row.auctionWinners.map(w => w.memberId),
                ]
                const complete = isRowComplete(row)

                return (
                  <div
                    key={row.cycleNo}
                    className={cn(
                      'rounded-lg border p-3 space-y-2',
                      row.alreadyDone ? 'bg-muted/20 opacity-60' : 'bg-background',
                      !row.alreadyDone && complete && 'border-blue-300',
                    )}
                  >
                    {/* Row header */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-semibold text-sm w-8">#{row.cycleNo}</span>
                        <Input
                          type="date"
                          value={row.auctionDate}
                          disabled={row.alreadyDone}
                          onChange={e => updateRow(rowIdx, 'auctionDate', e.target.value)}
                          className="h-7 text-xs w-36"
                        />
                      </div>
                      {row.alreadyDone ? (
                        <Badge variant="secondary" className="text-xs">
                          <CheckCircle2 className="h-3 w-3 mr-1 text-green-600" />Done
                        </Badge>
                      ) : complete ? (
                        <Badge variant="outline" className="text-xs border-blue-300 text-blue-700">
                          <Zap className="h-3 w-3 mr-1" />Ready
                        </Badge>
                      ) : row.fixedWinnerId ? (
                        <Badge variant="outline" className="text-xs border-orange-300 text-orange-700">
                          Partial
                        </Badge>
                      ) : null}
                    </div>

                    {!row.alreadyDone && (
                      <div className="space-y-1.5 pl-11">
                        {/* Fixed winner */}
                        <div className="flex items-center gap-2">
                          <Trophy className="h-3.5 w-3.5 text-yellow-500 flex-shrink-0" />
                          <span className="text-xs w-16 text-muted-foreground">Fixed</span>
                          <Select
                            value={row.fixedWinnerId || 'none'}
                            onValueChange={v => updateRow(rowIdx, 'fixedWinnerId', v === 'none' ? '' : v)}
                          >
                            <SelectTrigger className="h-7 text-xs flex-1">
                              <SelectValue placeholder="Select winner…" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">
                                <span className="text-muted-foreground">— no winner yet —</span>
                              </SelectItem>
                              {availableForSlot(rowIdx, row.fixedWinnerId, allSlotsInRow).map(m => (
                                <SelectItem key={m.memberId} value={m.memberId}>{m.memberName}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select
                            value={row.fixedWinnerPaymentMethod}
                            onValueChange={(v: 'cash' | 'bank') => updateRow(rowIdx, 'fixedWinnerPaymentMethod', v)}
                            disabled={!row.fixedWinnerId}
                          >
                            <SelectTrigger className="h-7 text-xs w-20">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="cash">Cash</SelectItem>
                              <SelectItem value="bank">Bank</SelectItem>
                            </SelectContent>
                          </Select>
                          {row.fixedWinnerId && (
                            <span className="text-xs text-green-700 font-medium w-24 text-right">
                              {formatCurrency(fixedPrize)}
                            </span>
                          )}
                        </div>

                        {/* Auction winners */}
                        {row.auctionWinners.map((aw, awIdx) => {
                          const auctionPayout = Math.max(0, totalAmount - aw.bidDiscount - commissionPerWinner)
                          return (
                            <div key={awIdx} className="flex items-center gap-2">
                              <Gavel className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                              <span className="text-xs w-16 text-muted-foreground">Auction {awIdx + 1}</span>
                              <Select
                                value={aw.memberId || 'none'}
                                onValueChange={v => updateAuctionWinner(rowIdx, awIdx, 'memberId', v === 'none' ? '' : v)}
                              >
                                <SelectTrigger className="h-7 text-xs flex-1">
                                  <SelectValue placeholder="Select winner…" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">
                                    <span className="text-muted-foreground">— no winner yet —</span>
                                  </SelectItem>
                                  {availableForSlot(rowIdx, aw.memberId, allSlotsInRow).map(m => (
                                    <SelectItem key={m.memberId} value={m.memberId}>{m.memberName}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <div className="flex items-center gap-1">
                                <span className="text-xs text-muted-foreground">Bid</span>
                                <Input
                                  type="number" min={0} step="0.01"
                                  value={aw.bidDiscount || ''}
                                  placeholder="0"
                                  disabled={!aw.memberId}
                                  onChange={e => updateAuctionWinner(rowIdx, awIdx, 'bidDiscount', parseFloat(e.target.value) || 0)}
                                  className="h-7 text-xs w-20"
                                />
                              </div>
                              <Select
                                value={aw.paymentMethod}
                                onValueChange={(v: 'cash' | 'bank') => updateAuctionWinner(rowIdx, awIdx, 'paymentMethod', v)}
                                disabled={!aw.memberId}
                              >
                                <SelectTrigger className="h-7 text-xs w-20">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="cash">Cash</SelectItem>
                                  <SelectItem value="bank">Bank</SelectItem>
                                </SelectContent>
                              </Select>
                              {aw.memberId && (
                                <span className="text-xs text-blue-700 font-medium w-24 text-right">
                                  {formatCurrency(auctionPayout)}
                                </span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 flex-shrink-0 pt-2 border-t">
          <div className="flex-1 text-xs text-muted-foreground self-center space-x-3">
            <span>{filledRows.length} of {editableRows.length} remaining cycles filled</span>
            {auctionCount > 0 && completeRows.length !== filledRows.length && (
              <span className="text-orange-600">
                · {completeRows.length} fully complete (all winners selected)
              </span>
            )}
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || isLoading || pastDataLocked || filledRows.length === 0}
          >
            {isSubmitting ? <Spinner className="mr-2 h-4 w-4" /> : <Zap className="mr-2 h-4 w-4" />}
            Record {filledRows.length > 0 ? `${filledRows.length} Cycle${filledRows.length !== 1 ? 's' : ''}` : 'Cycles'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
