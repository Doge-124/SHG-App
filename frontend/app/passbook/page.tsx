'use client'

import { useState, useEffect, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Spinner } from '@/components/ui/spinner'
import { PageHeader } from '@/components/page-header'
import { toast } from 'sonner'
import { formatCurrency, formatDate } from '@/lib/format'
import { BookOpen, RefreshCw, Printer, User } from 'lucide-react'

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

interface Member {
  id: string
  name: string
  code: string
  memberType: string
}

function formatFY(year: number) {
  return `${year}-${String((year + 1) % 100).padStart(2, '0')}`
}

// Quick-select FY date ranges
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

export default function PassbookPage() {
  const searchParams = useSearchParams()
  const preselectedMemberId = searchParams?.get('memberId') ?? ''

  const today = new Date().toISOString().split('T')[0]
  const [members, setMembers] = useState<Member[]>([])
  const [selectedMemberId, setSelectedMemberId] = useState(preselectedMemberId)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [passbook, setPassbook] = useState<MemberPassbook | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingMembers, setIsLoadingMembers] = useState(true)
  const [search, setSearch] = useState('')

  // Load all SHG members
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

  // Auto-load if member pre-selected from profile page
  useEffect(() => {
    if (preselectedMemberId && members.length > 0) {
      setSelectedMemberId(preselectedMemberId)
      loadPassbook(preselectedMemberId, '', '')
    }
  }, [preselectedMemberId, members.length])

  const loadPassbook = async (memberId: string, from: string, to: string) => {
    if (!memberId) { toast.error('Select a member first'); return }
    setIsLoading(true)
    try {
      const result = await invoke<MemberPassbook>('get_member_passbook', {
        memberId: parseInt(memberId),
        fromDate: from,
        toDate: to,
      })
      setPassbook(result)
    } catch (err: any) {
      toast.error(err?.toString() || 'Failed to load passbook')
    } finally {
      setIsLoading(false)
    }
  }

  const handleLoad = () => loadPassbook(selectedMemberId, fromDate, toDate)

  const handleFyQuick = (from: string, to: string) => {
    setFromDate(from)
    setToDate(to)
    loadPassbook(selectedMemberId, from, to)
  }

  const handleAllTime = () => {
    setFromDate('')
    setToDate('')
    loadPassbook(selectedMemberId, '', '')
  }

  const handlePrint = () => window.print()

  const filteredMembers = useMemo(() =>
    members.filter(m =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.code.toLowerCase().includes(search.toLowerCase())
    ), [members, search]
  )

  const ranges = fyRanges()

  return (
    <div className="space-y-6">
      <PageHeader title="Member Passbook" description="Savings ledger with running balance for each member">
        <Button variant="outline" onClick={handlePrint} disabled={!passbook} className="print:hidden">
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
          {/* Member selector */}
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
                onValueChange={v => { setSelectedMemberId(v); setPassbook(null) }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={isLoadingMembers ? 'Loading…' : 'Select member'} />
                </SelectTrigger>
                <SelectContent>
                  {filteredMembers.map(m => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name} <span className="text-muted-foreground ml-1">({m.code})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>From</Label>
              <Input type="date" value={fromDate} max={today} onChange={e => setFromDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>To</Label>
              <Input type="date" value={toDate} max={today} min={fromDate} onChange={e => setToDate(e.target.value)} />
            </div>
          </div>

          {/* Quick selects + load */}
          <div className="flex flex-wrap gap-2 items-center">
            <Button onClick={handleLoad} disabled={isLoading || !selectedMemberId}>
              <BookOpen className="mr-2 h-4 w-4" />Load Passbook
            </Button>
            <Button variant="outline" size="sm" onClick={handleAllTime}>All Time</Button>
            {ranges.slice(0, 3).map(r => (
              <Button key={r.from} variant="outline" size="sm" onClick={() => handleFyQuick(r.from, r.to)}>
                {r.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Spinner className="h-8 w-8" />
        </div>
      )}

      {!isLoading && passbook && (
        <>
          {/* Member header — shown in print too */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                    <User className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold">{passbook.memberName}</h2>
                    <p className="text-sm text-muted-foreground">
                      Code: {passbook.memberCode} · Joined: {formatDate(passbook.joinDate)}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-xs">
                        {passbook.memberType === 'SHG' ? 'Savings Member' : passbook.memberType}
                      </Badge>
                      <Badge variant="secondary" className="text-xs">
                        {passbook.totalInstallments} instalment{passbook.totalInstallments !== 1 ? 's' : ''}
                      </Badge>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">
                    {passbook.fromDate ? `${formatDate(passbook.fromDate)} — ${formatDate(passbook.toDate)}` : 'All Time'}
                  </p>
                  <p className="text-2xl font-bold text-green-700 mt-1">{formatCurrency(passbook.closingBalance)}</p>
                  <p className="text-xs text-muted-foreground">Current Balance</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Passbook table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <BookOpen className="h-4 w-4" />
                Savings Passbook
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
                    {/* Pre-migration savings row — shown when member has past data */}
                    {passbook.migrationOpening > 0 && !passbook.fromDate && (
                      <TableRow className="bg-amber-50/60 text-sm">
                        <TableCell className="text-center text-muted-foreground">—</TableCell>
                        <TableCell className="text-muted-foreground">Before app</TableCell>
                        <TableCell className="text-amber-800">Pre-migration savings (past data)</TableCell>
                        <TableCell className="text-right font-medium text-amber-700">
                          +{formatCurrency(passbook.migrationOpening)}
                        </TableCell>
                        <TableCell className="text-right font-semibold text-amber-700">
                          {formatCurrency(passbook.migrationOpening)}
                        </TableCell>
                      </TableRow>
                    )}

                    {/* Opening balance row (balance brought forward for filtered views) */}
                    {(passbook.fromDate || passbook.openingBalance > passbook.migrationOpening) && (
                      <TableRow className="bg-blue-50/50 font-medium text-sm">
                        <TableCell className="text-center text-muted-foreground">—</TableCell>
                        <TableCell className="text-muted-foreground">
                          {passbook.fromDate ? formatDate(passbook.fromDate) : 'Opening'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {passbook.fromDate ? 'Balance brought forward' : 'Opening Balance'}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                        <TableCell className="text-right font-semibold">
                          {formatCurrency(passbook.openingBalance)}
                        </TableCell>
                      </TableRow>
                    )}

                    {passbook.entries.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                          No savings entries for this period
                        </TableCell>
                      </TableRow>
                    ) : (
                      passbook.entries.map((entry, idx) => (
                        <TableRow key={entry.id} className="hover:bg-muted/30">
                          <TableCell className="text-center text-xs text-muted-foreground">
                            {idx + 1}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">
                            {formatDate(entry.date)}
                          </TableCell>
                          <TableCell className="text-sm">{entry.particulars}</TableCell>
                          <TableCell className="text-right font-medium text-green-700">
                            +{formatCurrency(entry.credit)}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {formatCurrency(entry.runningBalance)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}

                    {/* Totals row */}
                    <TableRow className="bg-muted/50 font-semibold border-t-2">
                      <TableCell colSpan={3} className="text-sm">
                        Total ({passbook.entries.length} entries)
                      </TableCell>
                      <TableCell className="text-right text-green-700">
                        +{formatCurrency(passbook.totalCredits)}
                      </TableCell>
                      <TableCell className="text-right text-lg">
                        {formatCurrency(passbook.closingBalance)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Summary strip */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="pt-4 pb-4 text-center">
                <p className="text-xs text-muted-foreground">Opening Balance</p>
                <p className="text-xl font-bold mt-1">{formatCurrency(passbook.openingBalance)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4 text-center">
                <p className="text-xs text-muted-foreground">Savings Added</p>
                <p className="text-xl font-bold text-green-700 mt-1">+{formatCurrency(passbook.totalCredits)}</p>
                <p className="text-xs text-muted-foreground">{passbook.totalInstallments} instalments</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4 text-center">
                <p className="text-xs text-muted-foreground">Closing Balance</p>
                <p className="text-xl font-bold text-green-700 mt-1">{formatCurrency(passbook.closingBalance)}</p>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {!isLoading && !passbook && selectedMemberId && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
          <BookOpen className="h-12 w-12 opacity-30" />
          <p>Click "Load Passbook" to view the savings ledger</p>
        </div>
      )}

      {!isLoading && !selectedMemberId && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
          <User className="h-12 w-12 opacity-30" />
          <p>Select a member to view their savings passbook</p>
        </div>
      )}
    </div>
  )
}
