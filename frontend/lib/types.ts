// A single member role. A member's `memberType` is a comma-separated SET of
// these (e.g. "SHG" or "CHIT,LOAN") — see lib/roles.ts for helpers.
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
  memberType: string  // comma-separated role set, e.g. "SHG" or "CHIT,LOAN"
  createdAt: string
  updatedAt: string
}

export interface MemberFormData {
  name: string
  phone: string
  address?: string
  memberType: string  // comma-separated role set
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
  regularBalance: number
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
  interestRate: number          // legacy field, kept for compat
  dailyInterestRate: number     // % per day
  totalRepayable: number
  interestAmount: number
  upfrontInterestAmount: number // first 30 days interest collected at disbursement
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
  dailyInterestRate: number     // % per day
  paymentMethod: 'cash' | 'bank' | 'mixed'
  cashAmount?: number | null    // bank/cash split when paymentMethod === 'mixed'
  bankAmount?: number | null
  bankTxnId?: string | null     // bank reference / cheque no. for the bank portion
  loanType: 'monthly' | 'weekly'
  note?: string
  guarantors?: import('@/lib/api/guarantors').GuarantorInput[]
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
  paymentMethod: 'cash' | 'bank' | 'mixed'
  referenceType?: string
  referenceId?: string
  cashAmount?: number | null
  bankAmount?: number | null
  bankTxnId?: string | null
}

// Voucher Types (Money spent by SHG)
export interface Voucher {
  id: string
  amount: number
  reason: string
  paymentMethod: 'cash' | 'bank' | 'mixed'
  reference?: string
  referenceNumber: string
  referenceType?: string
  createdAt: string
  memberName?: string
  voidedAt?: number | null
  voidedReason?: string | null
  reversalOfId?: number | null
  bankTxnId?: string | null
  groupId?: string | null
  // Set when a mixed (cash + bank) payment is collapsed into one voucher.
  cashAmount?: number | null
  bankAmount?: number | null
  // Chit payout breakdown (CHIT_PAYOUT only): the voucher amount is the prize net
  // of the bid discount; full prize = amount + bidDiscount, and the winner nets
  // amount - commission. Used to show the deductions on the voucher.
  bidDiscount?: number | null
  commission?: number | null
}

export interface VoucherFormData {
  memberId: string
  // External (general) voucher: paid to an outside entity/vendor for an SHG
  // purchase, not tied to a member. When true, `payee` carries the recipient
  // and `memberId` is empty.
  isExternal?: boolean
  payee?: string
  amount: number
  reasonType: string
  customReason?: string
  paymentMethod: 'cash' | 'bank' | 'mixed'
  reference?: string
  bankTxnId?: string
  cashAmount?: number
  bankAmount?: number
}

// Chit Fund Types
export interface ChitGroup {
  id: string
  name: string
  totalAmount: number           // P: fixed prize per winner
  monthlyContribution: number   // C: per member per cycle
  totalMembers: number          // N
  currentMembers: number
  durationMonths: number        // total cycles
  currentCycle: number
  winnersPerCycle: number       // W
  commissionPerWinner: number   // F
  fixedPrizeAmount: number      // P (same as totalAmount for new chits)
  status: 'active' | 'completed' | 'cancelled'
  startDate: string
  createdAt: string
}

export interface ChitGroupFormData {
  name: string
  totalAmount: number        // P: fixed prize amount per cycle
  monthlyContribution: number // C: per member per cycle
  totalMembers: number       // N
  durationMonths: number     // total cycles = floor(N/W)
  winnersPerCycle: number    // W (1 fixed + W-1 auction)
  commissionPerWinner: number // F: flat commission SHG keeps per winner
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
  passbookNumber?: string | null
  memberType?: string
}

export interface ChitCycleWinner {
  id: string
  chitGroupId: string
  cycleId: string
  memberId: string
  memberName: string
  winnerType: 'FIXED' | 'AUCTION'
  bidDiscount: number
  commission: number
  payoutAmount: number
  paymentMethod: 'cash' | 'bank'
  paidAt: string
}

export interface MemberEligibility {
  memberId: string
  memberName: string
  isEligible: boolean
  adminOverride: boolean
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

export interface CloudBackupSettings {
  enabled: boolean
  smtpHost: string
  smtpPort: number
  username: string
  appPassword: string
  fromEmail: string
  recipient: string
  frequency: 'daily' | 'weekly' | 'monthly'
  lastBackupAt?: string | null
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
  // manual | cloud | pre-upgrade | pre-migration | pre-restore | automatic
  type: string
}

// Fixed-asset register
export interface Asset {
  id: number
  name: string
  category: string
  purchaseDate: string
  cost: number
  supplier?: string | null
  location?: string | null
  referenceNo?: string | null
  note?: string | null
  fundingMethod: 'CASH' | 'BANK' | 'OPENING'
  isOpening: boolean
  status: 'ACTIVE' | 'DISPOSED'
  disposedAt?: string | null
  disposalAmount?: number | null
  disposalMethod?: string | null
  createdAt: string
}

export interface NewAssetInput {
  name: string
  category: string
  purchaseDate: string
  cost: number
  supplier?: string | null
  location?: string | null
  referenceNo?: string | null
  note?: string | null
  fundingMethod: 'CASH' | 'BANK' | 'OPENING'
  bankTxnId?: string | null
}

export interface AssetSummary {
  activeCount: number
  totalCost: number
  byCategory: { category: string; count: number; cost: number }[]
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

export interface PastWinnerEntry {
  memberId: string
  winnerType: 'FIXED' | 'AUCTION'
  bidDiscount: number
  commission: number
  payoutAmount: number
  paymentMethod: string
}

export interface PastChitCycleData {
  cycleNumber: number
  auctionDate: string
  winners: PastWinnerEntry[]
  auctionDiscountPerMember: number
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
