import { ArrowUpRightIcon, CopyIcon, RefreshCwIcon } from 'lucide-react'
import { useState } from 'react'
import type { StatsReport, StatsScope } from '../../../shared/types.ts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label as FieldLabel } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { useRefreshStats } from '../data/mutations.ts'
import { useStats } from '../data/queries.ts'
import { go } from '../router.ts'
import { Empty, ErrorBox, Pill, Spinner, plural, useToast } from '../ui.tsx'

/** Jour local au format AAAA-MM-JJ (celui des champs date). */
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const nb = (n: number) => n.toLocaleString('fr-FR')
const frDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
const frMonth = (month: string) => new Date(`${month}-15T12:00:00`).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })

/** Raccourcis de période : [libellé, début, fin] calculés à partir d'aujourd'hui. */
function presets(): [string, string, string][] {
  const today = new Date()
  const y = today.getFullYear()
  const m = today.getMonth()
  const day = (yy: number, mm: number, dd: number) => isoDay(new Date(yy, mm, dd))
  const quarter = Math.floor(m / 3) * 3
  const yearAgo = new Date(today)
  yearAgo.setFullYear(y - 1)
  yearAgo.setDate(yearAgo.getDate() + 1)
  return [
    ['Ce mois', day(y, m, 1), isoDay(today)],
    ['Mois dernier', day(y, m - 1, 1), day(y, m, 0)],
    ['Ce trimestre', day(y, quarter, 1), isoDay(today)],
    ['6 derniers mois', day(y, m - 5, 1), isoDay(today)],
    ['12 derniers mois', isoDay(yearAgo), isoDay(today)],
    ['Cette année', day(y, 0, 1), isoDay(today)],
    ['Année dernière', day(y - 1, 0, 1), day(y - 1, 11, 31)],
  ]
}

/** Bilan en texte, à coller dans un document ou un message. */
function toMarkdown(r: StatsReport): string {
  const t = r.totals
  return [
    `## Bilan du ${frDay(r.from)} au ${frDay(r.to)}`,
    '',
    `- ${nb(t.prsMerged)} PR mergées (${nb(t.prsOpened)} ouvertes), ${nb(t.commits)} commits`,
    `- +${nb(t.linesAdded)} / −${nb(t.linesDeleted)} lignes`,
    `- ${nb(t.reviews)} reviews sur ${nb(t.reviewedPrs)} PR de collègues (${nb(t.approvals)} approbations, ${nb(t.changesRequested)} demandes de changements)`,
    ...(t.ticketsCompleted != null ? [`- ${nb(t.ticketsCompleted)} tickets Linear terminés`] : []),
    '',
    '### Par dépôt',
    ...r.byRepo.map((x) => `- ${x.repo} : ${nb(x.prsMerged)} PR mergées, ${nb(x.reviews)} reviews, ${nb(x.commits)} commits`),
    '',
    '### PR les plus importantes',
    ...r.mergedPrs.slice(0, 10).map((p) => `- ${p.title} (${p.repo}#${p.number}, +${nb(p.additions)} −${nb(p.deletions)}) ${p.url}`),
  ].join('\n')
}

const METRICS = [['prsMerged', 'PR mergées', 'PR mergées'], ['commits', 'Commits', 'commits'], ['reviews', 'Reviews', 'reviews'], ['ticketsCompleted', 'Tickets terminés', 'tickets terminés']] as const
type Metric = (typeof METRICS)[number][0]

export function StatsPage({ from: routeFrom, to: routeTo, scope = 'tracked' }: { from?: string; to?: string; scope?: StatsScope }) {
  const toast = useToast()
  const options = presets()
  const [, defaultFrom, defaultTo] = options[4]
  const from = routeFrom ?? defaultFrom
  const to = routeTo ?? defaultTo
  const valid = from <= to
  const stats = useStats(from, to, scope)
  const refresh = useRefreshStats(from, to, scope)
  const set = (next: { from?: string; to?: string; scope?: StatsScope }) => go({ page: 'stats', from, to, scope, ...next })
  const r = stats.data

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Stats</h1>
          <p className="mt-1 text-sm text-muted-foreground">Ton activité sur une période : PR, commits, reviews et tickets, lus sur GitHub et Linear. De quoi chiffrer un bilan ou un entretien.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={!valid || stats.isFetching || refresh.isPending}
            onClick={() => (r ? refresh.mutate(undefined, { onError: (e) => toast(e.message, true) }) : void stats.refetch())}>
            {stats.isFetching || refresh.isPending ? <Spinner /> : <RefreshCwIcon />}{stats.isError ? 'Réessayer' : 'Actualiser'}
          </Button>
          <Button disabled={!r} onClick={() => r && navigator.clipboard.writeText(toMarkdown(r)).then(() => toast('Bilan copié'))}><CopyIcon />Copier le bilan</Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border bg-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {options.map(([label, f, t]) => <Pill key={label} active={from === f && to === t} onClick={() => set({ from: f, to: t })}>{label}</Pill>)}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="stats-from">Du</FieldLabel>
            <Input id="stats-from" type="date" className="w-44" value={from} max={to} onChange={(e) => e.target.value && set({ from: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="stats-to">Au</FieldLabel>
            <Input id="stats-to" type="date" className="w-44" value={to} min={from} max={isoDay(new Date())} onChange={(e) => e.target.value && set({ to: e.target.value })} />
          </div>
          <div className="flex flex-wrap items-center gap-2 pb-0.5">
            <Pill active={scope === 'tracked'} onClick={() => set({ scope: 'tracked' })}>Projets suivis</Pill>
            <Pill active={scope === 'all'} onClick={() => set({ scope: 'all' })}>Tous mes dépôts</Pill>
          </div>
        </div>
        {!valid && <p className="text-sm text-destructive">La date de début doit précéder la date de fin.</p>}
      </div>

      {stats.isPending && valid && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Lecture de GitHub et Linear… jusqu’à une minute sur une longue période.</div>}
      <ErrorBox error={stats.error} />
      {r && <Report report={r} />}
    </div>
  )
}

function Report({ report: r }: { report: StatsReport }) {
  const t = r.totals
  const monthsCount = r.byMonth.length
  const perMonth = (n: number) => (monthsCount > 1 ? `≈ ${nb(Math.round((n / monthsCount) * 10) / 10)} par mois` : null)
  if (!t.prsMerged && !t.prsOpened && !t.reviews && !t.ticketsCompleted) {
    return <Empty title="Aucune activité sur la période">Pas de PR, de review ni de ticket terminé entre ces deux dates.</Empty>
  }
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Tile label="PR mergées" value={nb(t.prsMerged)} detail={[`${nb(t.prsOpened)} ouvertes`, perMonth(t.prsMerged)].filter(Boolean).join(' · ')} />
        <Tile label="Commits" value={nb(t.commits)} detail="dans mes PR mergées" />
        <Tile label="Reviews" value={nb(t.reviews)} detail={`${plural(t.reviewedPrs, 'PR de collègue', 'PR de collègues')} · ${nb(t.approvals)} approuvées · ${nb(t.changesRequested)} changements demandés`} />
        <Tile label="Lignes" value={`+${nb(t.linesAdded)}`} detail={`−${nb(t.linesDeleted)} supprimées`} />
        <Tile label="Tickets terminés" value={t.ticketsCompleted == null ? '—' : nb(t.ticketsCompleted)} detail={t.ticketsCompleted == null ? 'clé Linear non configurée' : perMonth(t.ticketsCompleted) ?? 'dans Linear'} />
        <Tile label="Dépôts" value={nb(r.byRepo.length)} detail={r.byRepo.slice(0, 3).map((x) => x.repo.split('/')[1]).join(', ')} />
      </div>

      {monthsCount > 1 && <MonthlyChart report={r} />}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Par dépôt</h2>
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Dépôt</TableHead>
                <TableHead className="text-right">PR mergées</TableHead>
                <TableHead className="text-right">Ouvertes</TableHead>
                <TableHead className="text-right">Commits</TableHead>
                <TableHead className="text-right">Reviews</TableHead>
                <TableHead className="pr-4 text-right">Lignes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="tabular-nums">
              {r.byRepo.map((x) => (
                <TableRow key={x.repo}>
                  <TableCell className="pl-4 font-mono text-xs">{x.repo}</TableCell>
                  <TableCell className="text-right">{nb(x.prsMerged)}</TableCell>
                  <TableCell className="text-right">{nb(x.prsOpened)}</TableCell>
                  <TableCell className="text-right">{nb(x.commits)}</TableCell>
                  <TableCell className="text-right">{nb(x.reviews)}</TableCell>
                  <TableCell className="pr-4 text-right text-muted-foreground">+{nb(x.linesAdded)} / −{nb(x.linesDeleted)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <MergedPrs report={r} />

      <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
        {r.notes.map((n) => <li key={n}>{n}</li>)}
      </ul>
    </>
  )
}

function Tile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border bg-card px-4 py-3">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
    </div>
  )
}

/** Une mesure à la fois, mois par mois : une seule série, une seule échelle. */
function MonthlyChart({ report: r }: { report: StatsReport }) {
  const [metric, setMetric] = useState<Metric>('prsMerged')
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...r.byMonth.map((m) => m[metric]))
  const [, label, unit] = METRICS.find(([k]) => k === metric) ?? METRICS[0]
  const metrics = METRICS.filter(([k]) => k !== 'ticketsCompleted' || r.totals.ticketsCompleted != null)
  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{label} par mois</h2>
        <div className="flex flex-wrap gap-1.5">
          {metrics.map(([k, l]) => <Pill key={k} active={metric === k} onClick={() => setMetric(k)}>{l}</Pill>)}
        </div>
      </div>
      <div className="flex h-48 items-end gap-0.5 border-b border-border" role="img" aria-label={`${label} par mois : ${r.byMonth.map((m) => `${frMonth(m.month)} ${m[metric]}`).join(', ')}`}>
        {r.byMonth.map((m, i) => (
          // biome-ignore lint/a11y/noStaticElementInteractions: survol pour afficher la valeur, les données sont aussi dans l'aria-label
          <div key={m.month} className="relative flex h-full min-w-0 flex-1 items-end justify-center" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <div className={cn('w-full max-w-12 rounded-t bg-primary transition-opacity', hover != null && hover !== i && 'opacity-50')} style={{ height: `${(m[metric] / max) * 100}%`, minHeight: m[metric] ? 2 : 0 }} />
            {hover === i && (
              <div className="pointer-events-none absolute top-0 left-1/2 z-10 -translate-x-1/2 rounded-md whitespace-nowrap border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
                <span className="font-medium">{frMonth(m.month)}</span> · {nb(m[metric])} {unit}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-0.5 text-xs text-muted-foreground">
        {r.byMonth.map((m, i) => (
          <span key={m.month} className="min-w-0 flex-1 truncate text-center">{r.byMonth.length > 12 && i % 2 ? '' : frMonth(m.month)}</span>
        ))}
      </div>
    </section>
  )
}

function MergedPrs({ report: r }: { report: StatsReport }) {
  const [all, setAll] = useState(false)
  if (!r.mergedPrs.length) return null
  const shown = all ? r.mergedPrs : r.mergedPrs.slice(0, 10)
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">PR mergées, les plus importantes d’abord</h2>
      <ul className="flex flex-col divide-y rounded-xl border bg-card">
        {shown.map((p) => (
          <li key={p.url} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
            <a href={p.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">{p.title}<ArrowUpRightIcon className="ml-1 inline size-3.5 text-muted-foreground" /></a>
            <span className="font-mono text-xs text-muted-foreground">{p.repo.split('/')[1]}#{p.number}</span>
            <span className="text-xs text-muted-foreground tabular-nums">+{nb(p.additions)} −{nb(p.deletions)} · {plural(p.commits, 'commit', 'commits')}</span>
          </li>
        ))}
      </ul>
      {r.mergedPrs.length > 10 && (
        <Button variant="ghost" size="sm" className="w-fit" onClick={() => setAll(!all)}>{all ? 'Voir moins' : `Voir les ${r.mergedPrs.length} PR`}</Button>
      )}
    </section>
  )
}
