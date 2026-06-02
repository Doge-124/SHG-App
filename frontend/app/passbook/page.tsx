'use client'

import { useState, useEffect, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Spinner } from '@/components/ui/spinner'
import { PageHeader } from '@/components/page-header'
import { toast } from 'sonner'
import { formatCurrency, formatDate, loanRef } from '@/lib/format'
import { BookOpen, RefreshCw, Printer, User, Banknote, Coins } from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────────────

interface Member {
  id: string
  name: string
  code: string
  memberType: string
}

interface PassbookEntry {
  id: number
  date: string
  particulars: string
  txnType: string
  credit: number
  runningBalance: number
}

interface MemberPassbook {
  memberId: number
  memberName: string
  memberCode: string
  memberType: string
  joinDate: string
  fromDate: string
  toDate: string
  migrationOpening: number
  openingBalance: number
  entries: PassbookEntry[]
  totalCredits: number
  closingBalance: number
  totalInstallments: number
}

interface LoanLedgerEntry {
  id: number
  date: string
  particulars: string
  debit: number
  credit: number
  principal: number
  interest: number
  runningOutstanding: number
}

interface LoanPassbookLoan {
  loanId: number
  amount: number
  issuedAt: string
  status: string
  loanType: string
  dailyInterestRate: number
  outstanding: number
  totalPrincipalPaid: number
  totalInterestPaid: number
  entries: LoanLedgerEntry[]
}

interface MemberLoanPassbook {
  memberId: number
  memberName: string
  memberCode: string
  memberType: string
  joinDate: string
  loans: LoanPassbookLoan[]
  totalDisbursed: number
  totalPrincipalPaid: number
  totalInterestPaid: number
  totalOutstanding: number
}

interface ChitLedgerEntry {
  id: number
  date: string
  particulars: string
  paid: number
  won: number
  runningPaid: number
}

interface ChitPassbookGroup {
  chitId: number
  chitName: string
  passbookNumber: string | null
  totalAmount: number
  monthlyContribution: number
  status: string
  entries: ChitLedgerEntry[]
  totalPaid: number
  totalWon: number
}

interface MemberChitPassbook {
  memberId: number
  memberName: string
  memberCode: string
  memberType: string
  joinDate: string
  groups: ChitPassbookGroup[]
  totalPaid: number
  totalWon: number
}

function formatFY(year: number) {
  return `${year}-${String((year + 1) % 100).padStart(2, '0')}`
}

// Quick-select FY date ranges (savings only)
function fyRanges(): { label: string; from: string; to: string }[] {
  const today = new Date()
  const currentFyStart = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1
  const ranges = []
  for (let y = currentFyStart; y >= currentFyStart - 4; y--) {
    ranges.push({
      label: `FY ${formatFY(y)}`,
      from: `${y}-04-01`,
      to: `${y + 1}-03-31`,
    })
  }
  return ranges
}

const TYPE_LABEL: Record<string, string> = {
  SHG: 'Savings Member',
  LOAN: 'Loan Member',
  CHIT: 'Chit Member',
}

export default function PassbookPage() {
  const searchParams = useSearchParams()
  const preselectedMemberId = searchParams?.get('memberId') ?? ''

  const today = new Date().toISOString().split('T')[0]
  const [members, setMembers] = useState<Member[]>([])
  const [selectedMemberId, setSelectedMemberId] = useState(preselectedMemberId)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [savings, setSavings] = useState<MemberPassbook | null>(null)
  const [loanBook, setLoanBook] = useState<MemberLoanPassbook | null>(null)
  const [chitBook, setChitBook] = useState<MemberChitPassbook | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingMembers, setIsLoadingMembers] = useState(true)
  const [search, setSearch] = useState('')

  const selectedMember = useMemo(
    () => members.find(m => m.id === selectedMemberId),
    [members, selectedMemberId],
  )
  const selectedType = selectedMember?.memberType ?? ''
  const isSavings = selectedType === 'SHG'
  const hasData = !!savings || !!loanBook || !!chitBook

  // Load all members
  useEffect(() => {
    invoke<any[]>('list_members').then(raw => {
      const mapped = raw.map(m => ({
        id: m.id?.toString() ?? '',
        name: m.name ?? '',
        code: m.member_code ?? '',
        memberType: m.member_type ?? '',
      }))
      setMembers(mapped)
    }).catch(() => toast.error('Failed to load members'))
      .finally(() => setIsLoadingMembers(false))
  }, [])

  const clearBooks = () => { setSavings(null); setLoanBook(null); setChitBook(null) }

  const loadPassbook = async (memberId: string, type: string, from: string, to: string) => {
    if (!memberId) { toast.error('Select a member first'); return }
    setIsLoading(true)
    clearBooks()
    try {
      if (type === 'LOAN') {
        const result = await invoke<MemberLoanPassbook>('get_member_loan_passbook', {
          memberId: parseInt(memberId),
        })
        setLoanBook(result)
      } else if (type === 'CHIT') {
        const result = await invoke<MemberChitPassbook>('get_member_chit_passbook', {
          memberId: parseInt(memberId),
        })
        setChitBook(result)
      } else {
        const result = await invoke<MemberPassbook>('get_member_passbook', {
          memberId: parseInt(memberId),
          fromDate: from,
          toDate: to,
        })
        setSavings(result)
      }
    } catch (err: any) {
      toast.error(err?.toString() || 'Failed to load passbook')
    } finally {
      setIsLoading(false)
    }
  }

  // Auto-load if member pre-selected from profile page (waits for members so
  // we know the member's type before choosing which passbook to fetch).
  useEffect(() => {
    if (preselectedMemberId && members.length > 0) {
      const m = members.find(x => x.id === preselectedMemberId)
      if (m) {
        setSelectedMemberId(preselectedMemberId)
        loadPassbook(preselectedMemberId, m.memberType, '', '')
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectedMemberId, members.length])

  const handleLoad = () => loadPassbook(selectedMemberId, selectedType, fromDate, toDate)

  const handleFyQuick = (from: string, to: string) => {
    setFromDate(from)
    setToDate(to)
    loadPassbook(selectedMemberId, selectedType, from, to)
  }

  const handleAllTime = () => {
    setFromDate('')
    setToDate('')
    loadPassbook(selectedMemberId, selectedType, '', '')
  }

  const handlePrint = () => window.print()

  const filteredMembers = useMemo(() =>
    members.filter(m =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.code.toLowerCase().includes(search.toLowerCase())
    ), [members, search]
  )

  const ranges = fyRanges()

  // Shared member header card.
  const header = (info: { name: string; code: string; joinDate: string; memberType: string }, right: React.ReactNode) => (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <User className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-bold">{info.name}</h2>
              <p className="text-sm text-muted-foreground">
                Code: {info.code} · Joined: {formatDate(info.joinDate)}
              </p>
              <Badge variant="outline" className="text-xs mt-1">
                {TYPE_LABEL[info.memberType] ?? info.memberType}
              </Badge>
            </div>
          </div>
          {right}
        </div>
      </CardContent>
    </Card>
  )

  return (
    <div className="space-y-6">
      <PageHeader title="Member Passbook" description="Per-member ledger — savings, loans, or chit history">
        <Button variant="outline" onClick={handlePrint} disabled={!hasData} className="print:hidden">
          <Printer className="mr-2 h-4 w-4" />Print
        </Button>
        <Button variant="outline" onClick={handleLoad} disabled={isLoading || !selectedMemberId} className="print:hidden">
          {isLoading ? <Spinner className="mr-2 h-4 w-4" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
      </PageHeader>

      {/* Controls */}
      <Card className="print:hidden">
        <CardContent className="pt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1 lg:col-span-1">
              <Label>Member</Label>
              <Input
                placeholder="Search name or code…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="mb-1"
              />
              <Select
                value={selectedMemberId}
                onValueChange={v => { setSelectedMemberId(v); clearBooks() }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={isLoadingMembers ? 'Loading…' : 'Select member'} />
                </SelectTrigger>
                <SelectContent>
                  {filteredMembers.map(m => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name} <span className="text-muted-foreground ml-1">({m.code} · {m.memberType})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date range only applies to the savings passbook */}
            {isSavings && (
              <>
                <div className="space-y-1">
                  <Label>From</Label>
                  <Input type="date" value={fromDate} max={today} onChange={e => setFromDate(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>To</Label>
                  <Input type="date" value={toDate} max={today} min={fromDate} onChange={e => setToDate(e.target.value)} />
                </div>
              </>
            )}
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <Button onClick={handleLoad} disabled={isLoading || !selectedMemberId}>
              <BookOpen className="mr-2 h-4 w-4" />Load Passbook
            </Button>
            {isSavings && (
              <>
                <Button variant="outline" size="sm" onClick={handleAllTime}>All Time</Button>
                {ranges.slice(0, 3).map(r => (
                  <Button key={r.from} variant="outline" size="sm" onClick={() => handleFyQuick(r.from, r.to)}>
                    {r.label}
                  </Button>
                ))}
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Spinner className="h-8 w-8" />
        </div>
      )}

      {/* ── Savings passbook (SHG) ───────────────────────────────────────── */}
      {!isLoading && savings && (
        <>
          {header(
            { name: savings.memberName, code: savings.memberCode, joinDate: savings.joinDate, memberType: savings.memberType },
            <div className="text-right">
              <p className="text-xs text-muted-foreground">
                {savings.fromDate ? `${formatDate(savings.fromDate)} — ${formatDate(savings.toDate)}` : 'All Time'}
              </p>
              <p className="text-2xl font-bold text-green-700 mt-1">{formatCurrency(savings.closingBalance)}</p>
              <p className="text-xs text-muted-foreground">Current Balance</p>
            </div>,
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <BookOpen className="h-4 w-4" />Savings Passbook
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="w-8 text-center">#</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Particulars</TableHead>
                      <TableHead className="text-right">Credit (Rs.)</TableHead>
                      <TableHead className="text-right">Balance (Rs.)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {savings.migrationOpening > 0 && !savings.fromDate && (
                      <TableRow className="bg-amber-50/60 text-sm">
                        <TableCell className="text-center text-muted-foreground">—</TableCell>
                        <TableCell className="text-muted-foreground">Before app</TableCell>
                        <TableCell className="text-amber-800">Pre-migration savings (past data)</TableCell>
                        <TableCell className="text-right font-medium text-amber-700">+{formatCurrency(savings.migrationOpening)}</TableCell>
                        <TableCell className="text-right font-semibold text-amber-700">{formatCurrency(savings.migrationOpening)}</TableCell>
                      </TableRow>
                    )}
                    {(savings.fromDate || savings.openingBalance > savings.migrationOpening) && (
                      <TableRow className="bg-blue-50/50 font-medium text-sm">
                        <TableCell className="text-center text-muted-foreground">—</TableCell>
                        <TableCell className="text-muted-foreground">{savings.fromDate ? formatDate(savings.fromDate) : 'Opening'}</TableCell>
                        <TableCell className="text-muted-foreground">{savings.fromDate ? 'Balance brought forward' : 'Opening Balance'}</TableCell>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                        <TableCell className="text-right font-semibold">{formatCurrency(savings.openingBalance)}</TableCell>
                      </TableRow>
                    )}
                    {savings.entries.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">No savings entries for this period</TableCell>
                      </TableRow>
                    ) : (
                      savings.entries.map((entry, idx) => {
                        const isWithdrawal = entry.credit < 0
                        return (
                          <TableRow key={entry.id} className="hover:bg-muted/30">
                            <TableCell className="text-center text-xs text-muted-foreground">{idx + 1}</TableCell>
                            <TableCell className="whitespace-nowrap text-sm">{formatDate(entry.date)}</TableCell>
                            <TableCell className="text-sm">{entry.particulars}</TableCell>
                            <TableCell className={`text-right font-medium ${isWithdrawal ? 'text-red-700' : 'text-green-700'}`}>
                              {isWithdrawal ? '−' : '+'}{formatCurrency(Math.abs(entry.credit))}
                            </TableCell>
                            <TableCell className="text-right font-semibold">{formatCurrency(entry.runningBalance)}</TableCell>
                          </TableRow>
                        )
                      })
                    )}
                    <TableRow className="bg-muted/50 font-semibold border-t-2">
                      <TableCell colSpan={3} className="text-sm">Total ({savings.entries.length} entries)</TableCell>
                      <TableCell className="text-right text-green-700">+{formatCurrency(savings.totalCredits)}</TableCell>
                      <TableCell className="text-right text-lg">{formatCurrency(savings.closingBalance)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* ── Loan passbook (LOAN) ─────────────────────────────────────────── */}
      {!isLoading && loanBook && (
        <>
          {header(
            { name: loanBook.memberName, code: loanBook.memberCode, joinDate: loanBook.joinDate, memberType: loanBook.memberType },
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Total Outstanding</p>
              <p className="text-2xl font-bold text-red-700 mt-1">{formatCurrency(loanBook.totalOutstanding)}</p>
              <p className="text-xs text-muted-foreground">{loanBook.loans.length} loan(s)</p>
            </div>,
          )}

          {loanBook.loans.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
              <Banknote className="h-12 w-12 opacity-30" />
              <p>No loans recorded for this member</p>
            </div>
          ) : (
            loanBook.loans.map(loan => (
              <Card key={loan.loanId}>
                <CardHeader>
                  <CardTitle className="text-base flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <Banknote className="h-4 w-4" />
                      {loanRef(loan.loanId)} · {formatCurrency(loan.amount)}
                      <Badge variant="outline" className="text-xs capitalize">{loan.loanType}</Badge>
                      <Badge
                        variant={loan.status === 'paid' ? 'secondary' : 'default'}
                        className={loan.status === 'active' ? 'bg-amber-100 text-amber-800 text-xs' : 'text-xs'}
                      >
                        {loan.status}
                      </Badge>
                    </span>
                    <span className="text-sm font-normal text-muted-foreground">
                      Issued {formatDate(loan.issuedAt)}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead>Date</TableHead>
                          <TableHead>Particulars</TableHead>
                          <TableHead className="text-right">Principal</TableHead>
                          <TableHead className="text-right">Interest</TableHead>
                          <TableHead className="text-right">Paid (Rs.)</TableHead>
                          <TableHead className="text-right">Outstanding (Rs.)</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {loan.entries.map(e => (
                          <TableRow key={e.id} className="hover:bg-muted/30">
                            <TableCell className="whitespace-nowrap text-sm">{formatDate(e.date)}</TableCell>
                            <TableCell className="text-sm">{e.particulars}</TableCell>
                            <TableCell className="text-right text-sm">{e.principal > 0 ? formatCurrency(e.principal) : '—'}</TableCell>
                            <TableCell className="text-right text-sm">{e.interest > 0 ? formatCurrency(e.interest) : '—'}</TableCell>
                            <TableCell className="text-right text-sm">
                              {e.debit > 0
                                ? <span className="text-red-700">−{formatCurrency(e.debit)}</span>
                                : <span className="text-green-700">+{formatCurrency(e.credit)}</span>}
                            </TableCell>
                            <TableCell className="text-right font-semibold">{formatCurrency(e.runningOutstanding)}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="bg-muted/50 font-semibold border-t-2">
                          <TableCell colSpan={2} className="text-sm">Totals</TableCell>
                          <TableCell className="text-right text-sm">{formatCurrency(loan.totalPrincipalPaid)}</TableCell>
                          <TableCell className="text-right text-sm">{formatCurrency(loan.totalInterestPaid)}</TableCell>
                          <TableCell className="text-right text-sm"></TableCell>
                          <TableCell className="text-right text-lg">{formatCurrency(loan.outstanding)}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            ))
          )}

          {loanBook.loans.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-4">
              <Card><CardContent className="pt-4 pb-4 text-center">
                <p className="text-xs text-muted-foreground">Total Disbursed</p>
                <p className="text-xl font-bold mt-1">{formatCurrency(loanBook.totalDisbursed)}</p>
              </CardContent></Card>
              <Card><CardContent className="pt-4 pb-4 text-center">
                <p className="text-xs text-muted-foreground">Principal Repaid</p>
                <p className="text-xl font-bold text-green-700 mt-1">{formatCurrency(loanBook.totalPrincipalPaid)}</p>
              </CardContent></Card>
              <Card><CardContent className="pt-4 pb-4 text-center">
                <p className="text-xs text-muted-foreground">Interest Paid</p>
                <p className="text-xl font-bold text-blue-700 mt-1">{formatCurrency(loanBook.totalInterestPaid)}</p>
              </CardContent></Card>
              <Card><CardContent className="pt-4 pb-4 text-center">
                <p className="text-xs text-muted-foreground">Outstanding</p>
                <p className="text-xl font-bold text-red-700 mt-1">{formatCurrency(loanBook.totalOutstanding)}</p>
              </CardContent></Card>
            </div>
          )}
        </>
      )}

      {/* ── Chit passbook (CHIT) ─────────────────────────────────────────── */}
      {!isLoading && chitBook && (
        <>
          {header(
            { name: chitBook.memberName, code: chitBook.memberCode, joinDate: chitBook.joinDate, memberType: chitBook.memberType },
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Total Paid In</p>
              <p className="text-2xl font-bold text-green-700 mt-1">{formatCurrency(chitBook.totalPaid)}</p>
              <p className="text-xs text-muted-foreground">{chitBook.groups.length} chit group(s)</p>
            </div>,
          )}

          {chitBook.groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
              <Coins className="h-12 w-12 opacity-30" />
              <p>This member is not part of any chit group</p>
            </div>
          ) : (
            chitBook.groups.map(group => (
              <Card key={group.chitId}>
                <CardHeader>
                  <CardTitle className="text-base flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <Coins className="h-4 w-4" />
                      {group.chitName}
                      {group.passbookNumber && (
                        <Badge variant="outline" className="text-xs">Passbook #{group.passbookNumber}</Badge>
                      )}
                      <Badge
                        variant={group.status === 'CLOSED' ? 'secondary' : 'default'}
                        className={group.status === 'ACTIVE' ? 'bg-green-100 text-green-800 text-xs' : 'text-xs'}
                      >
                        {group.status}
                      </Badge>
                    </span>
                    <span className="text-sm font-normal text-muted-foreground">
                      Fund {formatCurrency(group.totalAmount)} · {formatCurrency(group.monthlyContribution)}/cycle
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead className="w-8 text-center">#</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Particulars</TableHead>
                          <TableHead className="text-right">Paid In (Rs.)</TableHead>
                          <TableHead className="text-right">Won (Rs.)</TableHead>
                          <TableHead className="text-right">Total Paid (Rs.)</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.entries.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No activity yet</TableCell>
                          </TableRow>
                        ) : (
                          group.entries.map((e, idx) => (
                            <TableRow key={e.id} className="hover:bg-muted/30">
                              <TableCell className="text-center text-xs text-muted-foreground">{idx + 1}</TableCell>
                              <TableCell className="whitespace-nowrap text-sm">{formatDate(e.date)}</TableCell>
                              <TableCell className="text-sm">{e.particulars}</TableCell>
                              <TableCell className="text-right text-sm text-green-700">{e.paid > 0 ? `+${formatCurrency(e.paid)}` : '—'}</TableCell>
                              <TableCell className="text-right text-sm font-medium text-blue-700">{e.won > 0 ? formatCurrency(e.won) : '—'}</TableCell>
                              <TableCell className="text-right font-semibold">{formatCurrency(e.runningPaid)}</TableCell>
                            </TableRow>
                          ))
                        )}
                        <TableRow className="bg-muted/50 font-semibold border-t-2">
                          <TableCell colSpan={3} className="text-sm">Totals</TableCell>
                          <TableCell className="text-right text-green-700">+{formatCurrency(group.totalPaid)}</TableCell>
                          <TableCell className="text-right text-blue-700">{formatCurrency(group.totalWon)}</TableCell>
                          <TableCell className="text-right text-lg">{formatCurrency(group.totalPaid)}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            ))
          )}

          {chitBook.groups.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Card><CardContent className="pt-4 pb-4 text-center">
                <p className="text-xs text-muted-foreground">Total Paid In</p>
                <p className="text-xl font-bold text-green-700 mt-1">{formatCurrency(chitBook.totalPaid)}</p>
              </CardContent></Card>
              <Card><CardContent className="pt-4 pb-4 text-center">
                <p className="text-xs text-muted-foreground">Total Won (Payouts)</p>
                <p className="text-xl font-bold text-blue-700 mt-1">{formatCurrency(chitBook.totalWon)}</p>
              </CardContent></Card>
            </div>
          )}
        </>
      )}

      {/* Empty states */}
      {!isLoading && !hasData && selectedMemberId && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
          <BookOpen className="h-12 w-12 opacity-30" />
          <p>Click "Load Passbook" to view this member's ledger</p>
        </div>
      )}

      {!isLoading && !selectedMemberId && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
          <User className="h-12 w-12 opacity-30" />
          <p>Select a member to view their passbook</p>
        </div>
      )}
    </div>
  )
}
