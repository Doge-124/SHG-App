'use client'

import { useEffect, useState } from 'react'
import { Plus, ArrowDownRight, Printer, Download, Ban } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { AdminPinDialog } from '@/components/admin-pin-dialog'
import { track } from '@/lib/track'
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
import { ReceiptForm } from '@/components/forms/receipt-form'
import { WeeklyContributionForm } from '@/components/forms/weekly-contribution-form'
import { getReceipts, createReceipt } from '@/lib/api/ledger'
import { useSettings } from '@/lib/settings-context'
import { getReceipts as getReceiptsList } from '@/lib/api/receipts'
import { generateReceiptPDF, generateMultipleReceiptsPDF } from '@/lib/pdf'
import { PrintPreview } from '@/components/print-preview'
import { formatCurrency, formatDateTime } from '@/lib/format'
import type { Receipt, ReceiptFormData } from '@/lib/types'
import type { ReceiptWithMember, WeeklyContributionInput } from '@/lib/types/receipts'

function friendlyReason(referenceType: string | undefined, rawReason: string): string {
  // MEMBER_PAYMENT covers loan repayments, upfront interest, and monthly
  // interest-only payments — they share a reference_type but the raw reason
  // distinguishes them, so check that first.
  if (referenceType === 'MEMBER_PAYMENT') {
    const r = (rawReason || '').toLowerCase()
    if (r.includes('upfront')) return 'Upfront interest'
    if (r.includes('interest')) return 'Interest payment'
    return 'Loan repayment'
  }
  switch (referenceType) {
    case 'WEEKLY_CONTRIBUTION':
    case 'MEMBER_CONTRIBUTION': return 'Savings contribution'
    case 'CHIT_PAYMENT':        return 'Chit installment'
    case 'CHIT_COMMISSION':     return 'Chit commission'
    case 'MEMBER_RECEIPT':      return 'Member receipt'
    case 'DONATION':            return 'Donation'
    case 'GRANT':               return 'Grant'
    case 'OPENING':             return 'Opening balance'
    default:                    return rawReason  // manual receipts keep their user-entered text
  }
}

export default function ReceiptsPage() {
  const { settings } = useSettings()
  const shgName = settings?.general?.groupName || undefined
  const [receipts, setReceipts] = useState<ReceiptWithMember[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [isWeeklyContributionOpen, setIsWeeklyContributionOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [paymentFilter, setPaymentFilter] = useState<'all' | 'cash' | 'bank'>('all')
  const [printPreview, setPrintPreview] = useState<{
    isOpen: boolean
    type: 'receipt' | 'receipts'
    data: ReceiptWithMember | ReceiptWithMember[]
  }>({ isOpen: false, type: 'receipt', data: [] })
  const [cancelTarget, setCancelTarget] = useState<ReceiptWithMember | null>(null)

  useEffect(() => {
    loadReceipts()
  }, [])

  async function loadReceipts() {
    setIsLoading(true)
    try {
      const response = await getReceiptsList()
      if (response.success && response.data) {
        setReceipts(response.data)
      }
    } catch {
      toast.error('Failed to load receipts')
    } finally {
      setIsLoading(false)
    }
  }

  function handleWeeklyContributionSuccess() {
    loadReceipts() // Refresh the receipts list
  }

  const filteredReceipts = paymentFilter === 'all'
    ? receipts
    : receipts.filter((r) => r.payment_method === paymentFilter.toLowerCase())

  // Mixed receipts carry a cash_amount/bank_amount split; count each side
  // toward the right total so the cards still reconcile.
  const totalCash = receipts.reduce(
    (sum, r) => sum + (r.payment_method === 'CASH' ? r.amount : (r.cash_amount ?? 0)), 0)

  const totalBank = receipts.reduce(
    (sum, r) => sum + (r.payment_method === 'BANK' ? r.amount : (r.bank_amount ?? 0)), 0)

  const handleCreateReceipt = async (data: ReceiptFormData) => {
    setIsSubmitting(true)
    try {
      const response = await createReceipt(data)
      if (response.success) {
        toast.success('Receipt created successfully')
        track('receipt.created', { payment_method: data.paymentMethod })
        setIsFormOpen(false)
        loadReceipts()
      } else {
        toast.error(response.error || 'Failed to create receipt')
      }
    } catch {
      toast.error('An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handlePrintReceipt = (receipt: ReceiptWithMember) => {
    setPrintPreview({
      isOpen: true,
      type: 'receipt',
      data: receipt
    })
  }

  const handlePrintAllReceipts = () => {
    if (receipts.length === 0) {
      toast.error('No receipts to print')
      return
    }
    setPrintPreview({
      isOpen: true,
      type: 'receipts',
      data: receipts
    })
  }

  const handleClosePrintPreview = () => {
    setPrintPreview({
      isOpen: false,
      type: 'receipt',
      data: []
    })
  }

  const columns: Column<ReceiptWithMember>[] = [
    {
      key: 'created_at',
      header: 'Date & Time',
      cell: (receipt) => (
        <span className="text-sm">{formatDateTime(receipt.created_at)}</span>
      ),
      sortable: true,
    },
    {
      key: 'amount',
      header: 'Amount',
      cell: (receipt) => {
        const voided = !!receipt.voided_at
        const reversal = !!receipt.reversal_of_id
        return (
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-success/10">
              <ArrowDownRight className="h-4 w-4 text-success" />
            </div>
            <span className={`font-semibold ${voided ? 'line-through text-muted-foreground' : 'text-success'}`}>
              +{formatCurrency(receipt.amount)}
            </span>
            {voided && <Badge variant="outline" className="text-xs border-red-300 text-red-700">VOIDED</Badge>}
            {reversal && <Badge variant="outline" className="text-xs border-amber-300 text-amber-700">Reversal of #{receipt.reversal_of_id}</Badge>}
          </div>
        )
      },
      sortable: true,
    },
    {
      key: 'reason',
      header: 'Reason',
      cell: (receipt) => (
        <div className="space-y-0.5">
          <span className={`text-sm ${receipt.voided_at ? 'line-through text-muted-foreground' : ''}`}>
            {friendlyReason(receipt.reference_type, receipt.reason)}
          </span>
          {receipt.member_name && (
            <span className="text-xs text-muted-foreground block">From: {receipt.member_name}</span>
          )}
          {receipt.payment_method === 'MIXED' && (
            <span className="text-xs text-muted-foreground block">
              Cash {formatCurrency(receipt.cash_amount ?? 0)} + Bank {formatCurrency(receipt.bank_amount ?? 0)}
            </span>
          )}
          {receipt.bank_txn_id && (
            <span className="text-xs text-muted-foreground block">Txn ID: {receipt.bank_txn_id}</span>
          )}
          {receipt.voided_at && receipt.voided_reason && (
            <span className="text-xs text-red-700 block">Cancelled: {receipt.voided_reason}</span>
          )}
        </div>
      ),
    },
    {
      key: 'payment_method',
      header: 'Method',
      cell: (receipt) => (
        <Badge variant="outline">{receipt.payment_method?.toUpperCase()}</Badge>
      ),
    },
    {
      key: 'id',
      header: 'Ref. No.',
      cell: (receipt) => (
        <span className="text-sm font-mono">#{receipt.id}</span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      cell: (receipt) => {
        const cancellable = !receipt.voided_at && !receipt.reversal_of_id
        return (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePrintReceipt(receipt)}
              title="Print"
            >
              <Printer className="h-4 w-4" />
            </Button>
            {cancellable && (
              <Button
                variant="outline"
                size="sm"
                className="text-red-600 hover:bg-red-50"
                onClick={() => setCancelTarget(receipt)}
                title="Cancel this receipt (admin PIN required)"
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
        title="Receipts"
        description="Track money received by the SHG"
      >
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handlePrintAllReceipts}
            disabled={receipts.length === 0}
          >
            <Download className="mr-2 h-4 w-4" />
            Print All
          </Button>
          <Button onClick={() => setIsWeeklyContributionOpen(true)} className="bg-primary hover:bg-primary/90">
            <Plus className="mr-2 h-4 w-4" />
            Weekly Contribution
          </Button>
          <Button onClick={() => setIsFormOpen(true)} className="bg-success hover:bg-success/90 text-success-foreground">
            <Plus className="mr-2 h-4 w-4" />
            Create Receipt
          </Button>
        </div>
      </PageHeader>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          title="Total Receipts"
          value={formatCurrency(totalCash + totalBank)}
          icon={ArrowDownRight}
          description={`${receipts.length} transactions`}
          variant="success"
        />
        <StatCard
          title="Cash Received"
          value={formatCurrency(totalCash)}
          icon={ArrowDownRight}
          description="Cash transactions"
        />
        <StatCard
          title="Bank Received"
          value={formatCurrency(totalBank)}
          icon={ArrowDownRight}
          description="Bank transactions"
        />
      </div>

      {/* Filter */}
      <div className="flex items-center gap-4">
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
      </div>

      <DataTable
        data={filteredReceipts}
        columns={columns}
        searchKey="reason"
        searchPlaceholder="Search by reason..."
        isLoading={isLoading}
        emptyMessage="No receipts found"
      />

      <ReceiptForm
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        onSubmit={handleCreateReceipt}
        isLoading={isSubmitting}
      />
      
      <WeeklyContributionForm
        isOpen={isWeeklyContributionOpen}
        onClose={() => setIsWeeklyContributionOpen(false)}
        onSuccess={handleWeeklyContributionSuccess}
      />
      
      <PrintPreview
        isOpen={printPreview.isOpen}
        onClose={handleClosePrintPreview}
        type={printPreview.type}
        data={printPreview.data as any}
        shgName={shgName}
      />

      <AdminPinDialog
        open={!!cancelTarget}
        onOpenChange={(open) => { if (!open) setCancelTarget(null) }}
        title={`Cancel receipt #${cancelTarget?.id ?? ''}`}
        description={`This will reverse the receipt (Rs ${cancelTarget?.amount ?? 0}) and roll back any derived state (loan, chit, contribution). The original row stays in the ledger marked VOIDED.`}
        destructive
        requireReason
        reasonLabel="Reason for cancellation"
        reasonPlaceholder="e.g. amount typed wrong"
        confirmLabel="Cancel receipt"
        onConfirm={async (adminPin, reason) => {
          await invoke('cancel_shg_transaction', {
            txnId: cancelTarget!.id,
            reason: reason ?? '',
            adminPin,
          })
          toast.success('Receipt cancelled and reversed')
          setCancelTarget(null)
          // Reload the list to reflect voided + reversal rows.
          const res = await getReceiptsList()
          if (res.success && res.data) setReceipts(res.data as ReceiptWithMember[])
        }}
      />
    </div>
  )
}
