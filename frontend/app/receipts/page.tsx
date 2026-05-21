'use client'

import { useEffect, useState } from 'react'
import { Plus, ArrowDownRight, Printer, Download } from 'lucide-react'
import { toast } from 'sonner'
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
  switch (referenceType) {
    case 'WEEKLY_CONTRIBUTION':
    case 'MEMBER_CONTRIBUTION': return 'Savings contribution'
    case 'MEMBER_PAYMENT':      return 'Loan repayment'
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

  const totalCash = receipts
    .filter((r) => r.payment_method === 'CASH')
    .reduce((sum, r) => sum + r.amount, 0)

  const totalBank = receipts
    .filter((r) => r.payment_method === 'BANK')
    .reduce((sum, r) => sum + r.amount, 0)

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
      cell: (receipt) => (
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-success/10">
            <ArrowDownRight className="h-4 w-4 text-success" />
          </div>
          <span className="font-semibold text-success">
            +{formatCurrency(receipt.amount)}
          </span>
        </div>
      ),
      sortable: true,
    },
    {
      key: 'reason',
      header: 'Reason',
      cell: (receipt) => (
        <div className="space-y-0.5">
          <span className="text-sm">{friendlyReason(receipt.reference_type, receipt.reason)}</span>
          {receipt.member_name && (
            <span className="text-xs text-muted-foreground block">From: {receipt.member_name}</span>
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
      cell: (receipt) => (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePrintReceipt(receipt)}
          >
            <Printer className="h-4 w-4" />
          </Button>
        </div>
      ),
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
    </div>
  )
}
