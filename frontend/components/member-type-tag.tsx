import { cn } from '@/lib/utils'

const COLORS: Record<string, string> = {
  SHG: 'bg-blue-100 text-blue-700',
  CHIT: 'bg-purple-100 text-purple-700',
  LOAN: 'bg-amber-100 text-amber-700',
}

/**
 * Small inline badge showing a member's type (SHG / CHIT / LOAN). Use after a
 * member name wherever members are picked from a list so the type is obvious.
 */
export function MemberTypeTag({ type, className }: { type?: string | null; className?: string }) {
  if (!type) return null
  const t = type.toUpperCase()
  return (
    <span
      className={cn(
        'ml-1.5 inline-block rounded px-1 py-0.5 text-[10px] font-semibold leading-none align-middle',
        COLORS[t] ?? 'bg-muted text-muted-foreground',
        className,
      )}
    >
      {t}
    </span>
  )
}
