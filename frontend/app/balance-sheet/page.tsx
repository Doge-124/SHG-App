'use client'

import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { PageHeader } from '@/components/page-header'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/format'
import { CheckCircle, AlertTriangle, RefreshCw, Scale } from 'lucide-react'
import { cn } from '@/lib/utils'

interface BalanceSheet {
  as_on_date: string
  cash_in_hand: number
  cash_at_bank: number
  loans_to_members: number
  fixed_assets: number
  chit_receivable: number
  total_assets: number
  member_savings: number
  total_members_with_savings: number
  chit_payable: number
  chit_winner_unpaid: number
  surplus: number
  shg_seed: number
  interest_earned: number
  chit_commission: number
  donations_grants: number
  opening_asset_capital: number
  other_income: number
  total_income: number
  other_expenses: number
  total_liabilities_capital: number
  is_balanced: boolean
  recon?: Record<string, number>
}

function formatDisplayDate(iso: string) {
  const [y, m, d] = iso.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`
}

function Row({
  label, value, bold = false, indent = false, muted = false, note
}: {
  label: string; value: number | string; bold?: boolean; indent?: boolean; muted?: boolean; note?: string
}) {
  return (
    <div className={cn('flex justify-between items-baseline py-1.5', indent && 'pl-5')}>
      <span className={cn('text-sm', muted ? 'text-muted-foreground' : bold ? 'font-semibold' : '')}>
        {label}
        {note && <span className="text-xs text-muted-foreground ml-1">({note})</span>}
      </span>
      <span className={cn('text-sm tabular-nums', bold ? 'font-semibold' : muted ? 'text-muted-foreground' : '')}>
        {typeof value === 'number' ? formatCurrency(value) : value}
      </span>
    </div>
  )
}

// FY-end quick-select dates: March 31 of years that have passed
function fyEndDates(): { label: string; date: string }[] {
  const today = new Date()
  const results = []
  const firstYear = today.getFullYear() - 5
  for (let y = firstYear; y <= today.getFullYear(); y++) {
    const march31 = new Date(y, 2, 31) // month 2 = March (0-indexed)
    if (march31 <= today) {
      const iso = `${y}-03-31`
      const fyStart = y - 1
      results.push({ label: `31 Mar ${y} (FY ${fyStart}-${String(y).slice(2)})`, date: iso })
    }
  }
  return results.reverse()
}

export default function BalanceSheetPage() {
  const today = new Date().toISOString().split('T')[0]
  const [asOnDate, setAsOnDate] = useState(today)
  const [data, setData] = useState<BalanceSheet | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => { load(today) }, [])

  const load = async (date: string) => {
    setIsLoading(true)
    try {
      const result = await invoke<BalanceSheet>('get_balance_sheet_cmd', { asOnDate: date })
      setData(result)
    } catch (err: any) {
      toast.error(err?.toString() || 'Failed to load balance sheet')
    } finally {
      setIsLoading(false)
    }
  }

  const quickDates = fyEndDates()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Balance Sheet"
        description="Snapshot of assets, liabilities and capital"
      >
        <Button variant="outline" onClick={() => load(asOnDate)} disabled={isLoading}>
          {isLoading ? <Spinner className="mr-2 h-4 w-4" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
      </PageHeader>

      {/* Date selector */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
              <Label>As on Date</Label>
              <Input
                type="date" value={asOnDate} max={today}
                onChange={e => setAsOnDate(e.target.value)}
                className="w-44"
              />
            </div>
            <Button onClick={() => load(asOnDate)} disabled={isLoading || !asOnDate}>
              {isLoading ? <Spinner className="mr-2 h-4 w-4" /> : <Scale className="mr-2 h-4 w-4" />}
              Load
            </Button>
            <div className="flex flex-wrap gap-2 items-end">
              <Button variant="outline" size="sm" onClick={() => { setAsOnDate(today); load(today) }}>
                Today
              </Button>
              {quickDates.slice(0, 3).map(q => (
                <Button key={q.date} variant="outline" size="sm"
                  onClick={() => { setAsOnDate(q.date); load(q.date) }}>
                  {q.label}
                </Button>
              ))}
            </div>
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
          {/* Balance check banner */}
          {data.is_balanced ? (
            <div className="flex items-center gap-3 rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-green-800">
              <CheckCircle className="h-5 w-5 flex-shrink-0" />
              <p className="text-sm font-medium">
                Balance Sheet balances as on {formatDisplayDate(data.as_on_date)} —
                Total Assets = Total Liabilities &amp; Capital = {formatCurrency(data.total_assets)}
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-red-800">
              <AlertTriangle className="h-5 w-5 flex-shrink-0" />
              <p className="text-sm font-medium">
                Balance Sheet does not reconcile — surplus from assets is{' '}
                {formatCurrency(data.surplus)}, but surplus from income − expenses is{' '}
                {formatCurrency(data.total_income - data.other_expenses)}
                {' '}(difference {formatCurrency(Math.abs(data.surplus - (data.total_income - data.other_expenses)))}).
                Some value changed the asset side without flowing through income/expenses.
              </p>
            </div>
          )}

          {!data.is_balanced && data.recon && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
              <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide mb-2">
                Reconciliation components (diagnostic)
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-xs font-mono">
                {Object.entries(data.recon).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <span className="text-muted-foreground">{k}</span>
                    <span className="font-medium">{formatCurrency(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-center text-sm font-semibold text-muted-foreground uppercase tracking-widest">
            Balance Sheet as on {formatDisplayDate(data.as_on_date)}
          </p>

          {/* Two-column layout */}
          <div className="grid gap-6 lg:grid-cols-2">

            {/* LEFT — Liabilities & Capital */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Liabilities &amp; Capital</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">

                {/* Member Savings */}
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Member Funds
                </p>
                <Row label="Member Savings Deposits"
                  note={`${data.total_members_with_savings} members`}
                  value={data.member_savings} />

                {(data.chit_payable - data.chit_winner_unpaid) > 0 && (
                  <Row
                    label="Chit dues payable (members yet to win)"
                    note="paid in so far, not yet won — owed back by the SHG"
                    value={data.chit_payable - data.chit_winner_unpaid}
                  />
                )}

                {Math.abs(data.chit_winner_unpaid) > 0.005 && (
                  <Row
                    label="Chit prizes awarded, not yet paid out"
                    note="won, but the payout has not been fully disbursed in cash"
                    value={data.chit_winner_unpaid}
                  />
                )}

                <Separator className="my-4" />

                {/* SHG Capital / Surplus */}
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  SHG Capital &amp; Surplus
                </p>

                {/* Income sources */}
                {data.shg_seed !== 0 && (
                  <Row label="SHG Opening Capital" value={data.shg_seed} indent muted />
                )}
                {data.interest_earned > 0 && (
                  <Row label="Interest Earned on Loans" value={data.interest_earned} indent muted />
                )}
                {data.chit_commission > 0 && (
                  <Row label="Chit Commission" value={data.chit_commission} indent muted />
                )}
                {data.donations_grants > 0 && (
                  <Row label="Donations &amp; Grants" value={data.donations_grants} indent muted />
                )}
                {data.opening_asset_capital > 0 && (
                  <Row label="Fixed Assets Brought In"
                    note="opening capital — assets owned before using the app"
                    value={data.opening_asset_capital} indent muted />
                )}
                {data.other_income > 0 && (
                  <Row label="Other Income"
                    note="miscellaneous receipts"
                    value={data.other_income} indent muted />
                )}
                {data.other_expenses > 0 && (
                  <Row label="Less: Operating Expenses"
                    note="excludes loans, chit payouts &amp; asset purchases"
                    value={-data.other_expenses} indent muted />
                )}
                <Row label="Total Surplus / Reserve" value={data.surplus} bold />

                <Separator className="my-4" />
                <Row label="Total Liabilities &amp; Capital" value={data.total_liabilities_capital} bold />
              </CardContent>
            </Card>

            {/* RIGHT — Assets */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Assets</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">

                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Current Assets
                </p>
                <Row label="Cash in Hand" value={data.cash_in_hand} />
                <Row label="Cash at Bank" value={data.cash_at_bank} />
                <Row label="Loans to Members (Outstanding)" value={data.loans_to_members} />
                {data.chit_receivable > 0 && (
                  <Row label="Chit dues receivable (winners repaying)"
                    note="won already, still repaying remaining installments"
                    value={data.chit_receivable} />
                )}
                {data.fixed_assets > 0 && (
                  <Row label="Fixed Assets (at cost)" value={data.fixed_assets} />
                )}
                <Separator className="my-4" />
                <Row label="Total Assets" value={data.total_assets} bold />

                {/* Mini breakdown */}
                <Separator className="my-4" />
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Asset Composition
                </p>
                {data.total_assets > 0 && (
                  <div className="space-y-2 text-xs text-muted-foreground">
                    <div className="flex justify-between">
                      <span>Liquid (Cash + Bank)</span>
                      <span>{((data.cash_in_hand + data.cash_at_bank) / data.total_assets * 100).toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Deployed (Loans Outstanding)</span>
                      <span>{(data.loans_to_members / data.total_assets * 100).toFixed(1)}%</span>
                    </div>
                    {/* Visual bar */}
                    <div className="flex h-2 rounded-full overflow-hidden mt-1">
                      <div
                        className="bg-blue-400"
                        style={{ width: `${(data.cash_in_hand + data.cash_at_bank) / data.total_assets * 100}%` }}
                      />
                      <div
                        className="bg-orange-400"
                        style={{ width: `${(data.loans_to_members / data.total_assets * 100)}%` }}
                      />
                    </div>
                    <div className="flex gap-4">
                      <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-blue-400" />Liquid</span>
                      <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-orange-400" />Loans</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Summary footer */}
          <Card className="border-muted">
            <CardContent className="pt-4">
              <div className="grid gap-4 sm:grid-cols-4 text-sm">
                <div className="text-center">
                  <p className="text-muted-foreground text-xs mb-1">Total Assets</p>
                  <p className="font-bold text-lg">{formatCurrency(data.total_assets)}</p>
                </div>
                <div className="text-center">
                  <p className="text-muted-foreground text-xs mb-1">Member Savings</p>
                  <p className="font-bold text-lg text-blue-700">{formatCurrency(data.member_savings)}</p>
                </div>
                <div className="text-center">
                  <p className="text-muted-foreground text-xs mb-1">SHG Surplus</p>
                  <p className={cn('font-bold text-lg', data.surplus >= 0 ? 'text-green-700' : 'text-red-600')}>
                    {formatCurrency(data.surplus)}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-muted-foreground text-xs mb-1">Loans Deployed</p>
                  <p className="font-bold text-lg text-orange-600">{formatCurrency(data.loans_to_members)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
