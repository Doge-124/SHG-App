import { invoke } from '@tauri-apps/api/core'
import type { Loan, LoanFormData, LoanRepayment, ApiResponse } from '@/lib/types'

function mapLoan(loan: any): Loan {
  return {
    id: loan.id.toString(),
    memberId: loan.member_id.toString(),
    memberName: loan.member_name || 'Unknown',
    amount: loan.amount,
    outstandingAmount: loan.outstanding_amount,
    interestRate: loan.interest_rate || 0,
    totalRepayable: loan.total_repayable || loan.outstanding_amount,
    interestAmount: loan.interest_amount || 0,
    paymentMethod: loan.payment_method.toLowerCase() as 'cash' | 'bank',
    loanType: (loan.loan_type || 'monthly').toLowerCase() as 'monthly' | 'weekly',
    note: loan.note || '',
    status: loan.status.toLowerCase() as 'active' | 'paid' | 'defaulted',
    issuedAt: loan.issued_at,
    createdAt: loan.created_at,
  }
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
    const loanId = await invoke('issue_member_loan', {
      memberId: parseInt(data.memberId),
      amount: data.amount,
      interestRate: data.interestRate,
      paymentMethod: data.paymentMethod.toUpperCase(),
      loanType: data.loanType.toUpperCase(),
      note: data.note || '',
      createdAt: new Date().toISOString(),
    }) as number

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

export async function recordRepayment(
  loanId: string,
  amount: number,
  paymentMethod: 'cash' | 'bank'
): Promise<ApiResponse<void>> {
  try {
    await invoke('record_member_payment', {
      loanId: parseInt(loanId),
      amount,
      paymentMethod: paymentMethod.toUpperCase(),
      note: 'Loan repayment',
      createdAt: new Date().toISOString(),
    })
    return { success: true }
  } catch (error) {
    console.error('Failed to record repayment:', error)
    return { success: false, error: 'Failed to record repayment' }
  }
}
