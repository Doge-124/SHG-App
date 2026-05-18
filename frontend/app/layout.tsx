import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { AppLayout } from '@/components/app-layout'
import AuthLayout from '@/components/AuthLayout'
import { AppearanceProvider } from '@/lib/appearance-context'
import { SentryBootstrap } from '@/components/sentry-bootstrap'
import './globals.css'

const inter = Inter({ 
  subsets: ['latin'],
  variable: '--font-inter',
})

export const metadata: Metadata = {
  title: 'SHG Manager - Self Help Group Financial Management',
  description: 'Complete financial management solution for Self Help Groups. Manage members, loans, receipts, vouchers, and chit funds with ease.',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#4f6bed',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans antialiased">
        <SentryBootstrap>
          <AppearanceProvider>
            <AuthLayout>
              <AppLayout>{children}</AppLayout>
            </AuthLayout>
          </AppearanceProvider>
        </SentryBootstrap>
      </body>
    </html>
  )
}
