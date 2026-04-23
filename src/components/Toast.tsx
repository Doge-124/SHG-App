import { createContext, useCallback, useContext, useMemo, useState } from 'react'

type ToastKind = 'success' | 'error' | 'info'

export interface ToastMessage {
  id: string
  kind: ToastKind
  title: string
  description?: string
}

interface ToastContextValue {
  showToast: (t: Omit<ToastMessage, 'id'>) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>')
  return ctx
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  const showToast = useCallback((t: Omit<ToastMessage, 'id'>) => {
    const id = crypto.randomUUID()
    setToasts(prev => [...prev, { ...t, id }])
    window.setTimeout(() => {
      setToasts(prev => prev.filter(x => x.id !== id))
    }, 4000)
  }, [])

  const value = useMemo(() => ({ showToast }), [showToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        style={{
          position: 'fixed',
          right: 16,
          bottom: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          zIndex: 9999,
        }}
        aria-live="polite"
        aria-relevant="additions"
      >
        {toasts.map(t => (
          <div
            key={t.id}
            role="status"
            style={{
              minWidth: 260,
              maxWidth: 360,
              padding: 12,
              borderRadius: 10,
              border: '1px solid #e5e7eb',
              background: '#fff',
              boxShadow:
                '0 10px 15px -3px rgba(0,0,0,0.10), 0 4px 6px -4px rgba(0,0,0,0.10)',
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 4 }}>
              <span
                style={{
                  color:
                    t.kind === 'success'
                      ? '#16a34a'
                      : t.kind === 'error'
                        ? '#dc2626'
                        : '#2563eb',
                }}
              >
                {t.title}
              </span>
            </div>
            {t.description ? (
              <div style={{ fontSize: 13, color: '#374151' }}>{t.description}</div>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

