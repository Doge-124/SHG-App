'use client'

import { useEffect } from 'react'
import { initSentry, Sentry } from '@/lib/sentry'

/**
 * Initialises Sentry on mount + wraps children in a Sentry ErrorBoundary.
 * Placed high in the tree (in app/layout.tsx).
 *
 * Activates only when NEXT_PUBLIC_SENTRY_DSN is set at build time.
 */
export function SentryBootstrap({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initSentry()
  }, [])

  return (
    <Sentry.ErrorBoundary
      fallback={({ error, resetError }) => (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
          <h1 className="text-2xl font-bold text-red-600">Something went wrong</h1>
          <p className="text-sm text-muted-foreground max-w-md">
            The application hit an unexpected error.
            {process.env.NEXT_PUBLIC_SENTRY_DSN
              ? ' A crash report has been sent automatically — your data is safe.'
              : ' Your data is safe — please report this to your administrator.'}
          </p>
          <pre className="max-w-xl overflow-auto rounded bg-muted p-3 text-xs text-left">
            {error instanceof Error ? error.message : String(error)}
          </pre>
          <button
            className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90"
            onClick={resetError}
          >
            Try Again
          </button>
        </div>
      )}
    >
      {children}
    </Sentry.ErrorBoundary>
  )
}
