import { ArrowRightIcon, CheckIcon, ChevronRightIcon, CircleSlashIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import type { ActionKind, RunSummary } from '../../../../shared/types.ts'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { runHref } from '../../../../shared/inbox.ts'
import { useWorktreeRuns } from '../../data/queries.ts'
import { useRun } from '../../data/runs.ts'
import { Empty, Pill, RunLog, Spinner, ago } from '../../ui.tsx'
import type { TabProps } from '../Worktree.tsx'

const KIND: Partial<Record<ActionKind, string>> = {
  'ticket-plan': 'Plan', ticket: 'Travail', 'change-plan': 'Plan (modif. libre)', change: 'Modification libre', 'branch-ask': 'Question / recherche',
  'pr-prepare': 'Préparation de PR', 'self-review': 'Auto-review', 'self-review-part': 'Auto-review (lot)', 'finding-fix': 'Correctif (auto-review)',
  'comments-analyze': 'Analyse des commentaires', 'comment-fix': 'Correctif (commentaire)', 'general-fix': 'Commentaire général appliqué', 'comments-fix-all': 'Tout accepter', 'comment-reply': 'Réponse rédigée',
  review: 'Review', 'review-part': 'Review (lot)', test: 'Test', 'test-part': 'Test (un dépôt)', 'ci-analyze': 'Diagnostic CI', 'ci-fix': 'Correctif CI',
  'commit-plan': 'Plan de commits', 'commit-exec': 'Commits', 'commit-fix': 'Correction de hook',
  'conflict-resolve': 'Résolution de conflits', 'merge-finish': 'Valider et pousser', 'base-sync': 'Récupérer la base', 'branch-sync': 'Récupérer ma branche',
}

type Filter = 'all' | 'error' | 'running'

const duration = (r: RunSummary) => {
  if (!r.endedAt) return null
  const s = Math.round((Date.parse(r.endedAt) - Date.parse(r.startedAt)) / 1000)
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}`
}

/** Logs : toutes les actions lancées sur ce worktree, de la plus récente à la plus ancienne, avec leur journal. */
export function LogsTab({ project, wtId }: TabProps) {
  const runs = useWorktreeRuns(project.id, wtId)
  const [filter, setFilter] = useState<Filter>('all')
  const all = runs.data ?? []
  const list = all.filter((r) => filter === 'all' || (filter === 'error' ? r.status === 'error' : r.status === 'running'))
  const cost = all.reduce((a, r) => a + (r.costUsd ?? 0), 0)

  return (
    <section className="flex flex-col gap-4" aria-label="Logs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          <Pill active={filter === 'all'} onClick={() => setFilter('all')}>Tout · {all.length}</Pill>
          <Pill active={filter === 'running'} onClick={() => setFilter('running')}>En cours · {all.filter((r) => r.status === 'running').length}</Pill>
          <Pill active={filter === 'error'} onClick={() => setFilter('error')}>Échecs · {all.filter((r) => r.status === 'error').length}</Pill>
        </div>
        {cost > 0 && <span className="text-xs text-muted-foreground">≈ {cost.toFixed(2)} $ en équivalent API sur ce worktree</span>}
      </div>

      {runs.isLoading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Chargement des logs…</div>}
      {runs.data && !list.length && <Empty title={filter === 'all' ? 'Aucune action pour l’instant' : 'Rien ici'}>Chaque action lancée sur ce worktree (plan, travail, review, correctif, fusion…) apparaîtra ici.</Empty>}

      <ul className="flex flex-col overflow-hidden rounded-xl border bg-card">
        {list.map((r) => <LogRow key={r.id} run={r} />)}
      </ul>
    </section>
  )
}

function LogRow({ run: r }: { run: RunSummary }) {
  const [open, setOpen] = useState(false)
  const icon = r.status === 'running' ? <Spinner className="size-3.5 text-blue-500" />
    : r.status === 'success' ? <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />
    : r.status === 'error' ? <XIcon className="size-3.5 text-red-600 dark:text-red-400" />
    : <CircleSlashIcon className="size-3.5 text-muted-foreground" />
  return (
    <li className="border-t first:border-t-0">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
          <ChevronRightIcon className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
          {icon}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{r.title}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {KIND[r.kind] ?? r.kind} · {ago(r.startedAt)}{duration(r) && ` · ${duration(r)}`}{r.costUsd ? ` · ${r.costUsd.toFixed(2)} $` : ''}
            </span>
          </span>
        </button>
        <Button variant="ghost" size="sm" asChild><a href={runHref(r.kind, r.scope)}>Ouvrir<ArrowRightIcon /></a></Button>
      </div>
      {open && <LogDetail id={r.id} />}
    </li>
  )
}

/** Journal complet d'un run, chargé à l'ouverture (et suivi en direct s'il tourne encore). */
function LogDetail({ id }: { id: string }) {
  const live = useRun(id)
  return (
    <div className="px-4 pb-3">
      {live.events.length ? <RunLog events={live.events} /> : <div className="flex items-center gap-2 text-xs text-muted-foreground"><Spinner className="size-3.5" />Chargement du journal…</div>}
    </div>
  )
}
