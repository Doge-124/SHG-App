import { getLoans } from './loans'
import { getChitGroups, getChitCycles } from './chits'

export interface LoanAlert {
  loanId: string
  memberName: string
  outstandingAmount: number
  daysOverdue: number
}

export interface ChitCycleUpcomingAlert {
  chitGroupId: string
  chitGroupName: string
  cycleNumber: number
  auctionDate: string
  daysUntil: number
}

export interface NotificationAlerts {
  overdueLoans: LoanAlert[]
  upcomingChitCycles: ChitCycleUpcomingAlert[]
}

/** Fetch all actionable alerts by querying existing DB data. */
export async function getNotificationAlerts(): Promise<NotificationAlerts> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // ── Overdue active loans ────────────────────────────────────────────────
  // Weekly loans: 120-day term, no grace = overdue after 120 days.
  // Monthly loans: open-ended, no due date — not included in overdue alerts.
  const overdueLoans: LoanAlert[] = []
  try {
    const loansRes = await getLoans()
    if (loansRes.success && loansRes.data) {
      for (const loan of loansRes.data) {
        if (loan.status !== 'active') continue
        if (loan.loanType !== 'weekly') continue // monthly loans have no fixed term
        const issued = new Date(loan.issuedAt)
        const graceEnd = new Date(issued.getTime() + 120 * 86_400_000) // 120-day term, no grace
        const daysOverdue = Math.floor((today.getTime() - graceEnd.getTime()) / 86_400_000)
        if (daysOverdue > 0) {
          overdueLoans.push({
            loanId: loan.id,
            memberName: loan.memberName,
            outstandingAmount: loan.outstandingAmount,
            daysOverdue,
          })
        }
      }
    }
  } catch { /* ignore */ }

  // ── Upcoming chit cycle auction dates (within 7 days) ──────────────────
  const upcomingChitCycles: ChitCycleUpcomingAlert[] = []
  try {
    const groupsRes = await getChitGroups()
    if (groupsRes.success && groupsRes.data) {
      for (const group of groupsRes.data) {
        if (group.status !== 'active') continue
        const cyclesRes = await getChitCycles(group.id)
        if (!cyclesRes.success || !cyclesRes.data?.length) continue

        // Latest cycle = highest cycle number
        const latest = cyclesRes.data.reduce((max, c) =>
          c.cycleNumber > max.cycleNumber ? c : max, cyclesRes.data[0])

        // Next expected auction date = latest auction + 30 days
        const lastDate = new Date(latest.dueDate)
        const nextDate = new Date(lastDate.getTime() + 30 * 86_400_000)
        nextDate.setHours(0, 0, 0, 0)
        const daysUntil = Math.floor((nextDate.getTime() - today.getTime()) / 86_400_000)

        if (daysUntil >= 0 && daysUntil <= 7) {
          upcomingChitCycles.push({
            chitGroupId: group.id,
            chitGroupName: group.name,
            cycleNumber: latest.cycleNumber + 1,
            auctionDate: nextDate.toISOString().split('T')[0],
            daysUntil,
          })
        }
      }
    }
  } catch { /* ignore */ }

  return { overdueLoans, upcomingChitCycles }
}
