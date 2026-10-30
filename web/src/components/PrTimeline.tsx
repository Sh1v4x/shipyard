import { ChevronDownIcon, ClockIcon } from 'lucide-react'
import { useState } from 'react'
import type { PullRequest, TimelineEvent } from '../../../shared/types.ts'
import { cn } from '@/lib/utils'
import { isStale, since, waitingInfo } from '../../../shared/timeline.ts'
import { useHealth } from '../data/queries.ts'

interface Step { at: string; label: string; tone: string }

const REVIEW: Record<string, [string, string]> = {
  APPROVED: ['Approuvée par', 'bg-emerald-500'],
  CHANGES_REQUESTED: ['Changements demandés par', 'bg-red-500'],
  COMMENTED: ['Commentée par', 'bg-amber-500'],
  DISMISSED: ['Review écartée de', 'bg-muted-foreground/50'],
}

/** Étapes lisibles : les commits successifs d'une même personne n'en font qu'une (« 4 commits de … »). */
function steps(events: TimelineEvent[]): Step[] {
  const out: Step[] = []
  let commits: TimelineEvent[] = []
  const flush = () => {
    if (!commits.length) return
    const who = commits[0].actor ?? '?'
    out.push({ at: commits.at(-1)!.at, label: commits.length > 1 ? `${commits.length} commits de ${who}` : `Commit de ${who} : ${commits[0].detail ?? ''}`, tone: 'bg-blue-500' })
    commits = []
  }
  for (const e of events) {
    if (e.type === 'commit') {
      if (commits.length && commits[0].actor !== e.actor) flush()
      commits.push(e)
      continue
    }
    flush()
    if (e.type === 'created') out.push({ at: e.at, label: `Ouverte par ${e.actor ?? '?'}`, tone: 'bg-foreground' })
    else if (e.type === 'review_requested') out.push({ at: e.at, label: `Review demandée à ${e.detail ?? '?'}`, tone: 'bg-violet-500' })
    else if (e.type === 'review') {
      const [label, tone] = REVIEW[e.detail ?? ''] ?? ['Review de', 'bg-muted-foreground/50']
      out.push({ at: e.at, label: `${label} ${e.actor ?? '?'}`, tone })
    } else if (e.type === 'ready') out.push({ at: e.at, label: 'Prête pour review', tone: 'bg-violet-500' })
    else if (e.type === 'draft') out.push({ at: e.at, label: 'Repassée en brouillon', tone: 'bg-muted-foreground/50' })
    else if (e.type === 'merged') out.push({ at: e.at, label: `Mergée par ${e.actor ?? '?'}`, tone: 'bg-violet-600' })
    else if (e.type === 'closed') out.push({ at: e.at, label: 'Fermée', tone: 'bg-muted-foreground/50' })
    else if (e.type === 'reopened') out.push({ at: e.at, label: 'Rouverte', tone: 'bg-foreground' })
  }
  flush()
  return out
}

const day = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })

/** Frise d'une PR dans l'en-tête du worktree : les dernières étapes, et depuis quand elle attend. */
export function PrTimeline({ pr }: { pr: PullRequest }) {
  const me = useHealth().data?.github ?? null
  const [all, setAll] = useState(false)
  if (!pr.timeline?.length) return null
  const list = steps(pr.timeline)
  const shown = all ? list : list.slice(-5)
  const w = waitingInfo(pr, me)
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-2 rounded-xl border bg-card px-4 py-2.5 text-xs">
      {!all && list.length > shown.length && (
        <button type="button" className="mr-1 flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={() => setAll(true)}>
          <ChevronDownIcon className="size-3.5" />{list.length - shown.length} étape(s) avant
        </button>
      )}
      {shown.map((s, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="mx-1 h-px w-4 bg-border" aria-hidden="true" />}
          <span className={cn('size-2 shrink-0 rounded-full', s.tone)} aria-hidden="true" />
          <span className="max-w-[260px] truncate" title={`${s.label} · ${new Date(s.at).toLocaleString('fr-FR')}`}>{s.label}</span>
          <span className="text-muted-foreground">{day(s.at)}</span>
        </span>
      ))}
      {w && (
        <span className={cn('ml-auto flex items-center gap-1 pl-3', isStale(w.since) ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>
          <ClockIcon className="size-3.5" />{w.label} depuis {since(w.since)}
        </span>
      )}
    </div>
  )
}
