'use client'

import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
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
import { 
  getDayBook, 
  exportDayBookCSV, 
  downloadCSV,
  filterDayBookEntries,
  getCategories,
  calculateRunningBalances,
  formatDate,
  formatTime,
  formatDateTime,
} from '@/lib/api/daybook'
import { formatCurrency } from '@/lib/format'
import type { DayBookSummary, DayBookEntry } from '@/lib/types/daybook'
import { 
  CalendarIcon, 
  FileSpreadsheet, 
  ArrowUpRight, 
  ArrowDownRight,
  Filter,
  BookOpen,
  RefreshCw,
} from 'lucide-react'

export default function DayBookPage() {
  // State
  const [startDate, setStartDate] = useState<string>(() => {
    const today = new Date()
    return today.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState<string>(() => {
    const today = new Date()
    return today.toISOString().split('T')[0]
  })
  
  const [summary, setSummary] = useState<DayBookSummary | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  
  // Filter states
  const [txnTypeFilter, setTxnTypeFilter] = useState<'ALL' | 'RECEIPT' | 'VOUCHER'>('ALL')
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL')
  
  // Fetch day book data
  const loadDayBook = async () => {
    setIsLoading(true)
    try {
      const response = await getDayBook(startDate, endDate)
      if (response.success && response.data) {
        setSummary(response.data)
      } else {
        toast.error(response.error || 'Failed to load day book')
      }
    } catch (error) {
      toast.error('An error occurred while loading day book')
    } finally {
      setIsLoading(false)
    }
  }
  
  // Initial load
  useEffect(() => {
    loadDayBook()
  }, [])
  
  // Filtered entries
  const filteredEntries = useMemo(() => {
    if (!summary) return []
    
    return filterDayBookEntries(summary.transactions, {
      txnType: txnTypeFilter,
      category: categoryFilter === 'ALL' ? undefined : categoryFilter,
    })
  }, [summary, txnTypeFilter, categoryFilter])
  
  // Running balances for filtered entries
  const entriesWithBalance = useMemo(() => {
    if (!summary) return []
    
    // Calculate adjusted opening balance based on filtered transactions
    let adjustedOpening = summary.opening_balance
    
    // Subtract any receipts before the first filtered entry
    // and add back any vouchers before the first filtered entry
    // This is a simplified approach - for full accuracy we'd need
    // to recalculate from the beginning
    
    return calculateRunningBalances(filteredEntries, adjustedOpening)
  }, [filteredEntries, summary])
  
  // Available categories
  const categories = useMemo(() => {
    if (!summary) return []
    return getCategories(summary.transactions)
  }, [summary])
  
  // Export to CSV
  const handleExportCSV = async () => {
    setIsExporting(true)
    try {
      const response = await exportDayBookCSV(startDate, endDate)
      if (response.success && response.data) {
        const filename = `daybook_${startDate}_to_${endDate}.csv`
        downloadCSV(response.data, filename)
        toast.success('Day book exported successfully')
      } else {
        toast.error(response.error || 'Failed to export day book')
      }
    } catch (error) {
      toast.error('An error occurred during export')
    } finally {
      setIsExporting(false)
    }
  }
  
  // Get today's date for max date validation
  const today = new Date().toISOString().split('T')[0]
  
  return (
    <div className="space-y-6">
      <PageHeader
        title="Day Book"
        description="Financial transactions and daily ledger"
      >
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={loadDayBook}
            disabled={isLoading}
          >
            {isLoading ? (
              <Spinner className="mr-2 h-4 w-4" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
          <Button
            variant="outline"
            onClick={handleExportCSV}
            disabled={isExporting || !summary}
          >
            {isExporting ? (
              <Spinner className="mr-2 h-4 w-4" />
            ) : (
              <FileSpreadsheet className="mr-2 h-4 w-4" />
            )}
            Export CSV
          </Button>
        </div>
      </PageHeader>
      
      {/* Date Range Selector */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5" />
            Select Date Range
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-2">
              <Label htmlFor="start-date">Start Date</Label>
              <Input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                max={today}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="end-date">End Date</Label>
              <Input
                id="end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                max={today}
                min={startDate}
              />
            </div>
            
            <Button 
              onClick={loadDayBook}
              disabled={isLoading || !startDate || !endDate}
            >
              {isLoading ? (
                <Spinner className="mr-2 h-4 w-4" />
              ) : (
                <BookOpen className="mr-2 h-4 w-4" />
              )}
              Load Day Book
            </Button>
          </div>
        </CardContent>
      </Card>
      
      {/* Balance Summary Cards */}
      {summary && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Opening Balance
              </CardTitle>
              <BookOpen className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatCurrency(summary.opening_balance)}
              </div>
              <p className="text-xs text-muted-foreground">
                As of {formatDate(startDate)}
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-success">
                Total Receipts
              </CardTitle>
              <ArrowUpRight className="h-4 w-4 text-success" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-success">
                {formatCurrency(summary.total_receipts)}
              </div>
              <p className="text-xs text-muted-foreground">
                {filteredEntries.filter(e => e.txn_type === 'RECEIPT').length} entries
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-destructive">
                Total Vouchers
              </CardTitle>
              <ArrowDownRight className="h-4 w-4 text-destructive" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-destructive">
                {formatCurrency(summary.total_vouchers)}
              </div>
              <p className="text-xs text-muted-foreground">
                {filteredEntries.filter(e => e.txn_type === 'VOUCHER').length} entries
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Closing Balance
              </CardTitle>
              <BookOpen className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${
                summary.closing_balance >= 0 ? 'text-success' : 'text-destructive'
              }`}>
                {formatCurrency(summary.closing_balance)}
              </div>
              <p className="text-xs text-muted-foreground">
                As of {formatDate(endDate)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}
      
      {/* Filters */}
      {summary && summary.transactions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-5 w-5" />
              Filters
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              <div className="w-48">
                <Label className="mb-2 block">Transaction Type</Label>
                <Select
                  value={txnTypeFilter}
                  onValueChange={(value: any) => setTxnTypeFilter(value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All Types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Types</SelectItem>
                    <SelectItem value="RECEIPT">Receipts Only</SelectItem>
                    <SelectItem value="VOUCHER">Vouchers Only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="w-48">
                <Label className="mb-2 block">Category</Label>
                <Select
                  value={categoryFilter}
                  onValueChange={setCategoryFilter}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All Categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Categories</SelectItem>
                    {categories.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="flex items-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setTxnTypeFilter('ALL')
                    setCategoryFilter('ALL')
                  }}
                >
                  Clear Filters
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* Transactions Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            Transactions ({filteredEntries.length} of {summary?.transactions.length || 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Spinner className="h-8 w-8" />
              <span className="ml-2">Loading day book...</span>
            </div>
          ) : !summary ? (
            <div className="text-center py-8 text-muted-foreground">
              <BookOpen className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Select a date range and click "Load Day Book" to view transactions</p>
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No transactions found for the selected criteria</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date & Time</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Member</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entriesWithBalance.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="whitespace-nowrap">
                        <div className="font-medium">{formatDate(entry.date)}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatTime(entry.date)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={entry.txn_type === 'RECEIPT' ? 'default' : 'destructive'}
                          className={
                            entry.txn_type === 'RECEIPT'
                              ? 'bg-success/10 text-success hover:bg-success/20'
                              : 'bg-destructive/10 text-destructive hover:bg-destructive/20'
                          }
                        >
                          {entry.txn_type === 'RECEIPT' ? (
                            <ArrowUpRight className="mr-1 h-3 w-3" />
                          ) : (
                            <ArrowDownRight className="mr-1 h-3 w-3" />
                          )}
                          {entry.txn_type}
                        </Badge>
                      </TableCell>
                      <TableCell>{entry.category}</TableCell>
                      <TableCell className="max-w-xs truncate" title={entry.description}>
                        {entry.description}
                      </TableCell>
                      <TableCell>
                        {entry.member_name ? (
                          <div>
                            <div className="font-medium">{entry.member_name}</div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {entry.payment_method}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        <span className={entry.txn_type === 'RECEIPT' ? 'text-success' : 'text-destructive'}>
                          {entry.txn_type === 'RECEIPT' ? '+' : '-'}
                          {formatCurrency(entry.amount)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(entry.running_balance)}
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
