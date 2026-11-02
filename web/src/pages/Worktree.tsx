import { ArrowRightIcon, ArrowUpRightIcon, CheckIcon, ChevronDownIcon, CircleIcon, ClockIcon, CodeIcon, CopyIcon, EllipsisIcon, GhostIcon, GitMergeIcon, Loader2Icon, MinusIcon, PinIcon, PinOffIcon, RotateCcwIcon, Trash2Icon, XIcon, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { LinkTicket } from '../components/LinkTicket.tsx'
import { LabelPicker } from '../components/LabelPicker.tsx'
import { LinkedWorktrees } from '../components/LinkedWorktrees.tsx'
import { MoveWorktree } from '../components/MoveWorktree.tsx'
import { TicketStatus } from '../components/TicketStatus.tsx'
import { PrTimeline } from '../components/PrTimeline.tsx'
import type { CheckReport, LabelRules, Project, PullRequest, ReviewThread, SdkStatus, TestsSummary, Worktree, WorktreeDetail } from '../../../shared/types.ts'
import { useFinishWorktree, useOpenInEditor, useRemoveWorktree, useRerequestReview, useSetGhost, useWakeGhost } from '../data/mutations.ts'
import { usePins } from '../data/pins.ts'
import { useChecks, useHealth, useLabelRules, useProjectOverview, useSdkStatus, useThreads, useWorktreeDetail } from '../data/queries.ts'
import { awaitsReview, labelWithRole, needsChanges, needsTesting } from '../../../shared/review.ts'
import { isStale, since, waitingInfo } from '../../../shared/timeline.ts'
import { go } from '../router.ts'
import { ghostKey } from '../../../shared/queue.ts'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { Avatar, Badge, ErrorBox, Label, Spinner, plural, prReviewBadge, reviewersToRerequest, useToast, worktreeTitle } from '../ui.tsx'
import { CiTab } from './worktree/CiTab.tsx'
import { ChecksTab } from './worktree/ChecksTab.tsx'
import { LogsTab } from './worktree/LogsTab.tsx'
import { CommentsTab } from './worktree/CommentsTab.tsx'
import { ConflictsTab } from './worktree/ConflictsTab.tsx'
import { FilesTab } from './worktree/FilesTab.tsx'
import { FollowupTab, myOpenThreads } from './worktree/FollowupTab.tsx'
import { ReviewTab } from './worktree/ReviewTab.tsx'
import { SdkPanel, lateSdks } from './worktree/SdkPanel.tsx'
import { TestsTab } from './worktree/TestsTab.tsx'
import { TicketTab } from './worktree/TicketTab.tsx'

type SectionState = 'ok' | 'ko' | 'warn' | 'run' | 'wait' | 'none'
interface Section { key: string; label: string; state: SectionState; summary: string; group: 'status' | 'work' }
interface NextStep { tone: 'red' | 'amber' | 'purple' | 'green' | 'gray' | 'blue'; title: string; detail: string | null; tab?: string; url?: string; label?: string }

const STATE_ICON: Record<SectionState, { icon: LucideIcon; className: string }> = {
  ok: { icon: CheckIcon, className: 'bg-emerald-500 text-white' },
  ko: { icon: XIcon, className: 'bg-red-500 text-white' },
  warn: { icon: CircleIcon, className: 'bg-amber-500 text-white [&_svg]:fill-current [&_svg]:size-1.5' },
  run: { icon: Loader2Icon, className: 'bg-blue-500 text-white [&_svg]:animate-spin' },
  wait: { icon: MinusIcon, className: 'bg-muted text-muted-foreground' },
  none: { icon: MinusIcon, className: 'hidden' },
}

const NEXT_TONE: Record<NextStep['tone'], string> = {
  red: 'border-red-500/35 bg-red-500/5',
  amber: 'border-amber-500/40 bg-amber-500/5',
  purple: 'border-violet-500/35 bg-violet-500/5',
  green: 'border-emerald-500/35 bg-emerald-500/5',
  blue: 'border-blue-500/30 bg-blue-500/5',
  gray: 'bg-card',
}

export function WorktreePage({ project, wtId, tab }: { project: Project; wtId: string; tab?: string }) {
  const q = useWorktreeDetail(project.id, wtId)
  const open = useOpenInEditor(project.id, wtId)
  const toast = useToast()
  const rules = useLabelRules()
  const pins = usePins()
  const ghosts = useProjectOverview(project.id).data?.ghosts
  const setGhost = useSetGhost(project.id)
  const wake = useWakeGhost(project.id)
  const [history, setHistory] = useState(false)
  const d = q.data
  const hasPr = !!d?.pr && !d.worktree.merged
  // Fils, contrôles et SDK de la PR : l'état de chaque point de la liste et la prochaine étape.
  const threads = useThreads(project.id, wtId, hasPr)
  const checks = useChecks(project.id, wtId, hasPr)
  const sdk = useSdkStatus(project.id, wtId, !!d)
  const me = useHealth().data?.github ?? null
  // Début de détail tiré de la vue du projet : en-tête tout de suite, contenu à l'arrivée de la vraie réponse.
  const partial = q.isPlaceholderData

  if (q.isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Chargement du worktree…</div>
  if (!d) return <ErrorBox error={q.error ?? 'Worktree introuvable'} />

  const { worktree: w, ticket, pr } = d
  const review = w.kind === 'review' && !!pr
  const state: PrState = { d, partial, threads: threads.data, checks: checks.data, sdk: sdk.data, rules, me }
  const sections = buildSections(state)
  const next = w.merged ? null : nextStep(state)
  const active = sections.some((s) => s.key === tab) ? tab! : next?.tab && sections.some((s) => s.key === next.tab) ? next.tab : sections[0].key
  const status = sections.filter((s) => s.group === 'status')
  const ok = status.filter((s) => s.state === 'ok').length
  const ctx = { project, detail: d, wtId }
  const pinned = pins.isPinned(project.id, wtId)
  const ghostId = ghostKey(pr?.number, wtId)
  const ghost = ghostId ? ghosts?.[ghostId] : undefined
  const toggleGhost = () => {
    if (!ghostId) return
    if (ghost) return wake.mutate(ghostId, { onSuccess: () => toast('Remis dans tes tâches en cours'), onError: (e) => toast(e.message, true) })
    const note = prompt('Mettre de côté (ghost) : pourquoi ? (facultatif)')
    if (note !== null) setGhost.mutate({ key: ghostId, note }, { onSuccess: () => toast('Mis de côté : il ne compte plus dans tes tâches'), onError: (e) => toast(e.message, true) })
  }
  const wait = pr && waitingInfo(pr, me)
  const goTo = (k: string) => go({ page: 'worktree', project: project.id, wt: wtId, tab: k })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start gap-3">
          <h1 className={cn('min-w-0 flex-1 text-xl font-semibold tracking-tight', pr || w.merged ? 'break-words' : 'font-mono break-all')} title={w.path}>{pr && !w.merged ? pr.title : worktreeTitle(w, pr)}</h1>
          <span className="flex flex-wrap items-center gap-1.5">
            {w.kind !== 'review' && !pr && !w.merged && <MoveWorktree project={project} worktree={w} hasWork={d.commitsAhead.length > 0 || d.dirtyFiles.length > 0} />}
            <Button variant="outline" size="sm" onClick={() => open.mutate(undefined, { onError: (e) => toast(e.message, true) })}>
              <CodeIcon />Ouvrir dans l’éditeur
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Plus d’actions"><EllipsisIcon /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {!w.merged && <DropdownMenuItem onSelect={toggleGhost}><GhostIcon />{ghost ? 'Réveiller : remettre dans mes tâches' : 'Mettre de côté (ghost)'}</DropdownMenuItem>}
                <DropdownMenuItem onSelect={() => pins.toggle(project.id, wtId)}>{pinned ? <PinOffIcon /> : <PinIcon />}{pinned ? 'Désépingler' : 'Épingler dans la barre latérale'}</DropdownMenuItem>
                {pr && <DropdownMenuItem asChild><a href={pr.url} target="_blank" rel="noreferrer"><ArrowUpRightIcon />Ouvrir la PR sur GitHub</a></DropdownMenuItem>}
                {ticket && <DropdownMenuItem asChild><a href={ticket.url} target="_blank" rel="noreferrer"><ArrowUpRightIcon />Ouvrir {ticket.id} dans Linear</a></DropdownMenuItem>}
                <DropdownMenuItem onSelect={() => void navigator.clipboard.writeText(w.path).then(() => toast('Chemin copié'))}><CopyIcon />Copier le chemin</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-muted-foreground">
          {pr && (
            <>
              <a className="font-mono text-[13px] font-medium text-foreground hover:underline" href={pr.url} target="_blank" rel="noreferrer">#{pr.number}</a>
              <Badge tone={pr.mine ? 'blue' : 'purple'}>{pr.mine ? 'Ma PR' : `Review · ${pr.author}`}</Badge>
              {ghost && <span title={ghost.note ?? "Mis de côté"}><Badge tone="gray"><GhostIcon className="size-3" />Ghost</Badge></span>}
              {pr.isDraft && <Badge tone="gray">draft</Badge>}
              <span aria-hidden>·</span>
            </>
          )}
          <span className="flex items-center gap-1.5">
            {ticket ? <><a className="font-mono text-[13px] font-medium text-foreground hover:underline" href={ticket.url} target="_blank" rel="noreferrer">{ticket.id}</a><TicketStatus project={project} ticket={ticket} /></> : w.localTicket ? <Badge tone="gray">Ticket local</Badge> : <span>{w.ticketId ?? 'Sans ticket'}</span>}
            <LinkTicket project={project} worktree={w} hasTicket={!!w.ticketId} />
          </span>
          <span aria-hidden>·</span>
          <span className="max-w-full truncate font-mono text-xs" title={w.path}>{w.branch ?? w.head}{pr && ` → ${pr.base}`}</span>
          {pr?.labels.map((l) => <Label key={l.name} {...l} />)}
          {pr?.timeline?.length ? (
            <button type="button" className={cn('ml-auto flex items-center gap-1 text-xs hover:text-foreground', wait && isStale(wait.since) && 'font-medium text-amber-700 dark:text-amber-400')} aria-expanded={history} onClick={() => setHistory(!history)}>
              <ClockIcon className="size-3.5" />{wait ? `${wait.label} depuis ${since(wait.since)}` : 'Historique'}<ChevronDownIcon className={cn('size-3.5 transition-transform', history && 'rotate-180')} />
            </button>
          ) : null}
        </div>
        <LinkedWorktrees project={project} worktree={w} />
      </div>

      {history && pr && <PrTimeline pr={pr} />}

      {w.merged && <FinishBanner project={project} wtId={wtId} merged={w.merged} ticketId={w.ticketId} dirty={d.dirtyFiles.length} review={w.kind === 'review'} />}
      {next && (
        <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border px-4 py-3', NEXT_TONE[next.tone])}>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Prochaine étape</p>
            <p className="font-semibold">{next.title}</p>
            {next.detail && <p className="text-sm text-muted-foreground">{next.detail}</p>}
          </div>
          {next.url && <Button size="sm" asChild><a href={next.url} target="_blank" rel="noreferrer">{next.label}<ArrowUpRightIcon /></a></Button>}
          {!next.url && next.tab && next.label && active !== next.tab && <Button size="sm" onClick={() => goTo(next.tab!)}>{next.label}<ArrowRightIcon /></Button>}
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[232px_minmax(0,1fr)]">
        <nav aria-label="Sections du worktree" className="flex flex-col gap-3 lg:sticky lg:top-20">
          {status.length > 0 && (
            <div className="overflow-hidden rounded-xl border bg-card">
              <div className="flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground">
                <span>{review ? 'Ma review' : 'Prête à merger'}</span>
                <span className="tabular-nums">{ok} / {status.length}</span>
              </div>
              <div className="h-1 bg-muted"><div className="h-full bg-emerald-500 transition-[width]" style={{ width: `${(ok / status.length) * 100}%` }} /></div>
              {status.map((s) => <SectionButton key={s.key} s={s} active={active === s.key} onClick={() => goTo(s.key)} />)}
            </div>
          )}
          <div className="overflow-hidden rounded-xl border bg-card">
            {sections.filter((s) => s.group === 'work').map((s) => <SectionButton key={s.key} s={s} active={active === s.key} onClick={() => goTo(s.key)} />)}
          </div>
        </nav>

        <div className="min-w-0">
          {partial && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Chargement du worktree…</div>}
          {!partial && active === 'ticket' && <TicketTab {...ctx} />}
          {!partial && active === 'files' && <FilesTab {...ctx} />}
          {!partial && active === 'comments' && <CommentsTab {...ctx} />}
          {!partial && active === 'review' && <ReviewTab {...ctx} />}
          {!partial && active === 'followup' && <FollowupTab {...ctx} />}
          {!partial && active === 'tests' && <TestsTab {...ctx} />}
          {!partial && active === 'ci' && <CiTab {...ctx} />}
          {!partial && active === 'checks' && <ChecksTab {...ctx} />}
          {!partial && active === 'sdk' && <SdkPanel {...ctx} />}
          {!partial && active === 'logs' && <LogsTab {...ctx} />}
          {!partial && active === 'reviewers' && pr && <ReviewersBar project={project} wtId={wtId} pr={pr} />}
          {!partial && active === 'conflicts' && <ConflictsTab {...ctx} />}
        </div>
      </div>
    </div>
  )
}

function SectionButton({ s, active, onClick }: { s: Section; active: boolean; onClick: () => void }) {
  const { icon: StateIcon, className } = STATE_ICON[s.state]
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={cn('flex w-full items-center gap-2.5 border-t px-3 py-2 text-left text-sm transition-colors first:border-t-0 hover:bg-accent', active && 'bg-accent font-medium')}
    >
      <span className={cn('flex size-4 shrink-0 items-center justify-center rounded-full [&_svg]:size-2.5', className)} aria-hidden><StateIcon strokeWidth={3} /></span>
      <span className="min-w-0 flex-1 truncate">{s.label}</span>
      {s.summary && <span className="shrink-0 text-xs font-normal text-muted-foreground">{s.summary}</span>}
    </button>
  )
}

interface PrState {
  d: WorktreeDetail
  /** Détail provisoire (tiré de la vue du projet) : tests et auto-review encore inconnus. */
  partial: boolean
  threads: ReviewThread[] | undefined
  checks: CheckReport[] | undefined
  sdk: SdkStatus[] | undefined
  rules: LabelRules
  me: string | null
}

/** Points de la liste de contrôle (status) et sections de travail (work) du worktree, avec leur état. */
const manualDone = (t: TestsSummary) => !!t.manual && t.manual.done === t.manual.total

/**
 * Tests faits : rien en échec, un test manuel commencé est fini, et les points « à vérifier » du test IA
 * sont couverts par ce test manuel.
 */
const testsDone = (t: TestsSummary) =>
  (!!t.ai || !!t.manual) && !t.ai?.failed && (!t.manual || manualDone(t)) && (!t.ai?.toCheck || manualDone(t))

function testsSection({ d, partial, rules }: PrState): Section {
  const t = d.tests
  const base = { key: 'tests', label: 'Tests', group: 'status' as const }
  const manual = t.manual && `manuel ${t.manual.done}/${t.manual.total}`
  if (partial) return { ...base, state: 'wait', summary: '…' }
  if (t.running) return { ...base, state: 'run', summary: 'en cours' }
  if (t.ai?.failed) return { ...base, state: 'ko', summary: `IA : ${plural(t.ai.failed, 'échec', 'échecs')}` }
  if (t.manual && !manualDone(t)) return { ...base, state: 'warn', summary: manual ?? '' }
  if (t.ai?.toCheck && !t.manual) return { ...base, state: 'warn', summary: `IA : ${t.ai.toCheck} à vérifier` }
  if (testsDone(t)) return { ...base, state: 'ok', summary: [t.ai && 'IA', manual].filter(Boolean).join(' · ') }
  return { ...base, ...(d.pr && needsTesting(d.pr, rules) ? { state: 'warn', summary: 'à tester' } : { state: 'wait', summary: 'à lancer' }) }
}

/** Ma branche face à sa base : fusion en cours, conflits, retard (pas encore récupérée), ou à jour. */
function baseSection({ d }: PrState, pr: PullRequest): Section {
  const base = { key: 'conflicts', label: `À jour avec ${pr.base}`, group: 'status' as const }
  if (d.merge) return { ...base, state: 'ko', summary: `${d.merge.remaining.length}/${d.merge.conflicted.length} en conflit` }
  if (pr.conflicts) return { ...base, state: 'ko', summary: 'conflits' }
  if (d.behindBase) return { ...base, state: 'warn', summary: `${d.behindBase} en retard` }
  if (pr.conflictsUnknown) return { ...base, state: 'run', summary: 'en vérification' }
  return { ...base, state: 'ok', summary: 'à jour' }
}

/** Auto-review de ma PR (onglet Fichiers) : à lancer, en cours, remarques à traiter, ou faite. */
function selfReviewSection({ d, partial }: PrState): Section {
  const s = d.selfReview
  const base = { key: 'files', label: 'Self-review', group: 'status' as const }
  if (partial) return { ...base, state: 'wait', summary: '…' }
  if (s?.running) return { ...base, state: 'run', summary: 'en cours' }
  if (!s?.at) return { ...base, state: 'wait', summary: s ? 'à relancer' : 'à lancer' }
  if (s.pending) return { ...base, state: 'warn', summary: plural(s.pending, 'remarque', 'remarques') }
  return { ...base, state: 'ok', summary: s.findings ? 'remarques traitées' : 'rien à signaler' }
}

function buildSections(state: PrState): Section[] {
  const { d, threads, checks, sdk, rules } = state
  const { worktree: w, pr } = d
  const out: Section[] = []
  const late = lateSdks(sdk)
  const sdkState: Section = { key: 'sdk', label: 'SDK', group: 'status', ...(!sdk ? { state: 'wait', summary: '…' } : late.length ? { state: 'warn', summary: late[0].latest && late[0].locked !== late[0].latest ? `${late[0].locked} → ${late[0].latest}` : 'à publier' } : { state: 'ok', summary: sdk.length ? 'à jour' : 'aucun' }) }
  const fresh = (checks ?? []).filter((r) => !r.stale)
  const checksState: Section = {
    key: 'checks', label: 'Contrôles', group: 'status',
    ...(!checks ? { state: 'wait', summary: '…' } : !checks.length ? { state: 'wait', summary: 'aucun' } : fresh.some((r) => r.status === 'fail') ? { state: 'ko', summary: plural(fresh.filter((r) => r.status === 'fail').length, 'échec', 'échecs') } : fresh.some((r) => r.status === 'warn') ? { state: 'warn', summary: 'à regarder' } : fresh.length < checks.length ? { state: 'run', summary: 'en retard' } : { state: 'ok', summary: 'rien à signaler' }),
  }
  const ciState = (p: PullRequest): Section => {
    const jobs = p.ci.jobs.filter((j) => j.state !== 'skipped')
    const passed = jobs.filter((j) => j.state === 'pass').length
    return { key: 'ci', label: 'CI', group: 'status', ...(p.ci.failing ? { state: 'ko', summary: `${p.ci.failing} / ${jobs.length} en échec` } : p.ci.state === 'running' ? { state: 'run', summary: `${passed} / ${jobs.length}` } : p.ci.state === 'pass' ? { state: 'ok', summary: `${passed} / ${jobs.length}` } : { state: 'wait', summary: 'aucun check' }) }
  }
  if (pr && w.kind === 'mine' && !w.merged) {
    out.push(selfReviewSection(state))
    out.push(baseSection(state, pr))
    const open = threads ? threads.filter((t) => !t.isResolved && !t.awaitingReviewer && !t.isDraft).length : pr.unresolvedThreads
    out.push({ key: 'comments', label: 'Commentaires', group: 'status', ...(open ? { state: 'ko', summary: `${open} à traiter` } : { state: 'ok', summary: threads?.length ? `${threads.length} traités` : 'aucun' }) })
    out.push(ciState(pr), sdkState, checksState)
    const humans = pr.reviews.filter((r) => !/\[bot\]$|^coderabbitai$/.test(r.login))
    const approved = humans.filter((r) => r.state === 'APPROVED').length
    out.push({
      key: 'reviewers', label: 'Reviewers', group: 'status',
      ...(humans.some((r) => r.state === 'CHANGES_REQUESTED') ? { state: 'ko', summary: 'changements' } : reviewersToRerequest(pr, rules).length ? { state: 'warn', summary: 'à relancer' } : approved ? { state: 'ok', summary: plural(approved, 'approbation', 'approbations') } : pr.requestedReviewers.length ? { state: 'wait', summary: 'en attente' } : { state: 'wait', summary: 'aucun' }),
    })
    out.push(testsSection(state))
  } else if (pr && w.kind === 'review' && !w.merged) {
    const mineThreads = myOpenThreads(threads)
    out.push({ key: 'review', label: 'Review', group: 'status', ...(awaitsReview(pr, rules) || pr.requestedReviewers.length ? { state: 'warn', summary: 'à faire' } : { state: 'ok', summary: 'rendue' }) })
    if (mineThreads.length || threads?.some((t) => t.byMe && !t.isDraft)) {
      const replies = mineThreads.filter((t) => !t.awaitingReviewer).length
      out.push({ key: 'followup', label: 'Suivi des retours', group: 'status', ...(replies ? { state: 'warn', summary: plural(replies, 'réponse', 'réponses') } : mineThreads.length ? { state: 'wait', summary: `${mineThreads.length} ouverts` } : { state: 'ok', summary: 'tout réglé' }) })
    }
    out.push(ciState(pr), checksState, sdkState, testsSection(state))
  }
  out.push({ key: 'ticket', label: pr ? 'Ticket et commits' : 'Ticket', group: 'work', state: 'none', summary: d.dirtyFiles.length ? plural(d.dirtyFiles.length, 'fichier modifié', 'fichiers modifiés') : '' })
  if (pr && !w.merged && w.kind !== 'mine') out.push({ key: 'files', label: 'Fichiers', group: 'work', state: 'none', summary: String(pr.changedFiles) })
  if (!pr) out.push({ key: 'tests', label: 'Tests', group: 'work', state: 'none', summary: '' })
  out.push({ key: 'logs', label: 'Logs', group: 'work', state: 'none', summary: '' })
  return out
}

/** Ce qui débloque le worktree, dans l'ordre : conflits, commentaires, CI, SDK, contrôles, retard sur la base, auto-review, labels, relance, tests, merge. */
function nextStep({ d, threads, checks, sdk, rules, me }: PrState): NextStep {
  const { worktree: w, pr } = d
  if (pr && w.kind === 'review') {
    const replies = myOpenThreads(threads).filter((t) => !t.awaitingReviewer)
    if (replies.length && awaitsReview(pr, rules)) return { tone: 'purple', title: `${pr.author} a répondu à ${plural(replies.length, 'de tes retours', 'de tes retours')}`, detail: 'Vérifie les correctifs avant de relancer une review complète.', tab: 'followup', label: 'Vérifier les correctifs' }
    if (awaitsReview(pr, rules) || (me && pr.requestedReviewers.includes(me))) return { tone: 'purple', title: `Review demandée par ${pr.author}`, detail: `+${pr.additions} −${pr.deletions} · ${plural(pr.changedFiles, 'fichier', 'fichiers')}`, tab: 'review', label: 'Lancer la review' }
    return { tone: 'gray', title: 'Review rendue', detail: `En attente de ${pr.author}.` }
  }
  if (pr) {
    if (d.merge?.remaining.length) return { tone: 'red', title: `Fusion de ${d.merge.base ?? pr.base} en cours : ${plural(d.merge.remaining.length, 'fichier en conflit', 'fichiers en conflit')}`, detail: d.merge.remaining.join(', '), tab: 'conflicts', label: 'Résoudre les conflits' }
    if (pr.conflicts) return { tone: 'red', title: `Conflits avec ${pr.base}`, detail: d.behindBase ? `${pr.base} a ${plural(d.behindBase, 'commit', 'commits')} d’avance.` : null, tab: 'conflicts', label: 'Résoudre les conflits' }
    const open = threads ? threads.filter((t) => !t.isResolved && !t.awaitingReviewer && !t.isDraft) : []
    const nOpen = threads ? open.length : pr.unresolvedThreads
    const others: string[] = []
    if (pr.ci.failing) others.push(plural(pr.ci.failing, 'job CI en échec', 'jobs CI en échec'))
    if (lateSdks(sdk).length) others.push('SDK à mettre à jour')
    if (nOpen) return { tone: 'amber', title: plural(nOpen, 'commentaire à traiter', 'commentaires à traiter'), detail: [open.length ? `De ${[...new Set(open.map((t) => t.comments[0]?.author))].join(', ')}.` : null, others.length ? `Ensuite : ${others.join(', ')}.` : null].filter(Boolean).join(' ') || null, tab: 'comments', label: 'Traiter les commentaires' }
    if (pr.ci.failing) return { tone: 'red', title: plural(pr.ci.failing, 'job CI en échec', 'jobs CI en échec'), detail: pr.ci.jobs.filter((j) => j.state === 'fail').map((j) => j.name).join(', '), tab: 'ci', label: 'Voir les échecs' }
    const late = lateSdks(sdk)
    if (late.length) return { tone: 'amber', title: `${late[0].name} n’est pas à jour`, detail: late[0].latest && late[0].locked !== late[0].latest ? `Figé en ${late[0].locked}, dernière publiée ${late[0].latest}.` : 'Des merges du SDK ne sont pas encore publiés.', tab: 'sdk', label: 'Mettre à jour' }
    const failing = (checks ?? []).filter((r) => !r.stale && r.status !== 'pass')
    if (failing.length) return { tone: 'amber', title: `Contrôle « ${failing[0].title} » ${failing[0].status === 'fail' ? 'en échec' : 'à regarder'}`, detail: failing.length > 1 ? `Et ${plural(failing.length - 1, 'autre contrôle', 'autres contrôles')}.` : null, tab: 'checks', label: 'Analyser' }
    if (d.behindBase) return { tone: 'amber', title: `${pr.base} a ${plural(d.behindBase, 'commit', 'commits')} d’avance sur la branche`, detail: 'Récupère-les avant de demander une review ou de merger.', tab: 'conflicts', label: `Récupérer ${pr.base}` }
    if (d.selfReview?.pending) return { tone: 'amber', title: plural(d.selfReview.pending, 'remarque d’auto-review à traiter', 'remarques d’auto-review à traiter'), detail: null, tab: 'files', label: 'Voir les remarques' }
    if (needsChanges(pr, rules)) return { tone: 'amber', title: `Label « ${labelWithRole(rules, 'changes', pr.labels)?.name} » sans commentaire ouvert`, detail: 'Une modification est peut-être encore attendue, ou le label est resté.', tab: 'reviewers', label: 'Voir les reviewers' }
    const who = reviewersToRerequest(pr, rules)
    if (who.length) return { tone: 'amber', title: `Commentaires traités : relancer ${who.join(', ')}`, detail: null, tab: 'reviewers', label: 'Relancer la review' }
    if (needsTesting(pr, rules) && !testsDone(d.tests)) return { tone: 'purple', title: 'À tester avant de merger', detail: null, tab: 'tests', label: 'Tester' }
    if (pr.isDraft) return { tone: 'gray', title: 'Brouillon', detail: 'Passe-la en « prête pour review » sur GitHub quand le travail est fini.', url: pr.url, label: 'Ouvrir sur GitHub' }
    if (labelWithRole(rules, 'approved', pr.labels) || pr.reviewDecision === 'APPROVED') return { tone: 'green', title: pr.conflictsUnknown ? 'Approuvée : GitHub vérifie encore les conflits' : 'Prête à merger', detail: null, url: pr.url, label: 'Merger sur GitHub' }
    if (pr.ci.state === 'running') return { tone: 'blue', title: 'CI en cours', detail: null, tab: 'ci', label: 'Suivre la CI' }
    const wait = waitingInfo(pr, me)
    return { tone: 'gray', title: pr.requestedReviewers.length ? `En attente de review de ${pr.requestedReviewers.join(', ')}` : 'En attente', detail: wait ? `${wait.label} depuis ${since(wait.since)}` : null }
  }
  if (d.dirtyFiles.length) return { tone: 'amber', title: plural(d.dirtyFiles.length, 'fichier modifié non commité', 'fichiers modifiés non commités'), detail: d.commitsAhead.length ? `${plural(d.commitsAhead.length, 'commit', 'commits')} déjà sur la branche.` : null, tab: 'ticket', label: 'Commiter' }
  if (d.commitsAhead.length) return { tone: 'blue', title: `${plural(d.commitsAhead.length, 'commit prêt', 'commits prêts')} : ouvrir la PR`, detail: null, tab: 'ticket', label: 'Préparer la PR' }
  return { tone: 'gray', title: w.localTicket || d.ticket ? 'Rien n’est encore commencé sur cette branche' : 'Branche sans ticket', detail: 'Le plan et le travail se lancent depuis le ticket.', tab: 'ticket', label: 'Ouvrir le ticket' }
}

const REVIEW_STATE: Record<string, { label: string; tone: 'green' | 'red' | 'gray' | 'amber' }> = {
  APPROVED: { label: 'a approuvé', tone: 'green' },
  CHANGES_REQUESTED: { label: 'demande des changements', tone: 'red' },
  COMMENTED: { label: 'a commenté', tone: 'gray' },
  DISMISSED: { label: 'review écartée', tone: 'gray' },
  PENDING: { label: 'en cours', tone: 'amber' },
}

/** Labels, état des reviewers, et relance des reviewers qui ont demandé des changements. */
function ReviewersBar({ project, wtId, pr }: { project: Project; wtId: string; pr: PullRequest }) {
  const toast = useToast()
  const rerequest = useRerequestReview(project.id, wtId)
  const busy = rerequest.isPending
  const humans = pr.reviews.filter((r) => !r.login.endsWith('[bot]') && r.login !== 'coderabbitai')
  // Seuls ceux qui ont demandé des changements et dont la review n'est pas déjà redemandée.
  const toRequest = reviewersToRerequest(pr, useLabelRules())
  const rb = prReviewBadge(pr)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* Les labels de l'équipe font foi : le badge GitHub ne s'affiche qu'en leur absence, pour éviter les doublons. */}
        <span className="flex flex-wrap items-center gap-1.5">
          {pr.labels.length ? pr.labels.map((l) => <Label key={l.name} {...l} />) : <Badge tone={rb.tone}>{rb.label}</Badge>}
          <LabelPicker project={project.id} wtId={wtId} pr={pr} />
        </span>
        {[...humans.map((r) => r.login), ...pr.requestedReviewers.filter((r) => !humans.some((h) => h.login === r))].map((login) => {
          const review = humans.find((h) => h.login === login)
          const st = pr.requestedReviewers.includes(login) ? { label: 'review redemandée', tone: 'amber' as const } : REVIEW_STATE[review?.state ?? ''] ?? { label: review?.state ?? '', tone: 'gray' as const }
          return (
            <span key={login} className="flex items-center gap-1.5 text-sm">
              <Avatar login={login} size="sm" />
              {login} <Badge tone={st.tone}>{st.label}</Badge>
            </span>
          )
        })}
      </div>
      {pr.mine && toRequest.length > 0 && (
        <Button size="sm" className="max-w-full" disabled={busy} onClick={() => rerequest.mutate(toRequest, {
          onSuccess: (r) => {
            const labels = [r.removed.length && `retiré : ${r.removed.join(', ')}`, r.added.length && `ajouté : ${r.added.join(', ')}`].filter(Boolean).join(' · ')
            toast(`Review redemandée à ${toRequest.join(', ')}${labels ? ` · labels ${labels}` : ''}`)
          },
          onError: (e) => toast(e.message, true),
        })} title="Relance les reviewers qui ont demandé des changements et passe les labels « à corriger » en « en attente de review »">{busy ? <Spinner /> : <RotateCcwIcon />}<span className="truncate">Re-demander une review à {toRequest.join(', ')}</span></Button>
      )}
    </div>
  )
}

export interface TabProps {
  project: Project
  detail: import('../../../shared/types.ts').WorktreeDetail
  wtId: string
}

/** Ma PR est mergée : « Aboutir le projet » passe le ticket en Done et supprime le worktree. */
function FinishBanner({ project, wtId, merged, ticketId, dirty, review }: { project: Project; wtId: string; merged: NonNullable<Worktree['merged']>; ticketId: string | null; dirty: number; review: boolean }) {
  const finish = useFinishWorktree(project.id)
  const remove = useRemoveWorktree(project.id)
  const toast = useToast()
  const linear = !!project.team && !!ticketId
  const closed = merged.state === 'CLOSED'
  // Review d'une PR mergée (ou fermée) : le ticket appartient à l'auteur, on supprime seulement le worktree.
  if (review) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-500/30 bg-violet-500/5 px-5 py-4">
        <div className="flex min-w-0 flex-1 gap-3">
          <GitMergeIcon className="mt-0.5 size-4 shrink-0 text-violet-600 dark:text-violet-400" />
          <div className="min-w-0">
            <p className="font-medium text-violet-800 dark:text-violet-300">
              <a href={merged.url} target="_blank" rel="noreferrer" className="hover:underline">PR #{merged.number}</a> {closed ? 'fermée sans merge' : 'mergée'} : ta review n’a plus d’objet
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {dirty ? `Il reste ${plural(dirty, 'fichier non commité', 'fichiers non commités')} : annule-les avant de supprimer le worktree.` : 'Le worktree de review peut être supprimé.'}
            </p>
          </div>
        </div>
        <Button size="sm" disabled={remove.isPending || dirty > 0} onClick={() => {
          if (!confirm('Supprimer ce worktree de review ?')) return
          remove.mutate(wtId, {
            onSuccess: () => {
              toast('Worktree supprimé')
              go({ page: 'overview', project: project.id })
            },
            onError: (e) => toast(e.message, true),
          })
        }}>{remove.isPending ? <Spinner /> : <Trash2Icon />}Supprimer le worktree</Button>
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-500/30 bg-violet-500/5 px-5 py-4">
      <div className="flex min-w-0 flex-1 gap-3">
        <GitMergeIcon className="mt-0.5 size-4 shrink-0 text-violet-600 dark:text-violet-400" />
        <div className="min-w-0">
          <p className="font-medium text-violet-800 dark:text-violet-300">
            <a href={merged.url} target="_blank" rel="noreferrer" className="hover:underline">PR #{merged.number}</a> mergée{merged.mergedAt && ` le ${new Date(merged.mergedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {dirty
              ? `Il reste ${plural(dirty, 'fichier non commité', 'fichiers non commités')} : commite-les ou annule-les avant d’aboutir.`
              : `${linear ? `Le ticket ${ticketId} passe en Done et le` : 'Le'} worktree est supprimé. La branche est conservée.`}
          </p>
        </div>
      </div>
      <Button size="sm" disabled={finish.isPending || dirty > 0} onClick={() => {
        if (!confirm(linear ? `Passer ${ticketId} en Done et supprimer ce worktree ?` : 'Supprimer ce worktree ?')) return
        finish.mutate(wtId, {
          onSuccess: (r) => {
            toast(r.ticket ? `${r.ticket.id} passé en ${r.ticket.state} · worktree supprimé` : 'Worktree supprimé')
            go({ page: 'overview', project: project.id })
          },
          onError: (e) => toast(e.message, true),
        })
      }}>{finish.isPending ? <Spinner /> : <GitMergeIcon />}Aboutir le projet</Button>
    </div>
  )
}
