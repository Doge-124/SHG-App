// Member Type - determines what a member can participate in
export type MemberType = 'SHG' | 'CHIT' | 'LOAN'

// Member Types
export interface Member {
  id: string
  code: string
  name: string
  phone: string
  address?: string
  joinDate: string
  status: 'active' | 'inactive'
  balance: number
  memberType: MemberType  // SHG = savings, CHIT = chit fund, LOAN = loan
  createdAt: string
  updatedAt: string
}

export interface MemberFormData {
  name: string
  phone: string
  address?: string
  memberType: MemberType
}

export interface OpeningDataInput {
  memberId: number
  openingBalance: number
  paymentMethod?: 'CASH' | 'BANK'
  pastInstallments: number
}

export interface MemberTxn {
  id: number
  memberId: number
  amount: number
  txnType: string
  reason: string
  createdAt: string
}

export interface MemberProfile {
  member: Member
  currentBalance: number
  openingBalance: number
  openingBalanceMethod?: string
  openingBalanceSetAt?: string
  initialInstallments: number    // Seeded from past data (locked)
  currentInstallments: number     // Ongoing contributions
  totalInstallments: number       // Total = initial + current
  openingDataLocked: boolean
  recentTransactions: MemberTxn[]
}

// Loan Types
export interface Loan {
  id: string
  memberId: string
  memberName: string
  amount: number
  outstandingAmount: number
  interestRate: number
  totalRepayable: number
  interestAmount: number
  paymentMethod: 'cash' | 'bank'
  loanType: 'monthly' | 'weekly'
  note?: string
  status: 'active' | 'paid' | 'defaulted'
  issuedAt: string
  createdAt: string
}

export interface LoanFormData {
  memberId: string
  amount: number
  interestRate: number
  paymentMethod: 'cash' | 'bank'
  loanType: 'monthly' | 'weekly'
  note?: string
}

export interface LoanRepayment {
  id: string
  loanId: string
  amount: number
  paymentMethod: 'cash' | 'bank'
  note?: string
  paidAt: string
}

// Receipt Types (Money received by SHG)
export interface Receipt {
  id: string
  amount: number
  reason: string
  reasonType?: string
  customReason?: string
  paymentMethod: 'cash' | 'bank'
  referenceType?: string
  referenceId?: string
  referenceNumber: string
  createdAt: string
  memberName?: string
}

export interface ReceiptFormData {
  memberId: string
  amount: number
  reasonType: string
  customReason?: string
  paymentMethod: 'cash' | 'bank'
  referenceType?: string
  referenceId?: string
}

// Voucher Types (Money spent by SHG)
export interface Voucher {
  id: string
  amount: number
  reason: string
  paymentMethod: 'cash' | 'bank'
  reference?: string
  referenceNumber: string
  referenceType?: string
  createdAt: string
  memberName?: string
}

export interface VoucherFormData {
  memberId: string
  amount: number
  reasonType: string
  customReason?: string
  paymentMethod: 'cash' | 'bank'
  reference?: string
}

// Chit Fund Types
export interface ChitGroup {
  id: string
  name: string
  totalAmount: number
  monthlyContribution: number
  totalMembers: number
  currentMembers: number
  durationMonths: number
  currentCycle: number
  status: 'active' | 'completed' | 'cancelled'
  startDate: string
  createdAt: string
}

export interface ChitGroupFormData {
  name: string
  totalAmount: number
  monthlyContribution: number
  totalMembers: number
  durationMonths: number
  startDate: string
}

export interface ChitMember {
  id: string
  chitGroupId: string
  memberId: string
  memberName: string
  joinedAt: string
  isWinner: boolean
  winCycle?: number
}

export interface ChitCycle {
  id: string
  chitGroupId: string
  cycleNumber: number
  winnerId?: string
  winnerName?: string
  winnerAmount?: number
  status: 'pending' | 'active' | 'completed'
  dueDate: string
  completedAt?: string
}

export interface ChitPayment {
  id: string
  chitGroupId: string
  chitCycleId: string
  memberId: string
  memberName: string
  amount: number
  paymentMethod: 'cash' | 'bank'
  status: 'pending' | 'paid'
  paidAt?: string
}

// Dashboard Types
export interface DashboardStats {
  totalMembers: number
  totalLoansOutstanding: number
  cashBalance: number
  bankBalance: number
  activeChitGroups: number
}

export interface Transaction {
  id: string
  type: 'receipt' | 'voucher' | 'loan' | 'repayment' | 'chit_payment'
  amount: number
  description: string
  paymentMethod: 'cash' | 'bank'
  createdAt: string
  memberName?: string
}

export interface ChitCycleAlert {
  chitGroupId: string
  chitGroupName: string
  cycleNumber: number
  dueDate: string
  pendingPayments: number
}

// Report Types
export interface ReportFilters {
  startDate?: string
  endDate?: string
  paymentMethod?: 'cash' | 'bank' | 'all'
  transactionType?: 'receipt' | 'voucher' | 'loan' | 'repayment' | 'all'
  memberId?: string
}

export interface ReportData {
  totalReceipts: number
  totalVouchers: number
  totalLoansIssued: number
  totalRepayments: number
  netCashFlow: number
  currentBalance: number
  isTallied: boolean
  tallyDetails?: {
    cashFlowMatches: boolean
    hasCompleteData: boolean
    transactionCount: number
    netCashFlow: number
    expectedNetCashFlow: number
  }
  transactions: Transaction[]
}

// Settings Types
export interface GeneralSettings {
  groupName: string
  registrationNumber: string
  address: string
  contactPhone: string
  contactEmail: string
}

export interface NotificationSettings {
  enableNotifications: boolean
  enableEmailAlerts: boolean
  loanDueReminders: boolean
  chitCycleAlerts: boolean
  newMemberRequests: boolean
  paymentConfirmations: boolean
}

export interface DataSettings {
  autoBackup: boolean
  backupFrequency: 'daily' | 'weekly' | 'monthly'
  lastBackupDate?: string
}

export interface AppearanceSettings {
  theme: 'light' | 'dark' | 'system'
  language: 'english' | 'hindi' | 'tamil'
}

export interface AppSettings {
  general: GeneralSettings
  notifications: NotificationSettings
  data: DataSettings
  appearance: AppearanceSettings
}

export interface BackupInfo {
  id: string
  fileName: string
  fileSize: number
  createdAt: string
  type: 'manual' | 'automatic'
}

// API Response Types
export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

// Chit Past Data Entry Types

export interface MemberPaymentInput {
  memberId: string
  memberName: string
  amount: number
  paymentMethod: 'cash' | 'bank'
}

export interface PastChitCycleData {
  cycleNumber: number
  auctionDate: string
  winningMemberId?: string
  bidDiscount: number
  winnerPayout?: number
  memberPayments: MemberPaymentInput[]
}

export interface MemberPaymentStatus {
  memberId: string
  memberName: string
  cyclesPaid: number
  currentCycle: number
  lateCycles: number[]
  isUpToDate: boolean
}

export interface ChitCycleDetail {
  id: string
  chitGroupId: string
  cycleNumber: number
  auctionDate: string
  winningMemberId?: string
  winningMemberName?: string
  bidDiscount: number
  payoutAmount: number
  totalCollected: number
  numberOfPayers: number
  expectedCollection: number
}

export interface ChitMigrationStatus {
  chitId: string
  chitName: string
  totalMonths: number
  cyclesEntered: number
  cyclesRemaining: number
  totalMembers: number
  membersUpToDate: number
  membersWithPending: number
  totalBidDiscounts: number
  totalCollected: number
  isComplete: boolean
}
