'use client'

import { useState, useEffect, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Spinner } from '@/components/ui/spinner'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/format'
import { calculateRunningBalances, formatDate, formatTime } from '@/lib/api/daybook'
import { getBankTransactionIds, printBankTransactionIds } from '@/lib/reports'
import { useSettings } from '@/lib/settings-context'
import type { DayBookSummary } from '@/lib/types/daybook'
import { BookOpen, ArrowUpRight, ArrowDownRight, RefreshCw, LandmarkIcon, Printer } from 'lucide-react'

function friendlyReason(referenceType: string | undefined | null, raw: string): string {
  switch (referenceType) {
    case 'WEEKLY_CONTRIBUTION':
    case 'MEMBER_CONTRIBUTION': return 'Savings Contribution'
    case 'MEMBER_PAYMENT':      return 'Loan Repayment'
    case 'CHIT_PAYMENT':        return 'Chit Installment'
    case 'CHIT_COMMISSION':     return 'Chit Commission'
    case 'CHIT_PAYOUT':         return 'Chit Payout'
    case 'MEMBER_RECEIPT':      return 'Member Receipt'
    case 'MEMBER_LOAN':         return 'Loan Disbursement'
    case 'DONATION':            return 'Donation'
    case 'GRANT':               return 'Grant'
    case 'OPENING':             return 'Opening Balance'
    default:                    return raw
  }
}

export default function BankBookPage() {
  const today = new Date().toISOString().split('T')[0]
  const { settings } = useSettings()

  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [summary, setSummary] = useState<DayBookSummary | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isPrintingIds, setIsPrintingIds] = useState(false)

  const loadBankBook = async () => {
    setIsLoading(true)
    try {
      const result = await invoke<DayBookSummary>('get_bank_book', { startDate, endDate })
      setSummary(result)
    } catch (err: any) {
      toast.error(err?.toString() || 'Failed to load bank book')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadBankBook()
  }, [])

  const handlePrintTxnIds = async () => {
    setIsPrintingIds(true)
    try {
      const res = await getBankTransactionIds(startDate, endDate)
      if (!res.success || !res.data) {
        toast.error(res.error || 'Failed to load transaction IDs')
        return
      }
      if (res.data.length === 0) {
        toast.error('No bank transactions with a transaction ID in this period')
        return
      }
      printBankTransactionIds(res.data, {
        shgName: settings?.general?.groupName,
        fromDate: startDate,
        toDate: endDate,
      })
    } catch (err: any) {
      toast.error(err?.toString() || 'Failed to print transaction IDs')
    } finally {
      setIsPrintingIds(false)
    }
  }

  const entriesWithBalance = useMemo(() => {
    if (!summary) return []
    return calculateRunningBalances(summary.transactions, summary.opening_balance)
  }, [summary])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bank Book"
        description="Bank account flow — bank receipts and payments only"
      >
        <div className="flex gap-2">
          <Button variant="outline" onClick={handlePrintTxnIds} disabled={isPrintingIds || isLoading}>
            {isPrintingIds ? <Spinner className="mr-2 h-4 w-4" /> : <Printer className="mr-2 h-4 w-4" />}
            Print Transaction IDs
          </Button>
          <Button variant="outline" onClick={loadBankBook} disabled={isLoading}>
            {isLoading ? <Spinner className="mr-2 h-4 w-4" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
        </div>
      </PageHeader>

      {/* Date range */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
              <Label htmlFor="start">From</Label>
              <Input id="start" type="date" value={startDate} max={today}
                onChange={e => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="end">To</Label>
              <Input id="end" type="date" value={endDate} max={today} min={startDate}
                onChange={e => setEndDate(e.target.value)} />
            </div>
            <Button onClick={loadBankBook} disabled={isLoading || !startDate || !endDate}>
              {isLoading ? <Spinner className="mr-2 h-4 w-4" /> : <BookOpen className="mr-2 h-4 w-4" />}
              Load
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary cards */}
      {summary && (
        <div className="grid gap-4 sm:grid-cols-4">
          <StatCard
            title="Opening Balance"
            value={formatCurrency(summary.opening_balance)}
            icon={LandmarkIcon}
            description={`Bank balance before ${formatDate(startDate)}`}
          />
          <StatCard
            title="Bank In"
            value={formatCurrency(summary.total_receipts)}
            icon={ArrowUpRight}
            description={`${entriesWithBalance.filter(e => e.txn_type === 'RECEIPT').length} receipts`}
            variant="success"
          />
          <StatCard
            title="Bank Out"
            value={formatCurrency(summary.total_vouchers)}
            icon={ArrowDownRight}
            description={`${entriesWithBalance.filter(e => e.txn_type === 'VOUCHER').length} payments`}
            variant="destructive"
          />
          <StatCard
            title="Bank Balance"
            value={formatCurrency(summary.closing_balance)}
            icon={LandmarkIcon}
            description="Current bank balance"
            variant={summary.closing_balance >= 0 ? 'success' : 'destructive'}
          />
        </div>
      )}

      {/* Transactions table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LandmarkIcon className="h-5 w-5" />
            Bank Transactions
            {summary && (
              <span className="text-sm font-normal text-muted-foreground ml-2">
                ({summary.transactions.length} entries)
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner className="h-8 w-8" />
              <span className="ml-2 text-muted-foreground">Loading…</span>
            </div>
          ) : !summary ? (
            <div className="text-center py-12 text-muted-foreground">
              <LandmarkIcon className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p>Select a date range and click Load</p>
            </div>
          ) : summary.transactions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>No bank transactions for the selected period</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date & Time</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Member</TableHead>
                    <TableHead className="text-right">Bank In</TableHead>
                    <TableHead className="text-right">Bank Out</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* Opening balance row */}
                  <TableRow className="bg-muted/30">
                    <TableCell colSpan={4} className="text-sm font-medium text-muted-foreground">
                      Opening Balance — {formatDate(startDate)}
                    </TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell className="text-right font-semibold">
                      {formatCurrency(summary.opening_balance)}
                    </TableCell>
                  </TableRow>

                  {entriesWithBalance.map(entry => (
                    <TableRow key={entry.id}>
                      <TableCell className="whitespace-nowrap text-sm">
                        <div>{formatDate(entry.date)}</div>
                        <div className="text-xs text-muted-foreground">{formatTime(entry.date)}</div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={entry.txn_type === 'RECEIPT' ? 'default' : 'destructive'}
                          className={
                            entry.txn_type === 'RECEIPT'
                              ? 'bg-success/10 text-success'
                              : 'bg-destructive/10 text-destructive'
                          }
                        >
                          {entry.txn_type === 'RECEIPT'
                            ? <ArrowUpRight className="mr-1 h-3 w-3" />
                            : <ArrowDownRight className="mr-1 h-3 w-3" />}
                          {entry.txn_type === 'RECEIPT' ? 'In' : 'Out'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {friendlyReason(entry.reference_type, entry.description)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {entry.member_name || '—'}
                      </TableCell>
                      <TableCell className="text-right font-medium text-success">
                        {entry.txn_type === 'RECEIPT' ? `+${formatCurrency(entry.amount)}` : ''}
                      </TableCell>
                      <TableCell className="text-right font-medium text-destructive">
                        {entry.txn_type === 'VOUCHER' ? `-${formatCurrency(entry.amount)}` : ''}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatCurrency(entry.running_balance)}
                      </TableCell>
                    </TableRow>
                  ))}

                  {/* Closing balance row */}
                  <TableRow className="bg-muted/30">
                    <TableCell colSpan={4} className="text-sm font-medium text-muted-foreground">
                      Bank Balance — {formatDate(endDate)}
                    </TableCell>
                    <TableCell className="text-right font-medium text-success text-sm">
                      {summary.total_receipts > 0 ? `+${formatCurrency(summary.total_receipts)}` : ''}
                    </TableCell>
                    <TableCell className="text-right font-medium text-destructive text-sm">
                      {summary.total_vouchers > 0 ? `-${formatCurrency(summary.total_vouchers)}` : ''}
                    </TableCell>
                    <TableCell className="text-right font-bold">
                      {formatCurrency(summary.closing_balance)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
