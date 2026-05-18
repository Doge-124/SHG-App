'use client'

import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { PageHeader } from '@/components/page-header'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/format'
import { TrendingUp, TrendingDown, RefreshCw, ReceiptText, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

interface IncomeExpenditureAccount {
  financial_year: string
  from_date: string
  to_date: string
  interest_on_loans: number
  chit_commission: number
  donations_grants: number
  other_income: number
  total_income: number
  operational_expenses: number
  total_expenditure: number
  surplus: number
  loans_outstanding_start: number
  loans_disbursed_in_period: number
  loan_repayments_in_period: number
  loans_outstanding_end: number
  principal_recovered: number
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${parseInt(d)} ${months[parseInt(m)-1]} ${y}`
}

function formatFY(year: number) {
  return `${year}-${String((year + 1) % 100).padStart(2, '0')}`
}

function Row({ label, amount, bold = false, indent = false, positive = true, note }: {
  label: string; amount: number; bold?: boolean; indent?: boolean; positive?: boolean; note?: string
}) {
  return (
    <div className={cn('flex justify-between items-baseline py-1.5', indent && 'pl-5')}>
      <span className={cn('text-sm', bold ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
        {label}
        {note && <span className="text-xs text-muted-foreground ml-1">({note})</span>}
      </span>
      <span className={cn('text-sm tabular-nums font-medium', bold && 'font-semibold')}>
        {formatCurrency(amount)}
      </span>
    </div>
  )
}

export default function IncomeExpenditurePage() {
  const [years, setYears] = useState<number[]>([])
  const [selectedYear, setSelectedYear] = useState<number | null>(null)
  const [data, setData] = useState<IncomeExpenditureAccount | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [showWorking, setShowWorking] = useState(false)

  useEffect(() => {
    invoke<number[]>('get_available_financial_years_cmd').then(ys => {
      setYears(ys)
      if (ys.length > 0) {
        const latest = ys[ys.length - 1]
        setSelectedYear(latest)
        load(latest)
      }
    }).catch(() => toast.error('Failed to load financial years'))
  }, [])

  const load = async (year: number) => {
    setIsLoading(true)
    try {
      const result = await invoke<IncomeExpenditureAccount>('get_income_expenditure_cmd', { financialYear: year })
      setData(result)
    } catch (err: any) {
      toast.error(err?.toString() || 'Failed to load I&E account')
    } finally {
      setIsLoading(false)
    }
  }

  const isSurplus = data ? data.surplus >= 0 : true

  return (
    <div className="space-y-6">
      <PageHeader
        title="Income & Expenditure Account"
        description="Revenue-based P&L — true income and expenses, excluding capital flows"
      >
        <Button variant="outline" onClick={() => selectedYear && load(selectedYear)} disabled={isLoading}>
          {isLoading ? <Spinner className="mr-2 h-4 w-4" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
      </PageHeader>

      {/* FY selector */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">Financial Year</p>
              <Select
                value={selectedYear?.toString() ?? ''}
                onValueChange={v => {
                  const y = parseInt(v)
                  setSelectedYear(y)
                  load(y)
                }}
              >
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Select FY" />
                </SelectTrigger>
                <SelectContent>
                  {years.map(y => (
                    <SelectItem key={y} value={y.toString()}>FY {formatFY(y)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {data && (
              <p className="text-sm text-muted-foreground pb-1">
                {formatDate(data.from_date)} — {formatDate(data.to_date)}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Spinner className="h-8 w-8" />
        </div>
      )}

      {!isLoading && data && (
        <>
          {/* Summary cards */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="border-green-200">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100">
                    <TrendingUp className="h-5 w-5 text-green-700" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total Income</p>
                    <p className="font-bold text-green-700">{formatCurrency(data.total_income)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-red-200">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-100">
                    <TrendingDown className="h-5 w-5 text-red-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total Expenditure</p>
                    <p className="font-bold text-red-600">{formatCurrency(data.total_expenditure)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className={cn(isSurplus ? 'border-blue-200' : 'border-orange-300')}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', isSurplus ? 'bg-blue-100' : 'bg-orange-100')}>
                    <ReceiptText className={cn('h-5 w-5', isSurplus ? 'text-blue-700' : 'text-orange-600')} />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{isSurplus ? 'Surplus' : 'Deficit'}</p>
                    <p className={cn('font-bold', isSurplus ? 'text-blue-700' : 'text-orange-600')}>
                      {formatCurrency(Math.abs(data.surplus))}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Main account — two columns */}
          <p className="text-center text-sm font-semibold text-muted-foreground uppercase tracking-widest">
            Income &amp; Expenditure Account — FY {data.financial_year}
          </p>

          <div className="grid gap-6 lg:grid-cols-2">

            {/* Income */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-green-600" />
                    Income (Cr)
                  </span>
                  <Badge variant="outline" className="font-mono text-green-700 border-green-300">
                    {formatCurrency(data.total_income)}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {data.interest_on_loans > 0 && (
                  <Row label="Interest on Loans" amount={data.interest_on_loans} />
                )}
                {data.chit_commission > 0 && (
                  <Row label="Chit Fund Commission" amount={data.chit_commission} />
                )}
                {data.donations_grants > 0 && (
                  <Row label="Donations &amp; Grants" amount={data.donations_grants} />
                )}
                {data.other_income > 0 && (
                  <Row label="Other Income" amount={data.other_income} />
                )}
                {data.total_income === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">No income recorded for this period</p>
                )}

                <Separator className="my-3" />
                <Row label="Total Income" amount={data.total_income} bold />
              </CardContent>
            </Card>

            {/* Expenditure */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <TrendingDown className="h-4 w-4 text-red-600" />
                    Expenditure (Dr)
                  </span>
                  <Badge variant="outline" className="font-mono text-red-700 border-red-300">
                    {formatCurrency(data.total_expenditure)}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {data.operational_expenses > 0 && (
                  <Row label="Operational Expenses" amount={data.operational_expenses} />
                )}
                {data.total_expenditure === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">No expenses recorded for this period</p>
                )}

                <Separator className="my-3" />
                <Row label="Total Expenditure" amount={data.total_expenditure} bold />

                <Separator className="my-3" />
                <div className={cn(
                  'flex justify-between items-baseline py-2 px-3 rounded-lg',
                  isSurplus ? 'bg-blue-50' : 'bg-orange-50'
                )}>
                  <span className={cn('text-sm font-semibold', isSurplus ? 'text-blue-800' : 'text-orange-800')}>
                    {isSurplus ? 'Surplus transferred to Balance Sheet' : 'Deficit transferred to Balance Sheet'}
                  </span>
                  <span className={cn('text-sm font-bold tabular-nums', isSurplus ? 'text-blue-800' : 'text-orange-800')}>
                    {formatCurrency(Math.abs(data.surplus))}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Interest working note */}
          <Card className="border-muted">
            <CardHeader>
              <CardTitle className="text-sm text-muted-foreground flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Info className="h-4 w-4" />
                  Note: Interest on Loans — Working
                </span>
                <Button variant="ghost" size="sm" onClick={() => setShowWorking(v => !v)} className="h-7 text-xs">
                  {showWorking ? 'Hide' : 'Show'}
                </Button>
              </CardTitle>
            </CardHeader>
            {showWorking && (
              <CardContent>
                <div className="space-y-2 text-sm">
                  <div className="grid gap-2 grid-cols-2 bg-muted/40 rounded-lg p-3 text-xs">
                    <div>
                      <p className="text-muted-foreground">Loans outstanding (start of FY)</p>
                      <p className="font-medium">{formatCurrency(data.loans_outstanding_start)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">New loans disbursed during FY</p>
                      <p className="font-medium">{formatCurrency(data.loans_disbursed_in_period)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Loans outstanding (end of FY)</p>
                      <p className="font-medium">{formatCurrency(data.loans_outstanding_end)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Principal recovered (start + disbursed − end)</p>
                      <p className="font-medium">{formatCurrency(data.principal_recovered)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Total repayments received</p>
                      <p className="font-medium">{formatCurrency(data.loan_repayments_in_period)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground font-semibold text-foreground">Interest earned (repayments − principal)</p>
                      <p className="font-semibold text-green-700">{formatCurrency(data.interest_on_loans)}</p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Interest = Total Repayments − Principal Recovered.
                    Principal Recovered = Outstanding at Start + Disbursed during FY − Outstanding at End.
                    This isolates genuine interest income from capital repayments.
                  </p>
                </div>
              </CardContent>
            )}
          </Card>

          {/* Note on excluded items */}
          <Card className="border-muted bg-muted/20">
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">
                <strong>Excluded from this account</strong> (capital flows, not income/expense):
                Member savings contributions · Loan principal disbursements · Loan principal repayments ·
                Chit installments collected · Chit payouts to winners.
                These appear in the Receipts &amp; Payments Account (Trial Balance) instead.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
