'use client'

import { useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { formatCurrency } from '@/lib/format'

export type PayMethod = 'cash' | 'bank' | 'mixed'

export interface PaymentSplit {
  method: PayMethod
  cashAmount: number   // meaningful only when method === 'mixed'
  bankAmount: number   // meaningful only when method === 'mixed'
  bankTxnId: string    // for bank, or the bank half of mixed
}

export const emptyPaymentSplit: PaymentSplit = {
  method: 'cash',
  cashAmount: 0,
  bankAmount: 0,
  bankTxnId: '',
}

/**
 * Reusable payment-method picker supporting Cash, Bank, and Mixed
 * (cash + bank split), plus an optional bank transaction-ID field for any
 * payment with a bank component.
 *
 * Controlled component: parent owns the PaymentSplit value. The parent is
 * responsible for passing the split fields to the backend and for final
 * validation (use `isPaymentSplitValid`).
 */
export function PaymentMethodFields({
  total,
  value,
  onChange,
  allowMixed = true,
  idPrefix = 'pm',
}: {
  total: number
  value: PaymentSplit
  onChange: (v: PaymentSplit) => void
  allowMixed?: boolean
  idPrefix?: string
}) {
  // When Mixed is selected and the split is empty, seed cash = full total so
  // the officer just edits one side. When total changes, keep bank = total − cash.
  useEffect(() => {
    if (value.method !== 'mixed') return
    if (value.cashAmount === 0 && value.bankAmount === 0 && total > 0) {
      onChange({ ...value, cashAmount: total, bankAmount: 0 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.method, total])

  const setCash = (cash: number) => {
    const c = isFinite(cash) ? cash : 0
    onChange({ ...value, cashAmount: c, bankAmount: Math.max(0, Math.round((total - c) * 100) / 100) })
  }
  const setBank = (bank: number) => {
    const b = isFinite(bank) ? bank : 0
    onChange({ ...value, bankAmount: b, cashAmount: Math.max(0, Math.round((total - b) * 100) / 100) })
  }

  const showBankTxn = value.method === 'bank' || value.method === 'mixed'
  const splitSum = Math.round((value.cashAmount + value.bankAmount) * 100) / 100
  const mismatch = value.method === 'mixed' && Math.abs(splitSum - total) > 0.01

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>Payment Method</Label>
        <Select
          value={value.method}
          onValueChange={(m) => onChange({ ...value, method: m as PayMethod })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="cash">Cash</SelectItem>
            <SelectItem value="bank">Bank</SelectItem>
            {allowMixed && <SelectItem value="mixed">Mixed (cash + bank)</SelectItem>}
          </SelectContent>
        </Select>
      </div>

      {value.method === 'mixed' && (
        <div className="grid grid-cols-2 gap-3 rounded-md border p-3 bg-muted/30">
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-cash`} className="text-xs">Cash portion (₹)</Label>
            <Input
              id={`${idPrefix}-cash`}
              type="number" min={0} step="0.01"
              value={value.cashAmount || ''}
              onChange={(e) => setCash(parseFloat(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-bank`} className="text-xs">Bank portion (₹)</Label>
            <Input
              id={`${idPrefix}-bank`}
              type="number" min={0} step="0.01"
              value={value.bankAmount || ''}
              onChange={(e) => setBank(parseFloat(e.target.value) || 0)}
            />
          </div>
          <p className={`col-span-2 text-xs ${mismatch ? 'text-destructive' : 'text-muted-foreground'}`}>
            {mismatch
              ? `Cash + bank (${formatCurrency(splitSum)}) must equal the total ${formatCurrency(total)}`
              : `Splits to ${formatCurrency(value.cashAmount)} cash + ${formatCurrency(value.bankAmount)} bank`}
          </p>
        </div>
      )}

      {showBankTxn && (
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-txn`} className="text-xs">
            Bank Transaction ID {value.method === 'mixed' ? '(for the bank portion)' : '(optional)'}
          </Label>
          <Input
            id={`${idPrefix}-txn`}
            type="text"
            placeholder="UTR / cheque / reference no."
            value={value.bankTxnId}
            onChange={(e) => onChange({ ...value, bankTxnId: e.target.value })}
            maxLength={64}
          />
        </div>
      )}
    </div>
  )
}

/** True if the split is internally consistent for submission. */
export function isPaymentSplitValid(v: PaymentSplit, total: number): boolean {
  if (v.method !== 'mixed') return true
  if (v.cashAmount <= 0 || v.bankAmount <= 0) return false
  return Math.abs((v.cashAmount + v.bankAmount) - total) <= 0.01
}

/**
 * Build the invoke() args for the split. Returns the fields every backend
 * payment command now accepts: paymentMethod (UPPER), cashAmount, bankAmount,
 * bankTxnId. Non-mixed payments send null splits.
 */
export function paymentInvokeArgs(v: PaymentSplit) {
  const method = v.method.toUpperCase() // CASH | BANK | MIXED
  return {
    paymentMethod: method,
    cashAmount: v.method === 'mixed' ? v.cashAmount : null,
    bankAmount: v.method === 'mixed' ? v.bankAmount : null,
    bankTxnId: (v.method === 'bank' || v.method === 'mixed') && v.bankTxnId.trim()
      ? v.bankTxnId.trim()
      : null,
  }
}
