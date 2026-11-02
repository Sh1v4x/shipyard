import { ArrowUpRightIcon, ChevronRightIcon, GhostIcon, GitBranchIcon, PlusIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { LinkWorktree } from '../components/LinkTicket.tsx'
import { TicketStatus } from '../components/TicketStatus.tsx'
import type { Project, PullRequest, QueueGroup, QueueItem, QueueTone, Ticket } from '../../../shared/types.ts'
import { QUEUE_GROUPS, canGhost, isActiveTicket } from '../../../shared/queue.ts'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { useCreateWorktree, useDismissInbox, useLinkTeam, useSetGhost, useWakeGhost } from '../data/mutations.ts'
import { useLabelRules, usePrefetchWorktree, useQueue, useTeams } from '../data/queries.ts'
import { go, href } from '../router.ts'
import { Badge, Empty, ErrorBox, Label, Notif, Pill, Spinner, ago, ciTone, needsChanges, plural, reviewersToRerequest, useToast, type Tone } from '../ui.tsx'

const TABS = [
  ['queue', 'File d’attente'],
  ['tickets', 'Tickets Linear'],
  ['mypr', 'Mes PR'],
  ['reviews', 'Reviews'],
  ['ci', 'CI'],
] as const

const FILTERS: [string, string, (t: Ticket) => boolean][] = [
  ['open', 'Todo et en cours', isActiveTicket],
  ['unstarted', 'Todo', (t) => t.statusType === 'unstarted'],
  ['started', 'En cours', (t) => t.statusType === 'started'],
]

export function OverviewPage({ project, tab = 'queue' }: { project: Project; tab?: string }) {
  const { items, count, overview: ov } = useQueue(project.id)
  const [filter, setFilter] = useState('open')
  const d = ov.data
  const setTab = (t: string) => go({ page: 'overview', project: project.id, tab: t === 'queue' ? undefined : t })
  // Nombre de lignes de chaque onglet : un total, pas un « à faire » (seule la file a le compteur noir).
  const rows: Record<string, number> = d ? { tickets: d.tickets.filter(isActiveTicket).length, mypr: d.myPrs.length, reviews: d.reviewPrs.length, ci: [...d.myPrs, ...d.reviewPrs].filter((p) => p.ci.failing).length } : {}

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-mono text-[13px]">{project.repo}</span> · {project.team ? `Équipe Linear ${project.team}` : 'Aucune équipe Linear liée'} · base <span className="font-mono text-[13px]">{project.baseBranch}</span>
          </p>
        </div>
        <Button size="sm" asChild>
          <a href={href({ page: 'create', project: project.id })}><GitBranchIcon />Nouveau worktree</a>
        </Button>
      </div>

      {ov.isLoading && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Récupération de Linear, GitHub et de la CI…</div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      )}
      <ErrorBox error={ov.error} />
      {d?.errors.map((e) => <ErrorBox key={e} error={e} />)}

      {d && items && (
        <section className="flex flex-col gap-4">
          <div role="tablist" className="flex gap-5 overflow-x-auto overflow-y-hidden border-b">
            {TABS.map(([k, label]) => (
              <button type="button"
                key={k}
                role="tab"
                aria-selected={tab === k}
                className={cn(
                  '-mb-px flex h-10 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-0.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground',
                  tab === k && 'border-foreground text-foreground',
                )}
                onClick={() => setTab(k)}
              >
                {label}
                {k === 'queue' ? <Notif n={count} /> : <span className="text-muted-foreground tabular-nums">{rows[k]}</span>}
              </button>
            ))}
          </div>

          {tab === 'queue' && <QueueView project={project} items={items} prs={[...d.myPrs, ...d.reviewPrs]} />}
          {tab === 'tickets' && <TicketsTable project={project} tickets={d.tickets.filter(isActiveTicket)} worktrees={d.worktrees} filter={filter} setFilter={setFilter} linear={d.linearConfigured} />}
          {tab === 'mypr' && <PrTable project={project} prs={d.myPrs} worktrees={d.worktrees} mine />}
          {tab === 'reviews' && <PrTable project={project} prs={d.reviewPrs} worktrees={d.worktrees} />}
          {tab === 'ci' && <CiTable project={project} prs={[...d.myPrs, ...d.reviewPrs]} worktrees={d.worktrees} />}
        </section>
      )}
    </div>
  )
}

// ---------- File d'attente ----------

const QUEUE_FILTERS: [string, string, (q: QueueItem) => boolean][] = [
  ['all', 'Tout', () => true],
  ['mine', 'Mes PR', (q) => q.kind === 'mine'],
  ['review', 'Reviews', (q) => q.kind === 'review'],
  ['agent', 'Agents', (q) => q.kind === 'agent'],
  ['work', 'Tickets et branches', (q) => q.kind === 'ticket' || q.kind === 'branch'],
]

const STRIPE: Record<QueueTone, string> = {
  red: 'bg-red-500', amber: 'bg-amber-500', purple: 'bg-violet-500', blue: 'bg-blue-500', green: 'bg-emerald-500', gray: 'bg-border',
}
const PILL: Record<QueueTone, Tone> = { red: 'red', amber: 'amber', purple: 'purple', blue: 'blue', green: 'green', gray: 'gray' }

/** Groupes repliés par défaut : ce qui ne demande rien tout de suite. */
const FOLDED: QueueGroup[] = ['others', 'clean', 'ghost']

function QueueView({ project, items, prs }: { project: Project; items: QueueItem[]; prs: PullRequest[] }) {
  const [filter, setFilter] = useState('all')
  const match = QUEUE_FILTERS.find((f) => f[0] === filter)![2]
  const shown = items.filter(match)
  const me = items.filter((q) => q.group === 'me').length
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{me ? plural(me, 'chose t’attend', 'choses t’attendent') : 'Rien ne t’attend'}</h2>
          <p className="text-sm text-muted-foreground">Le plus bloquant d’abord : conflits et CI, puis commentaires, reviews et tests.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {QUEUE_FILTERS.map(([k, label, fn]) => {
            const n = items.filter(fn).length
            if (!n && k !== 'all') return null
            return <Pill key={k} active={filter === k} onClick={() => setFilter(k)}>{label} <span className="opacity-60 tabular-nums">{n}</span></Pill>
          })}
        </div>
      </div>
      {QUEUE_GROUPS.map((g) => {
        const list = shown.filter((q) => q.group === g.key)
        if (!list.length) return null
        return <QueueGroupCard key={g.key} label={g.label} group={g.key} items={list} project={project} prs={prs} />
      })}
      {!shown.length && <Empty title="Rien dans ce filtre" />}
    </div>
  )
}

function QueueGroupCard({ label, group, items, project, prs }: { label: string; group: QueueGroup; items: QueueItem[]; project: Project; prs: PullRequest[] }) {
  const [open, setOpen] = useState(!FOLDED.includes(group))
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <button type="button" className="flex w-full items-center gap-2 border-b bg-muted/40 px-4 py-2 text-left text-xs font-semibold text-muted-foreground hover:text-foreground" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronRightIcon className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        {label}
        <span className="tabular-nums">· {items.length}</span>
      </button>
      {open && <div className="divide-y">{items.map((q) => <QueueRow key={q.key} item={q} project={project} pr={prs.find((p) => p.number === q.prNumber)} />)}</div>}
    </div>
  )
}

function QueueRow({ item: q, project, pr }: { item: QueueItem; project: Project; pr?: PullRequest }) {
  const prefetch = usePrefetchWorktree()
  const dismiss = useDismissInbox()
  const setGhost = useSetGhost(project.id)
  const wake = useWakeGhost(project.id)
  const toast = useToast()
  const putAside = () => {
    const note = prompt('Mettre de côté (ghost) : pourquoi ? (facultatif)')
    if (note === null) return
    setGhost.mutate({ key: q.key, note }, { onSuccess: () => toast(`${q.ref ?? q.title} mis de côté`), onError: (e) => toast(e.message, true) })
  }
  // Résultat d'agent à lire : l'ouvrir suffit à le retirer de la file.
  const opened = () => { if (q.runId && q.clearsOnOpen) dismiss.mutate(q.runId) }
  const primary = q.group === 'me'
  const variant = primary ? 'default' : 'outline'
  const a = q.action
  let action: React.ReactNode = null
  if (a?.url) action = <Button size="sm" variant={variant} asChild><a href={a.url} target="_blank" rel="noreferrer">{a.label}<ArrowUpRightIcon /></a></Button>
  else if (a?.href) action = <Button size="sm" variant={variant} asChild><a href={a.href} onClick={opened}>{a.label}</a></Button>
  else if (q.worktree) action = <Button size="sm" variant={variant} asChild><a href={href({ page: 'worktree', project: project.id, wt: q.worktree, tab: a?.tab })}>{a?.label ?? 'Ouvrir'}</a></Button>
  else if (pr) action = <CreateReviewWorktree project={project} pr={pr} label={pr.mine ? 'Créer le worktree' : 'Worktree pour reviewer'} />
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: préchargement au survol, sans action pour l'utilisateur
    <div className="grid grid-cols-[4px_minmax(0,1fr)_auto] items-center gap-4 py-3 pr-4" onMouseEnter={() => q.worktree && void prefetch(project.id, q.worktree)}>
      <span className={cn('h-full min-h-10 rounded-r-full', STRIPE[q.tone])} aria-hidden />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="flex min-w-0 items-baseline gap-2">
          {q.ref && <span className="shrink-0 font-mono text-xs text-muted-foreground">{q.ref}</span>}
          <span className="truncate text-sm font-medium" title={q.title}>{q.title}</span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {q.reasons.map((r) => <Badge key={r.label} tone={PILL[r.tone]}>{r.label}</Badge>)}
          {q.detail && <span className="truncate">{q.detail}</span>}
          {q.until && <span className="shrink-0 text-muted-foreground/80">· {q.until}</span>}
          {q.ghost && <span className="shrink-0 text-muted-foreground/80">· mis de côté {ago(q.ghost.at)}{q.ghost.note && ` : ${q.ghost.note}`}</span>}
        </span>
      </div>
      <span className="flex shrink-0 items-center gap-1.5">
        {action}
        {q.ghost ? (
          <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={wake.isPending} title="Le remettre dans mes tâches en cours"
            onClick={() => wake.mutate(q.key, { onSuccess: () => toast(`${q.ref ?? q.title} réveillé`), onError: (e) => toast(e.message, true) })}>
            <GhostIcon />Réveiller
          </Button>
        ) : canGhost(q) && (
          <Button variant="ghost" size="icon-sm" aria-label="Mettre de côté (ghost)" title="Mettre de côté (ghost) : ne compte plus dans mes tâches, sans rien changer sur GitHub" className="text-muted-foreground" disabled={setGhost.isPending} onClick={putAside}>
            <GhostIcon />
          </Button>
        )}
        {q.runId && (
          <Button variant="ghost" size="icon-sm" aria-label="Écarter" title="Écarter : ne plus l’afficher" className="text-muted-foreground"
            onClick={() => dismiss.mutate(q.runId!, { onError: (e) => toast(e.message, true) })}>
            <XIcon />
          </Button>
        )}
      </span>
    </div>
  )
}

type Wts = { id: string; ticketId: string | null; prNumber: number | null; branch: string | null }[]

/** Conteneur commun des tables de la vue d'ensemble. */
const TableCard = ({ children }: { children: React.ReactNode }) => <div className="overflow-hidden rounded-xl border bg-card shadow-xs">{children}</div>

function TicketsTable({ project, tickets, worktrees, filter, setFilter, linear }: { project: Project; tickets: Ticket[]; worktrees: Wts; filter: string; setFilter: (f: string) => void; linear: boolean }) {
  if (!linear) return <Empty title="Linear n’est pas connecté">Ajoute LINEAR_API_KEY dans .env.local (Linear › Settings › Security & access › Personal API keys), puis relance le serveur.</Empty>
  if (!project.team) return <LinkTeam project={project} />
  const match = FILTERS.find((f) => f[0] === filter)?.[2] ?? (() => true)
  const rows = tickets.filter(match)
  return (
    <section aria-label="Tickets Linear" className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map(([k, label, fn]) => (
          <Pill key={k} active={filter === k} onClick={() => setFilter(k)}>
            {label} <span className="opacity-60 tabular-nums">{tickets.filter(fn).length}</span>
          </Pill>
        ))}
      </div>
      {rows.length === 0 ? <Empty title="Aucun ticket pour ce filtre" /> : (
        <TableCard>
          <Table>
            <TableHeader><TableRow><TableHead>ID</TableHead><TableHead>Titre</TableHead><TableHead>Statut</TableHead><TableHead>Priorité</TableHead><TableHead>Mis à jour</TableHead><TableHead>Worktree</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((t) => {
                const w = worktrees.find((x) => x.ticketId === t.id)
                return (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-[13px] font-medium"><a href={t.url} target="_blank" rel="noreferrer" className="hover:underline">{t.id}</a></TableCell>
                    <TableCell className="min-w-[240px] whitespace-normal">
                      <span className="font-medium">{t.title}</span>
                      {!t.isMine && <span className="text-xs text-muted-foreground"> · {t.assignee ?? 'non assigné'}</span>}
                    </TableCell>
                    <TableCell><TicketStatus project={project} ticket={t} /></TableCell>
                    <TableCell className="text-muted-foreground">{t.priority}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{ago(t.updatedAt)}</TableCell>
                    <TableCell>
                      {w ? (
                        <Button variant="outline" size="sm" className="max-w-[220px] font-mono text-xs" asChild>
                          <a href={href({ page: 'worktree', project: project.id, wt: w.id })} title={w.branch ?? ''}><GitBranchIcon /><span className="truncate">{w.branch}</span></a>
                        </Button>
                      ) : t.statusType === 'completed' || t.statusType === 'canceled' ? <span className="text-muted-foreground">—</span>
                        : (
                          <span className="flex items-center gap-1">
                            <Button variant="outline" size="sm" className="border-dashed text-muted-foreground" asChild>
                              <a href={href({ page: 'create', project: project.id, ticket: t.id })}><PlusIcon />Créer un worktree</a>
                            </Button>
                            {worktrees.length > 0 && <LinkWorktree project={project} ticket={t} />}
                          </span>
                        )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableCard>
      )}
    </section>
  )
}

function LinkTeam({ project }: { project: Project }) {
  const [asked, setAsked] = useState(false)
  const teams = useTeams(asked)
  const link = useLinkTeam(project.id)
  const toast = useToast()
  return (
    <Empty
      title="Aucune équipe Linear liée à ce projet"
      action={
        teams.data ? (
          <div className="flex flex-wrap justify-center gap-2">
            {teams.data.map((t) => (
              <Button key={t.key} variant="outline" size="sm" disabled={link.isPending} onClick={() => link.mutate(t.key, {
                onSuccess: () => toast(`Équipe ${t.key} liée à ${project.name}`),
                onError: (e) => toast(e.message, true),
              })}>{t.key} · {t.name}</Button>
            ))}
          </div>
        ) : (
          <Button variant="outline" disabled={teams.isFetching} onClick={() => setAsked(true)}>{teams.isFetching && <Spinner />}Choisir une équipe</Button>
        )
      }
    >
      Lie une équipe pour voir ses tickets. Sans équipe, crée tes worktrees depuis une branche.
    </Empty>
  )
}

function PrTable({ project, prs, worktrees, mine = false }: { project: Project; prs: PullRequest[]; worktrees: Wts; mine?: boolean }) {
  const rules = useLabelRules()
  if (!prs.length) return <Empty title={mine ? 'Aucune PR ouverte par toi' : 'Aucune review demandée'} />
  return (
    <TableCard>
      <Table>
        <TableHeader><TableRow><TableHead>PR</TableHead><TableHead>Titre</TableHead><TableHead>CI</TableHead><TableHead>{mine ? 'État' : 'Auteur'}</TableHead><TableHead>Activité</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
        <TableBody>
          {prs.map((p) => {
            const w = worktrees.find((x) => x.prNumber === p.number)
            return (
              <TableRow key={p.number}>
                <TableCell className="w-0 font-mono text-[13px] font-medium"><a href={p.url} target="_blank" rel="noreferrer" className="hover:underline">#{p.number}</a></TableCell>
                <TableCell className="max-w-0 w-full">
                  <span className="block truncate font-medium" title={p.title}>{p.title}</span>
                  <span className="mt-1 flex items-center gap-1.5 overflow-hidden">
                    <span className="shrink-0 font-mono text-xs"><span className="text-emerald-600 dark:text-emerald-400">+{p.additions}</span> <span className="text-red-600 dark:text-red-400">−{p.deletions}</span> <span className="text-muted-foreground">· {p.changedFiles} f.</span></span>
                    {p.isDraft && <Badge tone="gray">draft</Badge>}
                    {p.labels.map((l) => <Label key={l.name} {...l} />)}
                  </span>
                </TableCell>
                <TableCell className="w-0"><Badge tone={ciTone(p.ci.state)}>{p.ci.state === 'fail' ? plural(p.ci.failing, 'échec', 'échecs') : p.ci.state === 'pass' ? 'CI ok' : p.ci.state === 'running' ? 'En cours' : '—'}</Badge></TableCell>
                <TableCell className="w-0">
                  {mine ? (
                    <span className="flex gap-1">
                      {p.conflicts && <Badge tone="red">Conflits</Badge>}
                      {p.unresolvedThreads ? <Badge tone="amber">{p.unresolvedThreads} à traiter</Badge>
                        : reviewersToRerequest(p, rules).length ? <Badge tone="amber">Review à relancer</Badge>
                        : needsChanges(p, rules) ? <Badge tone="amber">Modifications demandées</Badge>
                        : !p.conflicts && <Badge tone="green">À jour</Badge>}
                    </span>
                  ) : <span className="text-sm">{p.author}</span>}
                </TableCell>
                <TableCell className="w-0 text-xs text-muted-foreground">{ago(p.updatedAt)}</TableCell>
                <TableCell className="w-0 text-right">
                  {w ? (
                    <Button variant="outline" size="sm" asChild>
                      <a href={href({ page: 'worktree', project: project.id, wt: w.id })}>Ouvrir</a>
                    </Button>
                  ) : <CreateReviewWorktree project={project} pr={p} label={mine ? 'Worktree' : 'Worktree pour reviewer'} />}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </TableCard>
  )
}

function CreateReviewWorktree({ project, pr, label, tab }: { project: Project; pr: PullRequest; label: string; tab?: string }) {
  const create = useCreateWorktree(project.id)
  const busy = create.isPending
  const toast = useToast()
  return (
    <Button variant="outline" size="sm" className="border-dashed text-muted-foreground" disabled={busy} onClick={() => {
      const body = pr.mine ? { mode: 'existing', branch: pr.head } : { mode: 'review', prNumber: pr.number }
      create.mutate(body, {
        onSuccess: (r) => {
          toast(`Worktree créé : ${r.path}`)
          go({ page: 'worktree', project: project.id, wt: r.id, tab })
        },
        onError: (e) => toast(e.message, true),
      })
    }}>{busy ? <Spinner /> : <PlusIcon />}{label}</Button>
  )
}

function CiTable({ project, prs, worktrees }: { project: Project; prs: PullRequest[]; worktrees: Wts }) {
  if (!prs.length) return <Empty title="Aucune PR ouverte" />
  return (
    <TableCard>
      <Table>
        <TableHeader><TableRow><TableHead>PR</TableHead><TableHead>Titre</TableHead><TableHead>Type</TableHead><TableHead>État CI</TableHead><TableHead>Jobs en échec</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
        <TableBody>
          {prs.map((p) => {
            const w = worktrees.find((x) => x.prNumber === p.number)
            return (
              <TableRow key={p.number}>
                <TableCell className="font-mono text-[13px] font-medium">#{p.number}</TableCell>
                <TableCell className="min-w-[220px] whitespace-normal font-medium">{p.title}</TableCell>
                <TableCell><Badge tone={p.mine ? 'blue' : 'purple'}>{p.mine ? 'Ma PR' : 'Review'}</Badge></TableCell>
                <TableCell><Badge tone={ciTone(p.ci.state)}>{p.ci.state === 'fail' ? plural(p.ci.failing, 'job en échec', 'jobs en échec') : p.ci.state === 'pass' ? 'CI ok' : p.ci.state === 'running' ? 'En cours' : 'Aucun check'}</Badge></TableCell>
                <TableCell className="max-w-[280px] truncate font-mono text-xs text-muted-foreground">{p.ci.jobs.filter((j) => j.state === 'fail').map((j) => j.name).join(', ') || '—'}</TableCell>
                <TableCell className="text-right">
                  {w ? (
                    <Button variant="outline" size="sm" asChild>
                      <a href={href({ page: 'worktree', project: project.id, wt: w.id, tab: 'ci' })}>Voir les jobs</a>
                    </Button>
                  ) : <CreateReviewWorktree project={project} pr={p} label="Worktree pour analyser" tab="ci" />}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </TableCard>
  )
}
