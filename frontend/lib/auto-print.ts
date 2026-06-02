'use client'

/**
 * Auto-print: when enabled, any receipt or voucher created by the app is sent
 * straight to the printer (the OS print dialog) without the user having to open
 * the document and click Print.
 *
 * The feature is a per-machine preference (printing is device-specific), so it
 * lives in localStorage rather than the encrypted settings DB. The actual
 * detection is done by snapshotting the newest receipt/voucher id *before* a
 * money operation runs and printing any rows created *after* it — this means we
 * always print exactly what was stored (including passbook-stamped reasons and
 * the real reference numbers), and we never print anything when an operation
 * fails (no new rows → nothing to print).
 */

import { invoke } from '@tauri-apps/api/core'

const ENABLED_KEY = 'shg.autoPrintDocs'
const SILENT_KEY = 'shg.autoPrintSilent'
const NAME_KEY = 'shg.groupName'

export function isAutoPrintEnabled(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(ENABLED_KEY) === '1'
}

export function setAutoPrintEnabled(on: boolean): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(ENABLED_KEY, on ? '1' : '0')
}

/**
 * Silent printing routes the PDF through the backend (ShellExecuteW print verb)
 * so it goes straight to the printer with no dialog. Requires a silent-capable
 * PDF handler on the machine; if the backend reports it can't, we fall back to
 * the in-app print dialog automatically.
 */
export function isSilentPrintEnabled(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(SILENT_KEY) === '1'
}

export function setSilentPrintEnabled(on: boolean): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(SILENT_KEY, on ? '1' : '0')
}

/** Cache the SHG name so the auto-print header matches the manual print. */
export function cacheGroupName(name?: string | null): void {
  if (typeof window === 'undefined' || !name) return
  window.localStorage.setItem(NAME_KEY, name)
}

function groupName(): string | undefined {
  if (typeof window === 'undefined') return undefined
  return window.localStorage.getItem(NAME_KEY) || undefined
}

type LedgerCmd = 'get_receipts' | 'get_vouchers'

async function fetchRows(cmd: LedgerCmd): Promise<any[]> {
  try {
    const rows = await invoke<any[]>(cmd, { from: null, to: null })
    return Array.isArray(rows) ? rows : []
  } catch {
    return []
  }
}

function maxId(rows: any[]): number {
  return rows.reduce((m, r) => Math.max(m, Number(r?.id) || 0), 0)
}

/**
 * Mixed (cash+bank) payments are stored as two rows sharing a group_id. Collapse
 * them into a single document showing the combined amount so the operator gets
 * one receipt/voucher per payment rather than two halves.
 */
function mergeByGroup(rows: any[]): any[] {
  const out: any[] = []
  const byGroup = new Map<string, any>()
  for (const r of rows) {
    const gid = r?.group_id
    if (!gid) { out.push(r); continue }
    const isCash = String(r.payment_method).toUpperCase() === 'CASH'
    const existing = byGroup.get(gid)
    if (existing) {
      existing.amount = (Number(existing.amount) || 0) + (Number(r.amount) || 0)
      existing.payment_method = 'MIXED'
      if (isCash) {
        existing.cash_amount = (Number(existing.cash_amount) || 0) + (Number(r.amount) || 0)
      } else {
        existing.bank_amount = (Number(existing.bank_amount) || 0) + (Number(r.amount) || 0)
        if (r.bank_txn_id) existing.bank_txn_id = r.bank_txn_id
      }
    } else {
      const copy = {
        ...r,
        cash_amount: isCash ? Number(r.amount) || 0 : 0,
        bank_amount: isCash ? 0 : Number(r.amount) || 0,
        bank_txn_id: isCash ? null : r.bank_txn_id,
      }
      byGroup.set(gid, copy)
      out.push(copy)
    }
  }
  return out
}

/** Send the PDF to the OS printer with no dialog via the backend. */
async function silentPrintBlob(blob: Blob): Promise<void> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  // Tauri serialises a number[] as the Vec<u8> the command expects.
  await invoke('silent_print_pdf', { bytes: Array.from(buf), printer: null })
}

/** Print a PDF blob, preferring the silent backend path when it's enabled. */
async function printBlob(blob: Blob): Promise<void> {
  if (isSilentPrintEnabled()) {
    try {
      await silentPrintBlob(blob)
      return
    } catch (e) {
      // No silent handler available — fall back to the in-app dialog so the
      // document still prints rather than silently failing.
      console.error('Silent print failed, falling back to dialog', e)
    }
  }
  return printBlobViaDialog(blob)
}

/** Print a PDF blob via a hidden iframe (opens the OS print dialog). */
function printBlobViaDialog(blob: Blob): Promise<void> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    iframe.setAttribute('aria-hidden', 'true')

    let settled = false
    const cleanup = () => {
      if (settled) return
      settled = true
      // Keep the iframe around briefly so the print job can spool, then remove.
      setTimeout(() => {
        try { document.body.removeChild(iframe) } catch {}
        URL.revokeObjectURL(url)
      }, 60000)
      resolve()
    }

    iframe.onload = () => {
      try {
        iframe.contentWindow?.focus()
        iframe.contentWindow?.print()
      } catch (e) {
        console.error('Auto-print: print() failed', e)
      }
      cleanup()
    }
    // Safety net if onload never fires.
    setTimeout(cleanup, 8000)

    iframe.src = url
    document.body.appendChild(iframe)
  })
}

async function printDocs(kind: 'receipt' | 'voucher', rows: any[]): Promise<void> {
  if (rows.length === 0) return
  const merged = mergeByGroup(rows)
  const name = groupName()
  const pdf = await import('@/lib/pdf')

  let blob: Blob
  if (kind === 'receipt') {
    blob = merged.length === 1
      ? await pdf.generateReceiptPDFBlobAsync(merged[0], name)
      : await pdf.generateMultipleReceiptsPDFBlobAsync(merged, name)
  } else {
    blob = merged.length === 1
      ? await pdf.generateVoucherPDFBlobAsync(merged[0], name)
      : await pdf.generateMultipleVouchersPDFBlobAsync(merged, name)
  }
  await printBlob(blob)
}

/**
 * Run a money operation and, if auto-print is enabled, print whatever receipts
 * and/or vouchers it created. The operation's return value is passed through
 * unchanged, so this is a drop-in wrapper around existing API calls.
 */
export async function withAutoPrint<T>(op: () => Promise<T>): Promise<T> {
  if (!isAutoPrintEnabled()) return op()

  const [receiptsBefore, vouchersBefore] = await Promise.all([
    fetchRows('get_receipts'),
    fetchRows('get_vouchers'),
  ])
  const rBefore = maxId(receiptsBefore)
  const vBefore = maxId(vouchersBefore)

  const result = await op()

  // Print in the background so we never delay the caller's UI.
  void (async () => {
    try {
      const [receiptsAfter, vouchersAfter] = await Promise.all([
        fetchRows('get_receipts'),
        fetchRows('get_vouchers'),
      ])
      const newReceipts = receiptsAfter
        .filter((r) => (Number(r?.id) || 0) > rBefore)
        .sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0))
      const newVouchers = vouchersAfter
        .filter((r) => (Number(r?.id) || 0) > vBefore)
        .sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0))

      await printDocs('receipt', newReceipts)
      await printDocs('voucher', newVouchers)
    } catch (e) {
      console.error('Auto-print failed', e)
    }
  })()

  return result
}
