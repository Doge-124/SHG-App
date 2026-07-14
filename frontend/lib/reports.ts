import { invoke } from '@tauri-apps/api/core'
import { formatCurrency } from '@/lib/format'
import { guarantorLabel } from '@/lib/api/guarantors'

export interface BankTxnIdEntry {
  id: number
  date: string
  txnType: string
  amount: number
  reason: string
  memberName?: string | null
  bankTxnId: string
}

/** Fetch bank transaction IDs for a period (for the Bank Book report). */
export async function getBankTransactionIds(
  startDate: string,
  endDate: string,
): Promise<{ success: boolean; data?: BankTxnIdEntry[]; error?: string }> {
  try {
    const data = await invoke<BankTxnIdEntry[]>('get_bank_transaction_ids', { startDate, endDate })
    return { success: true, data }
  } catch (error) {
    return { success: false, error: typeof error === 'string' ? error : 'Failed to load transaction IDs' }
  }
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso.slice(0, 10)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}

/**
 * Render report HTML and open the print dialog.
 *
 * In the Tauri WebView2: `window.open()` is blocked (returns null), and a
 * `document.write()` iframe doesn't reliably fire `onload`, so `print()` never
 * gets called. We instead load the HTML into a hidden iframe via a **Blob URL**
 * — the same mechanism the working receipt/voucher PDF print uses — whose
 * `onload` fires dependably, then call print() on it.
 */
function printHtml(html: string): void {
  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)

  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.setAttribute('aria-hidden', 'true')

  iframe.onload = () => {
    setTimeout(() => {
      try {
        iframe.contentWindow?.focus()
        iframe.contentWindow?.print()
      } catch (e) {
        console.error('Print failed', e)
      }
    }, 200)
  }

  iframe.src = url
  document.body.appendChild(iframe)

  // Clean up after the print job has had time to spool.
  setTimeout(() => {
    try { document.body.removeChild(iframe) } catch {}
    URL.revokeObjectURL(url)
  }, 60000)
}

/**
 * Open a printable window for a set of bank transaction IDs. Uses the browser
 * print dialog (the WebView supports window.print()), so the user can "print"
 * to PDF or paper. No external PDF library needed.
 */
export function printBankTransactionIds(
  entries: BankTxnIdEntry[],
  opts: { shgName?: string; fromDate: string; toDate: string },
): void {
  const rows = entries.map((e, i) => `
    <tr>
      <td style="text-align:center">${i + 1}</td>
      <td>${escapeHtml(fmtDate(e.date))}</td>
      <td style="font-family:monospace">${escapeHtml(e.bankTxnId)}</td>
      <td>${escapeHtml(e.txnType === 'RECEIPT' ? 'Credit (in)' : 'Debit (out)')}</td>
      <td style="text-align:right">${escapeHtml(formatCurrency(e.amount))}</td>
      <td>${escapeHtml(e.memberName ?? '')}</td>
      <td>${escapeHtml(e.reason)}</td>
    </tr>`).join('')

  const total = entries.reduce((s, e) => s + (e.txnType === 'RECEIPT' ? e.amount : -e.amount), 0)

  const html = `<!doctype html><html><head><meta charset="utf-8">
    <title>Bank Transaction IDs</title>
    <style>
      body { font: 13px/1.5 -apple-system, Segoe UI, Roboto, sans-serif; padding: 24px; color: #111; }
      h1 { font-size: 18px; margin: 0 0 2px; }
      .sub { color: #555; font-size: 12px; margin-bottom: 16px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #ccc; padding: 6px 8px; font-size: 12px; }
      th { background: #f1f5f9; text-align: left; }
      tfoot td { font-weight: 600; }
      @media print { button { display: none; } }
    </style></head>
    <body>
      <h1>${escapeHtml(opts.shgName || 'SHG Manager')}</h1>
      <div class="sub">Bank Transaction IDs · ${escapeHtml(fmtDate(opts.fromDate))} to ${escapeHtml(fmtDate(opts.toDate))} · ${entries.length} transaction(s)</div>
      <table>
        <thead>
          <tr><th>#</th><th>Date</th><th>Transaction ID</th><th>Type</th><th style="text-align:right">Amount</th><th>Member</th><th>Reason</th></tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#888">No bank transactions with IDs in this period</td></tr>'}</tbody>
        <tfoot><tr><td colspan="4">Net bank movement</td><td style="text-align:right">${escapeHtml(formatCurrency(total))}</td><td colspan="2"></td></tr></tfoot>
      </table>
      <button onclick="window.print()" style="margin-top:16px;padding:8px 16px">Print / Save as PDF</button>
    </body></html>`

  printHtml(html)
}

/** Generic Day Book → printable HTML (Print / Save as PDF). */
export interface DayBookPrintEntry {
  date: string
  txnType: string
  category: string
  amount: number
  paymentMethod: string
  memberName?: string | null
  description: string
}

export function printDayBook(
  entries: DayBookPrintEntry[],
  opts: {
    shgName?: string
    title: string
    fromDate: string
    toDate: string
    openingBalance: number
    totalReceipts: number
    totalVouchers: number
    closingBalance: number
  },
): void {
  const rows = entries.map((e, i) => {
    const isReceipt = e.txnType === 'RECEIPT'
    return `<tr>
      <td style="text-align:center">${i + 1}</td>
      <td>${escapeHtml(fmtDate(e.date))}</td>
      <td>${escapeHtml(e.category)}</td>
      <td>${escapeHtml(e.memberName ?? '')}</td>
      <td>${escapeHtml(e.description)}</td>
      <td>${escapeHtml(e.paymentMethod)}</td>
      <td style="text-align:right;color:#166534">${isReceipt ? escapeHtml(formatCurrency(e.amount)) : ''}</td>
      <td style="text-align:right;color:#991b1b">${!isReceipt ? escapeHtml(formatCurrency(e.amount)) : ''}</td>
    </tr>`
  }).join('')

  const html = `<!doctype html><html><head><meta charset="utf-8">
    <title>${escapeHtml(opts.title)}</title>
    <style>
      body { font: 13px/1.5 -apple-system, Segoe UI, Roboto, sans-serif; padding: 24px; color: #111; }
      h1 { font-size: 18px; margin: 0 0 2px; }
      .sub { color: #555; font-size: 12px; margin-bottom: 12px; }
      .cards { display:flex; gap:16px; margin-bottom:16px; font-size:12px; }
      .card { border:1px solid #ddd; border-radius:6px; padding:8px 12px; }
      .card b { display:block; font-size:14px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #ccc; padding: 6px 8px; font-size: 12px; }
      th { background: #f1f5f9; text-align: left; }
      @media print { button { display: none; } }
    </style></head>
    <body>
      <h1>${escapeHtml(opts.shgName || 'SHG Manager')}</h1>
      <div class="sub">${escapeHtml(opts.title)} · ${escapeHtml(fmtDate(opts.fromDate))} to ${escapeHtml(fmtDate(opts.toDate))}</div>
      <div class="cards">
        <div class="card">Opening<b>${escapeHtml(formatCurrency(opts.openingBalance))}</b></div>
        <div class="card">Receipts<b style="color:#166534">${escapeHtml(formatCurrency(opts.totalReceipts))}</b></div>
        <div class="card">Payments<b style="color:#991b1b">${escapeHtml(formatCurrency(opts.totalVouchers))}</b></div>
        <div class="card">Closing<b>${escapeHtml(formatCurrency(opts.closingBalance))}</b></div>
      </div>
      <table>
        <thead>
          <tr><th>#</th><th>Date</th><th>Category</th><th>Member</th><th>Description</th><th>Method</th>
              <th style="text-align:right">Receipt</th><th style="text-align:right">Payment</th></tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="8" style="text-align:center;color:#888">No transactions</td></tr>'}</tbody>
      </table>
      <button onclick="window.print()" style="margin-top:16px;padding:8px 16px">Print / Save as PDF</button>
    </body></html>`

  printHtml(html)
}

// ─── Income ledgers (interest / chit / savings) ──────────────────────────

export interface IncomeLedgerEntry {
  id: number
  date: string
  memberName?: string | null
  amount: number
  note: string
}

export interface IncomeLedgerSection {
  entries: IncomeLedgerEntry[]
  total: number
  count: number
}

export interface IncomeLedger {
  fromDate: string
  toDate: string
  interest: IncomeLedgerSection
  principal: IncomeLedgerSection
  chit: IncomeLedgerSection
  savings: IncomeLedgerSection
  grandTotal: number
}

const INCOME_SECTIONS: { key: 'interest' | 'principal' | 'chit' | 'savings'; title: string }[] = [
  { key: 'interest', title: 'Interest Income' },
  { key: 'principal', title: 'Loan Principal Collected' },
  { key: 'chit', title: 'Chit Commission Income' },
  { key: 'savings', title: 'Savings Collected' },
]

/** CSV export of all three income ledgers. UTF-8 BOM + CRLF for Excel. */
export function incomeLedgerToCSV(ledger: IncomeLedger, fromLabel: string, toLabel: string): string {
  const q = (s: string) =>
    /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  let csv = '﻿'
  csv += `Income Ledger,${q(fromLabel)} to ${q(toLabel)}\r\n\r\n`
  for (const sec of INCOME_SECTIONS) {
    const s = ledger[sec.key]
    csv += `${sec.title}\r\n`
    csv += `#,Date,Member,Note,Amount\r\n`
    s.entries.forEach((e, i) => {
      const d = e.date.slice(0, 10)
      csv += `${i + 1},${q(d)},${q(e.memberName ?? 'SHG')},${q(e.note)},${e.amount.toFixed(2)}\r\n`
    })
    csv += `,,,Total,${s.total.toFixed(2)}\r\n\r\n`
  }
  csv += `,,,Grand Total (Interest + Chit),${ledger.grandTotal.toFixed(2)}\r\n`
  return csv
}

/** Printable HTML (Print / Save as PDF) for the income ledgers. */
export function printIncomeLedger(
  ledger: IncomeLedger,
  opts: { shgName?: string; fromLabel: string; toLabel: string },
): void {
  const sectionHtml = (title: string, s: IncomeLedgerSection) => {
    const rows = s.entries.map((e, i) => `
      <tr>
        <td style="text-align:center">${i + 1}</td>
        <td>${escapeHtml(fmtDate(e.date))}</td>
        <td>${escapeHtml(e.memberName ?? 'SHG')}</td>
        <td>${escapeHtml(e.note)}</td>
        <td style="text-align:right">${escapeHtml(formatCurrency(e.amount))}</td>
      </tr>`).join('')
    return `
      <h2 style="font-size:14px;margin:18px 0 6px">${escapeHtml(title)}
        <span style="font-weight:400;color:#666">(${s.count})</span></h2>
      <table>
        <thead><tr><th>#</th><th>Date</th><th>Member</th><th>Note</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:#888">No entries</td></tr>'}</tbody>
        <tfoot><tr><td colspan="4" style="text-align:right">Total</td>
          <td style="text-align:right">${escapeHtml(formatCurrency(s.total))}</td></tr></tfoot>
      </table>`
  }

  const html = `<!doctype html><html><head><meta charset="utf-8">
    <title>Income Ledger</title>
    <style>
      body { font: 13px/1.5 -apple-system, Segoe UI, Roboto, sans-serif; padding: 24px; color: #111; }
      h1 { font-size: 18px; margin: 0 0 2px; }
      .sub { color: #555; font-size: 12px; margin-bottom: 12px; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
      th, td { border: 1px solid #ccc; padding: 5px 8px; font-size: 12px; }
      th { background: #f1f5f9; text-align: left; }
      tfoot td { font-weight: 600; background: #fafafa; }
      .grand { margin-top:16px; font-size:14px; font-weight:700; }
      @media print { button { display: none; } }
    </style></head>
    <body>
      <h1>${escapeHtml(opts.shgName || 'SHG Manager')}</h1>
      <div class="sub">Income Ledger · ${escapeHtml(opts.fromLabel)} to ${escapeHtml(opts.toLabel)}</div>
      ${sectionHtml('Interest Income', ledger.interest)}
      ${sectionHtml('Loan Principal Collected', ledger.principal)}
      ${sectionHtml('Chit Commission Income', ledger.chit)}
      ${sectionHtml('Savings Collected', ledger.savings)}
      <div class="grand">Grand Total (Interest + Chit): ${escapeHtml(formatCurrency(ledger.grandTotal))}</div>
      <button onclick="window.print()" style="margin-top:16px;padding:8px 16px">Print / Save as PDF</button>
    </body></html>`

  printHtml(html)
}

// ─── Chit cycles money-flow report ───────────────────────────────────────

export interface ChitCycleReportRow {
  cycleNumber: number | string
  date: string
  collected: number
  paidOut: number
  paymentCount: number
  winnerCount: number
  winnerNames: string   // comma-separated, may be empty
}

export function printChitCycles(
  rows: ChitCycleReportRow[],
  opts: { shgName?: string; chitName: string },
): void {
  const tCollected = rows.reduce((s, r) => s + r.collected, 0)
  const tPaidOut = rows.reduce((s, r) => s + r.paidOut, 0)

  const body = rows.map((r) => `
    <tr>
      <td style="text-align:center">${escapeHtml(String(r.cycleNumber))}</td>
      <td>${escapeHtml(fmtDate(r.date))}</td>
      <td>${escapeHtml(r.winnerNames || '—')}</td>
      <td style="text-align:center">${r.paymentCount}</td>
      <td style="text-align:right;color:#166534">${escapeHtml(formatCurrency(r.collected))}</td>
      <td style="text-align:right;color:#1d4ed8">${escapeHtml(formatCurrency(r.paidOut))}</td>
      <td style="text-align:right">${escapeHtml(formatCurrency(r.collected - r.paidOut))}</td>
    </tr>`).join('')

  const html = `<!doctype html><html><head><meta charset="utf-8">
    <title>Chit Cycles — ${escapeHtml(opts.chitName)}</title>
    <style>
      body { font: 13px/1.5 -apple-system, Segoe UI, Roboto, sans-serif; padding: 24px; color: #111; }
      h1 { font-size: 18px; margin: 0 0 2px; }
      .sub { color: #555; font-size: 12px; margin-bottom: 14px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #ccc; padding: 6px 8px; font-size: 12px; }
      th { background: #f1f5f9; text-align: left; }
      tfoot td { font-weight: 700; background: #fafafa; }
      @media print { button { display: none; } }
    </style></head>
    <body>
      <h1>${escapeHtml(opts.shgName || 'SHG Manager')}</h1>
      <div class="sub">Chit Cycles — ${escapeHtml(opts.chitName)} · ${rows.length} cycle(s)</div>
      <table>
        <thead>
          <tr><th>Cycle</th><th>Date</th><th>Winner(s)</th><th style="text-align:center">Payments</th>
              <th style="text-align:right">Collected</th><th style="text-align:right">Paid Out</th>
              <th style="text-align:right">Net</th></tr>
        </thead>
        <tbody>${body || '<tr><td colspan="7" style="text-align:center;color:#888">No cycles</td></tr>'}</tbody>
        <tfoot>
          <tr><td colspan="4" style="text-align:right">Totals</td>
            <td style="text-align:right;color:#166534">${escapeHtml(formatCurrency(tCollected))}</td>
            <td style="text-align:right;color:#1d4ed8">${escapeHtml(formatCurrency(tPaidOut))}</td>
            <td style="text-align:right">${escapeHtml(formatCurrency(tCollected - tPaidOut))}</td></tr>
        </tfoot>
      </table>
      <button onclick="window.print()" style="margin-top:16px;padding:8px 16px">Print / Save as PDF</button>
    </body></html>`

  printHtml(html)
}

export interface ChitLedgerReportRow {
  cycleNo: number
  date: string
  particulars: string
  debit: number
  credit: number
  balance: number
  isPayout: boolean
}

export function printChitMemberLedger(
  data: {
    memberName: string
    memberCode: string
    chitName: string
    passbookNumber: string | null
    wonCycleNo: number | null
    payoutAmount: number
    totalDebit: number
    totalCredit: number
    totalPayout: number
    closingBalance: number
    guarantors: import('@/lib/api/guarantors').Guarantor[]
    rows: ChitLedgerReportRow[]
  },
  opts: { shgName?: string },
): void {
  const fmtBalance = (b: number) =>
    Math.abs(b) < 0.005 ? 'NIL' : `${formatCurrency(Math.abs(b))} ${b > 0 ? 'CR' : 'DR'}`

  const body = data.rows.map((r) => `
    <tr${r.isPayout ? ' style="background:#fef9c3"' : ''}>
      <td style="text-align:center">${escapeHtml(String(r.cycleNo))}</td>
      <td>${escapeHtml(fmtDate(r.date))}</td>
      <td>${escapeHtml(r.particulars)}</td>
      <td style="text-align:right;color:#1d4ed8">${r.debit ? escapeHtml(formatCurrency(r.debit)) : ''}</td>
      <td style="text-align:right;color:#166534">${r.credit ? escapeHtml(formatCurrency(r.credit)) : ''}</td>
      <td style="text-align:right">${escapeHtml(fmtBalance(r.balance))}</td>
    </tr>`).join('')

  const wonLine = data.wonCycleNo
    ? `Won cycle ${data.wonCycleNo} · Prize ${formatCurrency(data.payoutAmount)}`
    : 'Not yet won'

  const guarantorLine = data.guarantors.length > 0
    ? data.guarantors.map(guarantorLabel).join(', ')
    : '—'

  const html = `<!doctype html><html><head><meta charset="utf-8">
    <title>Chit Ledger — ${escapeHtml(data.memberName)}</title>
    <style>
      body { font: 13px/1.5 -apple-system, Segoe UI, Roboto, sans-serif; padding: 24px; color: #111; }
      h1 { font-size: 18px; margin: 0 0 2px; }
      .sub { color: #555; font-size: 12px; margin-bottom: 4px; }
      .meta { font-size: 12px; margin-bottom: 14px; }
      .meta b { color: #111; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #ccc; padding: 6px 8px; font-size: 12px; }
      th { background: #f1f5f9; text-align: left; }
      tfoot td { font-weight: 700; background: #fafafa; }
      .legend { color:#666; font-size:11px; margin-top:10px; }
      @media print { button { display: none; } }
    </style></head>
    <body>
      <h1>${escapeHtml(opts.shgName || 'SHG Manager')}</h1>
      <div class="sub">Chit Ledger — ${escapeHtml(data.chitName)}</div>
      <div class="meta">
        <b>${escapeHtml(data.memberName)}</b> (${escapeHtml(data.memberCode)})
        ${data.passbookNumber ? ` · Passbook: <b>${escapeHtml(data.passbookNumber)}</b>` : ''}
        · ${escapeHtml(wonLine)}
        <br>Guaranteed by: ${escapeHtml(guarantorLine)}
      </div>
      <table>
        <thead>
          <tr><th style="text-align:center">Cycle</th><th>Date</th><th>Particulars</th>
              <th style="text-align:right">Debit</th><th style="text-align:right">Credit</th>
              <th style="text-align:right">Balance</th></tr>
        </thead>
        <tbody>${body || '<tr><td colspan="6" style="text-align:center;color:#888">No entries</td></tr>'}</tbody>
        <tfoot>
          <tr><td colspan="3" style="text-align:right">Totals</td>
            <td style="text-align:right;color:#1d4ed8">${escapeHtml(formatCurrency(data.totalDebit))}</td>
            <td style="text-align:right;color:#166534">${escapeHtml(formatCurrency(data.totalCredit))}</td>
            <td style="text-align:right">${escapeHtml(fmtBalance(data.closingBalance))}</td></tr>
        </tfoot>
      </table>
      <div class="legend">
        Each cycle credits the member's full contribution — Receipt (cash) + Auction discount (bid discount).
        The Winner payout is debited the gross prize. Balance: CR = creditor (SHG owes the member),
        DR = debtor (member owes the SHG); settles to NIL when the chit completes.
      </div>
      <button onclick="window.print()" style="margin-top:16px;padding:8px 16px">Print / Save as PDF</button>
    </body></html>`

  printHtml(html)
}

// ─── Loan repayment schedule (interest accrual projection) ───────────────

export interface LoanScheduleEntry {
  date: string
  label: string
  entryType: string
  daysElapsed: number
  daysAfterUpfront: number
  interestAccrued: number
  projectedOutstanding: number
  dailyInterest: number
  isPast: boolean
  isOverdue: boolean
  paymentAmount: number
  paymentMethod: string
}

export interface LoanScheduleReport {
  loanId: number
  memberName: string
  principal: number
  dailyRate: number
  dailyInterest: number
  loanType: string
  issuedAt: string
  upfrontDays: number
  upfrontEndDate: string
  upfrontInterest: number
  outstandingAtIssue: number
  dueDate: string | null
  currentOutstanding: number
  totalRepaid: number
  status: string
  entries: LoanScheduleEntry[]
}

/** Printable HTML (Print / Save as PDF) for a member's loan repayment schedule. */
export function printLoanSchedule(
  s: LoanScheduleReport,
  opts: { shgName?: string; memberCode?: string; loanRef?: string },
): void {
  const rowBg = (e: LoanScheduleEntry): string => {
    if (e.entryType === 'today') return ' style="background:#eff6ff"'
    if (e.entryType === 'due_date' && e.isOverdue) return ' style="background:#fef2f2"'
    if (e.entryType === 'due_date') return ' style="background:#fff7ed"'
    if (e.entryType === 'payment') return ' style="background:#f0fdf4"'
    if (e.entryType === 'issued') return ' style="background:#f8fafc"'
    if (e.entryType === 'upfront_end') return ' style="background:#faf5ff"'
    return ''
  }

  const body = s.entries.map((e) => {
    const interestCell =
      e.entryType === 'issued'
        ? `<span style="color:#666">${escapeHtml(formatCurrency(s.upfrontInterest))} upfront (paid)</span>`
        : (e.entryType === 'payment' || e.daysAfterUpfront === 0)
          ? '<span style="color:#999">—</span>'
          : `<span${e.isOverdue ? ' style="color:#b91c1c"' : ''}>${escapeHtml(formatCurrency(e.interestAccrued))}</span>`

    const outstandingCell =
      e.entryType === 'payment'
        ? '<span style="color:#999">—</span>'
        : `<span${e.isOverdue ? ' style="color:#b91c1c"' : ''}>${escapeHtml(formatCurrency(e.projectedOutstanding))}</span>`

    const eventExtra =
      e.entryType === 'payment'
        ? ` <b style="color:#166534">−${escapeHtml(formatCurrency(e.paymentAmount))}</b>${e.paymentMethod ? ` <span style="color:#666">(${escapeHtml(e.paymentMethod)})</span>` : ''}`
        : e.entryType === 'today'
          ? ' <b>(Today)</b>'
          : (e.entryType === 'due_date' && e.isOverdue)
            ? ' <b style="color:#b91c1c">(Overdue)</b>'
            : ''

    return `<tr${rowBg(e)}>
      <td style="white-space:nowrap;font-family:monospace">${escapeHtml(fmtDate(e.date))}</td>
      <td>${escapeHtml(e.label)}${eventExtra}</td>
      <td style="text-align:right;color:#666">${e.daysElapsed}</td>
      <td style="text-align:right">${interestCell}</td>
      <td style="text-align:right;font-weight:600">${outstandingCell}</td>
    </tr>`
  }).join('')

  const dueLine = s.dueDate
    ? ` · Due ${escapeHtml(fmtDate(s.dueDate))}`
    : (s.loanType === 'monthly' ? ' · Open-ended (no fixed due date)' : '')

  const fineNote = s.loanType === 'weekly' && s.dueDate
    ? ` After the due date, a fine of outstanding × 7%/100 per overdue day applies.`
    : ''

  const html = `<!doctype html><html><head><meta charset="utf-8">
    <title>Loan Schedule — ${escapeHtml(s.memberName)}</title>
    <style>
      body { font: 13px/1.5 -apple-system, Segoe UI, Roboto, sans-serif; padding: 24px; color: #111; }
      h1 { font-size: 18px; margin: 0 0 2px; }
      .sub { color: #555; font-size: 12px; margin-bottom: 12px; }
      .cards { display:flex; flex-wrap:wrap; gap:12px; margin-bottom:12px; font-size:12px; }
      .card { border:1px solid #ddd; border-radius:6px; padding:8px 12px; }
      .card span { color:#666; }
      .card b { display:block; font-size:14px; }
      .meta { font-size:12px; margin-bottom:12px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #ccc; padding: 6px 8px; font-size: 12px; }
      th { background: #f1f5f9; text-align: left; }
      .legend { color:#666; font-size:11px; margin-top:10px; }
      @media print { button { display: none; } }
    </style></head>
    <body>
      <h1>${escapeHtml(opts.shgName || 'SHG Manager')}</h1>
      <div class="sub">Loan Repayment Schedule${opts.loanRef ? ` — ${escapeHtml(opts.loanRef)}` : ''} (${escapeHtml(s.loanType)})</div>
      <div class="meta">
        <b>${escapeHtml(s.memberName)}</b>${opts.memberCode ? ` (${escapeHtml(opts.memberCode)})` : ''}
        · Issued ${escapeHtml(fmtDate(s.issuedAt))}${dueLine} · Status: ${escapeHtml(s.status)}
      </div>
      <div class="cards">
        <div class="card"><span>Principal</span><b>${escapeHtml(formatCurrency(s.principal))}</b></div>
        <div class="card"><span>Daily Rate</span><b>${s.dailyRate}% <span style="font-weight:400">(${escapeHtml(formatCurrency(s.dailyInterest))}/day)</span></b></div>
        <div class="card"><span>Upfront Interest (${s.upfrontDays}d)</span><b>${escapeHtml(formatCurrency(s.upfrontInterest))}</b></div>
        <div class="card"><span>Total Paid</span><b style="color:#166534">${escapeHtml(formatCurrency(s.totalRepaid + s.upfrontInterest))}</b></div>
        <div class="card"><span>Current Outstanding</span><b style="color:${s.currentOutstanding > 0 ? '#b45309' : '#166534'}">${escapeHtml(formatCurrency(s.currentOutstanding))}</b></div>
      </div>
      <table>
        <thead>
          <tr><th>Date</th><th>Event</th><th style="text-align:right">Days</th>
              <th style="text-align:right">Interest Accrued</th>
              <th style="text-align:right">Projected Outstanding</th></tr>
        </thead>
        <tbody>${body || '<tr><td colspan="5" style="text-align:center;color:#888">No schedule entries</td></tr>'}</tbody>
      </table>
      <div class="legend">
        Interest accrues at ${escapeHtml(formatCurrency(s.dailyInterest))}/day on principal after the ${s.upfrontDays}-day upfront period.
        Projected Outstanding = original outstanding + cumulative interest, before repayments (so it is a projection, not the live balance on payment rows).${fineNote}
      </div>
      <button onclick="window.print()" style="margin-top:16px;padding:8px 16px">Print / Save as PDF</button>
    </body></html>`

  printHtml(html)
}

export interface LoanLedgerReportRow {
  date: string
  particulars: string
  debit: number
  credit: number
  runningOutstanding: number
}

export function printLoanLedger(
  data: {
    memberName: string
    memberCode: string
    loanRef: string
    amount: number
    status: string
    issuedAt: string
    loanType: string
    outstanding: number
    totalPrincipalPaid: number
    totalInterestPaid: number
    guarantors: import('@/lib/api/guarantors').Guarantor[]
    rows: LoanLedgerReportRow[]
  },
  opts: { shgName?: string },
): void {
  const fmtDr = (x: number) => (x > 0.005 ? `${formatCurrency(x)} Dr` : 'NIL')
  const totalDebit = data.rows.reduce((s, r) => s + r.debit, 0)
  const totalCredit = data.rows.reduce((s, r) => s + r.credit, 0)

  const body = data.rows.map((r) => `
    <tr>
      <td>${escapeHtml(fmtDate(r.date))}</td>
      <td>${escapeHtml(r.particulars)}</td>
      <td style="text-align:right;color:#b45309">${r.debit ? escapeHtml(formatCurrency(r.debit)) : ''}</td>
      <td style="text-align:right;color:#166534">${r.credit ? escapeHtml(formatCurrency(r.credit)) : ''}</td>
      <td style="text-align:right">${escapeHtml(fmtDr(r.runningOutstanding))}</td>
    </tr>`).join('')

  const guarantorLine = data.guarantors.length > 0
    ? data.guarantors.map(guarantorLabel).join(', ')
    : '—'

  const html = `<!doctype html><html><head><meta charset="utf-8">
    <title>Loan Ledger — ${escapeHtml(data.memberName)}</title>
    <style>
      body { font: 13px/1.5 -apple-system, Segoe UI, Roboto, sans-serif; padding: 24px; color: #111; }
      h1 { font-size: 18px; margin: 0 0 2px; }
      .sub { color: #555; font-size: 12px; margin-bottom: 4px; }
      .meta { font-size: 12px; margin-bottom: 14px; }
      .meta b { color: #111; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #ccc; padding: 6px 8px; font-size: 12px; }
      th { background: #f1f5f9; text-align: left; }
      tfoot td { font-weight: 700; background: #fafafa; }
      .legend { color:#666; font-size:11px; margin-top:10px; }
      @media print { button { display: none; } }
    </style></head>
    <body>
      <h1>${escapeHtml(opts.shgName || 'SHG Manager')}</h1>
      <div class="sub">Loan Ledger — ${escapeHtml(data.loanRef)} (${escapeHtml(data.loanType)})</div>
      <div class="meta">
        <b>${escapeHtml(data.memberName)}</b> (${escapeHtml(data.memberCode)})
        · Loan ${escapeHtml(formatCurrency(data.amount))} · Issued ${escapeHtml(fmtDate(data.issuedAt))}
        · Status: ${escapeHtml(data.status)} · Outstanding ${escapeHtml(fmtDr(data.outstanding))}
        <br>Interest paid: ${escapeHtml(formatCurrency(data.totalInterestPaid))}
        <br>Guaranteed by: ${escapeHtml(guarantorLine)}
      </div>
      <table>
        <thead>
          <tr><th>Date</th><th>Particulars</th>
              <th style="text-align:right">Debit</th><th style="text-align:right">Credit</th>
              <th style="text-align:right">Outstanding</th></tr>
        </thead>
        <tbody>${body || '<tr><td colspan="5" style="text-align:center;color:#888">No entries</td></tr>'}</tbody>
        <tfoot>
          <tr><td colspan="2" style="text-align:right">Totals</td>
            <td style="text-align:right;color:#b45309">${escapeHtml(formatCurrency(totalDebit))}</td>
            <td style="text-align:right;color:#166534">${escapeHtml(formatCurrency(totalCredit))}</td>
            <td style="text-align:right">${escapeHtml(fmtDr(data.outstanding))}</td></tr>
        </tfoot>
      </table>
      <div class="legend">
        Debit = loan disbursed (member owes) · Credit = repayments received ·
        Outstanding = principal still owed (Dr), settling to NIL when the loan is cleared.
      </div>
      <button onclick="window.print()" style="margin-top:16px;padding:8px 16px">Print / Save as PDF</button>
    </body></html>`

  printHtml(html)
}
