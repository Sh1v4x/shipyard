import type { ComponentProps, ReactNode } from 'react'
import type { DiffLine } from '../../../shared/types.ts'
import { cn } from '@/lib/utils'

/** Bloc de diff : police mono, passage à la ligne pour ne jamais déborder sur mobile. */
export function Diff({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('font-mono text-xs leading-relaxed', className)} {...props} />
}

const tone = (t: DiffLine['t'], highlight?: boolean) =>
  highlight
    ? 'bg-amber-500/15 shadow-[inset_3px_0_0] shadow-amber-500'
    : t === '+'
      ? 'bg-emerald-500/10'
      : t === '-'
        ? 'bg-red-500/10'
        : t === '@'
          ? 'bg-blue-500/10 text-blue-700 dark:text-blue-300'
          : ''

/** Une ligne de diff : numéros (ancien/nouveau ou un seul), signe, code. */
export function DiffRow({ line, nums, highlight }: { line: DiffLine; nums: (number | null)[]; highlight?: boolean }) {
  return (
    <div className={cn('flex items-start', tone(line.t, highlight))}>
      {nums.map((n, i) => (
        <span key={i} className="w-10 shrink-0 pr-2 text-right text-muted-foreground/70 select-none sm:w-12">{n ?? ''}</span>
      ))}
      <span className={cn('w-4 shrink-0 select-none', line.t === '+' && 'text-emerald-600 dark:text-emerald-400', line.t === '-' && 'text-red-600 dark:text-red-400')}>
        {line.t === '@' || line.t === ' ' ? '' : line.t}
      </span>
      <span className="min-w-0 flex-1 pr-3 break-all whitespace-pre-wrap">{line.code}</span>
    </div>
  )
}

/** Ligne d'information dans le diff (fichier binaire, diff tronqué…). */
export const DiffNotice = ({ children }: { children: ReactNode }) => (
  <div className="bg-blue-500/10 px-3 py-1 text-blue-700 dark:text-blue-300">{children}</div>
)

/** Compteurs +/− d'un fichier ou d'une PR. */
export const DiffStat = ({ add, del, className }: { add: number; del: number; className?: string }) => (
  <span className={cn('font-mono text-xs whitespace-nowrap', className)}>
    <span className="text-emerald-600 dark:text-emerald-400">+{add}</span> <span className="text-red-600 dark:text-red-400">−{del}</span>
  </span>
)
