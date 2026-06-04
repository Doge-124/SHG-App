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
import { CheckCircle, AlertTriangle, RefreshCw, Scale, Banknote, LandmarkIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TrialBalance {
  financial_year: string
  from_date: string
  to_date: string
  opening_cash: number
  opening_bank: number
  shg_opening_seed: number
  savings_contributions: number
  loan_repayments: number
  upfront_loan_interest: number
  chit_installments: number
  chit_commission: number
  grants_donations: number
  other_receipts: number
  total_dr: number
  loans_disbursed: number
  savings_payouts: number
  chit_payouts: number
  member_payments: number
  other_payments: number
  closing_cash: number
  closing_bank: number
  total_cr: number
  outstanding_loans: number
  actual_cash_balance: number
  actual_bank_balance: number
  is_balanced: boolean
  cash_reconciled: boolean
  bank_reconciled: boolean
}

function formatFY(year: number) {
  return `${year}-${String((year + 1) % 100).padStart(2, '0')}`
}

function formatDate(d: string) {
  const [y, m, day] = d.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${parseInt(day)} ${months[parseInt(m) - 1]} ${y}`
}

function Row({ label, amount, bold = false, indent = false }: { label: string; amount: number; bold?: boolean; indent?: boolean }) {
  return (
    <div className={cn('flex justify-between py-1.5 text-sm', bold && 'font-semibold', indent && 'pl-4')}>
      <span className={cn('text-muted-foreground', bold && 'text-foreground')}>{label}</span>
      <span className={cn(bold && 'text-foreground')}>{formatCurrency(amount)}</span>
    </div>
  )
}

export default function TrialBalancePage() {
  const [years, setYears] = useState<number[]>([])
  const [selectedYear, setSelectedYear] = useState<number | null>(null)
  const [data, setData] = useState<TrialBalance | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    invoke<number[]>('get_available_financial_years_cmd').then(ys => {
      setYears(ys)
      if (ys.length > 0) {
        const latest = ys[ys.length - 1]
        setSelectedYear(latest)
        loadBalance(latest)
      }
    }).catch(() => toast.error('Failed to load financial years'))
  }, [])

  const loadBalance = async (year: number) => {
    setIsLoading(true)
    try {
      const result = await invoke<TrialBalance>('get_trial_balance_cmd', { financialYear: year })
      setData(result)
    } catch (err: any) {
      toast.error(err?.toString() || 'Failed to load trial balance')
    } finally {
      setIsLoading(false)
    }
  }

  const allGood = data && data.is_balanced && data.cash_reconciled && data.bank_reconciled

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trial Balance"
        description="Receipts & Payments Account — yearly financial verification"
      >
        <Button variant="outline" onClick={() => selectedYear && loadBalance(selectedYear)} disabled={isLoading}>
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
                  loadBalance(y)
                }}
              >
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Select FY" />
                </SelectTrigger>
                <SelectContent>
                  {years.map(y => (
                    <SelectItem key={y} value={y.toString()}>
                      FY {formatFY(y)}
                    </SelectItem>
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
          {/* Status cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className={cn(data.is_balanced ? 'border-green-300' : 'border-red-300')}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', data.is_balanced ? 'bg-green-100' : 'bg-red-100')}>
                    <Scale className={cn('h-5 w-5', data.is_balanced ? 'text-green-700' : 'text-red-600')} />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Account</p>
                    <p className={cn('font-semibold text-sm', data.is_balanced ? 'text-green-700' : 'text-red-600')}>
                      {data.is_balanced ? 'Balanced' : 'Mismatch'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className={cn(data.cash_reconciled ? 'border-green-300' : 'border-orange-300')}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', data.cash_reconciled ? 'bg-green-100' : 'bg-orange-100')}>
                    <Banknote className={cn('h-5 w-5', data.cash_reconciled ? 'text-green-700' : 'text-orange-600')} />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Cash</p>
                    <p className={cn('font-semibold text-sm', data.cash_reconciled ? 'text-green-700' : 'text-orange-600')}>
                      {data.cash_reconciled ? 'Reconciled' : 'Check Required'}
                    </p>
                    <p className="text-xs text-muted-foreground">{formatCurrency(data.closing_cash)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className={cn(data.bank_reconciled ? 'border-green-300' : 'border-orange-300')}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', data.bank_reconciled ? 'bg-green-100' : 'bg-orange-100')}>
                    <LandmarkIcon className={cn('h-5 w-5', data.bank_reconciled ? 'text-green-700' : 'text-orange-600')} />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Bank</p>
                    <p className={cn('font-semibold text-sm', data.bank_reconciled ? 'text-green-700' : 'text-orange-600')}>
                      {data.bank_reconciled ? 'Reconciled' : 'Check Required'}
                    </p>
                    <p className="text-xs text-muted-foreground">{formatCurrency(data.closing_bank)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
                    <Banknote className="h-5 w-5 text-blue-700" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Loans Outstanding</p>
                    <p className="font-semibold text-sm text-blue-700">{formatCurrency(data.outstanding_loans)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Overall status banner */}
          {allGood ? (
            <div className="flex items-center gap-3 rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-green-800">
              <CheckCircle className="h-5 w-5 flex-shrink-0" />
              <p className="text-sm font-medium">Books are balanced and reconciled for FY {data.financial_year}.</p>
            </div>
          ) : (
            <div className="flex items-start gap-3 rounded-lg border border-orange-300 bg-orange-50 px-4 py-3 text-orange-800">
              <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
              <div className="text-sm space-y-1">
                <p className="font-medium">Action required for FY {data.financial_year}:</p>
                {!data.is_balanced && <p>• Account totals do not match (Dr: {formatCurrency(data.total_dr)} vs Cr: {formatCurrency(data.total_cr)})</p>}
                {!data.cash_reconciled && <p>• Cash balance mismatch: computed {formatCurrency(data.closing_cash)} vs actual {formatCurrency(data.actual_cash_balance)}</p>}
                {!data.bank_reconciled && <p>• Bank balance mismatch: computed {formatCurrency(data.closing_bank)} vs actual {formatCurrency(data.actual_bank_balance)}</p>}
              </div>
            </div>
          )}

          {/* Receipts & Payments table */}
          <div className="grid gap-6 lg:grid-cols-2">

            {/* Dr — Receipts */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between">
                  <span>Dr — Receipts</span>
                  <Badge variant="outline" className="font-mono">{formatCurrency(data.total_dr)}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Opening Balance</p>
                <Row label="Cash in Hand" amount={data.opening_cash} indent />
                <Row label="Cash at Bank" amount={data.opening_bank} indent />
                <Row label="Total Opening" amount={data.opening_cash + data.opening_bank} bold />

                <Separator className="my-3" />
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Receipts During the Year</p>
                {data.shg_opening_seed > 0 && <Row label="SHG Opening Balance (Seed)" amount={data.shg_opening_seed} />}
                {data.savings_contributions > 0 && <Row label="Member Savings / Contributions" amount={data.savings_contributions} />}
                {data.loan_repayments > 0 && <Row label="Loan Repayments (Principal + Interest)" amount={data.loan_repayments} />}
                {data.upfront_loan_interest > 0 && <Row label="Upfront Loan Interest" amount={data.upfront_loan_interest} />}
                {data.chit_installments > 0 && <Row label="Chit Installments" amount={data.chit_installments} />}
                {data.chit_commission > 0 && <Row label="Chit Commission" amount={data.chit_commission} />}
                {data.grants_donations > 0 && <Row label="Grants & Donations" amount={data.grants_donations} />}
                {data.other_receipts > 0 && <Row label="Other Receipts" amount={data.other_receipts} />}

                <Separator className="my-3" />
                <Row label="Total Dr" amount={data.total_dr} bold />
              </CardContent>
            </Card>

            {/* Cr — Payments */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between">
                  <span>Cr — Payments</span>
                  <Badge variant="outline" className="font-mono">{formatCurrency(data.total_cr)}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Payments During the Year</p>
                {data.loans_disbursed > 0 && <Row label="Loans Disbursed to Members" amount={data.loans_disbursed} />}
                {data.savings_payouts > 0 && <Row label="Savings Paid Out to Members" amount={data.savings_payouts} />}
                {data.chit_payouts > 0 && <Row label="Chit Payouts to Winners" amount={data.chit_payouts} />}
                {data.member_payments > 0 && <Row label="Member Payments & Expenses" amount={data.member_payments} />}
                {data.other_payments > 0 && <Row label="Other Payments" amount={data.other_payments} />}

                <Separator className="my-3" />
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Closing Balance</p>
                <Row label="Cash in Hand" amount={data.closing_cash} indent />
                <Row label="Cash at Bank" amount={data.closing_bank} indent />
                <Row label="Total Closing" amount={data.closing_cash + data.closing_bank} bold />

                <Separator className="my-3" />
                <Row label="Total Cr" amount={data.total_cr} bold />
              </CardContent>
            </Card>
          </div>

          {/* Reconciliation note */}
          <Card className="border-muted">
            <CardHeader><CardTitle className="text-sm text-muted-foreground">Balance Reconciliation</CardTitle></CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Computed Cash Balance</p>
                  <p className="font-semibold">{formatCurrency(data.closing_cash)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Actual Cash (Live)</p>
                  <p className={cn('font-semibold', !data.cash_reconciled && 'text-orange-600')}>{formatCurrency(data.actual_cash_balance)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Cash Difference</p>
                  <p className={cn('font-semibold', Math.abs(data.closing_cash - data.actual_cash_balance) > 0.01 ? 'text-orange-600' : 'text-green-700')}>
                    {formatCurrency(Math.abs(data.closing_cash - data.actual_cash_balance))}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Computed Bank Balance</p>
                  <p className="font-semibold">{formatCurrency(data.closing_bank)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Actual Bank (Live)</p>
                  <p className={cn('font-semibold', !data.bank_reconciled && 'text-orange-600')}>{formatCurrency(data.actual_bank_balance)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Bank Difference</p>
                  <p className={cn('font-semibold', Math.abs(data.closing_bank - data.actual_bank_balance) > 0.01 ? 'text-orange-600' : 'text-green-700')}>
                    {formatCurrency(Math.abs(data.closing_bank - data.actual_bank_balance))}
                  </p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-4">
                Reconciliation is only checked for the current financial year. For past years, closing balance reflects the computed total at year-end.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
