import { invoke } from '@tauri-apps/api/core'
import { withAutoPrint } from '@/lib/auto-print'
import type { Loan, LoanFormData, LoanRepayment, ApiResponse } from '@/lib/types'
import type { Guarantor } from '@/lib/api/guarantors'

export interface LoanLedgerEntry {
  id: number
  date: string
  particulars: string
  debit: number
  credit: number
  principal: number
  interest: number
  runningOutstanding: number
}

export interface LoanPassbookLoan {
  loanId: number
  amount: number
  issuedAt: string
  status: string
  loanType: string
  dailyInterestRate: number
  outstanding: number
  totalPrincipalPaid: number
  totalInterestPaid: number
  guarantors: Guarantor[]
  entries: LoanLedgerEntry[]
}

export interface MemberLoanPassbook {
  memberId: number
  memberName: string
  memberCode: string
  memberType: string
  joinDate: string
  loans: LoanPassbookLoan[]
  totalDisbursed: number
  totalPrincipalPaid: number
  totalInterestPaid: number
  totalOutstanding: number
}

/** A member's full loan history as a per-loan debit/credit ledger. */
export async function getMemberLoanPassbook(memberId: string): Promise<ApiResponse<MemberLoanPassbook>> {
  try {
    const data = await invoke<MemberLoanPassbook>('get_member_loan_passbook', { memberId: parseInt(memberId) })
    return { success: true, data }
  } catch (error) {
    console.error('Failed to load loan ledger:', error)
    return { success: false, error: typeof error === 'string' ? error : 'Failed to load loan ledger' }
  }
}

function mapLoan(loan: any): Loan {
  return {
    id: loan.id.toString(),
    memberId: loan.member_id.toString(),
    memberName: loan.member_name || 'Unknown',
    amount: loan.amount,
    outstandingAmount: loan.outstanding_amount,
    interestRate: loan.interest_rate || 0,
    dailyInterestRate: loan.daily_interest_rate || 0,
    totalRepayable: loan.total_repayable || loan.outstanding_amount,
    interestAmount: loan.interest_amount || 0,
    upfrontInterestAmount: loan.upfront_interest_amount || 0,
    paymentMethod: loan.payment_method.toLowerCase() as 'cash' | 'bank',
    loanType: (loan.loan_type || 'monthly').toLowerCase() as 'monthly' | 'weekly',
    note: loan.note || '',
    status: loan.status.toLowerCase() as 'active' | 'paid' | 'defaulted',
    issuedAt: loan.issued_at,
    createdAt: loan.created_at,
  }
}

/**
 * Calculate the overdue fine for a weekly loan.
 * Fine accumulates after 120 days (100-day term + 20-day grace).
 * Formula: outstanding × 0.07 / 100 × daysOverdue
 */
export function calculateWeeklyFine(outstanding: number, issuedAt: string, paymentDate?: Date): number {
  const issued = new Date(issuedAt)
  const now = paymentDate ?? new Date()
  const daysSinceIssue = Math.floor((now.getTime() - issued.getTime()) / (1000 * 60 * 60 * 24))
  if (daysSinceIssue <= 120) return 0
  const daysOverdue = daysSinceIssue - 120
  return Math.round(outstanding * 0.07 / 100 * daysOverdue * 100) / 100
}

function mapRepayment(p: any): LoanRepayment {
  return {
    id: p.id.toString(),
    loanId: p.loan_id.toString(),
    amount: p.amount,
    paymentMethod: p.payment_method.toLowerCase() as 'cash' | 'bank',
    note: p.note || '',
    paidAt: p.created_at,
  }
}

export async function getLoans(): Promise<ApiResponse<Loan[]>> {
  try {
    const loans = await invoke('get_all_loans') as any[]
    return { success: true, data: loans.map(mapLoan).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) }
  } catch (error) {
    console.error('Failed to get loans:', error)
    return { success: false, error: 'Failed to load loans' }
  }
}

export async function getLoan(id: string): Promise<ApiResponse<Loan>> {
  try {
    const loan = await invoke('get_loan', { loanId: parseInt(id) }) as any
    if (!loan) return { success: false, error: 'Loan not found' }
    return { success: true, data: mapLoan(loan) }
  } catch (error) {
    console.error('Failed to get loan:', error)
    return { success: false, error: 'Failed to load loan' }
  }
}

export async function getMemberLoans(memberId: string): Promise<ApiResponse<Loan[]>> {
  try {
    const loans = await invoke('get_member_loans', { memberId: parseInt(memberId) }) as any[]
    return { success: true, data: loans.map(mapLoan).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) }
  } catch (error) {
    console.error('Failed to get member loans:', error)
    return { success: false, error: 'Failed to load member loans' }
  }
}

export async function getOutstandingLoans(): Promise<ApiResponse<Loan[]>> {
  try {
    const loans = await invoke('get_all_loans') as any[]
    const active = loans.map(mapLoan).filter(l => l.status === 'active')
    return { success: true, data: active }
  } catch (error) {
    console.error('Failed to get outstanding loans:', error)
    return { success: false, error: 'Failed to load outstanding loans' }
  }
}

export async function getLoanRepayments(loanId: string): Promise<ApiResponse<LoanRepayment[]>> {
  try {
    const payments = await invoke('get_loan_repayments', { loanId: parseInt(loanId) }) as any[]
    return { success: true, data: payments.map(mapRepayment) }
  } catch (error) {
    console.error('Failed to get loan repayments:', error)
    return { success: false, error: 'Failed to load loan repayments' }
  }
}

export async function issueLoan(data: LoanFormData): Promise<ApiResponse<Loan>> {
  try {
    const loanId = await withAutoPrint(() => invoke('issue_member_loan', {
      memberId: parseInt(data.memberId),
      amount: data.amount,
      dailyInterestRate: data.dailyInterestRate,
      paymentMethod: data.paymentMethod.toUpperCase(),
      cashAmount: data.cashAmount ?? null,
      bankAmount: data.bankAmount ?? null,
      bankTxnId: data.bankTxnId ?? null,
      loanType: data.loanType.toLowerCase(),
      note: data.note || '',
      createdAt: new Date().toISOString(),
    })) as number

    // Attach guarantors (optional, up to 2) to the freshly created loan.
    if (data.guarantors && data.guarantors.length > 0) {
      const { setLoanGuarantors } = await import('@/lib/api/guarantors')
      await setLoanGuarantors(loanId.toString(), data.guarantors)
    }

    const loan = await invoke('get_loan', { loanId }) as any
    if (!loan) return { success: false, error: 'Loan created but could not be retrieved' }
    return { success: true, data: mapLoan(loan) }
  } catch (error) {
    console.error('Failed to issue loan:', error)
    const msg = (error as Error).toString()
    if (msg.includes('Insufficient') || msg.includes('balance')) {
      return { success: false, error: msg }
    }
    return { success: false, error: 'Failed to issue loan' }
  }
}

export interface RepaymentOptions {
  paymentMethod: string                 // CASH | BANK | MIXED
  cashAmount?: number | null
  bankAmount?: number | null
  bankTxnId?: string | null
  note?: string                         // e.g. 'Loan Repayment' | 'Interest Payment'
}

export async function recordRepayment(
  loanId: string,
  amount: number,
  opts: RepaymentOptions,
): Promise<ApiResponse<void>> {
  try {
    await withAutoPrint(() => invoke('record_member_payment', {
      loanId: parseInt(loanId),
      amount,
      paymentMethod: opts.paymentMethod,
      note: opts.note ?? 'Loan Repayment',
      createdAt: new Date().toISOString(),
      cashAmount: opts.cashAmount ?? null,
      bankAmount: opts.bankAmount ?? null,
      bankTxnId: opts.bankTxnId ?? null,
    }))
    return { success: true }
  } catch (error) {
    console.error('Failed to record repayment:', error)
    return { success: false, error: typeof error === 'string' ? error : 'Failed to record repayment' }
  }
}

export interface LoanPaymentPreview {
  interestDue: number
  interestPortion: number
  principalPortion: number
  newOutstanding: number
  newUnpaidInterest: number
}

export interface PrepayResult {
  arrearsCleared: number
  monthInterest: number
  totalPaid: number
  newPaidThrough: string   // YYYY-MM-DD
}

/** Preview a one-month interest prepayment (clears arrears + 30 days ahead). */
export async function previewPrepayInterest(
  loanId: string,
  paidAt: string = new Date().toISOString(),
): Promise<ApiResponse<PrepayResult>> {
  try {
    const data = await invoke<PrepayResult>('preview_prepay_interest', {
      loanId: parseInt(loanId),
      paidAt,
    })
    return { success: true, data }
  } catch (error) {
    return { success: false, error: typeof error === 'string' ? error : 'Failed to preview prepayment' }
  }
}

/** Record a one-month interest prepayment. */
export async function prepayLoanInterest(
  loanId: string,
  opts: { paymentMethod: string; cashAmount?: number | null; bankAmount?: number | null; bankTxnId?: string | null },
): Promise<ApiResponse<PrepayResult>> {
  try {
    const data = await withAutoPrint(() => invoke<PrepayResult>('prepay_loan_interest', {
      loanId: parseInt(loanId),
      paymentMethod: opts.paymentMethod,
      createdAt: new Date().toISOString(),
      cashAmount: opts.cashAmount ?? null,
      bankAmount: opts.bankAmount ?? null,
      bankTxnId: opts.bankTxnId ?? null,
    }))
    return { success: true, data }
  } catch (error) {
    return { success: false, error: typeof error === 'string' ? error : 'Failed to prepay interest' }
  }
}

/**
 * Preview how a payment will be split between interest and principal.
 * Backend computes accrued interest from issued_at + last payment date.
 */
export async function previewRepayment(
  loanId: string,
  amount: number,
  paidAt: string = new Date().toISOString(),
): Promise<ApiResponse<LoanPaymentPreview>> {
  try {
    const preview = await invoke<LoanPaymentPreview>('preview_loan_payment', {
      loanId: parseInt(loanId),
      amount,
      paidAt,
    })
    return { success: true, data: preview }
  } catch (error) {
    return { success: false, error: typeof error === 'string' ? error : 'Failed to preview payment' }
  }
}

/**
 * Calculate accrued daily interest since day 30 (first month already paid upfront).
 * Interest start = max(issued_at + 30 days, last_payment_date).
 */
export function calculateAccruedInterest(
  loan: { amount: number; outstandingAmount: number; dailyInterestRate: number; issuedAt: string; loanType: string },
  lastPaymentAt: string | null,
  asOf: Date = new Date()
): { accruedInterest: number; daysAccruing: number } {
  if (loan.dailyInterestRate <= 0 || loan.outstandingAmount <= 0) {
    return { accruedInterest: 0, daysAccruing: 0 }
  }

  const issued = new Date(loan.issuedAt)
  // Weekly loans: 100 days upfront collected — interest only accrues after day 100.
  // Monthly loans: 30 days upfront collected — interest only accrues after day 30.
  const upfrontDays = loan.loanType === 'weekly' ? 100 : 30
  const upfrontEnd = new Date(issued.getTime() + upfrontDays * 86400000)

  // Reset to last payment date if it's after the upfront period, so we only
  // charge interest for the period since the last payment was made.
  let interestStart = upfrontEnd
  if (lastPaymentAt) {
    const lastPmt = new Date(lastPaymentAt)
    if (lastPmt > upfrontEnd) interestStart = lastPmt
  }

  const daysAccruing = Math.max(0, Math.floor((asOf.getTime() - interestStart.getTime()) / 86400000))
  // Interest is always on the original principal, not the outstanding balance.
  const accruedInterest = Math.round(loan.amount * loan.dailyInterestRate / 100 * daysAccruing * 100) / 100

  return { accruedInterest, daysAccruing }
}
