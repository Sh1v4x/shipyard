import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  BranchInfo, CheckReport, CiJob, CiSummary, DiffFile, DiffLine, DigestInfo, LinearMeta, LocalTicket, PrFiles, Project, ProjectOverview, PullRequest, ReviewThread, SdkStatus,
  Ticket, TicketState, TimelineEvent, TodoCounts, Worktree, WorktreeCleanupInfo, WorktreeDetail, WorktreeStat,
} from '../../shared/types.ts'
import { buildQueue } from '../../shared/queue.ts'
import { DEFAULT_LABEL_RULES, awaitsReview, needsChanges, needsRerequest, needsTesting } from '../../shared/review.ts'
import { ROOT, encodeId } from '../lib/config.ts'
import type { MockData } from '../lib/mock.ts'

// Génère mock/demo.json : un projet de démo dont les PR couvrent les états que l'interface sait afficher
// (CI en échec, commentaires, conflits, fusion en cours, SDK pas à jour, contrôles des bots, reviews à faire, worktrees mergés…).
// pnpm mock pour régénérer, puis SHIPYARD_MOCK=mock/demo.json pnpm dev (ou pnpm dev:mock).

const NOW = Date.now()
const ago = (h: number) => new Date(NOW - h * 3600_000).toISOString()
const ME = 'demo-dev'
const REPO = 'demo-org/ledger-app'
const ROOT_WT = '/Users/demo/worktrees/ledger-app'

const project: Project = {
  id: 'demo',
  name: 'Démo UX',
  repo: REPO,
  path: '/Users/demo/projects/ledger-app',
  team: 'ENG',
  baseBranch: 'develop',
  worktreeRoot: ROOT_WT,
}

// ---------- Briques ----------

const LABEL_COLORS: Record<string, string> = {
  'Change required': 'd93f0b', 'To fix': 'e99695', 'Ready for testing': '0e8a16', 'Waiting review': 'fbca04', 'Review needed': 'fbca04',
  'Rabbit in progress': 'c5def5', 'Review accepted': '0e8a16', bug: 'd73a4a', enhancement: 'a2eeef', dependencies: '0366d6', 'Review in progress': '5319e7',
}
const labels = (...names: string[]) => names.map((name) => ({ name, color: LABEL_COLORS[name] ?? 'ededed' }))

let jobSeq = 1000
function job(name: string, state: CiJob['state'], workflow: string | null = 'CI', duration: string | null = '2m 14s'): CiJob {
  const id = String(jobSeq++)
  return { id, name, workflow, state, url: `https://github.com/${REPO}/actions/runs/88${id}/job/${id}`, runId: `88${id}`, jobId: id, duration: state === 'running' || state === 'pending' ? null : duration }
}
function ci(jobs: CiJob[]): CiSummary {
  const failing = jobs.filter((j) => j.state === 'fail').length
  const running = jobs.some((j) => j.state === 'running' || j.state === 'pending')
  return { state: !jobs.length ? 'none' : failing ? 'fail' : running ? 'running' : 'pass', failing, total: jobs.length, jobs }
}
const greenJobs = () => [
  job('lint', 'pass', 'CI', '48s'), job('typecheck', 'pass', 'CI', '1m 12s'), job('unit-tests', 'pass', 'CI', '3m 41s'),
  job('e2e (chromium)', 'pass', 'E2E', '7m 03s'), job('build', 'pass', 'CI', '2m 30s'), job('CodeRabbit', 'pass', null, null),
]

function pr(p: Partial<PullRequest> & Pick<PullRequest, 'number' | 'title' | 'head' | 'author'>): PullRequest {
  return {
    state: 'OPEN', url: `https://github.com/${REPO}/pull/${p.number}`, base: 'develop', isDraft: false, additions: 120, deletions: 34, changedFiles: 6,
    createdAt: ago(72), updatedAt: ago(3), reviewDecision: null, ticketId: null, ci: ci(greenJobs()), unresolvedThreads: 0, mine: p.author === ME,
    labels: [], reviews: [], requestedReviewers: [], conflicts: false, ...p,
    timeline: p.timeline?.map((e) => (e.type === 'created' ? { ...e, actor: p.author } : e)),
  }
}

function timeline(created: number, ...events: (Omit<TimelineEvent, 'at'> & { h: number })[]): TimelineEvent[] {
  return [{ type: 'created', at: ago(created), actor: null, detail: null }, ...events.map(({ h, ...e }) => ({ ...e, at: ago(h) }))]
}

function wt(branch: string, w: Partial<Worktree> = {}): Worktree {
  const path = `${ROOT_WT}/${branch.replace(/\//g, '-')}`
  return { id: encodeId(path), path, branch, head: [...branch].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16).slice(0, 7), isMain: false, ticketId: null, prNumber: null, kind: 'none', links: [], localTicket: null, ...w }
}

function ticket(id: string, title: string, statusType: Ticket['statusType'], t: Partial<Ticket> = {}): Ticket {
  const status = { backlog: 'Backlog', unstarted: 'Todo', started: 'In Progress', completed: 'Done', canceled: 'Canceled', triage: 'Triage' }[statusType]
  return {
    id, title, description: `## Contexte\n\n${title}.\n\n## Critères d’acceptation\n\n- [ ] Le comportement est couvert par un test\n- [ ] La page reste utilisable sur mobile`,
    status, statusType, priority: 'Medium', assignee: 'Alex', isMine: true, updatedAt: ago(20), url: `https://linear.app/demo/issue/${id}`, labels: [], type: 'feat', ...t,
  }
}

let threadSeq = 1
function thread(path: string, line: number, comments: [author: string, body: string, hoursAgo: number][], t: Partial<ReviewThread> = {}): ReviewThread {
  const id = `PRRT_demo${threadSeq++}`
  return {
    id, path, line, isResolved: false, isOutdated: false, awaitingReviewer: false, isDraft: false, byMe: comments[0][0] === ME, resolvedByMe: false,
    comments: comments.map(([author, body, h], i) => ({ id: `${id}_c${i}`, author, body, createdAt: ago(h), url: `https://github.com/${REPO}/pull/0#discussion_r${threadSeq}${i}` })),
    ...t,
  }
}

/** Diff unifié à partir de lignes préfixées par « + », « - » ou « ␣ ». */
function diff(path: string, start: number, src: string, viewed = false): DiffFile {
  let o = start
  let n = start
  const lines: DiffLine[] = [{ t: '@', o: null, n: null, code: `@@ -${start},12 +${start},14 @@` }]
  for (const raw of src.split('\n')) {
    const t = raw[0] as '+' | '-' | ' '
    const code = raw.slice(1)
    if (t === '+') lines.push({ t, o: null, n: n++, code })
    else if (t === '-') lines.push({ t, o: o++, n: null, code })
    else lines.push({ t: ' ', o: o++, n: n++, code })
  }
  return { path, additions: lines.filter((l) => l.t === '+').length, deletions: lines.filter((l) => l.t === '-').length, viewed, lines, truncated: false }
}

function report(id: string, title: string, status: CheckReport['status'], metrics: CheckReport['metrics'], body: string, r: Partial<CheckReport> = {}): CheckReport {
  return { id, url: `https://github.com/${REPO}/pull/0#issuecomment-${id.length}42`, author: 'github-actions[bot]', title, body, updatedAt: ago(2), status, blocking: null, metrics, command: null, stale: false, ...r }
}

function sdk(s: Partial<SdkStatus> & Pick<SdkStatus, 'name'>): SdkStatus {
  return {
    range: '^1.190.0', locked: '1.195.2', latest: '1.195.2', latestAt: ago(30), sourceRepo: 'demo-org/platform', sourceProject: null, sourceBranch: 'develop', unpublished: [],
    workflow: { file: 'publish-sdk.yml', dispatchable: true },
    lastRun: { status: 'completed', conclusion: 'success', createdAt: ago(31), url: `https://github.com/demo-org/platform/actions/runs/4242`, published: true }, ...s,
  }
}

// ---------- Tickets ----------

const tickets: Ticket[] = [
  ticket('ENG-210', 'Prévision de trésorerie sur le tableau de bord', 'started', { priority: 'High', labels: ['Feature'] }),
  ticket('ENG-214', 'Arrondi de TVA ligne par ligne sur les factures', 'started', { priority: 'Urgent', labels: ['Bug'], type: 'fix' }),
  ticket('ENG-219', 'Export FEC pour les experts-comptables', 'started', { labels: ['Feature'] }),
  ticket('ENG-223', 'Extraire le middleware de session', 'started', { labels: ['refacto'], type: 'refactor' }),
  ticket('ENG-226', 'Barre latérale qui déborde sur petit écran', 'started', { priority: 'Low', labels: ['Bug'], type: 'fix' }),
  ticket('ENG-228', 'Synchronisation Qonto : relancer avec backoff', 'started', { priority: 'High', labels: ['Feature'] }),
  ticket('ENG-231', 'Catégorisation en masse des transactions', 'started', { labels: ['Feature'] }),
  ticket('ENG-198', 'Rapprochement bancaire automatique', 'completed', { labels: ['Feature'] }),
  ticket('ENG-240', 'Rappel par e-mail des factures impayées', 'unstarted', { priority: 'High', labels: ['Feature'] }),
  ticket('ENG-242', 'Dark mode des PDF de devis illisible', 'unstarted', { labels: ['Bug'], type: 'fix' }),
  ticket('ENG-245', 'Pagination de la liste des fournisseurs', 'unstarted', { priority: 'Low', labels: ['Improvement'] }),
  ticket('ENG-250', 'Export comptable au format Sage', 'backlog', { priority: 'Low', labels: ['Feature'] }),
  ticket('ENG-251', 'Refonte de l’onboarding', 'backlog', { priority: 'No priority', labels: ['Improvement'] }),
  ticket('ENG-252', 'Synchronisation Pennylane', 'triage', { assignee: null, isMine: false }),
  ticket('ENG-190', 'Ancien import CSV des banques', 'canceled', { labels: ['Feature'] }),
  ticket('ENG-201', 'Rapport P&L par centre de coût', 'started', { assignee: 'Julie M.', isMine: false }),
  ticket('ENG-205', 'OCR des reçus de plusieurs pages', 'started', { assignee: 'Thomas R.', isMine: false, type: 'fix' }),
]

// ---------- Mes PR ----------

// A : CI en échec, commentaires à traiter, changements demandés, SDK en retard, contrôle qualité en échec.
const prA = pr({
  number: 512, title: 'feat(dashboard): add cash-flow forecast widget', head: 'feat/ENG-210-cash-flow-forecast', author: ME, ticketId: 'ENG-210',
  additions: 642, deletions: 88, changedFiles: 14, createdAt: ago(96), updatedAt: ago(1.5), reviewDecision: 'CHANGES_REQUESTED',
  ci: ci([job('lint', 'fail', 'CI', '52s'), job('typecheck', 'pass', 'CI', '1m 09s'), job('unit-tests', 'fail', 'CI', '4m 02s'), job('e2e (chromium)', 'pass', 'E2E', '6m 48s'), job('build', 'pass', 'CI', '2m 21s'), job('CodeRabbit', 'pass', null, null)]),
  unresolvedThreads: 3, labels: labels('Change required', 'enhancement'),
  reviews: [{ login: 'julie-m', state: 'CHANGES_REQUESTED' }, { login: 'coderabbitai', state: 'COMMENTED' }], requestedReviewers: [],
  timeline: timeline(96,
    { type: 'review_requested', actor: ME, detail: 'julie-m', h: 95 },
    { type: 'review', actor: 'coderabbitai', detail: 'COMMENTED', h: 94 },
    { type: 'review', actor: 'julie-m', detail: 'CHANGES_REQUESTED', h: 26 },
    { type: 'commit', actor: ME, detail: 'fix(dashboard): handle empty forecast', h: 3 },
    { type: 'commit', actor: ME, detail: 'test(dashboard): cover negative balance', h: 1.5 }),
})

// B : conflits avec develop, fusion en cours dans le worktree, base très en avance.
const prB = pr({
  number: 515, title: 'fix(invoices): round VAT per line instead of on the total', head: 'fix/ENG-214-vat-rounding', author: ME, ticketId: 'ENG-214',
  additions: 87, deletions: 41, changedFiles: 5, createdAt: ago(50), updatedAt: ago(5), conflicts: true, labels: labels('bug', 'Review needed'),
  reviews: [], requestedReviewers: ['julie-m', 'thomas-r'],
  timeline: timeline(50, { type: 'review_requested', actor: ME, detail: 'julie-m', h: 49 }, { type: 'review_requested', actor: ME, detail: 'thomas-r', h: 49 }),
})

// C : tout est vert, approuvée, à tester.
const prC = pr({
  number: 518, title: 'feat(export): FEC export for accountants', head: 'feat/ENG-219-fec-export', author: ME, ticketId: 'ENG-219',
  additions: 418, deletions: 12, changedFiles: 9, createdAt: ago(140), updatedAt: ago(8), reviewDecision: 'APPROVED', labels: labels('Ready for testing', 'Review accepted'),
  reviews: [{ login: 'julie-m', state: 'APPROVED' }, { login: 'thomas-r', state: 'APPROVED' }],
  timeline: timeline(140,
    { type: 'review_requested', actor: ME, detail: 'julie-m', h: 139 },
    { type: 'review', actor: 'julie-m', detail: 'CHANGES_REQUESTED', h: 100 },
    { type: 'commit', actor: ME, detail: 'fix(export): escape semicolons in labels', h: 60 },
    { type: 'commit', actor: ME, detail: 'test(export): snapshot FEC file', h: 59 },
    { type: 'review', actor: 'julie-m', detail: 'APPROVED', h: 30 },
    { type: 'review', actor: 'thomas-r', detail: 'APPROVED', h: 8 }),
})

// D : brouillon, CI en cours, CodeRabbit en train de relire.
const prD = pr({
  number: 520, title: 'chore(deps): bump @tanstack/react-query to 5.104', head: 'chore/bump-react-query', author: ME,
  additions: 31, deletions: 29, changedFiles: 4, createdAt: ago(0.6), updatedAt: ago(0.2), isDraft: true, labels: labels('dependencies', 'Rabbit in progress'),
  ci: ci([job('lint', 'pass', 'CI', '45s'), job('typecheck', 'pass', 'CI', '1m 10s'), job('unit-tests', 'running'), job('e2e (chromium)', 'pending', 'E2E'), job('build', 'running'), job('CodeRabbit', 'pending', null)]),
  timeline: timeline(0.6, { type: 'draft', actor: ME, detail: null, h: 0.6 }),
})

// E : commentaires tous répondus, mais le reviewer qui a commenté est à relancer (label « To fix »).
const prE = pr({
  number: 521, title: 'refactor(auth): extract session middleware', head: 'refactor/ENG-223-session-middleware', author: ME, ticketId: 'ENG-223',
  additions: 233, deletions: 198, changedFiles: 11, createdAt: ago(200), updatedAt: ago(18), labels: labels('To fix'),
  reviews: [{ login: 'thomas-r', state: 'COMMENTED' }],
  timeline: timeline(200,
    { type: 'review_requested', actor: ME, detail: 'thomas-r', h: 199 },
    { type: 'review', actor: 'thomas-r', detail: 'COMMENTED', h: 70 },
    { type: 'commit', actor: ME, detail: 'refactor(auth): keep cookie name configurable', h: 20 }),
})

// F : label « à corriger » sans commentaire ouvert (oubli ou modification encore à faire).
const prF = pr({
  number: 523, title: 'fix(ui): sidebar overflows on small screens', head: 'fix/ENG-226-sidebar-overflow', author: ME, ticketId: 'ENG-226',
  additions: 12, deletions: 4, changedFiles: 2, createdAt: ago(30), updatedAt: ago(10), labels: labels('Change required', 'bug'),
  reviews: [{ login: 'julie-m', state: 'APPROVED' }],
  timeline: timeline(30, { type: 'review', actor: 'julie-m', detail: 'APPROVED', h: 10 }),
})

// G : grosse PR, conflits pas encore recalculés, échec d'infrastructure, contrôles en retard sur le dernier commit, SDK non publié.
const prG = pr({
  number: 524, title: 'feat(bank): retry Qonto sync with exponential backoff and surface sync errors in the transactions list', head: 'feat/ENG-228-qonto-backoff', author: ME, ticketId: 'ENG-228',
  additions: 2341, deletions: 870, changedFiles: 58, createdAt: ago(400), updatedAt: ago(0.4), conflictsUnknown: true, labels: labels('enhancement', 'Review needed'),
  ci: ci([...greenJobs().slice(0, 4), job('deploy-preview', 'fail', 'Preview', '12s'), job('build', 'pass', 'CI', '2m 40s')]),
  requestedReviewers: ['julie-m'],
  timeline: timeline(400, { type: 'review_requested', actor: ME, detail: 'julie-m', h: 380 }, { type: 'commit', actor: ME, detail: 'feat(bank): surface sync errors', h: 0.4 }),
})

// ---------- Reviews ----------

// H : review demandée, jamais faite.
const prH = pr({
  number: 498, title: 'feat(reports): P&L by cost center', head: 'feat/ENG-201-pnl-cost-center', author: 'julie-m', ticketId: 'ENG-201',
  additions: 980, deletions: 145, changedFiles: 23, createdAt: ago(52), updatedAt: ago(6), labels: labels('Review needed', 'enhancement'), requestedReviewers: [ME],
  timeline: timeline(52, { type: 'review_requested', actor: 'julie-m', detail: ME, h: 51 }, { type: 'commit', actor: 'julie-m', detail: 'feat(reports): export to xlsx', h: 6 }),
})

// I : déjà reviewée (changements demandés), l'auteur a répondu et remis « Waiting review ». CI en échec.
const prI = pr({
  number: 501, title: 'fix(ocr): handle multi-page receipts', head: 'fix/ENG-205-ocr-multipage', author: 'thomas-r', ticketId: 'ENG-205',
  additions: 164, deletions: 52, changedFiles: 6, createdAt: ago(120), updatedAt: ago(4), labels: labels('Waiting review', 'bug'),
  reviews: [{ login: ME, state: 'CHANGES_REQUESTED' }], reviewDecision: 'CHANGES_REQUESTED',
  ci: ci([job('lint', 'pass', 'CI', '50s'), job('typecheck', 'pass', 'CI', '1m 15s'), job('unit-tests', 'fail', 'CI', '3m 55s'), job('build', 'pass', 'CI', '2m 18s')]),
  timeline: timeline(120,
    { type: 'review_requested', actor: 'thomas-r', detail: ME, h: 119 },
    { type: 'review', actor: ME, detail: 'CHANGES_REQUESTED', h: 48 },
    { type: 'commit', actor: 'thomas-r', detail: 'fix(ocr): merge pages before parsing', h: 5 },
    { type: 'commit', actor: 'thomas-r', detail: 'fix(ocr): keep page order', h: 4 }),
})

// ---------- Worktrees ----------

const wA = wt(prA.head, { kind: 'mine', prNumber: prA.number, ticketId: 'ENG-210' })
const wB = wt(prB.head, { kind: 'mine', prNumber: prB.number, ticketId: 'ENG-214' })
const wC = wt(prC.head, { kind: 'mine', prNumber: prC.number, ticketId: 'ENG-219' })
const wD = wt(prD.head, { kind: 'mine', prNumber: prD.number })
const wE = wt(prE.head, { kind: 'mine', prNumber: prE.number, ticketId: 'ENG-223' })
const wF = wt(prF.head, { kind: 'mine', prNumber: prF.number, ticketId: 'ENG-226' })
const wG = wt(prG.head, { kind: 'mine', prNumber: prG.number, ticketId: 'ENG-228' })
const wH = wt('review/pr-498', { kind: 'review', prNumber: prH.number, ticketId: 'ENG-201' })
const wI = wt('review/pr-501', { kind: 'review', prNumber: prI.number, ticketId: 'ENG-205' })
// Review d'une PR mergée depuis : à nettoyer.
const wJ = wt('review/pr-489', { kind: 'review', prNumber: 489, merged: { number: 489, title: 'feat(vendors): dedupe vendors by SIREN', url: `https://github.com/${REPO}/pull/489`, mergedAt: null, state: 'MERGED' } })
// Branche sans PR : travail commencé, fichiers non commités.
const wK = wt('feat/ENG-231-bulk-categorize', { ticketId: 'ENG-231' })
// Ticket local (proposition gardée sur le Mac).
const localTicket: LocalTicket = {
  project: project.id, path: `${ROOT_WT}/perf-transactions-index`, branch: 'perf/transactions-index', title: 'Index composite sur transactions (account_id, booked_at)', category: 'performance',
  why: 'La liste des transactions fait un seq scan dès 50 000 lignes : 1,8 s en p95 sur les gros comptes.', proposal: 'Ajouter un index composite et réécrire la requête de pagination en keyset.',
  files: ['db/migrations/20261020_transactions_index.sql', 'server/repositories/transactions.ts'], risk: 'Migration longue sur la prod : à lancer en CONCURRENTLY.', createdAt: ago(28),
}
const wL = wt('perf/transactions-index', { localTicket })
// Ma PR mergée : ticket à passer en Done, worktree à supprimer.
const wM = wt('feat/ENG-198-bank-reconciliation', { ticketId: 'ENG-198', merged: { number: 487, title: 'feat(bank): automatic bank reconciliation', url: `https://github.com/${REPO}/pull/487`, mergedAt: ago(30) } })
// Branche d'exploration, sans ticket ni commit.
const wN = wt('spike/pdf-renderer')

const worktrees = [wA, wB, wC, wD, wE, wF, wG, wH, wI, wJ, wK, wL, wM, wN]
const myPrs = [prA, prB, prC, prD, prE, prF, prG]
const reviewPrs = [prH, prI]

/** Mêmes règles que la vue réelle (server/services.ts). */
function todoCounts(): TodoCounts {
  const n = (f: (p: PullRequest) => boolean) => myPrs.filter(f).length
  const c = {
    comments: n((p) => p.unresolvedThreads > 0), todo: tickets.filter((t) => t.isMine && t.statusType === 'unstarted').length,
    reviews: new Set([...reviewPrs.filter((p) => p.requestedReviewers.includes(ME) || awaitsReview(p, DEFAULT_LABEL_RULES)).map((p) => p.number)]).size,
    ci: n((p) => p.ci.failing > 0), rerequest: n((p) => needsRerequest(p, DEFAULT_LABEL_RULES)), testing: n((p) => needsTesting(p, DEFAULT_LABEL_RULES)),
    conflicts: n((p) => p.conflicts), changes: n((p) => needsChanges(p, DEFAULT_LABEL_RULES)),
  }
  return { ...c, total: Object.values(c).reduce((a, b) => a + b, 0) }
}

const overviewBase: Omit<ProjectOverview, 'queue'> = {
  project,
  ghosts: {},
  worktrees,
  tickets,
  myPrs,
  reviewPrs,
  requestedReviews: [prH.number, prI.number],
  todo: todoCounts(),
  linearConfigured: true,
  errors: [],
  fetchedAt: ago(0),
}
const queue = buildQueue(overviewBase, DEFAULT_LABEL_RULES, ME)
const overview: ProjectOverview = { ...overviewBase, todo: { ...overviewBase.todo, total: queue.filter((q) => q.group === 'me').length }, queue }

// ---------- Détail de chaque worktree ----------

const routes: Record<string, unknown> = {}
const base = (w: Worktree) => `/worktrees/${w.id}`

interface WtData {
  detail?: Partial<WorktreeDetail>
  stat?: Partial<WorktreeStat>
  threads?: ReviewThread[]
  files?: DiffFile[]
  checks?: CheckReport[]
  sdk?: SdkStatus[]
  testMemory?: string
}

function addWorktree(w: Worktree, d: WtData = {}) {
  const p = [...myPrs, ...reviewPrs].find((x) => x.number === w.prNumber) ?? null
  const t = tickets.find((x) => x.id === w.ticketId) ?? null
  routes[base(w)] = { project, worktree: w, ticket: t, pr: p, commitsAhead: [], dirtyFiles: [], merge: null, behindBase: 0, behindRemote: 0, remoteAuthors: [], linked: [], tests: { running: false, ai: null, manual: null }, selfReview: null, ...d.detail } satisfies WorktreeDetail
  const files = d.files ?? []
  routes[`${base(w)}/stat`] = {
    branch: w.branch, title: w.kind === 'review' ? (p?.title ?? null) : null, base: p?.base ?? project.baseBranch,
    files: p?.changedFiles ?? files.length, additions: p?.additions ?? 0, deletions: p?.deletions ?? 0, ...d.stat,
  } satisfies WorktreeStat
  routes[`${base(w)}/threads`] = d.threads ?? []
  routes[`${base(w)}/files`] = { prId: `PR_demo${w.prNumber ?? 0}`, files, localDiff: false, threads: d.threads ?? [] } satisfies PrFiles
  routes[`${base(w)}/checks`] = d.checks ?? []
  routes[`${base(w)}/sdk`] = d.sdk ?? [sdk({ name: '@demo-org/sdk' })]
  routes[`${base(w)}/review/pending`] = null
  routes[`${base(w)}/manual-env`] = null
  routes[`${base(w)}/test-memory`] = { text: d.testMemory ?? '' }
}

const forecastDiff = diff('web/src/pages/dashboard/CashFlowForecast.tsx', 1, [
  "+import { useForecast } from '../../data/queries'",
  "+import { Chart } from '../../components/Chart'",
  ' ',
  '+export function CashFlowForecast({ accountId }: { accountId: string }) {',
  '+  const q = useForecast(accountId)',
  '+  if (!q.data) return null',
  '+  const negative = q.data.points.find((p) => p.balance < 0)',
  '+  return (',
  '+    <section className="rounded-xl border p-4">',
  '+      <Chart points={q.data.points} />',
  '+      {negative && <p className="text-red-600">Solde négatif prévu le {negative.date}</p>}',
  '+    </section>',
  '+  )',
  '+}',
].join('\n'))
const serviceDiff = diff('server/services/forecast.ts', 12, [
  ' export async function forecast(accountId: string, days = 90) {',
  '-  const tx = await db.transactions.recent(accountId)',
  '+  const tx = await db.transactions.recent(accountId, { days: 180 })',
  '+  const recurring = detectRecurring(tx)',
  '   const start = await db.accounts.balance(accountId)',
  '-  return project(start, tx, days)',
  '+  return project(start, [...tx, ...recurring], days)',
  ' }',
].join('\n'), true)
const testDiff = diff('server/services/forecast.test.ts', 1, [
  "+import { forecast } from './forecast'",
  ' ',
  "+test('flags a negative balance', async () => {",
  "+  const out = await forecast('acc_1', 30)",
  '+  expect(out.points.some((p) => p.balance < 0)).toBe(true)',
  '+})',
].join('\n'))

addWorktree(wA, {
  detail: { commitsAhead: ['test(dashboard): cover negative balance', 'fix(dashboard): handle empty forecast', 'feat(dashboard): add cash-flow forecast widget'], dirtyFiles: [{ status: 'M', path: 'web/src/pages/dashboard/CashFlowForecast.tsx' }], behindBase: 3 },
  threads: [
    thread('web/src/pages/dashboard/CashFlowForecast.tsx', 11, [['julie-m', 'Le message en rouge seul n’est pas accessible :\n\n- ajoute une icône ou un libellé « Alerte »\n- passe la date au format local (`toLocaleDateString`)\n\nVoir [les règles d’accessibilité](https://www.w3.org/WAI/WCAG21/Understanding/use-of-color.html).', 26]]),
    thread('server/services/forecast.ts', 15, [['coderabbitai', '_⚠️ Potential issue_\n\n**Doublons possibles dans les transactions récurrentes**\n\n`detectRecurring` peut renvoyer des doublons quand une transaction mensuelle tombe un 31 : le solde projeté est faussé.\n\n```suggestion\n  const recurring = dedupeByDate(detectRecurring(tx))\n```\n\n<details>\n<summary>🤖 Prompt for AI Agents</summary>\n\n```\nIn server/services/forecast.ts around line 15, dedupe recurring transactions by date.\n```\n\n</details>\n\n<!-- fingerprinting:phantom:triton:hawk -->', 94]], { code: ['  const recurring = detectRecurring(tx)'] }),
    thread('web/src/pages/dashboard/CashFlowForecast.tsx', 6, [['julie-m', 'Pas de skeleton pendant le chargement ? Le widget saute quand les données arrivent.', 26], [ME, 'Bien vu, je l’ajoute.', 20], ['julie-m', 'Et pense au cas d’erreur aussi 🙏', 19]]),
    thread('server/services/forecast.ts', 12, [['julie-m', '90 jours par défaut, c’est validé avec le produit ?', 25], [ME, 'Oui, cf. ENG-210 : 90 jours, configurable plus tard.', 22]], { isResolved: true, resolvedByMe: false }),
    thread('server/services/forecast.test.ts', 4, [['coderabbitai', 'Ajoute un test pour un compte sans transaction.', 94]], { isOutdated: true, isResolved: true }),
  ],
  files: [forecastDiff, serviceDiff, testDiff],
  checks: [
    report('code-quality-report', 'Code quality', 'fail', [{ label: 'Findings on added lines', value: 4 }, { label: 'Complexité > 15', value: 1 }, { label: 'Duplication', value: 2 }],
      'Oxlint : 3 erreurs sur des lignes ajoutées\nno-unused-vars · server/services/forecast.ts:3\nno-floating-promises · web/src/pages/dashboard/CashFlowForecast.tsx:5\nFallow : forecast() a une complexité cyclomatique de 18 (max 15).', { command: 'pnpm quality --pr 512' }),
    report('env-check', 'Variables d’environnement', 'warn', [{ label: 'Variables manquantes', value: 1 }],
      'FORECAST_HORIZON_DAYS est lue dans server/services/forecast.ts mais absente de .env.example et des secrets de staging.'),
  ],
  sdk: [
    sdk({ name: '@demo-org/sdk', range: '^1.190.0', locked: '1.190.0', latest: '1.195.2', unpublished: ['feat(sdk): add forecast endpoint (#640)', 'fix(sdk): retry on 429 (#644)'], lastRun: { status: 'completed', conclusion: 'success', createdAt: ago(2), url: 'https://github.com/demo-org/platform/actions/runs/4250', published: false } }),
    sdk({ name: '@demo-org/ui-kit', range: '^3.4.0', locked: '3.4.1', latest: '3.4.1', unpublished: ['feat(chart): add area variant (#212)'], workflow: { file: 'release.yml', dispatchable: false }, sourceRepo: 'demo-org/ui-kit', sourceBranch: 'main' }),
  ],
  testMemory: '- Lancer `pnpm db:seed --accounts=3` avant les tests e2e, sinon le tableau de bord est vide.\n- Le compte `demo@ledger.dev` / `demo` a un solde négatif prévu à J+12.',
})

addWorktree(wB, {
  detail: {
    commitsAhead: ['fix(invoices): round VAT per line instead of on the total'], behindBase: 14,
    merge: { base: 'develop', conflicted: ['server/services/invoices.ts', 'server/services/vat.ts', 'web/src/pages/invoices/InvoiceTotals.tsx'], remaining: ['server/services/invoices.ts', 'server/services/vat.ts'] },
    dirtyFiles: [{ status: 'UU', path: 'server/services/invoices.ts' }, { status: 'UU', path: 'server/services/vat.ts' }, { status: 'M', path: 'web/src/pages/invoices/InvoiceTotals.tsx' }],
  },
  files: [diff('server/services/vat.ts', 20, [' export function vatOf(lines: Line[]) {', '-  return round(sum(lines.map((l) => l.net)) * RATE)', '+  return sum(lines.map((l) => round(l.net * l.rate)))', ' }'].join('\n'))],
  checks: [report('code-quality-report', 'Code quality', 'pass', [{ label: 'Findings on added lines', value: 0 }], 'Aucun problème sur les lignes ajoutées.')],
})

addWorktree(wC, {
  files: [diff('server/exports/fec.ts', 1, ["+export function toFec(entries: Entry[]): string {", "+  return entries.map((e) => [e.journal, e.date, e.account, e.label.replaceAll(';', ','), e.debit, e.credit].join(';')).join('\\n')", '+}'].join('\n'), true)],
  threads: [thread('server/exports/fec.ts', 2, [['julie-m', 'Les « ; » dans les libellés vont casser le fichier.', 100], [ME, 'Corrigé dans abc1234.', 60]], { isResolved: true, resolvedByMe: true })],
  checks: [report('code-quality-report', 'Code quality', 'pass', [{ label: 'Findings on added lines', value: 0 }], 'Aucun problème sur les lignes ajoutées.')],
  testMemory: '- L’export FEC se vérifie avec `scripts/check-fec.sh <fichier>` (outil de la DGFiP).',
})

addWorktree(wD, {
  files: [diff('package.json', 18, ['-    "@tanstack/react-query": "5.90.2",', '+    "@tanstack/react-query": "5.104.4",'].join('\n'))],
  checks: [report('code-quality-report', 'Code quality', 'pass', [{ label: 'Findings on added lines', value: 0 }], 'Analyse en cours…', { stale: true, updatedAt: ago(0.5) })],
})

addWorktree(wE, {
  threads: [
    thread('server/middleware/session.ts', 8, [['thomas-r', 'Pourquoi le nom du cookie est codé en dur ?', 70], [ME, 'Rendu configurable dans 9f8e7d6 (SESSION_COOKIE).', 20]], { awaitingReviewer: true }),
    thread('server/middleware/session.ts', 31, [['thomas-r', 'On perd le `secure` en dev, c’est voulu ?', 70], [ME, 'Oui : en local on est en http. En prod c’est forcé par NODE_ENV.', 19]], { awaitingReviewer: true }),
  ],
  files: [diff('server/middleware/session.ts', 1, ["+export const sessionMiddleware = (opts: SessionOptions) => async (c: Context, next: Next) => {", '+  const sid = getCookie(c, opts.cookie ?? SESSION_COOKIE)', '+  c.set(\'session\', sid ? await store.get(sid) : null)', '+  await next()', '+}'].join('\n'))],
})

addWorktree(wF, {
  files: [diff('web/src/components/Sidebar.tsx', 40, ['-    <aside className="w-64">', '+    <aside className="w-64 max-w-full overflow-y-auto">'].join('\n'))],
})

addWorktree(wG, {
  detail: { commitsAhead: Array.from({ length: 23 }, (_, i) => `feat(bank): qonto sync step ${23 - i}`), behindBase: 41 },
  files: [serviceDiff, forecastDiff, testDiff].map((f, i) => ({ ...f, path: f.path.replace('forecast', `qonto-sync-${i}`) })),
  checks: [
    report('code-quality-report', 'Code quality', 'warn', [{ label: 'Findings on added lines', value: 2 }, { label: 'Fichiers > 400 lignes', value: 1 }], 'server/integrations/qonto/sync.ts dépasse 400 lignes.', { stale: true, updatedAt: ago(30) }),
    report('env-check', 'Variables d’environnement', 'fail', [{ label: 'Variables manquantes', value: 2 }], 'QONTO_RETRY_MAX et QONTO_WEBHOOK_SECRET absentes des secrets de staging.', { author: 'env-guard[bot]' }),
  ],
  sdk: [sdk({ name: '@demo-org/sdk', locked: '1.193.0', latest: '1.195.2', unpublished: null, workflow: null, lastRun: null })],
})

addWorktree(wH, {
  files: [forecastDiff, serviceDiff].map((f) => ({ ...f, path: f.path.replace('forecast', 'pnl'), viewed: false })),
  checks: [report('code-quality-report', 'Code quality', 'warn', [{ label: 'Findings on added lines', value: 1 }], 'Une fonction non testée : groupByCostCenter.')],
  sdk: [sdk({ name: '@demo-org/sdk', locked: '1.194.0', latest: '1.195.2' })],
})

addWorktree(wI, {
  threads: [
    // L'auteur a répondu : à moi de trancher.
    thread('server/ocr/receipts.ts', 22, [[ME, 'Les pages sont traitées en parallèle : l’ordre n’est pas garanti, le total peut être lu sur la mauvaise page.', 48], ['thomas-r', 'Corrigé dans « keep page order », les pages sont triées par index avant fusion.', 4]], { byMe: true }),
    thread('server/ocr/receipts.ts', 40, [[ME, 'Un PDF de 200 pages va tout charger en mémoire. Limite à 20 pages ?', 48], ['thomas-r', 'Je préfère ne pas limiter : les relevés annuels font 60 pages. Je stream à la place ?', 4]], { byMe: true }),
    // J'ai relancé, pas encore de réponse.
    thread('server/ocr/receipts.test.ts', 5, [[ME, 'Il manque un test avec une page blanche au milieu.', 48], ['thomas-r', 'Ok', 30], [ME, 'Toujours pas vu le test 🙂', 6]], { byMe: true, awaitingReviewer: true }),
    // Fil d'un autre reviewer.
    thread('server/ocr/receipts.ts', 12, [['coderabbitai', 'Considère `Promise.allSettled` pour ne pas perdre toutes les pages si une seule échoue.', 119]]),
  ],
  files: [diff('server/ocr/receipts.ts', 18, [' export async function parseReceipt(pdf: Buffer) {', '-  const pages = await Promise.all(split(pdf).map(ocr))', '+  const pages = (await Promise.all(split(pdf).map(ocr))).sort((a, b) => a.index - b.index)', '   return merge(pages)', ' }'].join('\n'))],
})

addWorktree(wJ)
addWorktree(wK, {
  detail: {
    commitsAhead: ['feat(transactions): bulk select rows', 'feat(transactions): category picker', 'wip: bulk categorize endpoint'],
    dirtyFiles: [{ status: 'M', path: 'web/src/pages/transactions/BulkBar.tsx' }, { status: 'M', path: 'server/routes/transactions.ts' }, { status: '??', path: 'web/src/pages/transactions/useSelection.ts' }, { status: 'D', path: 'web/src/pages/transactions/OldBulk.tsx' }],
  },
  stat: { files: 6, additions: 214, deletions: 37 },
})
addWorktree(wL, { stat: { files: 0, additions: 0, deletions: 0 } })
addWorktree(wM, { detail: { dirtyFiles: [] } })
addWorktree(wN, { stat: { files: 0, additions: 0, deletions: 0 } })

// ---------- Données du projet ----------

const states: TicketState[] = [
  { id: 's1', name: 'Backlog', type: 'backlog', color: '#bec2c8' }, { id: 's2', name: 'Todo', type: 'unstarted', color: '#e2e2e2' },
  { id: 's3', name: 'In Progress', type: 'started', color: '#f2c94c' }, { id: 's4', name: 'In Review', type: 'started', color: '#5e6ad2' },
  { id: 's5', name: 'Done', type: 'completed', color: '#5e6ad2' }, { id: 's6', name: 'Canceled', type: 'canceled', color: '#95a2b3' },
]
const meta: LinearMeta = {
  teamKey: 'ENG', me: 'Alex',
  members: [{ id: 'u1', name: 'Alex', displayName: 'alex' }, { id: 'u2', name: 'Julie M.', displayName: 'julie' }, { id: 'u3', name: 'Thomas R.', displayName: 'thomas' }],
  labels: ['Feature', 'Bug', 'Improvement', 'refacto', 'tech'].map((name, i) => ({ id: `l${i}`, name })),
  projects: [{ id: 'p1', name: 'Trésorerie' }, { id: 'p2', name: 'Facturation' }], states,
}
const digest: DigestInfo = { path: project.path, mode: 'map', sha: 'a1b2c3d', branch: 'develop', files: 812, excluded: 140, totalTokens: 1_240_000, digestTokens: 38_000, fullPossible: false }

const branch = (name: string, b: Partial<BranchInfo>): BranchInfo => ({
  name, creator: ME, mine: true, local: true, remote: true, lastCommitAt: ago(24), lastCommitSubject: 'wip', ahead: 2, behind: 0, unpushed: 0, worktree: null, dirty: 0, pr: null, suggestion: 'keep', protected: false, ...b,
})
const cleanup = (w: Worktree, c: Partial<WorktreeCleanupInfo>): WorktreeCleanupInfo => ({
  id: w.id, path: w.path, branch: w.branch, kind: w.kind, ticket: null, pr: null, reviewed: null, lastCommitAt: ago(24), dirty: 0, unpushed: 0, suggestion: 'keep', reason: '', ...c,
})

Object.assign(routes, {
  '/overview': overview,
  '/ticket-states': states,
  '/linear/meta': meta,
  '/labels': Object.keys(LABEL_COLORS),
  '/labels/details': Object.entries(LABEL_COLORS).map(([name, color]) => ({ name, color, description: '' })),
  '/digest': digest,
  '/test-memory': { text: '- Les seeds de démo se chargent avec `pnpm db:seed`.\n- Stripe est bouchonné en local : aucune clé à fournir.' },
  '/branches': ['develop', 'main', ...worktrees.map((w) => w.branch!).filter(Boolean), 'feat/old-onboarding', 'fix/ENG-150-typo'],
  '/branches/mine': [
    branch(wM.branch!, { worktree: wM.path, pr: { number: 487, state: 'MERGED', title: wM.merged!.title, url: wM.merged!.url, mergedAt: ago(30) }, suggestion: 'delete-merged', ahead: 0 }),
    branch('feat/old-onboarding', { lastCommitAt: ago(24 * 60), lastCommitSubject: 'feat(onboarding): new stepper', ahead: 6, behind: 312, suggestion: 'stale' }),
    branch('fix/ENG-150-typo', { pr: { number: 455, state: 'CLOSED', title: 'fix: typo in footer', url: `https://github.com/${REPO}/pull/455`, mergedAt: null }, suggestion: 'delete-closed', local: false }),
    branch(wK.branch!, { worktree: wK.path, dirty: 4, unpushed: 3, ahead: 3, remote: false }),
    branch('develop', { protected: true, mine: false, creator: 'julie-m', ahead: 0 }),
  ],
  '/worktrees/cleanup': [
    cleanup(wM, { ticket: { id: 'ENG-198', status: 'Done', done: true }, pr: { number: 487, state: 'MERGED', mine: true, url: wM.merged!.url }, suggestion: 'pr-merged', reason: 'PR #487 mergée il y a 30 h' }),
    cleanup(wJ, { pr: { number: 489, state: 'MERGED', mine: false, url: wJ.merged!.url }, reviewed: true, suggestion: 'review-done', reason: 'Review envoyée, PR mergée' }),
    cleanup(wN, { lastCommitAt: ago(24 * 21), suggestion: 'stale', reason: 'Aucun commit depuis 3 semaines' }),
    cleanup(wK, { ticket: { id: 'ENG-231', status: 'In Progress', done: false }, dirty: 4, unpushed: 3, suggestion: 'keep', reason: 'Travail en cours non poussé' }),
  ],
})

const out: MockData = { generatedAt: new Date(NOW).toISOString(), project, routes }
const file = join(ROOT, 'mock/demo.json')
mkdirSync(dirname(file), { recursive: true })
writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`)
console.log(`${file} : ${worktrees.length} worktrees, ${myPrs.length} PR à moi, ${reviewPrs.length} reviews`)
