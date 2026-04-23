import jsPDF from 'jspdf'
import { formatDateTime } from './format'
import type { Receipt, Voucher } from './types'

const PAGE_WIDTH = 210
const PAGE_HEIGHT = 297
const MARGIN = 20

const formatCurrencyForPDF = (amount: number): string =>
  `Rs. ${amount.toLocaleString('en-IN')}`

const triggerDownload = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/** Convert an empty reason + reference_type into a human-readable label. */
function resolveReason(reason: string | undefined, referenceType?: string): string {
  if (reason && reason.trim()) return reason.trim()
  if (!referenceType) return 'General Payment'
  const labels: Record<string, string> = {
    MEMBER_LOAN: 'Loan Disbursement',
    CHIT_PAYOUT: 'Chit Fund Payout',
    MEMBER_VOUCHER: 'General Expense',
    EXPENSE: 'Expense',
    LOAN_DISBURSEMENT: 'Loan Disbursement',
    MEMBER_PAYMENT: 'Loan Repayment',
    WEEKLY_CONTRIBUTION: 'Weekly Savings Contribution',
    CHIT_PAYMENT: 'Chit Installment',
    DONATION: 'Donation',
    GRANT: 'Grant / External Receipt',
  }
  return labels[referenceType] ?? referenceType.replace(/_/g, ' ')
}

// ─── Single voucher PDF (download) ───────────────────────────────────────────

export function generateVoucherPDF(voucher: Voucher, shgName?: string): void {
  const pdfBlob = buildVoucherPage(new jsPDF(), voucher, shgName)
  triggerDownload(pdfBlob.output('blob'), `voucher_${voucher.referenceNumber || voucher.id}.pdf`)
}

// ─── Batch voucher PDF (download) ────────────────────────────────────────────

export function generateMultipleVouchersPDF(vouchers: Voucher[], shgName?: string): void {
  const doc = new jsPDF()
  vouchers.forEach((v, i) => {
    if (i > 0) doc.addPage()
    renderVoucherContent(doc, v, shgName)
  })
  triggerDownload(doc.output('blob'), `vouchers_batch_${new Date().toISOString().split('T')[0]}.pdf`)
}

// ─── Single receipt PDF (download) ───────────────────────────────────────────

export function generateReceiptPDF(receipt: Receipt, shgName?: string): void {
  const doc = new jsPDF()
  renderReceiptContent(doc, receipt, shgName)
  triggerDownload(doc.output('blob'), `receipt_${receipt.referenceNumber || receipt.id}.pdf`)
}

// ─── Batch receipt PDF (download) ────────────────────────────────────────────

export function generateMultipleReceiptsPDF(receipts: Receipt[], shgName?: string): void {
  const doc = new jsPDF()
  receipts.forEach((r, i) => {
    if (i > 0) doc.addPage()
    renderReceiptContent(doc, r, shgName)
  })
  triggerDownload(doc.output('blob'), `receipts_batch_${new Date().toISOString().split('T')[0]}.pdf`)
}

// ─── Blob helpers (used by PrintPreview) ─────────────────────────────────────

export async function generateVoucherPDFBlobAsync(voucher: Voucher, shgName?: string): Promise<Blob> {
  const { default: jsPDF } = await import('jspdf')
  const doc = new jsPDF()
  renderVoucherContent(doc, voucher, shgName)
  return doc.output('blob')
}

export async function generateMultipleVouchersPDFBlobAsync(vouchers: Voucher[], shgName?: string): Promise<Blob> {
  const { default: jsPDF } = await import('jspdf')
  const doc = new jsPDF()
  vouchers.forEach((v, i) => {
    if (i > 0) doc.addPage()
    renderVoucherContent(doc, v, shgName)
  })
  return doc.output('blob')
}

export async function generateReceiptPDFBlobAsync(receipt: Receipt, shgName?: string): Promise<Blob> {
  const { default: jsPDF } = await import('jspdf')
  const doc = new jsPDF()
  renderReceiptContent(doc, receipt, shgName)
  return doc.output('blob')
}

export async function generateMultipleReceiptsPDFBlobAsync(receipts: Receipt[], shgName?: string): Promise<Blob> {
  const { default: jsPDF } = await import('jspdf')
  const doc = new jsPDF()
  receipts.forEach((r, i) => {
    if (i > 0) doc.addPage()
    renderReceiptContent(doc, r, shgName)
  })
  return doc.output('blob')
}

// ─── Internal renderers ───────────────────────────────────────────────────────

function renderVoucherContent(doc: jsPDF, voucher: Voucher, shgName?: string): void {
  const name = shgName || 'Self Help Group'

  doc.setFontSize(20)
  doc.text('PAYMENT VOUCHER', PAGE_WIDTH / 2, 28, { align: 'center' })

  doc.setFontSize(13)
  doc.text(name, PAGE_WIDTH / 2, 38, { align: 'center' })

  doc.line(MARGIN, 45, PAGE_WIDTH - MARGIN, 45)

  let y = 58
  doc.setFontSize(11)
  doc.text(`Voucher No: ${voucher.referenceNumber || `VOU${voucher.id}`}`, MARGIN, y)
  y += 9
  doc.text(`Date: ${formatDateTime(voucher.createdAt)}`, MARGIN, y)

  y += 14
  doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y)

  y += 10
  doc.setFontSize(12)
  doc.setFont(undefined as any, 'bold')
  doc.text('Paid To:', MARGIN, y)
  y += 8
  doc.setFont(undefined as any, 'normal')
  doc.text(voucher.memberName || voucher.reference || 'General', MARGIN, y)

  y += 14
  doc.setFont(undefined as any, 'bold')
  doc.text('Amount Details:', MARGIN, y)
  y += 8
  doc.setFont(undefined as any, 'normal')
  doc.text(`Amount: ${formatCurrencyForPDF(voucher.amount)}`, MARGIN, y)
  y += 8
  doc.text(`Payment Method: ${(voucher.paymentMethod || 'cash').toUpperCase()}`, MARGIN, y)

  y += 14
  doc.setFont(undefined as any, 'bold')
  doc.text('Reason:', MARGIN, y)
  y += 8
  doc.setFont(undefined as any, 'normal')
  const reason = resolveReason(voucher.reason, voucher.referenceType)
  const lines = doc.splitTextToSize(reason, PAGE_WIDTH - 2 * MARGIN)
  lines.forEach((line: string) => { doc.text(line, MARGIN, y); y += 6 })

  const footerY = PAGE_HEIGHT - 40
  doc.line(MARGIN, footerY, PAGE_WIDTH - MARGIN, footerY)
  doc.setFontSize(10)
  doc.text('This is a computer-generated voucher', PAGE_WIDTH / 2, footerY + 10, { align: 'center' })
  doc.text('No signature required', PAGE_WIDTH / 2, footerY + 16, { align: 'center' })
}

function renderReceiptContent(doc: jsPDF, receipt: any, shgName?: string): void {
  const name = shgName || 'Self Help Group'

  // Normalise field names — receipts page uses ReceiptWithMember (snake_case)
  // while the Receipt type from types.ts uses camelCase.
  const createdAt    = receipt.createdAt    ?? receipt.created_at    ?? ''
  const paymentMethod= receipt.paymentMethod ?? receipt.payment_method ?? 'cash'
  const referenceType= receipt.referenceType ?? receipt.reference_type
  const memberName   = receipt.memberName    ?? receipt.member_name
  const refNumber    = receipt.referenceNumber ?? `RCPT${receipt.id}`

  doc.setFontSize(20)
  doc.text('RECEIPT', PAGE_WIDTH / 2, 28, { align: 'center' })

  doc.setFontSize(13)
  doc.text(name, PAGE_WIDTH / 2, 38, { align: 'center' })

  doc.line(MARGIN, 45, PAGE_WIDTH - MARGIN, 45)

  let y = 58
  doc.setFontSize(11)
  doc.text(`Receipt No: ${refNumber}`, MARGIN, y)
  y += 9
  doc.text(`Date: ${formatDateTime(createdAt)}`, MARGIN, y)
  y += 9
  doc.text(`Type: ${referenceType ? referenceType.replace(/_/g, ' ') : 'GENERAL'}`, MARGIN, y)

  y += 14
  doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y)

  y += 10
  doc.setFontSize(12)
  doc.setFont(undefined as any, 'bold')
  doc.text('Received From:', MARGIN, y)
  y += 8
  doc.setFont(undefined as any, 'normal')
  doc.text(memberName || 'General', MARGIN, y)

  y += 14
  doc.setFont(undefined as any, 'bold')
  doc.text('Amount Details:', MARGIN, y)
  y += 8
  doc.setFont(undefined as any, 'normal')
  doc.text(`Amount: ${formatCurrencyForPDF(receipt.amount)}`, MARGIN, y)
  y += 8
  doc.text(`Payment Method: ${String(paymentMethod).toUpperCase()}`, MARGIN, y)

  y += 14
  doc.setFont(undefined as any, 'bold')
  doc.text('Reason:', MARGIN, y)
  y += 8
  doc.setFont(undefined as any, 'normal')
  const reason = resolveReason(receipt.reason, referenceType)
  const lines = doc.splitTextToSize(reason, PAGE_WIDTH - 2 * MARGIN)
  lines.forEach((line: string) => { doc.text(line, MARGIN, y); y += 6 })

  const footerY = PAGE_HEIGHT - 40
  doc.line(MARGIN, footerY, PAGE_WIDTH - MARGIN, footerY)
  doc.setFontSize(10)
  doc.text('This is a computer-generated receipt', PAGE_WIDTH / 2, footerY + 10, { align: 'center' })
  doc.text('No signature required', PAGE_WIDTH / 2, footerY + 16, { align: 'center' })
}

function buildVoucherPage(doc: jsPDF, voucher: Voucher, shgName?: string): jsPDF {
  renderVoucherContent(doc, voucher, shgName)
  return doc
}
