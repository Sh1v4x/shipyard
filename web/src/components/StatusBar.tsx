import { GitBranchIcon, RefreshCwIcon, SparklesIcon } from 'lucide-react'
import type { Project, UsageLimit } from '../../../shared/types.ts'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useRefreshClaudeUsage } from '../data/mutations.ts'
import { useClaudeUsage, useWorktreeStat } from '../data/queries.ts'
import type { Route } from '../router.ts'
import { plural } from '../ui.tsx'
import { DiffStat } from './Diff.tsx'

// Barre d'état en bas de l'écran : le worktree ouvert (branche, lignes modifiées) et l'usage du forfait Claude.

const FILL = { normal: 'bg-emerald-500', warning: 'bg-amber-500', critical: 'bg-red-500' } as const
const TEXT = { normal: 'text-foreground', warning: 'text-amber-600 dark:text-amber-400', critical: 'text-red-600 dark:text-red-400' } as const

/** « 15:29 » si la remise à zéro est dans moins de 24 h, sinon « dim. 14:59 ». */
function resetLabel(iso: string) {
  const d = new Date(iso)
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  return d.getTime() - Date.now() < 86_400_000 ? time : `${d.toLocaleDateString('fr-FR', { weekday: 'short' })} ${time}`
}

function inLabel(iso: string) {
  const min = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60_000))
  if (min < 60) return `dans ${min} min`
  if (min < 1440) return `dans ${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`
  return `dans ${Math.round(min / 1440)} j`
}

function Limit({ limit }: { limit: UsageLimit }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex w-[84px] shrink-0 cursor-default flex-col gap-1 border-l pl-3 first:border-l-0 first:pl-0 sm:w-36 sm:pl-4">
          <span className="flex items-baseline justify-between gap-2 whitespace-nowrap">
            <span className="font-medium">{limit.label}</span>
            <span className={cn('font-semibold tabular-nums', TEXT[limit.severity])}>{Math.round(limit.percent)} %</span>
          </span>
          <span className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
            <span className={cn('block h-full rounded-full transition-[width]', FILL[limit.severity])} style={{ width: `${Math.min(100, limit.percent)}%` }} />
          </span>
          <span className="truncate text-[11px] text-muted-foreground">{limit.resetsAt ? `Reset ${resetLabel(limit.resetsAt)}` : 'Pas de remise à zéro'}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top">
        {limit.label} : {Math.round(limit.percent)} % utilisé
        {limit.resetsAt && <> · remise à zéro {inLabel(limit.resetsAt)} ({resetLabel(limit.resetsAt)})</>}
      </TooltipContent>
    </Tooltip>
  )
}

function ClaudeUsage() {
  const usage = useClaudeUsage()
  const refresh = useRefreshClaudeUsage()
  const busy = refresh.isPending || usage.isFetching
  const fetched = usage.data && new Date(usage.data.fetchedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  return (
    <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-4">
      <div className="hidden flex-col items-end gap-0.5 lg:flex">
        <span className="flex items-center gap-1.5 font-medium"><SparklesIcon className="size-3.5 text-orange-500" aria-hidden />Claude</span>
        <span className="text-[11px] text-muted-foreground">{fetched ? `à ${fetched}` : '—'}</span>
      </div>
      <div className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2 shadow-xs sm:gap-4 sm:px-4">
        {usage.error && !usage.data && <span className="text-muted-foreground" title={usage.error.message}>Usage Claude indisponible</span>}
        {usage.isLoading && <span className="text-muted-foreground">Chargement…</span>}
        {usage.data?.limits.map((l) => <Limit key={`${l.kind}:${l.label}`} limit={l} />)}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => refresh.mutate()}
            disabled={busy}
            aria-label="Actualiser l’usage Claude"
            className="flex size-8 items-center justify-center rounded-md border bg-card text-muted-foreground shadow-xs transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
          >
            <RefreshCwIcon className={cn('size-3.5', busy && 'animate-spin')} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{refresh.error ? refresh.error.message : 'Actualiser l’usage'}</TooltipContent>
      </Tooltip>
    </div>
  )
}

/** Page GitHub du worktree : sa PR pour une review (branche locale review/pr-N), sinon sa branche. */
function githubUrl(repo: string, branch: string | null): string | null {
  if (!branch) return null
  const review = branch.match(/^review\/pr-(\d+)$/)
  return review ? `https://github.com/${repo}/pull/${review[1]}` : `https://github.com/${repo}/tree/${branch.split('/').map(encodeURIComponent).join('/')}`
}

function WorktreeInfo({ project, wt }: { project: Project; wt: string }) {
  const stat = useWorktreeStat(project.id, wt)
  if (!stat.data) return null
  const s = stat.data
  const url = githubUrl(project.repo, s.branch)
  const label = s.title ?? s.branch ?? 'HEAD détachée'
  return (
    <div className="hidden min-w-0 items-center gap-3 md:flex" title={`Comparé à origin/${s.base}, changements non commités compris`}>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" aria-label={`Ouvrir ${s.branch} sur GitHub`} title="Ouvrir sur GitHub"
          className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-card shadow-xs transition-colors hover:bg-accent">
          <GitBranchIcon className="size-3.5 text-muted-foreground" aria-hidden />
        </a>
      ) : (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-card shadow-xs">
          <GitBranchIcon className="size-3.5 text-muted-foreground" aria-hidden />
        </span>
      )}
      <div className="flex min-w-0 flex-col gap-0.5">
        {url
          ? <a href={url} target="_blank" rel="noreferrer" title="Ouvrir sur GitHub" className={cn('truncate font-medium hover:underline', !s.title && 'font-mono')}>{label}</a>
          : <span className={cn('truncate font-medium', !s.title && 'font-mono')}>{label}</span>}
        <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <DiffStat add={s.additions} del={s.deletions} className="text-[11px]" />
          <span className="whitespace-nowrap">· {plural(s.files, 'fichier', 'fichiers')} · vs {s.base}</span>
        </span>
      </div>
    </div>
  )
}

export function StatusBar({ project, route }: { project?: Project; route: Route }) {
  return (
    <footer className="fixed inset-x-0 bottom-0 z-20 flex h-[72px] items-center justify-between gap-6 border-t bg-background/95 px-4 text-xs backdrop-blur sm:px-8">
      <div className="min-w-0">{route.page === 'worktree' && project && <WorktreeInfo project={project} wt={route.wt} />}</div>
      <ClaudeUsage />
    </footer>
  )
}
