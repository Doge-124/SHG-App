/**
 * PDF generation for receipts and vouchers.
 * Paper size: A5 (148 × 210 mm) — standard Indian receipt/voucher size.
 * Two documents are printed per A4 sheet when batch-printing (saves paper).
 */

import jsPDF from 'jspdf'
import type { Receipt, Voucher } from './types'

// ─── Dimensions (A5, mm) ─────────────────────────────────────────────────────
const W = 148
const H = 210
const M = 11        // side margin
const TW = W - M * 2  // usable text width

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtAmount = (n: number) =>
  `Rs. ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtDate = (d: string): string => {
  try {
    return new Date(d).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    })
  } catch { return d }
}

const fmtDateTime = (d: string): string => {
  try {
    return new Date(d).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    })
  } catch { return d }
}

const newA5 = () => new jsPDF({ unit: 'mm', format: 'a5', orientation: 'portrait' })

function resolveReason(reason?: string, referenceType?: string): string {
  if (reason && reason.trim()) return reason.trim()
  const labels: Record<string, string> = {
    MEMBER_LOAN: 'Loan Disbursement',
    CHIT_PAYOUT: 'Chit Fund Payout',
    MEMBER_VOUCHER: 'General Expense',
    MEMBER_PAYMENT: 'Loan Repayment',
    WEEKLY_CONTRIBUTION: 'Weekly Savings Contribution',
    CHIT_PAYMENT: 'Chit Installment',
    DONATION: 'Donation / External Receipt',
    GRANT: 'Grant / External Receipt',
    MEMBER_CONTRIBUTION: 'Savings Deposit',
    MEMBER_RECEIPT: 'General Receipt',
  }
  return referenceType ? (labels[referenceType] ?? referenceType.replace(/_/g, ' ')) : 'General'
}

const triggerDownload = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ─── Receipt renderer ─────────────────────────────────────────────────────────

function renderReceipt(doc: jsPDF, receipt: any, shgName?: string, offsetY = 0): void {
  const name = shgName || 'Self Help Group'
  const y0 = offsetY   // baseline for this receipt on the page

  // Normalise field names (handles both camelCase and snake_case)
  const createdAt     = receipt.createdAt     ?? receipt.created_at     ?? ''
  const paymentMethod = (receipt.paymentMethod ?? receipt.payment_method ?? 'cash').toUpperCase()
  const referenceType = receipt.referenceType ?? receipt.reference_type
  const memberName    = receipt.memberName    ?? receipt.member_name     ?? 'General'
  const refNumber     = receipt.referenceNumber ?? `RCPT${String(receipt.id ?? '').padStart(6, '0')}`
  const amount        = receipt.amount ?? 0
  const reason        = resolveReason(receipt.reason, referenceType)

  // ── Header band (dark background) ──────────────────────────────────────────
  doc.setFillColor(30, 41, 59)   // slate-900
  doc.rect(0, y0, W, 30, 'F')

  doc.setTextColor(255, 255, 255)
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text('RECEIPT', W / 2, y0 + 12, { align: 'center' })

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(name, W / 2, y0 + 21, { align: 'center' })

  doc.setFontSize(8)
  doc.text('OFFICIAL MONEY RECEIPT', W / 2, y0 + 28, { align: 'center' })

  // Reset text colour
  doc.setTextColor(30, 41, 59)

  // ── Info row: no. + date ────────────────────────────────────────────────────
  let y = y0 + 38
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.text('RECEIPT NO.', M, y)
  doc.text('DATE', W - M, y, { align: 'right' })

  y += 5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(refNumber, M, y)
  doc.text(fmtDateTime(createdAt), W - M, y, { align: 'right' })

  // ── Thin divider ───────────────────────────────────────────────────────────
  y += 7
  doc.setDrawColor(203, 213, 225)   // slate-300
  doc.setLineWidth(0.3)
  doc.line(M, y, W - M, y)

  // ── Received from ──────────────────────────────────────────────────────────
  y += 8
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(100, 116, 139)   // slate-500
  doc.text('RECEIVED FROM', M, y)

  y += 5
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(30, 41, 59)
  doc.text(memberName, M, y)

  // ── Payment method pill ────────────────────────────────────────────────────
  const pillX = W - M - 20
  doc.setFillColor(241, 245, 249)   // slate-100
  doc.setDrawColor(203, 213, 225)
  doc.setLineWidth(0.3)
  doc.roundedRect(pillX, y - 4.5, 20, 7, 1.5, 1.5, 'FD')
  doc.setFontSize(7)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(71, 85, 105)     // slate-600
  doc.text(paymentMethod, pillX + 10, y, { align: 'center' })

  // ── Amount box ─────────────────────────────────────────────────────────────
  y += 10
  doc.setFillColor(240, 253, 244)   // green-50
  doc.setDrawColor(134, 239, 172)   // green-300
  doc.setLineWidth(0.4)
  doc.roundedRect(M, y, TW, 18, 2, 2, 'FD')

  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(22, 101, 52)     // green-800
  doc.text('AMOUNT RECEIVED', M + 5, y + 6)

  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text(fmtAmount(amount), W - M - 5, y + 13, { align: 'right' })

  // ── Divider ────────────────────────────────────────────────────────────────
  y += 24
  doc.setDrawColor(203, 213, 225)
  doc.setLineWidth(0.3)
  doc.line(M, y, W - M, y)

  // ── Reason / Purpose ───────────────────────────────────────────────────────
  y += 7
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(100, 116, 139)
  doc.text('PURPOSE', M, y)

  y += 5
  doc.setFontSize(9.5)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(30, 41, 59)
  const reasonLines = doc.splitTextToSize(reason, TW)
  reasonLines.forEach((line: string) => {
    doc.text(line, M, y)
    y += 5.5
  })

  // ── Signature section ──────────────────────────────────────────────────────
  const sigY = y0 + H - 32
  doc.setDrawColor(203, 213, 225)
  doc.setLineWidth(0.3)
  doc.line(M, sigY, W - M, sigY)

  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100, 116, 139)
  doc.text('Receiver\'s Signature', M, sigY + 6)
  doc.text('Authorised Signatory', W - M, sigY + 6, { align: 'right' })

  // Signature lines
  doc.setDrawColor(148, 163, 184)
  doc.setLineWidth(0.25)
  doc.line(M, sigY + 13, M + 45, sigY + 13)
  doc.line(W - M - 45, sigY + 13, W - M, sigY + 13)

  // Footer note
  y = y0 + H - 8
  doc.setFillColor(248, 250, 252)   // slate-50
  doc.rect(0, y0 + H - 12, W, 12, 'F')
  doc.setFontSize(7)
  doc.setFont('helvetica', 'italic')
  doc.setTextColor(148, 163, 184)
  doc.text('Computer-generated receipt — valid without physical signature', W / 2, y, { align: 'center' })
}

// ─── Voucher renderer ─────────────────────────────────────────────────────────

function renderVoucher(doc: jsPDF, voucher: any, shgName?: string, offsetY = 0): void {
  const name = shgName || 'Self Help Group'
  const y0 = offsetY

  const paymentMethod = (voucher.paymentMethod ?? voucher.payment_method ?? 'cash').toUpperCase()
  const memberName    = voucher.memberName ?? voucher.member_name ?? voucher.reference ?? 'General'
  const refNumber     = voucher.referenceNumber ?? `VOU${String(voucher.id ?? '').padStart(6, '0')}`
  const amount        = voucher.amount ?? 0
  const createdAt     = voucher.createdAt ?? voucher.created_at ?? ''
  const reason        = resolveReason(voucher.reason, voucher.referenceType ?? voucher.reference_type)

  // ── Header band (deep amber for vouchers) ──────────────────────────────────
  doc.setFillColor(120, 53, 15)    // amber-900
  doc.rect(0, y0, W, 30, 'F')

  doc.setTextColor(255, 255, 255)
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text('PAYMENT VOUCHER', W / 2, y0 + 12, { align: 'center' })

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(name, W / 2, y0 + 21, { align: 'center' })

  doc.setFontSize(8)
  doc.text('OFFICIAL PAYMENT VOUCHER', W / 2, y0 + 28, { align: 'center' })

  doc.setTextColor(30, 41, 59)

  // ── Info row ───────────────────────────────────────────────────────────────
  let y = y0 + 38
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.text('VOUCHER NO.', M, y)
  doc.text('DATE', W - M, y, { align: 'right' })

  y += 5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(refNumber, M, y)
  doc.text(fmtDateTime(createdAt), W - M, y, { align: 'right' })

  y += 7
  doc.setDrawColor(203, 213, 225)
  doc.setLineWidth(0.3)
  doc.line(M, y, W - M, y)

  // ── Paid to ────────────────────────────────────────────────────────────────
  y += 8
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(100, 116, 139)
  doc.text('PAID TO', M, y)

  y += 5
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(30, 41, 59)
  doc.text(memberName, M, y)

  // Payment method pill
  const pillX = W - M - 20
  doc.setFillColor(255, 251, 235)   // amber-50
  doc.setDrawColor(252, 211, 77)    // amber-300
  doc.setLineWidth(0.3)
  doc.roundedRect(pillX, y - 4.5, 20, 7, 1.5, 1.5, 'FD')
  doc.setFontSize(7)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(120, 53, 15)
  doc.text(paymentMethod, pillX + 10, y, { align: 'center' })

  // ── Amount box ─────────────────────────────────────────────────────────────
  y += 10
  doc.setFillColor(255, 251, 235)   // amber-50
  doc.setDrawColor(252, 211, 77)    // amber-300
  doc.setLineWidth(0.4)
  doc.roundedRect(M, y, TW, 18, 2, 2, 'FD')

  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(120, 53, 15)
  doc.text('AMOUNT PAID', M + 5, y + 6)

  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text(fmtAmount(amount), W - M - 5, y + 13, { align: 'right' })

  // ── Divider ────────────────────────────────────────────────────────────────
  y += 24
  doc.setDrawColor(203, 213, 225)
  doc.setLineWidth(0.3)
  doc.line(M, y, W - M, y)

  // ── Reason ────────────────────────────────────────────────────────────────
  y += 7
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(100, 116, 139)
  doc.text('PURPOSE', M, y)

  y += 5
  doc.setFontSize(9.5)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(30, 41, 59)
  const reasonLines = doc.splitTextToSize(reason, TW)
  reasonLines.forEach((line: string) => {
    doc.text(line, M, y)
    y += 5.5
  })

  // ── Signature section ──────────────────────────────────────────────────────
  const sigY = y0 + H - 32
  doc.setDrawColor(203, 213, 225)
  doc.setLineWidth(0.3)
  doc.line(M, sigY, W - M, sigY)

  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100, 116, 139)
  doc.text('Prepared By', M, sigY + 6)
  doc.text('Authorised Signatory', W - M, sigY + 6, { align: 'right' })

  doc.setDrawColor(148, 163, 184)
  doc.setLineWidth(0.25)
  doc.line(M, sigY + 13, M + 45, sigY + 13)
  doc.line(W - M - 45, sigY + 13, W - M, sigY + 13)

  // Footer note
  const fY = y0 + H - 8
  doc.setFillColor(255, 251, 235)
  doc.rect(0, y0 + H - 12, W, 12, 'F')
  doc.setFontSize(7)
  doc.setFont('helvetica', 'italic')
  doc.setTextColor(180, 130, 60)
  doc.text('Computer-generated voucher — valid without physical signature', W / 2, fY, { align: 'center' })
}

// ─── Public download API ──────────────────────────────────────────────────────

export function generateReceiptPDF(receipt: any, shgName?: string): void {
  const doc = newA5()
  renderReceipt(doc, receipt, shgName)
  triggerDownload(doc.output('blob'), `receipt_${receipt.referenceNumber ?? receipt.id}.pdf`)
}

export function generateVoucherPDF(voucher: any, shgName?: string): void {
  const doc = newA5()
  renderVoucher(doc, voucher, shgName)
  triggerDownload(doc.output('blob'), `voucher_${voucher.referenceNumber ?? voucher.id}.pdf`)
}

/** Batch receipts: 2 per A4 sheet (A5 top + A5 bottom). */
export function generateMultipleReceiptsPDF(receipts: any[], shgName?: string): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  receipts.forEach((r, i) => {
    if (i > 0 && i % 2 === 0) doc.addPage()
    const offsetY = (i % 2) * 149   // 0mm for top, 149mm for bottom
    renderReceipt(doc, r, shgName, offsetY)
    // Dashed cut line between top and bottom receipt
    if (i % 2 === 0 && i + 1 < receipts.length) {
      doc.setDrawColor(200, 200, 200)
      doc.setLineWidth(0.3)
      doc.setLineDashPattern([2, 2], 0)
      doc.line(0, 148, 210, 148)
      doc.setLineDashPattern([], 0)
    }
  })
  triggerDownload(doc.output('blob'), `receipts_${new Date().toISOString().split('T')[0]}.pdf`)
}

/** Batch vouchers: 2 per A4 sheet. */
export function generateMultipleVouchersPDF(vouchers: any[], shgName?: string): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  vouchers.forEach((v, i) => {
    if (i > 0 && i % 2 === 0) doc.addPage()
    const offsetY = (i % 2) * 149
    renderVoucher(doc, v, shgName, offsetY)
    if (i % 2 === 0 && i + 1 < vouchers.length) {
      doc.setDrawColor(200, 200, 200)
      doc.setLineWidth(0.3)
      doc.setLineDashPattern([2, 2], 0)
      doc.line(0, 148, 210, 148)
      doc.setLineDashPattern([], 0)
    }
  })
  triggerDownload(doc.output('blob'), `vouchers_${new Date().toISOString().split('T')[0]}.pdf`)
}

// ─── Blob API (used by PrintPreview for in-app preview) ───────────────────────

export async function generateReceiptPDFBlobAsync(receipt: any, shgName?: string): Promise<Blob> {
  const { default: jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a5', orientation: 'portrait' })
  renderReceipt(doc, receipt, shgName)
  return doc.output('blob')
}

export async function generateVoucherPDFBlobAsync(voucher: any, shgName?: string): Promise<Blob> {
  const { default: jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a5', orientation: 'portrait' })
  renderVoucher(doc, voucher, shgName)
  return doc.output('blob')
}

export async function generateMultipleReceiptsPDFBlobAsync(receipts: any[], shgName?: string): Promise<Blob> {
  const { default: jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  receipts.forEach((r, i) => {
    if (i > 0 && i % 2 === 0) doc.addPage()
    const offsetY = (i % 2) * 149
    renderReceipt(doc, r, shgName, offsetY)
    if (i % 2 === 0 && i + 1 < receipts.length) {
      doc.setDrawColor(200, 200, 200)
      doc.setLineWidth(0.3)
      doc.setLineDashPattern([2, 2], 0)
      doc.line(0, 148, 210, 148)
      doc.setLineDashPattern([], 0)
    }
  })
  return doc.output('blob')
}

export async function generateMultipleVouchersPDFBlobAsync(vouchers: any[], shgName?: string): Promise<Blob> {
  const { default: jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  vouchers.forEach((v, i) => {
    if (i > 0 && i % 2 === 0) doc.addPage()
    const offsetY = (i % 2) * 149
    renderVoucher(doc, v, shgName, offsetY)
    if (i % 2 === 0 && i + 1 < vouchers.length) {
      doc.setDrawColor(200, 200, 200)
      doc.setLineWidth(0.3)
      doc.setLineDashPattern([2, 2], 0)
      doc.line(0, 148, 210, 148)
      doc.setLineDashPattern([], 0)
    }
  })
  return doc.output('blob')
}
