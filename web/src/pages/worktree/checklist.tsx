import { CheckIcon, CircleIcon, Loader2Icon, MinusIcon, XIcon, type LucideIcon } from 'lucide-react'
import type { CheckReport, LabelRules, PullRequest, ReviewThread, SdkStatus, TestsSummary, WorktreeDetail } from '../../../../shared/types.ts'
import { awaitsReview, needsReviewer, needsTesting, reviewersToRerequest } from '../../../../shared/review.ts'
import { plural } from '../../../../shared/text.ts'
import { cn } from '@/lib/utils'
import { useChecks, useHealth, useLabelRules, useSdkStatus, useThreads, useWorktreeDetail } from '../../data/queries.ts'
import { href } from '../../router.ts'

// Liste « Prête à merger » d'un worktree : calculée ici pour la page du worktree et pour la barre latérale
// (qui ne charge pas la page entière).

/** SDK en retard : version figée plus ancienne que la dernière publiée, ou merges pas encore publiés. */
export const lateSdks = (list: SdkStatus[] | undefined) => (list ?? []).filter((s) => (s.latest && s.locked !== s.latest) || (s.unpublished?.length ?? 0) > 0)

/** Mes fils encore ouverts sur la PR d'un autre. */
export const myOpenThreads = (threads: ReviewThread[] | undefined) => (threads ?? []).filter((t) => t.byMe && !t.isDraft && !t.isResolved)

export type SectionState = 'ok' | 'ko' | 'warn' | 'run' | 'wait' | 'none'
export interface Section { key: string; label: string; state: SectionState; summary: string; group: 'status' | 'work' }

export const STATE_ICON: Record<SectionState, { icon: LucideIcon; className: string }> = {
  ok: { icon: CheckIcon, className: 'bg-emerald-500 text-white' },
  ko: { icon: XIcon, className: 'bg-red-500 text-white' },
  warn: { icon: CircleIcon, className: 'bg-amber-500 text-white [&_svg]:fill-current [&_svg]:size-1.5' },
  run: { icon: Loader2Icon, className: 'bg-blue-500 text-white [&_svg]:animate-spin' },
  wait: { icon: MinusIcon, className: 'bg-muted text-muted-foreground' },
  none: { icon: MinusIcon, className: 'hidden' },
}

export interface PrState {
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
export const testsDone = (t: TestsSummary) =>
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
  if (testsDone(t)) return { ...base, state: 'ok', summary: [t.ai && (t.ai.from ? `IA (via ${t.ai.from})` : 'IA'), manual].filter(Boolean).join(' · ') }
  return { ...base, ...(d.pr && needsTesting(d.pr, rules) ? { state: 'warn', summary: 'à tester' } : { state: 'wait', summary: 'à lancer' }) }
}

/**
 * Ma branche face à sa base et à sa propre version sur GitHub (un collègue a pu y pousser) :
 * fusion en cours, conflits, retard (pas encore récupéré), ou à jour.
 */
function baseSection({ d }: PrState, pr: PullRequest): Section {
  const base = { key: 'conflicts', label: 'À jour', group: 'status' as const }
  if (d.merge) return { ...base, state: 'ko', summary: `${d.merge.remaining.length}/${d.merge.conflicted.length} en conflit` }
  const late = [d.behindRemote > 0 && `branche ${d.behindRemote}`, d.behindBase > 0 && `${pr.base} ${d.behindBase}`].filter(Boolean).join(' · ')
  if (pr.conflicts) return { ...base, state: 'ko', summary: late ? `conflits · ${late}` : 'conflits' }
  if (late) return { ...base, state: 'warn', summary: `en retard : ${late}` }
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

export function buildSections(state: PrState): Section[] {
  const { d, threads, checks, sdk, rules } = state
  const { worktree: w, pr } = d
  const out: Section[] = []
  const late = lateSdks(sdk)
  const sdkState: Section = { key: 'sdk', label: 'SDK', group: 'status', ...(!sdk ? { state: 'wait', summary: '…' } : late.length ? { state: 'warn', summary: late[0].latest && late[0].locked !== late[0].latest ? `${late[0].locked} → ${late[0].latest}` : 'à publier' } : { state: 'ok', summary: sdk.length ? 'à jour' : 'aucun' }) }
  const fresh = (checks ?? []).filter((r) => !r.stale)
  const checksState: Section = {
    key: 'checks', label: 'Contrôles', group: 'status',
    ...(!checks ? { state: 'wait', summary: '…' } : !checks.length ? { state: 'ok', summary: 'aucun' } : fresh.some((r) => r.status === 'fail') ? { state: 'ko', summary: plural(fresh.filter((r) => r.status === 'fail').length, 'échec', 'échecs') } : fresh.some((r) => r.status === 'warn') ? { state: 'warn', summary: 'à regarder' } : fresh.length < checks.length ? { state: 'run', summary: 'en retard' } : { state: 'ok', summary: 'rien à signaler' }),
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
      ...(humans.some((r) => r.state === 'CHANGES_REQUESTED') ? { state: 'ko', summary: 'changements' } : reviewersToRerequest(pr, rules).length ? { state: 'warn', summary: 'à relancer' } : approved ? { state: 'ok', summary: plural(approved, 'approbation', 'approbations') } : pr.requestedReviewers.length ? { state: 'wait', summary: 'en attente' } : needsReviewer(pr, rules) ? { state: 'warn', summary: 'à demander' } : { state: 'wait', summary: 'aucun' }),
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

/** Les données de la liste d'un worktree, et ses points « status ». enabled : la barre latérale ne charge qu'à l'ouverture. */
export function usePrChecklist(project: string, wt: string, enabled = true, poll?: number) {
  const q = useWorktreeDetail(project, wt, enabled, poll)
  const d = q.data
  const hasPr = enabled && !!d?.pr && !d.worktree.merged
  const threads = useThreads(project, wt, hasPr)
  const checks = useChecks(project, wt, hasPr)
  const sdk = useSdkStatus(project, wt, enabled && !!d)
  const rules = useLabelRules()
  const me = useHealth().data?.github ?? null
  const state: PrState | null = d ? { d, partial: q.isPlaceholderData, threads: threads.data, checks: checks.data, sdk: sdk.data, rules, me } : null
  return { state, loading: q.isLoading, status: state ? buildSections(state).filter((s) => s.group === 'status') : [] }
}

/** Pastille d'état d'un point de la liste. */
export function StateDot({ state }: { state: SectionState }) {
  const { icon: StateIcon, className } = STATE_ICON[state]
  return <span className={cn('flex size-4 shrink-0 items-center justify-center rounded-full [&_svg]:size-2.5', className)} aria-hidden><StateIcon strokeWidth={3} /></span>
}

/** Liste compacte (barre latérale) : chaque point mène à son onglet. */
export function ChecklistMini({ project, wt }: { project: string; wt: string }) {
  // Relu chaque minute : la barre latérale reste à jour sans ouvrir le worktree.
  const { status, loading } = usePrChecklist(project, wt, true, 60_000)
  if (loading) return <span className="px-2 py-1 text-xs text-muted-foreground">Chargement…</span>
  if (!status.length) return <span className="px-2 py-1 text-xs text-muted-foreground">Pas de PR ouverte.</span>
  return (
    <div className="flex flex-col">
      {status.map((s) => (
        <a key={s.key} href={href({ page: 'worktree', project, wt, tab: s.key })} className="flex h-6 items-center gap-2 rounded px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
          <span className="scale-90"><StateDot state={s.state} /></span>
          <span className="min-w-0 flex-1 truncate">{s.label}</span>
          {s.summary && <span className="shrink-0 truncate tabular-nums">{s.summary}</span>}
        </a>
      ))}
    </div>
  )
}
