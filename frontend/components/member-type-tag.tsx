import { cn } from '@/lib/utils'
import { memberRoles } from '@/lib/roles'

const COLORS: Record<string, string> = {
  SHG: 'bg-blue-100 text-blue-700',
  CHIT: 'bg-purple-100 text-purple-700',
  LOAN: 'bg-amber-100 text-amber-700',
}

/**
 * Small inline badge(s) showing a member's role(s). `type` is the member's role
 * set ("SHG" or "CHIT,LOAN"); one badge is rendered per role. Use after a member
 * name wherever members are picked from a list so the role(s) are obvious.
 */
export function MemberTypeTag({ type, className }: { type?: string | null; className?: string }) {
  const roles = memberRoles(type)
  if (roles.length === 0) return null
  return (
    <>
      {roles.map(t => (
        <span
          key={t}
          className={cn(
            'ml-1.5 inline-block rounded px-1 py-0.5 text-[10px] font-semibold leading-none align-middle',
            COLORS[t] ?? 'bg-muted text-muted-foreground',
            className,
          )}
        >
          {t}
        </span>
      ))}
    </>
  )
}
