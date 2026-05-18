'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { useSettings } from '@/lib/settings-context'
import { getNotificationAlerts } from '@/lib/api/notifications'
import type { NotificationAlerts } from '@/lib/api/notifications'
import { formatCurrency } from '@/lib/format'

export function AppHeader() {
  const { settings, isLoading } = useSettings()
  const pathname = usePathname()
  const [now, setNow] = useState<Date | null>(null)
  const [alerts, setAlerts] = useState<NotificationAlerts>({ overdueLoans: [], upcomingChitCycles: [] })

  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  // Load real alerts whenever notification settings are available.
  useEffect(() => {
    if (!settings?.notifications?.enableNotifications) {
      setAlerts({ overdueLoans: [], upcomingChitCycles: [] })
      return
    }
    getNotificationAlerts()
      .then(a => {
        const filtered: NotificationAlerts = {
          overdueLoans: settings.notifications.loanDueReminders ? a.overdueLoans : [],
          upcomingChitCycles: settings.notifications.chitCycleAlerts ? a.upcomingChitCycles : [],
        }
        setAlerts(filtered)
      })
      .catch(() => {})
  }, [pathname, settings?.notifications])

  const groupName = settings?.general?.groupName || 'SHG Manager'
  const dateLabel = now
    ? now.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    : ''

  // Suppress overdue-loan entries when the user is already on the loans page.
  const onLoansPage = pathname?.startsWith('/loans')
  const visibleOverdueLoans = onLoansPage ? [] : alerts.overdueLoans
  const totalAlerts = visibleOverdueLoans.length + alerts.upcomingChitCycles.length

  return (
    <header className="flex h-14 items-center gap-4 border-b bg-card px-4">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-6" />

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-5 w-5" />
              {totalAlerts > 0 && (
                <Badge
                  variant="destructive"
                  className="absolute -top-1 -right-1 h-5 w-5 rounded-full p-0 flex items-center justify-center text-[10px]"
                >
                  {totalAlerts > 9 ? '9+' : totalAlerts}
                </Badge>
              )}
              <span className="sr-only">Notifications</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel>Notifications</DropdownMenuLabel>
            <DropdownMenuSeparator />

            {totalAlerts === 0 ? (
              <DropdownMenuItem disabled className="justify-center text-muted-foreground py-4">
                No active alerts
              </DropdownMenuItem>
            ) : (
              <>
                {visibleOverdueLoans.map(loan => (
                  <DropdownMenuItem key={loan.loanId} className="flex flex-col items-start gap-1 py-3">
                    <span className="font-medium">Overdue Loan — {loan.memberName}</span>
                    <span className="text-xs text-muted-foreground">
                      Outstanding {formatCurrency(loan.outstandingAmount)} · {loan.daysOverdue} day{loan.daysOverdue !== 1 ? 's' : ''} overdue
                    </span>
                  </DropdownMenuItem>
                ))}
                {alerts.upcomingChitCycles.map(cycle => (
                  <DropdownMenuItem key={`${cycle.chitGroupId}-${cycle.cycleNumber}`} className="flex flex-col items-start gap-1 py-3">
                    <span className="font-medium">Chit Cycle Due — {cycle.chitGroupName}</span>
                    <span className="text-xs text-muted-foreground">
                      Cycle #{cycle.cycleNumber} auction{' '}
                      {cycle.daysUntil === 0 ? 'today' : `in ${cycle.daysUntil} day${cycle.daysUntil !== 1 ? 's' : ''}`}
                      {' '}({cycle.auctionDate})
                    </span>
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <Separator orientation="vertical" className="h-6" />

        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-medium">{isLoading ? 'Loading...' : groupName}</p>
            <p className="text-xs text-muted-foreground">{dateLabel}</p>
          </div>
        </div>
      </div>
    </header>
  )
}
