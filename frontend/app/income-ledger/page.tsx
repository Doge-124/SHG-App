'use client'

import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Spinner } from '@/components/ui/spinner'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { useSettings } from '@/lib/settings-context'
import { formatCurrency, formatDate } from '@/lib/format'
import {
  incomeLedgerToCSV, printIncomeLedger,
  type IncomeLedger, type IncomeLedgerSection,
} from '@/lib/reports'
import {
  Coins, Landmark, PiggyBank, FileSpreadsheet, FileText, RefreshCw, TrendingUp,
} from 'lucide-react'

type Period = 'day' | 'week' | 'month' | 'year' | 'custom'

function isoDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

// Compute [from, to] for a quick period ending today.
function periodRange(period: Period): [string, string] {
  const today = new Date()
  const to = isoDate(today)
  const from = new Date(today)
  switch (period) {
    case 'day': break
    case 'week': from.setDate(from.getDate() - 6); break
    case 'month': from.setMonth(from.getMonth() - 1); from.setDate(from.getDate() + 1); break
    case 'year': from.setFullYear(from.getFullYear() - 1); from.setDate(from.getDate() + 1); break
    default: break
  }
  return [isoDate(from), to]
}

function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function IncomeLedgerPage() {
  const { settings } = useSettings()
  const today = isoDate(new Date())

  const [period, setPeriod] = useState<Period>('month')
  const [startDate, setStartDate] = useState(() => periodRange('month')[0])
  const [endDate, setEndDate] = useState(today)
  const [ledger, setLedger] = useState<IncomeLedger | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const load = useCallback(async (from: string, to: string) => {
    setIsLoading(true)
    try {
      const result = await invoke<IncomeLedger>('get_income_ledger_cmd', { from, to })
      setLedger(result)
    } catch (err: any) {
      toast.error(err?.toString() || 'Failed to load income ledger')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    load(startDate, endDate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pickPeriod = (p: Period) => {
    setPeriod(p)
    if (p !== 'custom') {
      const [f, t] = periodRange(p)
      setStartDate(f); setEndDate(t)
      load(f, t)
    }
  }

  const handleExportCSV = () => {
    if (!ledger) return
    const csv = incomeLedgerToCSV(ledger, formatDate(startDate), formatDate(endDate))
    downloadCSV(csv, `income-ledger_${startDate}_to_${endDate}.csv`)
    toast.success('Exported')
  }

  const handlePrint = () => {
    if (!ledger) return
    printIncomeLedger(ledger, {
      shgName: settings?.general?.groupName,
      fromLabel: formatDate(startDate),
      toLabel: formatDate(endDate),
    })
  }

  const periods: { key: Period; label: string }[] = [
    { key: 'day', label: 'Today' },
    { key: 'week', label: 'This Week' },
    { key: 'month', label: 'This Month' },
    { key: 'year', label: 'This Year' },
    { key: 'custom', label: 'Custom' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader title="Income Ledger" description="Interest, chit commission, and savings collected over a period">
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExportCSV} disabled={!ledger}>
            <FileSpreadsheet className="mr-2 h-4 w-4" />Export CSV
          </Button>
          <Button variant="outline" onClick={handlePrint} disabled={!ledger}>
            <FileText className="mr-2 h-4 w-4" />Print / PDF
          </Button>
        </div>
      </PageHeader>

      {/* Period picker */}
      <Card>
        <CardContent className="pt-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            {periods.map(p => (
              <Button key={p.key} size="sm" variant={period === p.key ? 'default' : 'outline'}
                onClick={() => pickPeriod(p.key)}>
                {p.label}
              </Button>
            ))}
          </div>
          {period === 'custom' && (
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
              <Button onClick={() => load(startDate, endDate)} disabled={isLoading || !startDate || !endDate}>
                {isLoading ? <Spinner className="mr-2 h-4 w-4" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Load
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Showing {formatDate(startDate)} to {formatDate(endDate)}
          </p>
        </CardContent>
      </Card>

      {isLoading && !ledger ? (
        <div className="flex items-center justify-center py-12">
          <Spinner className="h-8 w-8" /><span className="ml-2">Loading…</span>
        </div>
      ) : ledger ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard title="Interest Income" value={formatCurrency(ledger.interest.total)}
              icon={Coins} description={`${ledger.interest.count} payment(s)`} />
            <StatCard title="Chit Commission" value={formatCurrency(ledger.chit.total)}
              icon={Landmark} description={`${ledger.chit.count} entry(ies)`} />
            <StatCard title="Savings Collected" value={formatCurrency(ledger.savings.total)}
              icon={PiggyBank} description={`${ledger.savings.count} deposit(s)`} />
            <StatCard title="Total Income" value={formatCurrency(ledger.grandTotal)}
              icon={TrendingUp} description="Interest + chit (excl. savings)" variant="success" />
          </div>

          <LedgerCard title="Interest Income" icon={<Coins className="h-5 w-5 text-amber-600" />}
            section={ledger.interest} />
          <LedgerCard title="Chit Commission Income" icon={<Landmark className="h-5 w-5 text-purple-600" />}
            section={ledger.chit} />
          <LedgerCard title="Savings Collected" icon={<PiggyBank className="h-5 w-5 text-blue-600" />}
            section={ledger.savings}
            note="Savings are member deposits the SHG holds — shown for tracking, not counted as profit." />
        </>
      ) : null}
    </div>
  )
}

function LedgerCard({ title, icon, section, note }: {
  title: string
  icon: React.ReactNode
  section: IncomeLedgerSection
  note?: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">{icon}{title}
            <Badge variant="secondary">{section.count}</Badge></span>
          <span className="text-sm font-semibold">{formatCurrency(section.total)}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {note && <p className="text-xs text-muted-foreground mb-3">{note}</p>}
        {section.entries.length === 0 ? (
          <p className="text-center text-muted-foreground py-6 text-sm">No entries in this period</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Member</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {section.entries.map((e, i) => (
                <TableRow key={e.id}>
                  <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                  <TableCell>{formatDate(e.date)}</TableCell>
                  <TableCell>{e.memberName ?? 'SHG'}</TableCell>
                  <TableCell className="max-w-xs truncate" title={e.note}>{e.note}</TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(e.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
