'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  Wallet,
  Receipt,
  FileText,
  CircleDollarSign,
  Settings,
  Building2,
  BookOpen,
  ClipboardList,
  Banknote,
  LandmarkIcon,
  Scale,
  PieChart,
  TrendingUp,
  CalendarCheck,
  PiggyBank,
} from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import { useSettings } from '@/lib/settings-context'
import { getLoans } from '@/lib/api/loans'

// Due-date calculation (mirrors notifications.ts logic)
function isOverdue(issuedAt: string, loanType: string): boolean {
  if (loanType !== 'weekly') return false  // monthly loans are open-ended, no due date
  const issued = new Date(issuedAt)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const graceEnd = new Date(issued.getTime() + 120 * 86_400_000) // 100-day term + 20-day grace
  return today > graceEnd
}

const mainNavItems = [
  { title: 'Dashboard', href: '/',          icon: LayoutDashboard },
  { title: 'SHG Members',   href: '/members/shg',   icon: PiggyBank       },
  { title: 'Chit Members',  href: '/members/chit',  icon: Users           },
  { title: 'Loan Members',  href: '/members/loan',  icon: Banknote        },
  { title: 'Contributions', href: '/contributions', icon: CalendarCheck   },
  { title: 'Loans',         href: '/loans',         icon: Wallet          },
  { title: 'Receipts',  href: '/receipts',  icon: Receipt         },
  { title: 'Vouchers',  href: '/vouchers',  icon: FileText        },
  { title: 'Passbook',       href: '/passbook',        icon: BookOpen     },
  { title: 'Cash Book',      href: '/cashbook',       icon: Banknote     },
  { title: 'Bank Book',      href: '/bankbook',       icon: LandmarkIcon },
  { title: 'Day Book',       href: '/daybook',        icon: BookOpen     },
  { title: 'Trial Balance',       href: '/trial-balance',       icon: Scale       },
  { title: 'Income & Expenditure', href: '/income-expenditure', icon: TrendingUp  },
  { title: 'Balance Sheet',       href: '/balance-sheet',       icon: PieChart    },
]

const chitNavItems = [
  { title: 'Chit Funds', href: '/chits', icon: CircleDollarSign },
]

const systemNavItems = [
  { title: 'Audit Log', href: '/audit',    icon: ClipboardList },
  { title: 'Settings',  href: '/settings', icon: Settings      },
]

export function AppSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { settings } = useSettings()
  const [overdueCount, setOverdueCount] = useState(0)

  // Eagerly prefetch every sidebar route on mount. Next.js normally
  // prefetches visible Links via IntersectionObserver, but inside Tauri's
  // WebView2 the observer can be slow to fire — the first few clicks then
  // silently "do nothing" because the route chunk hasn't downloaded yet.
  // Calling router.prefetch directly warms them up the moment the sidebar
  // mounts so the first click always feels instant.
  useEffect(() => {
    const allItems = [...mainNavItems, ...chitNavItems, ...systemNavItems]
    for (const item of allItems) router.prefetch(item.href)
  }, [router])

  // Re-check overdue count on every navigation so repayments are reflected immediately.
  useEffect(() => {
    if (!settings?.notifications?.loanDueReminders) {
      setOverdueCount(0)
      return
    }
    getLoans()
      .then(res => {
        if (!res.success || !res.data) return
        const count = res.data.filter(
          l => l.status === 'active' && isOverdue(l.issuedAt, l.loanType)
        ).length
        setOverdueCount(count)
      })
      .catch(() => {/* silently ignore */})
  }, [pathname, settings?.notifications?.loanDueReminders])

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href)

  const groupName = settings?.general?.groupName || 'My SHG'

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/" className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Building2 className="h-5 w-5" />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold">SHG Manager</span>
                  <span className="text-xs text-muted-foreground">Financial Management</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Main Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNavItems.map((item) => {
                const active = isActive(item.href)
                const showBadge = item.href === '/loans' && overdueCount > 0 && !isActive('/loans')

                // Two layers were eating early-mount clicks in Tauri's WebView2:
                //  - Each SidebarMenuButton with a `tooltip` prop wraps its child in
                //    a Radix Tooltip + TooltipProvider; the Slot/asChild composition
                //    plus global pointer tracking would silently swallow the first
                //    couple of clicks while Radix wired up its listeners.
                //  - Next's <Link> click interception relies on the App Router being
                //    hydrated; before then clicks on the anchor preventDefault but
                //    router.push no-ops, so the navigation never fires.
                //
                // Fix: drop the tooltip wrapper (we lose the collapsed-state tooltip
                // text — small cost) and add an explicit onClick that calls
                // router.push. Keeping the <a href> means the native anchor still
                // navigates even if React hasn't hydrated yet.
                const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
                  // Let modifier-clicks / middle-clicks behave normally.
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                  e.preventDefault()
                  router.push(item.href)
                }

                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={active}>
                      <a href={item.href} onClick={handleClick} className="flex items-center w-full">
                        {/* Icon — with a dot indicator when collapsed */}
                        <span className="relative flex-shrink-0">
                          <item.icon className={cn('h-4 w-4', active && 'text-primary')} />
                          {showBadge && (
                            <span className="absolute -top-1 -right-1 flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-destructive" />
                            </span>
                          )}
                        </span>

                        {/* Label + pill badge (visible when sidebar is expanded) */}
                        <span className="flex items-center gap-2 flex-1 group-data-[collapsible=icon]:hidden">
                          {item.title}
                          {showBadge && (
                            <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                              {overdueCount > 99 ? '99+' : overdueCount}
                            </span>
                          )}
                        </span>
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Chit Management</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {chitNavItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={isActive(item.href)}>
                    <a
                      href={item.href}
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                        e.preventDefault()
                        router.push(item.href)
                      }}
                    >
                      <item.icon className={cn('h-4 w-4', isActive(item.href) && 'text-primary')} />
                      <span>{item.title}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>System</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {systemNavItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={isActive(item.href)}>
                    <a
                      href={item.href}
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                        e.preventDefault()
                        router.push(item.href)
                      }}
                    >
                      <item.icon className={cn('h-4 w-4', isActive(item.href) && 'text-primary')} />
                      <span>{item.title}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-center gap-3 px-2 py-2 group-data-[collapsible=icon]:justify-center">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-medium">
                {groupName.substring(0, 2).toUpperCase()}
              </div>
              <div className="flex flex-col gap-0.5 group-data-[collapsible=icon]:hidden">
                <span className="text-sm font-medium">{groupName}</span>
                <span className="text-xs text-muted-foreground">Administrator</span>
              </div>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
