import { ArrowUpRightIcon, ChevronRightIcon, ClipboardCheckIcon, GitBranchPlusIcon, MessageCircleQuestionIcon, PlayIcon } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { Project, QuickAssignee, QuickPick, QuickSkipped, QuickTicketsOutput, QuickUrgency, TicketAskOutput } from '../../../shared/types.ts'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label as FieldLabel } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { Markdown } from '../components/Markdown.tsx'
import { useLinearMeta, useProjects } from '../data/queries.ts'
import { useAction } from '../data/runs.ts'
import { go, href } from '../router.ts'
import { Badge, Empty, ErrorBox, Pill, PromptMenu, RunningBadge, RunPanel, SectionLabel, Spinner, plural, type Tone } from '../ui.tsx'

const ANY_LABEL = '__any__'

const URGENCY: { key: QuickUrgency; label: string }[] = [
  { key: 'any', label: 'Peu importe' },
  { key: 'high', label: 'Haute et urgente' },
  { key: 'urgent', label: 'Urgente seulement' },
]

const SIZE: Record<QuickPick['size'], { label: string; tone: Tone }> = {
  XS: { label: 'XS · moins d’une heure', tone: 'green' },
  S: { label: 'S · une à trois heures', tone: 'green' },
  M: { label: 'M · une demi-journée', tone: 'amber' },
  L: { label: 'L · un à deux jours', tone: 'red' },
  XL: { label: 'XL · plus de deux jours', tone: 'red' },
}
const CONFIDENCE: Record<QuickPick['confidence'], Tone> = { forte: 'green', moyenne: 'amber', faible: 'gray' }

/**
 * Tickets rapides : je choisis un projet, un label et une priorité ; un agent examine tous les tickets à démarrer
 * qui correspondent, vérifie les meilleurs candidats dans le code et rend les plus simples à faire.
 */
export function QuickTicketsPage({ project }: { project: Project }) {
  const projects = useProjects()
  const meta = useLinearMeta(project.id, !!project.team)
  const action = useAction<QuickTicketsOutput>('quick-tickets', { project: project.id })
  const [label, setLabel] = useState(ANY_LABEL)
  const [urgency, setUrgency] = useState<QuickUrgency>('any')
  const [assignee, setAssignee] = useState<QuickAssignee>('free')
  const [extra, setExtra] = useState('')

  // Critères de la dernière sélection : le formulaire en repart (après un rechargement, par exemple).
  const last = action.run?.input
  useEffect(() => {
    if (!last) return
    setLabel(last.label || ANY_LABEL)
    setUrgency(last.urgency ?? 'any')
    setAssignee(last.assignee ?? 'free')
    setExtra(last.extra ?? '')
  }, [action.run?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const labels = [...(meta.data?.labels ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  const result = action.result
  const start = () => action.start({ label: label === ANY_LABEL ? undefined : label, urgency, assignee, extra })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Tickets rapides</h1>
          <p className="mt-1 text-sm text-muted-foreground">Un agent lit en entier tous les tickets à démarrer qui correspondent à tes critères, les vérifie dans le code, et te classe les moins longs à faire, même quand aucun n’est petit. Rien n’est modifié.</p>
        </div>
        <PromptMenu items={[['quick-tickets', 'Sélection']]} />
      </div>

      <section className="flex flex-col gap-5 rounded-xl border bg-card p-5">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Projet</span>
          <div className="flex flex-wrap gap-1.5">
            {(projects.data ?? [project]).map((p) => (
              <Pill key={p.id} className="font-mono" active={p.id === project.id} onClick={() => go({ page: 'quick', project: p.id })}>{p.name}</Pill>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{project.team ? `Tickets de l’équipe Linear ${project.team}, jugés d’après le code de ${project.repo}.` : 'Ce projet n’a pas d’équipe Linear : choisis-en un autre, ou lie une équipe au projet.'}</p>
        </div>

        <div className="flex flex-wrap gap-5">
          <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-2">
            <FieldLabel htmlFor="quick-label">Label</FieldLabel>
            <Select value={label} onValueChange={setLabel} disabled={!project.team}>
              <SelectTrigger id="quick-label" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_LABEL}>Tous les labels</SelectItem>
                {/* Label d'une sélection précédente, disparu de Linear depuis : il reste affiché. */}
                {label !== ANY_LABEL && !labels.some((l) => l.name === label) && <SelectItem value={label}>{label}</SelectItem>}
                {labels.map((l) => <SelectItem key={l.id} value={l.name}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {meta.isLoading && <span className="flex items-center gap-2 text-xs text-muted-foreground"><Spinner className="size-3" />Chargement des labels…</span>}
            <ErrorBox error={meta.error} />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Priorité</span>
            <fieldset className="flex flex-wrap gap-1.5" aria-label="Priorité">
              {URGENCY.map((u) => <Pill key={u.key} active={urgency === u.key} onClick={() => setUrgency(u.key)}>{u.label}</Pill>)}
            </fieldset>
          </div>
        </div>

        <div className="flex items-start gap-2.5">
          <Checkbox id="quick-assigned" className="mt-0.5" checked={assignee === 'all'} onCheckedChange={(v) => setAssignee(v === true ? 'all' : 'free')} />
          <div className="flex flex-col gap-0.5">
            <FieldLabel htmlFor="quick-assigned">Inclure les tickets déjà assignés à quelqu’un d’autre</FieldLabel>
            <span className="text-xs text-muted-foreground">Décoché : seulement les tickets sans personne, et les tiens.</span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <FieldLabel htmlFor="quick-extra">Consigne <span className="font-normal text-muted-foreground">(facultatif)</span></FieldLabel>
          <Textarea id="quick-extra" rows={2} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Ex. : seulement le front web, rien qui touche à la base de données, pas plus d’une heure chacun…" />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={action.busy || !project.team} onClick={() => void start()}>{action.busy ? <Spinner /> : <PlayIcon />}Trouver les tickets rapides</Button>
          <span className="text-sm text-muted-foreground">Seuls les tickets pas encore démarrés sont examinés (triage, backlog, à faire), et jamais un ticket bloqué par un ticket pas terminé.</span>
        </div>
        <RunPanel id={action.id} events={action.events} running={action.running} run={action.run} label="L’agent lit les tickets et les vérifie dans le code" onStop={action.stop} action={action} />
      </section>

      {result && !action.busy && <Results project={project} projects={projects.data ?? [project]} result={result} />}
    </div>
  )
}

function Results({ project, projects, result }: { project: Project; projects: Project[]; result: QuickTicketsOutput }) {
  const skipped = result.skipped ?? []
  const blocked = result.blocked ?? []
  // Les bloqueurs les plus fréquents : ce qu'il faut finir pour libérer le plus de tickets.
  const counts = new Map<string, number>()
  for (const b of blocked) for (const x of b.by) counts.set(x, (counts.get(x) ?? 0) + 1)
  const topBlockers = [...counts].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 5)
  return (
    <section className="flex flex-col gap-4" aria-label="Tickets retenus">
      <div className="flex flex-col gap-2 rounded-xl border bg-card p-5">
        <p className="text-sm font-medium">{plural(result.picks.length, 'ticket retenu', 'tickets retenus')} · {skipped.length} pas {skipped.length > 1 ? 'retenus' : 'retenu'} · {blocked.length} {blocked.length > 1 ? 'bloqués' : 'bloqué'} dans Linear</p>
        <p className="text-sm leading-relaxed text-muted-foreground">{result.summary}</p>
      </div>
      <ListTitle tone="green" count={result.picks.length}>Retenus : à démarrer et à finir aujourd’hui</ListTitle>
      {!result.picks.length && <Empty title="Aucun ticket à démarrer">Aucun ne peut être démarré et fini sans attendre autre chose. Les listes ci-dessous disent pourquoi, et tu peux quand même en prendre un.</Empty>}
      {result.picks.map((p, n) => {
        // Le ticket peut relever d'un autre dépôt du même produit : le pre-check et le worktree partent de celui-là.
        const target = projects.find((x) => x.name === p.repo || x.repo === p.repo) ?? project
        return (
          <article key={p.id} className="flex flex-col gap-3 rounded-xl border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="min-w-0 flex-1 font-semibold">
                <span className="mr-2 text-muted-foreground tabular-nums">{n + 1}.</span>
                <a className="font-mono text-[13px] hover:underline" href={p.url} target="_blank" rel="noreferrer">{p.id}</a> {p.title}
              </h3>
              <span className="flex flex-wrap gap-1">
                <Badge tone={SIZE[p.size].tone}>{SIZE[p.size].label}</Badge>
                <Badge tone="gray">{p.effort}</Badge>
                <Badge tone={CONFIDENCE[p.confidence]}>confiance {p.confidence}</Badge>
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span>{p.priority}</span>
              <span aria-hidden>·</span>
              <span className="font-mono">{target.name}</span>
              {p.labels.map((l) => <Badge key={l} tone="gray">{l}</Badge>)}
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">{p.why}</p>
            <p className="text-sm leading-relaxed whitespace-pre-line">{p.approach}</p>
            {p.files.length > 0 && <p className="font-mono text-xs break-all text-muted-foreground">{p.files.join(', ')}</p>}
            {p.risk && <p className="text-sm text-amber-700 dark:text-amber-400">Risque : {p.risk}</p>}
            {(p.unblocks?.length ?? 0) > 0 && <p className="text-xs text-muted-foreground">Le faire débloque : {p.unblocks!.join(', ')}</p>}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" asChild><a href={href({ page: 'precheck', project: target.id, ticket: p.id })}><ClipboardCheckIcon />Pre-check</a></Button>
              <Button size="sm" variant="outline" asChild><a href={href({ page: 'create', project: target.id, ticket: p.id })}><GitBranchPlusIcon />Créer le worktree</a></Button>
              <Button size="sm" variant="ghost" asChild><a href={p.url} target="_blank" rel="noreferrer">Ouvrir dans Linear<ArrowUpRightIcon /></a></Button>
            </div>
            <PickAsk project={target.id} ticketId={p.id} />
          </article>
        )
      })}

      {skipped.length > 0 && (
        <>
          <ListTitle tone="amber" count={skipped.length}>Pas retenus par l’analyse</ListTitle>
          {skipped.map((x) => (
            <OtherTicket key={x.id} project={project.id} id={x.id} title={x.title ?? ''} url={x.url} priority={x.priority}
              badge={<Badge tone={SKIP[x.kind].tone}>{SKIP[x.kind].label}</Badge>}>
              <p className="text-sm leading-relaxed">{x.reason}</p>
              {x.waitsFor.length > 0 && <p className="text-sm text-amber-700 dark:text-amber-400">Attend : {x.waitsFor.join(', ')}</p>}
            </OtherTicket>
          ))}
        </>
      )}

      {blocked.length > 0 && (
        <>
          <ListTitle tone="red" count={blocked.length}>Bloqués dans Linear par un ticket pas terminé</ListTitle>
          <p className="-mt-2 text-sm text-muted-foreground">Écartés avant l’analyse : ils n’ont été ni lus ni estimés. Le ticket qui revient le plus souvent comme bloqueur est celui à faire en premier.</p>
          {topBlockers.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              <span className="text-muted-foreground">Bloquent le plus :</span>
              {topBlockers.map(([name, n]) => <Badge key={name} tone="gray">{name} · {n}</Badge>)}
            </div>
          )}
          {blocked.map((b) => (
            <OtherTicket key={b.id} project={project.id} id={b.id} title={b.title} url={b.url} priority={b.priority} badge={<Badge tone="red">Bloqué</Badge>}>
              <ul className="flex flex-col gap-0.5 text-sm">
                {b.by.map((x) => <li key={x} className="text-amber-700 dark:text-amber-400">Bloqué par {x}</li>)}
              </ul>
            </OtherTicket>
          ))}
        </>
      )}
    </section>
  )
}

const SKIP: Record<QuickSkipped['kind'], { label: string; tone: Tone }> = {
  blocked: { label: 'Attend autre chose', tone: 'amber' },
  long: { label: 'Plus long', tone: 'gray' },
  unclear: { label: 'Besoin flou', tone: 'purple' },
}

const LIST_DOT: Record<'green' | 'amber' | 'red', string> = { green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500' }

function ListTitle({ tone, count, children }: { tone: 'green' | 'amber' | 'red'; count: number; children: ReactNode }) {
  return (
    <h2 className="mt-2 flex items-center gap-2 text-base font-semibold">
      <span className={cn('size-2.5 shrink-0 rounded-full', LIST_DOT[tone])} aria-hidden />
      {children}
      <span className="font-normal text-muted-foreground tabular-nums">· {count}</span>
    </h2>
  )
}

/** Ticket pas retenu ou bloqué : la raison, et de quoi le prendre quand même (pre-check, worktree, question). */
function OtherTicket({ project, id, title, url, priority, badge, children }: { project: string; id: string; title: string; url?: string; priority?: string; badge: ReactNode; children: ReactNode }) {
  const [asking, setAsking] = useState(false)
  return (
    <article className="flex flex-col gap-2.5 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="min-w-0 flex-1 font-medium">
          {url ? <a className="font-mono text-[13px] hover:underline" href={url} target="_blank" rel="noreferrer">{id}</a> : <span className="font-mono text-[13px]">{id}</span>} {title}
        </h3>
        <span className="flex flex-wrap items-center gap-1.5">{priority && <span className="text-xs text-muted-foreground">{priority}</span>}{badge}</span>
      </div>
      {children}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" asChild><a href={href({ page: 'precheck', project, ticket: id })}><ClipboardCheckIcon />Pre-check</a></Button>
        <Button size="sm" variant="ghost" asChild><a href={href({ page: 'create', project, ticket: id })}><GitBranchPlusIcon />Le prendre quand même</a></Button>
        {url && <Button size="sm" variant="ghost" asChild><a href={url} target="_blank" rel="noreferrer">Ouvrir dans Linear<ArrowUpRightIcon /></a></Button>}
        {!asking && <Button size="sm" variant="ghost" onClick={() => setAsking(true)}><MessageCircleQuestionIcon />Poser une question</Button>}
      </div>
      {/* Montée à la demande : ces listes peuvent être longues, et chaque zone de question suit ses propres runs. */}
      {asking && <PickAsk project={project} ticketId={id} defaultOpen />}
    </article>
  )
}

/**
 * Question sur un ticket retenu : l'agent a le ticket entier, ses commentaires et l'analyse de la sélection, et répond
 * d'après le code. Repliée par défaut ; elle s'ouvre d'elle-même quand un agent y travaille ou qu'une réponse existe.
 */
function PickAsk({ project, ticketId, defaultOpen = false }: { project: string; ticketId: string; defaultOpen?: boolean }) {
  const ask = useAction<TicketAskOutput>('ticket-ask', { project, ref: ticketId }, { ticketId })
  const [open, setOpen] = useState(defaultOpen)
  const [text, setText] = useState('')
  const r = ask.result
  useEffect(() => {
    if (ask.working || ask.id) setOpen(true)
  }, [ask.working, ask.id])
  const send = async (previousRunId?: string) => {
    if (!text.trim()) return
    const id = await ask.start({ extra: text.trim(), previousRunId })
    if (id) setText('')
  }
  const followUp = !!r && !!ask.id

  return (
    <div className="flex flex-col gap-3 border-t border-dashed pt-3">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex items-center gap-2 self-start text-sm font-medium text-muted-foreground hover:text-foreground">
        <ChevronRightIcon className={cn('size-4 transition-transform', open && 'rotate-90')} />
        <MessageCircleQuestionIcon className="size-4" />Poser une question sur ce ticket
        {ask.working && <RunningBadge />}
      </button>
      {open && (
        <>
          <RunPanel id={ask.id} events={ask.events} running={ask.running} run={ask.run} label="L’agent lit le ticket et le code pour répondre" onStop={ask.stop} action={ask} />
          {r && !ask.busy && (
            <div className="flex flex-col gap-3">
              {ask.run?.request && (
                <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
                  <SectionLabel>Question</SectionLabel>
                  <p className="whitespace-pre-line">{ask.run.request}</p>
                </div>
              )}
              <Markdown text={r.summary} className="text-[15px] leading-relaxed font-medium" />
              {r.sections.map((sec) => (
                <section key={sec.title} className="flex flex-col gap-1.5">
                  <SectionLabel>{sec.title}</SectionLabel>
                  <Markdown text={sec.body} className="text-sm leading-relaxed" />
                </section>
              ))}
              {r.files.length > 0 && <p className="font-mono text-xs break-all text-muted-foreground">{r.files.join(' · ')}</p>}
            </div>
          )}
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor={`ask-${ticketId}`}>{followUp ? <>Préciser <span className="font-normal text-muted-foreground">(l’agent reprend avec tout le contexte)</span></> : 'Ta question'}</FieldLabel>
            <Textarea id={`ask-${ticketId}`} rows={2} value={text} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send(followUp ? ask.id ?? undefined : undefined) }}
              placeholder={followUp ? 'Ex. : et côté mobile, il y a quelque chose à faire ?' : 'Ex. : qu’est-ce qui existe déjà pour ça ? quelles sont les étapes exactes ? y a-t-il une migration ?'} />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" disabled={!text.trim() || ask.busy} title="⌘ + Entrée" onClick={() => void send(followUp ? ask.id ?? undefined : undefined)}>
                {ask.busy ? <Spinner /> : <MessageCircleQuestionIcon />}{followUp ? 'Continuer l’échange' : 'Poser la question'}
              </Button>
              {followUp && <Button size="sm" variant="ghost" disabled={!text.trim() || ask.busy} title="Sans le contexte de l’échange précédent" onClick={() => void send()}>Nouvelle question</Button>}
              <PromptMenu items={[['ticket-ask', 'Question']]} />
              <span className="text-xs text-muted-foreground">Rien n’est modifié : l’agent lit le ticket et le code.</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
