'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Printer, Trophy } from 'lucide-react'
import { getMemberChitLedger, type MemberChitLedger } from '@/lib/api/chits'
import { printChitMemberLedger } from '@/lib/reports'
import { formatCurrency, formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'

interface Props {
  chitGroupId: string
  memberId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  shgName?: string
}

export function ChitMemberLedgerDialog({ chitGroupId, memberId, open, onOpenChange, shgName }: Props) {
  const [ledger, setLedger] = useState<MemberChitLedger | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !memberId) return
    setLedger(null)
    setLoading(true)
    getMemberChitLedger(chitGroupId, memberId)
      .then(res => {
        if (res.success && res.data) setLedger(res.data)
        else toast.error(res.error || 'Failed to load chit ledger')
      })
      .finally(() => setLoading(false))
  }, [open, memberId, chitGroupId])

  const handlePrint = () => {
    if (!ledger) return
    printChitMemberLedger(ledger, { shgName })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Chit Ledger</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12"><Spinner className="h-6 w-6" /></div>
        ) : !ledger ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No ledger data.</p>
        ) : (
          <div className="space-y-4">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold">{ledger.memberName} <span className="text-muted-foreground font-normal">({ledger.memberCode})</span></p>
                <p className="text-xs text-muted-foreground">
                  {ledger.chitName}
                  {ledger.passbookNumber ? ` · Passbook: ${ledger.passbookNumber}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {ledger.wonCycleNo ? (
                  <Badge className="bg-success/10 text-success">
                    <Trophy className="mr-1 h-3 w-3" />Won cycle {ledger.wonCycleNo} · {formatCurrency(ledger.payoutAmount)}
                  </Badge>
                ) : <Badge variant="outline">Not yet won</Badge>}
                <Button size="sm" variant="outline" onClick={handlePrint}><Printer className="mr-1 h-4 w-4" />Print</Button>
              </div>
            </div>

            {/* Ledger table */}
            <ScrollArea className="max-h-[55vh] rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted">
                  <tr className="text-left">
                    <th className="px-3 py-2 w-14 text-center">Cycle</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Particulars</th>
                    <th className="px-3 py-2 text-right">Debit</th>
                    <th className="px-3 py-2 text-right">Credit</th>
                    <th className="px-3 py-2 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.rows.length === 0 ? (
                    <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No entries yet</td></tr>
                  ) : ledger.rows.map((r, i) => (
                    <tr key={i} className={cn('border-t', r.isPayout && 'bg-amber-50')}>
                      <td className="px-3 py-2 text-center">{r.isPayout ? '★' : r.cycleNo}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{formatDate(r.date)}</td>
                      <td className="px-3 py-2">{r.particulars}</td>
                      <td className="px-3 py-2 text-right text-success">{r.debit ? formatCurrency(r.debit) : ''}</td>
                      <td className="px-3 py-2 text-right text-blue-700">{r.credit ? formatCurrency(r.credit) : ''}</td>
                      <td className={cn('px-3 py-2 text-right tabular-nums', r.balance < 0 && 'text-destructive')}>
                        {formatCurrency(r.balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t bg-muted/50 font-medium">
                  <tr>
                    <td className="px-3 py-2 text-right" colSpan={3}>Totals</td>
                    <td className="px-3 py-2 text-right text-success">{formatCurrency(ledger.totalDebit)}</td>
                    <td className="px-3 py-2 text-right text-blue-700">{formatCurrency(ledger.totalCredit)}</td>
                    <td className={cn('px-3 py-2 text-right tabular-nums', ledger.closingBalance < 0 && 'text-destructive')}>
                      {formatCurrency(ledger.closingBalance)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </ScrollArea>

            <p className="text-xs text-muted-foreground">
              Debit = instalments paid before winning · Credit = instalments paid after winning ·
              Balance = total paid − prize awarded (settles to ~0 once fully paid; the commission stays with the SHG).
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
