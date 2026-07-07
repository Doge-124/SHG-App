'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Spinner } from '@/components/ui/spinner'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { formatCurrency, formatDate } from '@/lib/format'
import { getGeneralLedger, type GeneralLedger, type GlKind } from '@/lib/api/general-ledger'
import { RefreshCw, TrendingUp, TrendingDown, ArrowLeftRight } from 'lucide-react'

type Period = 'day' | 'week' | 'month' | 'year' | 'custom'

function isoDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

// [from, to] for a quick period ending today.
function periodRange(period: Period): [string, string] {
  const today = new Date()
  const to = isoDate(today)
  const from = new Date(today)
  switch (period) {
    case 'day': break
    case 'week': from.setDate(from.getDate() - 6); break
    case 'month': from.setMonth(from.getMonth() - 1); from.setDate(from.getDate() + 1); break
    case 'year': {
      // Indian financial year (Apr 1 → Mar 31) containing today.
      const fyStartYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1
      from.setFullYear(fyStartYear, 3, 1)
      break
    }
    default: break
  }
  return [isoDate(from), to]
}

const KIND_LABEL: Record<GlKind, string> = { income: 'Income', expense: 'Expense', transfer: 'Transfer' }

function kindBadge(kind: GlKind) {
  const cls = kind === 'income'
    ? 'bg-success/10 text-success hover:bg-success/20'
    : kind === 'expense'
    ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
    : 'bg-muted text-muted-foreground'
  return <Badge className={cls}>{KIND_LABEL[kind]}</Badge>
}

export default function GeneralLedgerPage() {
  const today = isoDate(new Date())
  const [period, setPeriod] = useState<Period>('month')
  const [startDate, setStartDate] = useState(() => periodRange('month')[0])
  const [endDate, setEndDate] = useState(today)
  const [ledger, setLedger] = useState<GeneralLedger | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const [kindFilter, setKindFilter] = useState<'all' | GlKind>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  const load = useCallback(async (from: string, to: string) => {
    setIsLoading(true)
    try {
      setLedger(await getGeneralLedger(from, to))
    } catch (err: any) {
      toast.error(err?.toString() || 'Failed to load general ledger')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { load(startDate, endDate); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  const pickPeriod = (p: Period) => {
    setPeriod(p)
    if (p !== 'custom') {
      const [f, t] = periodRange(p)
      setStartDate(f); setEndDate(t)
      load(f, t)
    }
  }

  const periods: { key: Period; label: string }[] = [
    { key: 'day', label: 'Today' },
    { key: 'week', label: 'This Week' },
    { key: 'month', label: 'This Month' },
    { key: 'year', label: 'This Year' },
    { key: 'custom', label: 'Custom' },
  ]

  // Categories available for the current kind filter.
  const visibleCategories = useMemo(() => {
    if (!ledger) return []
    return ledger.categories.filter(c => kindFilter === 'all' || c.kind === kindFilter)
  }, [ledger, kindFilter])

  // Reset the category filter if it's no longer valid for the chosen kind.
  useEffect(() => {
    if (categoryFilter !== 'all' && !visibleCategories.some(c => c.category === categoryFilter)) {
      setCategoryFilter('all')
    }
  }, [visibleCategories, categoryFilter])

  const filteredEntries = useMemo(() => {
    if (!ledger) return []
    return ledger.entries.filter(e =>
      (kindFilter === 'all' || e.kind === kindFilter) &&
      (categoryFilter === 'all' || e.category === categoryFilter)
    )
  }, [ledger, kindFilter, categoryFilter])

  const filteredTotal = filteredEntries.reduce((s, e) => s + e.amount, 0)
  const net = (ledger?.totalIncome ?? 0) - (ledger?.totalExpense ?? 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="General Ledger"
        description="Every receipt and voucher, grouped by income / expense type. Filter by category and date range."
      />

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
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard title="Total Income" value={formatCurrency(ledger.totalIncome)} icon={TrendingUp} variant="success" />
            <StatCard title="Total Expenses" value={formatCurrency(ledger.totalExpense)} icon={TrendingDown} />
            <StatCard title="Net (Income − Expenses)" value={formatCurrency(net)} icon={ArrowLeftRight}
              variant={net >= 0 ? 'success' : 'default'} />
          </div>

          {/* Filters */}
          <Card>
            <CardContent className="pt-4 flex flex-wrap gap-4 items-end">
              <div className="space-y-1">
                <Label>Type</Label>
                <select
                  className="flex h-10 w-40 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={kindFilter}
                  onChange={e => setKindFilter(e.target.value as 'all' | GlKind)}
                >
                  <option value="all">All types</option>
                  <option value="income">Income</option>
                  <option value="expense">Expense</option>
                  <option value="transfer">Transfer / pass-through</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label>Category</Label>
                <select
                  className="flex h-10 w-64 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={categoryFilter}
                  onChange={e => setCategoryFilter(e.target.value)}
                >
                  <option value="all">All categories</option>
                  {visibleCategories.map(c => (
                    <option key={c.category} value={c.category}>
                      {c.category} — {formatCurrency(c.total)} ({c.count})
                    </option>
                  ))}
                </select>
              </div>
              <div className="ml-auto text-right">
                <p className="text-xs text-muted-foreground">Filtered total</p>
                <p className="text-lg font-bold">{formatCurrency(filteredTotal)}</p>
              </div>
            </CardContent>
          </Card>

          {/* Category breakdown */}
          <Card>
            <CardContent className="pt-4">
              <p className="text-sm font-semibold mb-3">By category</p>
              {visibleCategories.length === 0 ? (
                <p className="text-sm text-muted-foreground">No entries in this period.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Count</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleCategories.map(c => (
                      <TableRow key={c.category} className="cursor-pointer hover:bg-accent"
                        onClick={() => setCategoryFilter(c.category)}>
                        <TableCell className="font-medium">{c.category}</TableCell>
                        <TableCell>{kindBadge(c.kind)}</TableCell>
                        <TableCell className="text-right">{c.count}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(c.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Entries */}
          <Card>
            <CardContent className="pt-4">
              <p className="text-sm font-semibold mb-3">
                Entries {categoryFilter !== 'all' ? `— ${categoryFilter}` : ''} ({filteredEntries.length})
              </p>
              {filteredEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground">No entries match the filter.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredEntries.map(e => (
                        <TableRow key={`${e.txnType}-${e.id}`}>
                          <TableCell className="whitespace-nowrap text-sm">{formatDate(e.date)}</TableCell>
                          <TableCell className="text-sm">{e.category}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{e.description}</TableCell>
                          <TableCell className="text-xs uppercase text-muted-foreground">{e.paymentMethod}</TableCell>
                          <TableCell className={`text-right font-medium ${e.kind === 'expense' ? 'text-destructive' : e.kind === 'income' ? 'text-success' : ''}`}>
                            {formatCurrency(e.amount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  )
}
