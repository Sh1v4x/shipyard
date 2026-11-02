import { useEffect, useState } from 'react'
import type { CreatedTicket, LinearMeta, NewIssue, Project, TicketDraft, TicketDraftOutput } from '../../../shared/types.ts'
import { ArrowLeftIcon, CheckCircle2Icon, ChevronRightIcon, ExternalLinkIcon, GitBranchIcon, GitBranchPlusIcon, PlusIcon, SendIcon, SparklesIcon, XIcon } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label as FieldLabel } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useCreateLinearIssues, useCreateTicketWorktrees } from '../data/mutations.ts'
import { useCreatedTickets, useLinearMeta, useProjectOverviews, useProjects } from '../data/queries.ts'
import { useAction } from '../data/runs.ts'
import { go, href } from '../router.ts'
import { Badge, ErrorBox, Pill, PromptMenu, RunPanel, Spinner, plural, useToast } from '../ui.tsx'
import { slugify } from '../../../shared/text.ts'

const PRIORITIES = [[0, 'Aucune'], [1, 'Urgente'], [2, 'Haute'], [3, 'Normale'], [4, 'Basse']] as const

/** Réglages Linear d'un ticket, choisis dans l'interface (l'IA ne propose que labels, priorité et projet). */
interface Form {
  include: boolean
  title: string
  description: string
  assigneeId: string | null
  stateId: string | null
  priority: number
  labelIds: string[]
  projectId: string | null
  /** Projets (ids) où créer un worktree pour ce ticket : celui de la page et/ou ses projets liés. */
  repos: string[]
}

/** Petit stockage par navigateur : brouillon de la feature et réglages en cours, pour survivre à un rechargement. */
function useStored<T>(key: string, initial: T): [T, (v: T) => void] {
  const read = (): T => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  }
  const [value, setValue] = useState<T>(read)
  useEffect(() => setValue(read()), [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return [value, (v) => {
    setValue(v)
    try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* stockage indisponible */ }
  }]
}

function defaults(t: TicketDraft, meta: LinearMeta, repos: Project[], main: Project): Form {
  const byName = (name: string) => meta.labels.find((l) => l.name.toLowerCase() === name.toLowerCase())?.id
  const labelIds = [...new Set([t.type, ...t.labels].map(byName).filter((x): x is string => !!x))]
  const todo = meta.states.find((s) => s.type === 'unstarted') ?? meta.states.find((s) => s.type === 'backlog')
  return {
    include: true,
    title: t.title,
    description: t.description,
    assigneeId: meta.me,
    stateId: todo?.id ?? null,
    priority: t.priority,
    labelIds,
    projectId: meta.projects.find((p) => p.name === t.project)?.id ?? null,
    repos: (() => {
      const ids = repos.filter((r) => t.repos?.some((n) => n.toLowerCase() === r.name.toLowerCase())).map((r) => r.id)
      return ids.length ? ids : [main.id]
    })(),
  }
}

export function NewTicketPage({ project }: { project: Project }) {
  const projects = useProjects()
  const draft = useAction<TicketDraftOutput>('ticket-draft', { project: project.id, ref: 'ticket-draft' })
  const meta = useLinearMeta(project.id, !!project.team)
  const created = useCreatedTickets(draft.id)
  const createIssues = useCreateLinearIssues(project.id)
  // Dépôts où une feature peut se développer : ce projet et ceux de son groupe (Réglages › Projets liés).
  const repos = [project, ...(projects.data ?? []).filter((p) => p.id !== project.id && !!project.group && p.group === project.group)]
  const overviews = useProjectOverviews(repos.map((r) => r.id))
  const createWorktrees = useCreateTicketWorktrees(project.id)
  const [feature, setFeature] = useStored(`devpanel:ticket-draft:feature:${project.id}`, '')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState('')
  const [fresh, setFresh] = useState(false)
  const [edits, setEdits] = useStored<Record<number, Form>>(`devpanel:ticket-draft:edits:${draft.id}`, {})
  const busy = createIssues.isPending
  const toast = useToast()

  const out = fresh ? null : draft.result
  const done = created.data ?? []
  // Les réglages modifiés à la main l'emportent ; les champs ajoutés depuis (dépôts) gardent leur valeur proposée.
  const forms = out && meta.data ? out.tickets.map((t, i) => ({ ...defaults(t, meta.data, repos, project), ...edits[i] })) : []
  const edit = (i: number, patch: Partial<Form>) => setEdits({ ...edits, [i]: { ...forms[i], ...patch } })
  const toCreate = forms.map((f, i) => ({ f, i })).filter(({ f, i }) => f.include && !done.some((d) => d.index === i))
  // Ticket créé : ses worktrees (un par dépôt choisi), ou la branche à créer d'après le nom proposé par l'IA (feat/ENG-12-bank-sync).
  const worktreeOf = (repo: string, ticketId: string) => overviews.data.find((o) => o.project.id === repo)?.worktrees.find((w) => w.ticketId === ticketId)?.id ?? null
  const branchOf = (i: number, ticketId: string) => {
    const t = out?.tickets[i]
    return t?.branch ? `${t.type === 'Bug' ? 'fix' : 'feat'}/${ticketId}-${slugify(t.branch)}` : null
  }
  const pendingTickets = done
    .map((d) => ({ ticketId: d.id, branch: branchOf(d.index, d.id), projects: forms[d.index]?.repos ?? [project.id] }))
    .filter((x): x is { ticketId: string; branch: string; projects: string[] } => !!x.branch && x.projects.some((r) => !worktreeOf(r, x.ticketId)))
  const startWorktrees = (tickets: typeof pendingTickets) =>
    createWorktrees.mutate(tickets, {
      onSuccess: (r) => {
        toast(plural(r.length, 'worktree prêt', 'worktrees prêts'))
        // Un seul worktree : on l'ouvre directement.
        if (r.length === 1) go({ page: 'worktree', project: r[0].project, wt: r[0].id })
      },
      onError: (e) => toast(`Création interrompue : ${e.message}`, true),
    })

  const analyse = async () => {
    setFresh(false)
    setAnswers({})
    setNotes('')
    await draft.start({ extra: feature })
  }

  const refine = async () => {
    const lines = (out?.questions ?? []).filter((q) => answers[q.id]?.trim()).map((q) => `- ${q.question} → ${answers[q.id].trim()}`)
    const feedback = [lines.length ? `Answers to the questions:\n${lines.join('\n')}` : '', notes.trim() ? `Other feedback:\n${notes.trim()}` : ''].filter(Boolean).join('\n\n')
    if (!feedback) return toast('Réponds à une question ou ajoute un retour', true)
    const previousRunId = draft.id
    setEdits({})
    setAnswers({})
    setNotes('')
    await draft.start({ extra: feature, feedback, previousRunId })
  }

  const create = () => {
    if (!draft.id) return
    const issues: (NewIssue & { index: number })[] = toCreate.map(({ f, i }) => ({
      index: i, title: f.title.trim(), description: f.description, assigneeId: f.assigneeId, stateId: f.stateId, priority: f.priority, labelIds: f.labelIds, projectId: f.projectId,
    }))
    createIssues.mutate({ runId: draft.id, issues }, {
      onSuccess: (res) => {
        if (res.error) toast(`Création interrompue : ${res.error}`, true)
        else toast(`${plural(issues.length, 'ticket créé', 'tickets créés')} dans Linear`)
      },
      onError: (e) => toast(e.message, true),
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Button variant="ghost" size="sm" className="-ml-2 w-fit text-muted-foreground" onClick={() => history.back()}><ArrowLeftIcon />Retour</Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">Nouveau ticket Linear</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Décris la feature : l’IA explore le projet (code, SDK partagé, features voisines) et rédige des tickets prêts à planifier, avec les fichiers concernés et ce qui est réutilisable. Rien n’est créé dans Linear avant ta validation ; une fois les tickets créés, leur worktree se crée en un clic.
            </p>
          </div>
          <PromptMenu items={[['ticket-draft', 'Rédiger des tickets Linear']]} />
        </div>
      </div>

      <section className="flex flex-col gap-5 rounded-xl border bg-card p-5 shadow-xs">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Projet principal <span className="font-normal text-muted-foreground">(son équipe Linear reçoit les tickets)</span></span>
          <div className="flex flex-wrap gap-2">
            {projects.data?.map((p) => (
              <Pill key={p.id} active={p.id === project.id} className="font-mono" onClick={() => go({ page: 'new-ticket', project: p.id })}>{p.name}</Pill>
            ))}
          </div>
          {!project.team && <p className="text-xs text-red-600 dark:text-red-400">Aucune équipe Linear configurée pour ce projet.</p>}
          <p className="text-xs text-muted-foreground">
            {repos.length > 1
              ? `L’IA explore aussi ${repos.slice(1).map((r) => r.name).join(', ')} (projets liés) : une feature qui touche plusieurs dépôts donne des worktrees dans chacun, liés entre eux.`
              : 'Une feature sur plusieurs dépôts ? Range-les dans un même groupe (Réglages › Projets liés) : l’IA les explorera ensemble.'}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <FieldLabel htmlFor="feature">Feature</FieldLabel>
          <Textarea id="feature" rows={6} className="min-h-32" value={feature} onChange={(e) => setFeature(e.target.value)}
            placeholder="Ex. : permettre à l’utilisateur d’enregistrer ses véhicules et de les choisir dans les indemnités kilométriques, au lieu de ressaisir la plaque." />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={draft.busy || !feature.trim() || !project.team} onClick={analyse}>
            {draft.busy ? <Spinner /> : <SparklesIcon />}{draft.result && !fresh ? 'Relancer l’analyse' : 'Analyser le projet et rédiger'}
          </Button>
          {draft.result && !fresh && <Button variant="outline" onClick={() => { setFresh(true); setFeature('') }}><PlusIcon />Nouveau ticket</Button>}
        </div>
      </section>

      {!fresh && <RunPanel id={draft.id} events={draft.events} running={draft.running} run={draft.run} label="Exploration du projet" onStop={draft.stop} action={draft} />}

      {out && (
        <>
          <p className="text-sm leading-relaxed">{out.summary}</p>

          {out.questions.length > 0 && done.length === 0 && (
            <section className="flex flex-col gap-5 rounded-xl border bg-card p-5 shadow-xs">
              <div>
                <h2 className="font-semibold">Questions</h2>
                <p className="mt-1 text-sm text-muted-foreground">Les tickets ci-dessous suivent l’hypothèse la plus probable. Réponds pour les affiner.</p>
              </div>
              {out.questions.map((q) => (
                <div key={q.id} className="flex flex-col gap-2">
                  <span className="text-sm font-medium">{q.question}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {q.options.map((o) => (
                      <Pill key={o} active={answers[q.id] === o} onClick={() => setAnswers({ ...answers, [q.id]: o })}>{o}</Pill>
                    ))}
                  </div>
                  <Input aria-label={`Réponse libre : ${q.question}`} placeholder="Ou réponds librement…" value={q.options.includes(answers[q.id]) ? '' : answers[q.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />
                </div>
              ))}
              <div className="flex flex-col gap-2">
                <FieldLabel htmlFor="notes">Autres retours</FieldLabel>
                <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex. : un seul ticket suffit, ne touche pas au mobile…" />
              </div>
              <div>
                <Button disabled={draft.busy} onClick={refine}>{draft.busy ? <Spinner /> : <SparklesIcon />}Affiner les tickets</Button>
              </div>
            </section>
          )}

          {out.questions.length === 0 && done.length === 0 && (
            <details className="group rounded-xl border bg-card shadow-xs">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 font-medium [&::-webkit-details-marker]:hidden">
                <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
                Demander des modifications
              </summary>
              <div className="flex flex-col gap-3 border-t px-5 py-4">
                <Textarea aria-label="Retours sur les tickets" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex. : découpe en deux tickets, API puis web…" />
                <div><Button disabled={draft.busy || !notes.trim()} onClick={refine}>{draft.busy ? <Spinner /> : <SparklesIcon />}Affiner les tickets</Button></div>
              </div>
            </details>
          )}

          {meta.isLoading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Chargement des réglages Linear…</div>}
          {meta.error && <ErrorBox error={meta.error} />}

          {meta.data && forms.map((f, i) => {
            const made = done.find((d) => d.index === i)
            return (
              <TicketCard key={i} index={i} total={forms.length} form={f} meta={meta.data!} created={made} onChange={(patch) => edit(i, patch)} repos={repos}
                worktree={made && {
                  repos: f.repos.map((r) => ({ project: repos.find((x) => x.id === r)?.name ?? r, id: worktreeOf(r, made.id), open: (wt: string) => go({ page: 'worktree', project: r, wt }) })),
                  branch: branchOf(i, made.id),
                  customize: href({ page: 'create', project: project.id, ticket: made.id }),
                  busy: createWorktrees.isPending,
                  onCreate: (branch) => startWorktrees([{ ticketId: made.id, branch, projects: f.repos }]),
                }} />
            )
          })}

          {meta.data && forms.length > 0 && (
            <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card/95 p-4 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/80">
              <span className="text-sm text-muted-foreground">
                {toCreate.length ? `${plural(toCreate.length, 'ticket sera créé', 'tickets seront créés')} dans l’équipe ${meta.data.teamKey}.` : done.length ? 'Tous les tickets sont créés.' : 'Aucun ticket sélectionné.'}
              </span>
              {toCreate.length > 0 || pendingTickets.length < 2 ? (
                <Button disabled={busy || draft.busy || toCreate.length === 0 || toCreate.some(({ f }) => !f.title.trim())} onClick={create}>
                  {busy ? <Spinner /> : <SendIcon />}{`Créer ${plural(toCreate.length, 'ticket', 'tickets')} dans Linear`}
                </Button>
              ) : (
                <Button disabled={createWorktrees.isPending} onClick={() => startWorktrees(pendingTickets)}>
                  {createWorktrees.isPending ? <Spinner /> : <GitBranchPlusIcon />}{`Créer les worktrees des ${pendingTickets.length} tickets`}
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

const NONE = '__none'

function CreatedWorktrees({ w }: { w: TicketWorktree }) {
  const missing = w.repos.filter((r) => !r.id)
  return (
    <span className="flex flex-col gap-2">
      <span className="flex flex-wrap items-center gap-2">
        {w.repos.filter((r) => r.id).map((r) => (
          <Button key={r.project} size="sm" variant="outline" onClick={() => r.open(r.id!)}><GitBranchIcon />{w.repos.length > 1 ? `Ouvrir · ${r.project}` : 'Ouvrir le worktree'}</Button>
        ))}
        {missing.length > 0 && (w.branch ? (
          <>
            <Button size="sm" disabled={w.busy} onClick={() => w.onCreate(w.branch!)}>
              {w.busy ? <Spinner /> : <GitBranchPlusIcon />}{w.repos.length > 1 ? `Créer les worktrees · ${missing.map((r) => r.project).join(', ')}` : 'Créer le worktree'}
            </Button>
            <a href={w.customize} className="text-xs font-medium hover:underline">Personnaliser</a>
          </>
        ) : (
          <Button size="sm" variant="outline" asChild><a href={w.customize}><GitBranchPlusIcon />Créer le worktree…</a></Button>
        ))}
      </span>
      {missing.length > 0 && w.branch && (
        <span className="text-xs text-muted-foreground">
          Branche <span className="font-mono">{w.branch}</span>{w.repos.length > 1 && ' dans chaque dépôt, worktrees liés entre eux'}
        </span>
      )}
    </span>
  )
}

/** Après la création du ticket : ses worktrees, un par dépôt choisi, à ouvrir ou à créer en un clic. */
interface TicketWorktree {
  repos: { project: string; id: string | null; open: (wt: string) => void }[]
  /** Branche proposée ; null pour un brouillon rédigé avant les noms de branche (passer par la page complète). */
  branch: string | null
  customize: string
  busy: boolean
  onCreate: (branch: string) => void
}

function TicketCard({ index, total, form: f, meta, created, onChange, worktree, repos }: {
  index: number
  total: number
  form: Form
  meta: LinearMeta
  created?: CreatedTicket
  onChange: (patch: Partial<Form>) => void
  worktree?: TicketWorktree
  repos: Project[]
}) {
  const labels = meta.labels.filter((l) => f.labelIds.includes(l.id))
  const others = meta.labels.filter((l) => !f.labelIds.includes(l.id))
  const id = `t${index}`
  if (created) {
    return (
      <Alert variant="success">
        <CheckCircle2Icon />
        <AlertDescription className="flex flex-col gap-3 text-current">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex flex-wrap items-center gap-2 font-medium"><span className="font-mono">{created.id}</span>{created.title}</span>
            <a href={created.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium hover:underline">Ouvrir dans Linear<ExternalLinkIcon className="size-3.5" /></a>
          </span>
          {worktree && <CreatedWorktrees w={worktree} />}
        </AlertDescription>
      </Alert>
    )
  }
  return (
    <article className={cn('flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-xs transition-opacity', !f.include && 'opacity-55')}>
      <div className="flex items-center justify-between gap-2">
        <span>{total > 1 && <Badge tone="purple">Ticket {index + 1}/{total}</Badge>}</span>
        <FieldLabel className="cursor-pointer font-normal">
          <Checkbox checked={f.include} onCheckedChange={(v) => onChange({ include: v === true })} />Créer ce ticket
        </FieldLabel>
      </div>
      <div className="flex flex-col gap-2">
        <FieldLabel htmlFor={`${id}-title`}>Titre</FieldLabel>
        <Input id={`${id}-title`} value={f.title} onChange={(e) => onChange({ title: e.target.value })} />
      </div>
      {repos.length > 1 && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Dépôts touchés <span className="font-normal text-muted-foreground">(un worktree dans chacun, sur la même branche)</span></span>
          <div className="flex flex-wrap gap-1.5">
            {repos.map((r) => {
              const on = f.repos.includes(r.id)
              return (
                <Pill key={r.id} active={on} className="font-mono" disabled={on && f.repos.length === 1}
                  onClick={() => onChange({ repos: on ? f.repos.filter((x) => x !== r.id) : [...f.repos, r.id] })}>
                  {r.name}
                </Pill>
              )
            })}
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="flex min-w-0 flex-col gap-2">
          <FieldLabel htmlFor={`${id}-assignee`}>Assigné à</FieldLabel>
          <Select value={f.assigneeId ?? NONE} onValueChange={(v) => onChange({ assigneeId: v === NONE ? null : v })}>
            <SelectTrigger id={`${id}-assignee`} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Personne</SelectItem>
              {meta.members.map((m) => <SelectItem key={m.id} value={m.id}>{m.displayName}{m.id === meta.me ? ' (moi)' : ''} · {m.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <FieldLabel htmlFor={`${id}-state`}>Statut</FieldLabel>
          <Select value={f.stateId ?? ''} onValueChange={(v) => onChange({ stateId: v || null })}>
            <SelectTrigger id={`${id}-state`} className="w-full"><SelectValue placeholder="Choisir" /></SelectTrigger>
            <SelectContent>
              {meta.states.filter((s) => s.type !== 'completed' && s.type !== 'canceled' && s.type !== 'duplicate').map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <FieldLabel htmlFor={`${id}-priority`}>Priorité</FieldLabel>
          <Select value={String(f.priority)} onValueChange={(v) => onChange({ priority: Number(v) })}>
            <SelectTrigger id={`${id}-priority`} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRIORITIES.map(([v, l]) => <SelectItem key={v} value={String(v)}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <FieldLabel htmlFor={`${id}-project`}>Projet Linear</FieldLabel>
          <Select value={f.projectId ?? NONE} onValueChange={(v) => onChange({ projectId: v === NONE ? null : v })}>
            <SelectTrigger id={`${id}-project`} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Aucun</SelectItem>
              {meta.projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Labels</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {labels.map((l) => (
            <Pill key={l.id} active aria-label={`Retirer le label ${l.name}`} onClick={() => onChange({ labelIds: f.labelIds.filter((x) => x !== l.id) })}>{l.name}<XIcon className="size-3.5" /></Pill>
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 rounded-full border-dashed" aria-label="Ajouter un label" disabled={!others.length}><PlusIcon />Ajouter un label</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72">
              {others.map((l) => <DropdownMenuItem key={l.id} onSelect={() => onChange({ labelIds: [...f.labelIds, l.id] })}>{l.name}</DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <FieldLabel htmlFor={`${id}-desc`}>Description (Markdown)</FieldLabel>
        <Textarea id={`${id}-desc`} rows={18} className="field-sizing-fixed font-mono text-xs leading-relaxed" value={f.description} onChange={(e) => onChange({ description: e.target.value })} />
      </div>
    </article>
  )
}
