'use client'

import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { toast } from 'sonner'
import { ClipboardList, RefreshCw, Search } from 'lucide-react'
import { getAuditLog, ACTION_LABELS, actionVariant, ENTITY_OPTIONS } from '@/lib/api/audit'
import type { AuditEntry } from '@/lib/api/audit'

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    })
  } catch {
    return ts
  }
}

export default function AuditLogPage() {
  const today = new Date().toISOString().split('T')[0]
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().split('T')[0]

  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [fromDate, setFromDate] = useState(thirtyDaysAgo)
  const [toDate, setToDate] = useState(today)
  const [entityFilter, setEntityFilter] = useState('all')
  const [search, setSearch] = useState('')

  const load = async (from: string, to: string, entity: string) => {
    setIsLoading(true)
    try {
      const res = await getAuditLog({
        from: from || undefined,
        to: to || undefined,
        entity: entity === 'all' ? undefined : entity || undefined,
      })
      if (res.success && res.data) {
        setEntries(res.data)
      } else {
        toast.error(res.error || 'Failed to load audit log')
      }
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    load(fromDate, toDate, entityFilter)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleApply = () => load(fromDate, toDate, entityFilter)

  const filtered = useMemo(() => {
    if (!search.trim()) return entries
    const q = search.toLowerCase()
    return entries.filter(e =>
      e.action.toLowerCase().includes(q) ||
      e.entity.toLowerCase().includes(q) ||
      (e.details ?? '').toLowerCase().includes(q) ||
      String(e.entityId ?? '').includes(q)
    )
  }, [entries, search])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Log"
        description="Read-only record of all data-changing operations"
      >
        <Button variant="outline" size="sm" onClick={handleApply} disabled={isLoading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </PageHeader>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input
                type="date"
                value={fromDate}
                onChange={e => setFromDate(e.target.value)}
                className="w-36 h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input
                type="date"
                value={toDate}
                onChange={e => setToDate(e.target.value)}
                className="w-36 h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Entity Type</Label>
              <Select value={entityFilter} onValueChange={setEntityFilter}>
                <SelectTrigger className="w-44 h-8 text-sm">
                  <SelectValue placeholder="All Entities" />
                </SelectTrigger>
                <SelectContent>
                  {ENTITY_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" onClick={handleApply} disabled={isLoading}>
              Apply
            </Button>

            <div className="ml-auto flex items-end gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search entries…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-8 h-8 w-52 text-sm"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary badge */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <ClipboardList className="h-4 w-4" />
        <span>
          {isLoading ? 'Loading…' : `${filtered.length} entries${entries.length !== filtered.length ? ` (filtered from ${entries.length})` : ''}`}
        </span>
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm font-medium">Events</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Spinner className="h-8 w-8" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
              <ClipboardList className="h-10 w-10 opacity-30" />
              <p className="text-sm">No audit log entries for this period</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-44">Timestamp</TableHead>
                    <TableHead className="w-44">Action</TableHead>
                    <TableHead className="w-28">Entity</TableHead>
                    <TableHead className="w-16 text-right">ID</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(entry => (
                    <TableRow key={entry.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatTimestamp(entry.timestamp)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={actionVariant(entry.action)} className="text-xs whitespace-nowrap">
                          {ACTION_LABELS[entry.action] ?? entry.action}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium capitalize">
                          {entry.entity.replace('_', ' ')}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {entry.entityId ?? '—'}
                      </TableCell>
                      <TableCell className="text-sm max-w-sm truncate" title={entry.details ?? ''}>
                        {entry.details ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
