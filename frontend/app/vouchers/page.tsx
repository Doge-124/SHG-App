'use client'

import { useEffect, useState } from 'react'
import { Plus, ArrowUpRight, Printer, Download, Ban } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { AdminPinDialog } from '@/components/admin-pin-dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DataTable, type Column } from '@/components/data-table'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { VoucherForm, SAVINGS_PAYOUT_REASON } from '@/components/forms/voucher-form'
import { getVouchers, createVoucher } from '@/lib/api/ledger'
import { payoutMemberSavings } from '@/lib/api/members'
import { useSettings } from '@/lib/settings-context'
import { generateVoucherPDF, generateMultipleVouchersPDF } from '@/lib/pdf'
import { PrintPreview } from '@/components/print-preview'
import { formatCurrency, formatDateTime } from '@/lib/format'
import type { Voucher, VoucherFormData } from '@/lib/types'
import { track } from '@/lib/track'

export default function VouchersPage() {
  const { settings } = useSettings()
  const shgName = settings?.general?.groupName || undefined
  const [vouchers, setVouchers] = useState<Voucher[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [paymentFilter, setPaymentFilter] = useState<'all' | 'cash' | 'bank'>('all')
  const [amountRangeFilter, setAmountRangeFilter] = useState<'all' | 'small' | 'medium' | 'large'>('all')
  const [dateRangeFilter, setDateRangeFilter] = useState<'all' | 'today' | 'week' | 'month'>('all')
  const [printPreview, setPrintPreview] = useState<{
    isOpen: boolean
    type: 'voucher' | 'vouchers'
    data: Voucher | Voucher[]
  }>({ isOpen: false, type: 'voucher', data: [] })
  const [cancelTarget, setCancelTarget] = useState<Voucher | null>(null)

  useEffect(() => {
    loadVouchers()
  }, [])

  async function loadVouchers() {
    setIsLoading(true)
    try {
      const response = await getVouchers()
      if (response.success && response.data) {
        setVouchers(response.data)
      }
    } catch {
      toast.error('Failed to load vouchers')
    } finally {
      setIsLoading(false)
    }
  }

  const filteredVouchers = vouchers.filter((voucher) => {
    const paymentMatch = paymentFilter === 'all' || voucher.paymentMethod === paymentFilter
    const amountMatch = amountRangeFilter === 'all' || 
      (amountRangeFilter === 'small' && voucher.amount <= 5000) ||
      (amountRangeFilter === 'medium' && voucher.amount > 5000 && voucher.amount <= 20000) ||
      (amountRangeFilter === 'large' && voucher.amount > 20000)
    
    const dateMatch = dateRangeFilter === 'all' || {
      today: new Date(voucher.createdAt).toDateString() === new Date().toDateString(),
      week: new Date(voucher.createdAt) >= new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      month: new Date(voucher.createdAt) >= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    }[dateRangeFilter]
    
    return paymentMatch && amountMatch && dateMatch
  })

  // Mixed vouchers carry a cash_amount/bank_amount split; count each side
  // toward the right total so the cards still reconcile.
  const totalCash = vouchers.reduce(
    (sum, v) => sum + (v.paymentMethod === 'cash' ? v.amount : (v.cashAmount ?? 0)), 0)

  const totalBank = vouchers.reduce(
    (sum, v) => sum + (v.paymentMethod === 'bank' ? v.amount : (v.bankAmount ?? 0)), 0)

  const handleCreateVoucher = async (data: VoucherFormData) => {
    setIsSubmitting(true)
    try {
      // Savings payout is a special voucher that also reduces the member's
      // savings balance, so it goes through a dedicated backend command.
      const isSavingsPayout = data.reasonType === SAVINGS_PAYOUT_REASON
      const response = isSavingsPayout
        ? await payoutMemberSavings(data.memberId, data.amount, {
            paymentMethod: data.paymentMethod,
            cashAmount: data.cashAmount,
            bankAmount: data.bankAmount,
            bankTxnId: data.bankTxnId,
          })
        : await createVoucher(data)
      if (response.success) {
        toast.success(isSavingsPayout ? 'Savings paid out successfully' : 'Voucher created successfully')
        track('voucher.created', { payment_method: data.paymentMethod })
        setIsFormOpen(false)
        loadVouchers()
      } else {
        toast.error(response.error || 'Failed to create voucher')
      }
    } catch {
      toast.error('An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handlePrintVoucher = (voucher: Voucher) => {
    setPrintPreview({
      isOpen: true,
      type: 'voucher',
      data: voucher
    })
  }

  const handlePrintAllVouchers = () => {
    if (vouchers.length === 0) {
      toast.error('No vouchers to print')
      return
    }
    setPrintPreview({
      isOpen: true,
      type: 'vouchers',
      data: vouchers
    })
  }

  const handleClosePrintPreview = () => {
    setPrintPreview({
      isOpen: false,
      type: 'voucher',
      data: []
    })
  }

  const columns: Column<Voucher>[] = [
    {
      key: 'createdAt',
      header: 'Date & Time',
      cell: (voucher) => (
        <span className="text-sm">{formatDateTime(voucher.createdAt)}</span>
      ),
      sortable: true,
    },
    {
      key: 'amount',
      header: 'Amount',
      cell: (voucher) => {
        const voided = !!voucher.voidedAt
        const reversal = !!voucher.reversalOfId
        return (
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-destructive/10">
              <ArrowUpRight className="h-4 w-4 text-destructive" />
            </div>
            <span className={`font-semibold ${voided ? 'line-through text-muted-foreground' : 'text-destructive'}`}>
              -{formatCurrency(voucher.amount)}
            </span>
            {voided && <Badge variant="outline" className="text-xs border-red-300 text-red-700">VOIDED</Badge>}
            {reversal && <Badge variant="outline" className="text-xs border-amber-300 text-amber-700">Reversal of #{voucher.reversalOfId}</Badge>}
          </div>
        )
      },
      sortable: true,
    },
    {
      key: 'reason',
      header: 'Reason',
      cell: (voucher) => (
        <div className="space-y-1">
          <span className={`text-sm ${voucher.voidedAt ? 'line-through text-muted-foreground' : ''}`}>{voucher.reason}</span>
          {voucher.memberName && (
            <span className="text-xs text-muted-foreground block">
              To: {voucher.memberName}
            </span>
          )}
          {voucher.referenceType === 'GENERAL_VOUCHER' && (
            <span className="text-xs text-muted-foreground block">External voucher</span>
          )}
          {voucher.paymentMethod === 'mixed' && (
            <span className="text-xs text-muted-foreground block">
              Cash {formatCurrency(voucher.cashAmount ?? 0)} + Bank {formatCurrency(voucher.bankAmount ?? 0)}
            </span>
          )}
          {voucher.bankTxnId && (
            <span className="text-xs text-muted-foreground block">Txn ID: {voucher.bankTxnId}</span>
          )}
          {voucher.voidedAt && voucher.voidedReason && (
            <span className="text-xs text-red-700 block">Cancelled: {voucher.voidedReason}</span>
          )}
        </div>
      ),
    },
    {
      key: 'paymentMethod',
      header: 'Method',
      cell: (voucher) => (
        <Badge variant="outline">{voucher.paymentMethod.toUpperCase()}</Badge>
      ),
    },
    {
      key: 'referenceNumber',
      header: 'Ref. No.',
      cell: (voucher) => (
        <span className="text-sm font-mono">{voucher.referenceNumber}</span>
      ),
    },
    {
      key: 'reference',
      header: 'Reference',
      cell: (voucher) => (
        voucher.reference ? (
          <span className="text-sm font-mono">{voucher.reference}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        )
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      cell: (voucher) => {
        const cancellable = !voucher.voidedAt && !voucher.reversalOfId
        return (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePrintVoucher(voucher)}
              className="h-8 w-8 p-0"
              title="Print"
            >
              <Printer className="h-4 w-4" />
            </Button>
            {cancellable && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0 text-red-600 hover:bg-red-50"
                onClick={() => setCancelTarget(voucher)}
                title="Cancel this voucher (admin PIN required)"
              >
                <Ban className="h-4 w-4" />
              </Button>
            )}
          </div>
        )
      },
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vouchers"
        description="Track expenses and payments made by the SHG"
      >
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handlePrintAllVouchers}
            disabled={vouchers.length === 0}
          >
            <Download className="mr-2 h-4 w-4" />
            Print All
          </Button>
          <Button onClick={() => setIsFormOpen(true)} variant="destructive">
            <Plus className="mr-2 h-4 w-4" />
            Create Voucher
          </Button>
        </div>
      </PageHeader>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          title="Total Expenses"
          value={formatCurrency(totalCash + totalBank)}
          icon={ArrowUpRight}
          description={`${vouchers.length} transactions`}
          variant="destructive"
        />
        <StatCard
          title="Cash Payments"
          value={formatCurrency(totalCash)}
          icon={ArrowUpRight}
          description="Cash transactions"
        />
        <StatCard
          title="Bank Payments"
          value={formatCurrency(totalBank)}
          icon={ArrowUpRight}
          description="Bank transactions"
        />
      </div>

      {/* Filter */}
      <div className="flex flex-wrap items-center gap-4">
        <Select
          value={paymentFilter}
          onValueChange={(value) => setPaymentFilter(value as typeof paymentFilter)}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Payment method" />
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
            <SelectValue placeholder="Amount range" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Amounts</SelectItem>
            <SelectItem value="small">≤ ₹5,000</SelectItem>
            <SelectItem value="medium">₹5,001 - ₹20,000</SelectItem>
            <SelectItem value="large">&gt; ₹20,000</SelectItem>
          </SelectContent>
        </Select>
        
        <Select
          value={dateRangeFilter}
          onValueChange={(value) => setDateRangeFilter(value as typeof dateRangeFilter)}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Date range" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Time</SelectItem>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="week">Last 7 Days</SelectItem>
            <SelectItem value="month">Last 30 Days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable
        data={filteredVouchers}
        columns={columns}
        searchKey="reason"
        searchPlaceholder="Search by reason..."
        isLoading={isLoading}
        emptyMessage="No vouchers found"
      />

      <VoucherForm
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        onSubmit={handleCreateVoucher}
        isLoading={isSubmitting}
      />
      
      <PrintPreview
        isOpen={printPreview.isOpen}
        onClose={handleClosePrintPreview}
        type={printPreview.type}
        data={printPreview.data}
        shgName={shgName}
      />

      <AdminPinDialog
        open={!!cancelTarget}
        onOpenChange={(open) => { if (!open) setCancelTarget(null) }}
        title={`Cancel voucher #${cancelTarget?.id ?? ''}`}
        description={`This will reverse the voucher (Rs ${cancelTarget?.amount ?? 0}) and roll back any derived state (loan, chit, etc.). The original row stays in the ledger marked VOIDED.`}
        destructive
        requireReason
        reasonLabel="Reason for cancellation"
        reasonPlaceholder="e.g. amount typed wrong"
        confirmLabel="Cancel voucher"
        onConfirm={async (adminPin, reason) => {
          await invoke('cancel_shg_transaction', {
            txnId: parseInt(cancelTarget!.id),
            reason: reason ?? '',
            adminPin,
          })
          toast.success('Voucher cancelled and reversed')
          setCancelTarget(null)
          await loadVouchers()
        }}
      />
    </div>
  )
}
