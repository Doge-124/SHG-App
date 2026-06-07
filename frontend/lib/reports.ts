import { invoke } from '@tauri-apps/api/core'
import { formatCurrency } from '@/lib/format'

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
