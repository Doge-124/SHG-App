'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Users,
  Wallet,
  Banknote,
  Building,
  CircleDollarSign,
  UserPlus,
  HandCoins,
  Receipt,
  FileText,
  ArrowUpRight,
  ArrowDownRight,
  AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StatCard } from '@/components/stat-card'
import { PageHeader } from '@/components/page-header'
import { useApp } from '@/context/app-context'
import { formatCurrency, formatDate, getRelativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'

export default function DashboardPage() {
  const router = useRouter()
  const {
    dashboardStats,
    recentTransactions,
    chitAlerts,
    loadingDashboard,
    refreshDashboard,
  } = useApp()

  useEffect(() => {
    refreshDashboard()
  }, [refreshDashboard])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Overview of your Self Help Group finances"
      />

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          title="Total Members"
          value={dashboardStats?.totalMembers ?? '-'}
          icon={Users}
          description="Active members"
          variant="info"
        />
        <StatCard
          title="Loans Outstanding"
          value={dashboardStats ? formatCurrency(dashboardStats.totalLoansOutstanding) : '-'}
          icon={Wallet}
          description="To be collected"
          variant="warning"
        />
        <StatCard
          title="Cash Balance"
          value={dashboardStats ? formatCurrency(dashboardStats.cashBalance) : '-'}
          icon={Banknote}
          description="In hand"
          variant="success"
        />
        <StatCard
          title="Bank Balance"
          value={dashboardStats ? formatCurrency(dashboardStats.bankBalance) : '-'}
          icon={Building}
          description="In account"
          variant="success"
        />
        <StatCard
          title="Active Chit Groups"
          value={dashboardStats?.activeChitGroups ?? '-'}
          icon={CircleDollarSign}
          description="Running chits"
          variant="default"
        />
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Navigate via router.push — in the Tauri build a bare <Link>'s
                click interception is unreliable for nested routes (see the
                sidebar's matching workaround). */}
            <Button variant="outline" className="h-auto py-4 flex-col gap-2"
              onClick={() => router.push('/members/loan?add=1')}>
              <UserPlus className="h-5 w-5 text-primary" />
              <span>Add Loan Member</span>
            </Button>
            <Button variant="outline" className="h-auto py-4 flex-col gap-2"
              onClick={() => router.push('/loans')}>
              <HandCoins className="h-5 w-5 text-primary" />
              <span>Issue Loan</span>
            </Button>
            <Button variant="outline" className="h-auto py-4 flex-col gap-2"
              onClick={() => router.push('/receipts')}>
              <Receipt className="h-5 w-5 text-success" />
              <span>Create Receipt</span>
            </Button>
            <Button variant="outline" className="h-auto py-4 flex-col gap-2"
              onClick={() => router.push('/vouchers')}>
              <FileText className="h-5 w-5 text-destructive" />
              <span>Create Voucher</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent Transactions */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Recent Transactions</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/daybook">View All</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {loadingDashboard ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-14 bg-muted animate-pulse rounded-lg" />
                ))}
              </div>
            ) : recentTransactions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No recent transactions
              </div>
            ) : (
              <div className="space-y-3">
                {recentTransactions.map((transaction) => (
                  <div
                    key={transaction.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          'flex h-10 w-10 items-center justify-center rounded-full',
                          ['receipt', 'repayment', 'opening', 'contribution'].includes(transaction.type)
                            ? 'bg-success/10 text-success'
                            : ['voucher', 'loan'].includes(transaction.type)
                            ? 'bg-destructive/10 text-destructive'
                            : 'bg-primary/10 text-primary'
                        )}
                      >
                        {['receipt', 'repayment', 'opening', 'contribution'].includes(transaction.type) ? (
                          <ArrowDownRight className="h-5 w-5" />
                        ) : (
                          <ArrowUpRight className="h-5 w-5" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium text-sm">{transaction.description}</p>
                        <p className="text-xs text-muted-foreground">
                          {getRelativeTime(transaction.createdAt)} • {transaction.paymentMethod.toUpperCase()}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p
                        className={cn(
                          'font-semibold',
                          ['receipt', 'repayment', 'opening', 'contribution'].includes(transaction.type)
                            ? 'text-success'
                            : 'text-destructive'
                        )}
                      >
                        {['receipt', 'repayment', 'opening', 'contribution'].includes(transaction.type) ? '+' : '-'}
                        {formatCurrency(transaction.amount)}
                      </p>
                      <Badge variant="outline" className="text-xs">
                        {transaction.type.replace('_', ' ')}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Chit Cycle Alerts */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Upcoming Chit Cycles</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/chits">View All</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {loadingDashboard ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />
                ))}
              </div>
            ) : chitAlerts.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No upcoming chit cycles
              </div>
            ) : (
              <div className="space-y-3">
                {chitAlerts.map((alert) => (
                  <div
                    key={`${alert.chitGroupId}-${alert.cycleNumber}`}
                    className="p-4 rounded-lg border bg-warning/5 border-warning/20"
                  >
                    <div className="flex items-start gap-3">
                      <AlertCircle className="h-5 w-5 text-warning-foreground mt-0.5" />
                      <div className="flex-1">
                        <p className="font-medium text-sm">{alert.chitGroupName}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Cycle {alert.cycleNumber} • Due: {formatDate(alert.dueDate)}
                        </p>
                        <Badge variant="secondary" className="mt-2 text-xs">
                          {alert.pendingPayments} pending payments
                        </Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
