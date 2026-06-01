'use client'

import { useEffect, useState } from 'react'
import { Plus, CreditCard, MoreHorizontal, History, CalendarClock, Trash2 } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { AdminPinDialog } from '@/components/admin-pin-dialog'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DataTable, type Column } from '@/components/data-table'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { LoanForm } from '@/components/forms/loan-form'
import { RepaymentForm } from '@/components/forms/repayment-form'
import { useApp } from '@/context/app-context'
import { useSettings } from '@/lib/settings-context'
import { issueLoan, recordRepayment } from '@/lib/api/loans'
import { PastLoanForm } from '@/components/forms/past-loan-form'
import { LoanScheduleDialog } from '@/components/loan-schedule-dialog'
import { track } from '@/lib/track'

// Bucket a numeric amount into small/medium/large (preserves signal without sending exact amounts)
function amountBucket(n: number): string {
  if (n <= 5000) return 'small'
  if (n <= 20000) return 'medium'
  return 'large'
}
import { formatCurrency, formatDate, loanRef } from '@/lib/format'
import type { Loan, LoanFormData } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Wallet, AlertCircle, CheckCircle } from 'lucide-react'

export default function LoansPage() {
  const { loans, loadingLoans, refreshLoans } = useApp()
  const { settings } = useSettings()
  const notifs = settings?.notifications
  const [isPastFormOpen, setIsPastFormOpen] = useState(false)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [repaymentLoan, setRepaymentLoan] = useState<Loan | null>(null)
  const [scheduleLoanId, setScheduleLoanId] = useState<number | null>(null)
  const [deleteLoanId, setDeleteLoanId] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paid' | 'defaulted'>('all')
  const [loanTypeFilter, setLoanTypeFilter] = useState<'all' | 'monthly' | 'weekly'>('all')
  const [paymentMethodFilter, setPaymentMethodFilter] = useState<'all' | 'cash' | 'bank'>('all')
  const [amountRangeFilter, setAmountRangeFilter] = useState<'all' | 'small' | 'medium' | 'large'>('all')

  useEffect(() => {
    refreshLoans()
  }, [refreshLoans])

  const filteredLoans = loans.filter((loan) => {
    const statusMatch = statusFilter === 'all' || loan.status === statusFilter
    const loanTypeMatch = loanTypeFilter === 'all' || loan.loanType === loanTypeFilter
    const paymentMethodMatch = paymentMethodFilter === 'all' || loan.paymentMethod === paymentMethodFilter
    const amountMatch = amountRangeFilter === 'all' || 
      (amountRangeFilter === 'small' && loan.amount <= 5000) ||
      (amountRangeFilter === 'medium' && loan.amount > 5000 && loan.amount <= 20000) ||
      (amountRangeFilter === 'large' && loan.amount > 20000)
    
    return statusMatch && loanTypeMatch && paymentMethodMatch && amountMatch
  })

  const activeLoans = loans.filter((l) => l.status === 'active')
  const totalOutstanding = activeLoans.reduce((sum, l) => sum + l.outstandingAmount, 0)
  const totalDisbursed = loans.reduce((sum, l) => sum + l.amount, 0)

  const handleIssueLoan = async (data: LoanFormData) => {
    setIsSubmitting(true)
    try {
      const response = await issueLoan(data)
      if (response.success) {
        toast.success('Loan issued successfully')
        track('loan.issued', {
          loan_type: data.loanType,
          amount_bucket: amountBucket(data.amount),
          payment_method: data.paymentMethod,
        })
        setIsFormOpen(false)
        refreshLoans()
      } else {
        toast.error(response.error || 'Failed to issue loan')
      }
    } catch {
      toast.error('An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRepayment = async (data: {
    amount: number
    paymentMethod: string
    cashAmount: number | null
    bankAmount: number | null
    bankTxnId: string | null
    note: string
  }) => {
    if (!repaymentLoan) return
    setIsSubmitting(true)
    try {
      const response = await recordRepayment(
        repaymentLoan.id,
        data.amount,
        {
          paymentMethod: data.paymentMethod,
          cashAmount: data.cashAmount,
          bankAmount: data.bankAmount,
          bankTxnId: data.bankTxnId,
          note: data.note,
        },
      )
      if (response.success) {
        if (notifs?.enableNotifications && notifs?.paymentConfirmations) {
          toast.success('Payment recorded successfully')
        }
        track('loan.repaid', {
          amount_bucket: amountBucket(data.amount),
          payment_method: data.paymentMethod.toLowerCase(),
        })
        setRepaymentLoan(null)
        refreshLoans()
      } else {
        toast.error(response.error || 'Failed to record payment')
      }
    } catch {
      toast.error('An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  const columns: Column<Loan>[] = [
    {
      key: 'id',
      header: 'Ref. No.',
      cell: (loan) => (
        <span className="font-mono text-sm font-medium">{loanRef(loan.id)}</span>
      ),
      sortable: true,
    },
    {
      key: 'memberName',
      header: 'Member',
      cell: (loan) => (
        <div>
          <p className="font-medium">{loan.memberName}</p>
          <p className="text-xs text-muted-foreground">
            {formatDate(loan.issuedAt)}
          </p>
        </div>
      ),
      sortable: true,
    },
    {
      key: 'amount',
      header: 'Loan Amount',
      cell: (loan) => (
        <div>
          <span className="font-medium">{formatCurrency(loan.amount)}</span>
          {loan.dailyInterestRate > 0 && (
            <p className="text-xs text-muted-foreground">{loan.dailyInterestRate}%/day</p>
          )}
        </div>
      ),
      sortable: true,
    },
    {
      key: 'loanType',
      header: 'Loan Type',
      cell: (loan) => (
        <Badge variant={loan.loanType === 'monthly' ? 'default' : 'secondary'}>
          {loan.loanType === 'monthly' ? 'Monthly' : 'Weekly'}
        </Badge>
      ),
      sortable: true,
    },
    {
      key: 'outstandingAmount',
      header: 'Outstanding',
      cell: (loan) => (
        <div>
          <span
            className={cn(
              'font-medium',
              loan.outstandingAmount > 0 && 'text-warning-foreground'
            )}
          >
            {formatCurrency(loan.outstandingAmount)}
          </span>
          {loan.interestAmount > 0 && loan.status === 'active' && (
            <p className="text-xs text-muted-foreground">
              of {formatCurrency(loan.totalRepayable)} total
            </p>
          )}
        </div>
      ),
      sortable: true,
    },
    {
      key: 'paymentMethod',
      header: 'Method',
      cell: (loan) => (
        <Badge variant="outline">{loan.paymentMethod.toUpperCase()}</Badge>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (loan) => (
        <Badge
          variant={loan.status === 'active' ? 'default' : 'secondary'}
          className={cn(
            loan.status === 'paid' && 'bg-success/10 text-success',
            loan.status === 'defaulted' && 'bg-destructive/10 text-destructive'
          )}
        >
          {loan.status}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      cell: (loan) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">Open menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {loan.status === 'active' && (
              <DropdownMenuItem onClick={() => setRepaymentLoan(loan)}>
                <CreditCard className="mr-2 h-4 w-4" />
                Record Repayment
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => setScheduleLoanId(parseInt(loan.id))}>
              <CalendarClock className="mr-2 h-4 w-4" />
              View Schedule
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setDeleteLoanId(loan.id)}
              className="text-red-600 focus:text-red-700"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete (past entry only)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
      className: 'w-12',
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Loans"
        description="Manage member loans and repayments"
      >
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setIsPastFormOpen(true)}>
            <History className="mr-2 h-4 w-4" />
            Past Data Entry
          </Button>
          <Button onClick={() => setIsFormOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Issue Loan
          </Button>
        </div>
      </PageHeader>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          title="Total Disbursed"
          value={formatCurrency(totalDisbursed)}
          icon={Wallet}
          description="All time"
        />
        <StatCard
          title="Outstanding Amount"
          value={formatCurrency(totalOutstanding)}
          icon={AlertCircle}
          description={`${activeLoans.length} active loans`}
          variant="warning"
        />
        <StatCard
          title="Fully Paid"
          value={loans.filter((l) => l.status === 'paid').length}
          icon={CheckCircle}
          description="Completed loans"
          variant="success"
        />
      </div>

      {/* Filter */}
      <div className="flex flex-wrap items-center gap-4">
        <Select
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="defaulted">Defaulted</SelectItem>
          </SelectContent>
        </Select>
        
        <Select
          value={loanTypeFilter}
          onValueChange={(value) => setLoanTypeFilter(value as typeof loanTypeFilter)}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Filter by type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="monthly">Monthly</SelectItem>
            <SelectItem value="weekly">Weekly</SelectItem>
          </SelectContent>
        </Select>
        
        <Select
          value={paymentMethodFilter}
          onValueChange={(value) => setPaymentMethodFilter(value as typeof paymentMethodFilter)}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Filter by method" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Methods</SelectItem>
            <SelectItem value="cash">Cash</SelectItem>
            <SelectItem value="bank">Bank</SelectItem>
          </SelectContent>
        </Select>
        
        <Select
          value={amountRangeFilter}
          onValueChange={(value) => setAmountRangeFilter(value as typeof amountRangeFilter)}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Filter by amount" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Amounts</SelectItem>
            <SelectItem value="small">≤ ₹5,000</SelectItem>
            <SelectItem value="medium">₹5,001 - ₹20,000</SelectItem>
            <SelectItem value="large">&gt; ₹20,000</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable
        data={filteredLoans}
        columns={columns}
        searchKey="memberName"
        searchPlaceholder="Search by member name..."
        isLoading={loadingLoans}
        emptyMessage="No loans found"
      />

      <LoanForm
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        onSubmit={handleIssueLoan}
        isLoading={isSubmitting}
      />

      <RepaymentForm
        open={!!repaymentLoan}
        onOpenChange={(open) => !open && setRepaymentLoan(null)}
        onSubmit={handleRepayment}
        loan={repaymentLoan}
        isLoading={isSubmitting}
        onPrepaid={() => { setRepaymentLoan(null); refreshLoans() }}
      />

      <PastLoanForm
        open={isPastFormOpen}
        onOpenChange={setIsPastFormOpen}
        onSuccess={refreshLoans}
      />
      <LoanScheduleDialog
        loanId={scheduleLoanId}
        open={scheduleLoanId !== null}
        onOpenChange={open => { if (!open) setScheduleLoanId(null) }}
      />

      <AdminPinDialog
        open={!!deleteLoanId}
        onOpenChange={(open) => { if (!open) setDeleteLoanId(null) }}
        title="Delete past loan entry"
        description="Past-data loan entries can be deleted with the admin PIN. Live loans (with corresponding SHG vouchers) will be refused by the server."
        destructive
        confirmLabel="Delete"
        onConfirm={async (adminPin) => {
          await invoke('delete_past_loan', {
            loanId: parseInt(deleteLoanId!),
            adminPin,
          })
          toast.success('Past loan deleted')
          setDeleteLoanId(null)
          refreshLoans()
        }}
      />
    </div>
  )
}
