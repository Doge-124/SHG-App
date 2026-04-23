'use client'

import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { AppHeader } from '@/components/app-header'
import { AppProvider } from '@/context/app-context'
import { SettingsProvider } from '@/lib/settings-context'
import { Toaster } from '@/components/ui/sonner'
import { NotificationChecker } from '@/components/notification-checker'

interface AppLayoutProps {
  children: React.ReactNode
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <AppProvider>
      <SettingsProvider>
        <NotificationChecker />
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset>
            <AppHeader />
            <main className="flex-1 overflow-auto p-6">
              {children}
            </main>
          </SidebarInset>
        </SidebarProvider>
      </SettingsProvider>
      <Toaster position="top-right" />
    </AppProvider>
  )
}
