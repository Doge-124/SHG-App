'use client'

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useSettings } from '@/lib/settings-context'
import { getNotificationAlerts } from '@/lib/api/notifications'
import { formatCurrency } from '@/lib/format'

/**
 * Runs once after the app mounts. Reads notification settings and shows
 * relevant in-app alerts (overdue loans, upcoming chit cycles).
 * Renders nothing — purely a side-effect component.
 */
export function NotificationChecker() {
  const { settings } = useSettings()
  const hasRun = useRef(false)

  useEffect(() => {
    if (!settings || hasRun.current) return
    const { enableNotifications, loanDueReminders, chitCycleAlerts } = settings.notifications

    // Master toggle off → nothing to show
    if (!enableNotifications) return
    if (!loanDueReminders && !chitCycleAlerts) return

    hasRun.current = true

    // Short delay so the UI finishes rendering before toasts appear
    const timer = setTimeout(async () => {
      try {
        const alerts = await getNotificationAlerts()

        if (loanDueReminders) {
          alerts.overdueLoans.forEach(loan => {
            toast.warning(`Overdue Loan — ${loan.memberName}`, {
              description: `Outstanding ${formatCurrency(loan.outstandingAmount)} · ${loan.daysOverdue} day${loan.daysOverdue !== 1 ? 's' : ''} overdue`,
              duration: 10_000,
            })
          })
        }

        if (chitCycleAlerts) {
          alerts.upcomingChitCycles.forEach(cycle => {
            const when =
              cycle.daysUntil === 0
                ? 'today'
                : `in ${cycle.daysUntil} day${cycle.daysUntil !== 1 ? 's' : ''}`
            toast.info(`Chit Cycle Due — ${cycle.chitGroupName}`, {
              description: `Cycle #${cycle.cycleNumber} auction ${when} (${cycle.auctionDate})`,
              duration: 10_000,
            })
          })
        }
      } catch {
        // Never let notification errors surface to the user
      }
    }, 2500)

    return () => clearTimeout(timer)
  }, [settings])

  return null
}
