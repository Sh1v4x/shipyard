import type { ActionsBlock, TimelineEvent, CheckState, CiJob, CiSummary, DiffFile, PendingReview, PullRequest, ReviewDraftComment, ReviewEvent, ReviewThread } from '../../shared/types.ts'
import { join } from 'node:path'
import { run, runJson, ttlCache } from './exec.ts'
import { DATA_DIR } from './config.ts'
import { ticketFromBranch } from './git.ts'
import { parseUnifiedDiff } from './diff.ts'

const gh = (args: string[], opts: { cwd?: string; input?: string; timeoutMs?: number } = {}) => run('gh', args, opts)

let meLogin: Promise<string> | null = null
export function me(): Promise<string> {
  meLogin ??= gh(['api', 'user', '--jq', '.login']).then((s) => s.trim())
  return meLogin
}

let meIdentity: Promise<{ login: string; emails: Set<string> }> | null = null
/** Mon pseudo GitHub et toutes les adresses qui signent mes commits (dont l'adresse noreply de GitHub). */
export function identity(): Promise<{ login: string; emails: Set<string> }> {
  meIdentity ??= (async () => {
    const [user, local] = await Promise.all([
      runJson<{ login: string; id: number; email: string | null }>('gh', ['api', 'user']),
      run('git', ['config', '--global', 'user.email']).catch(() => ''),
    ])
    const emails = new Set(
      [user.email, local.trim(), `${user.id}+${user.login}@users.noreply.github.com`, `${user.login}@users.noreply.github.com`]
        .filter((e): e is string => !!e)
        .map((e) => e.toLowerCase()),
    )
    return { login: user.login, emails }
  })()
  return meIdentity
}

async function graphql<T>(query: string, vars: Record<string, string | number>, opts: { timeoutMs?: number } = {}): Promise<T> {
  const args = ['api', 'graphql', '-f', `query=${query}`]
  for (const [k, v] of Object.entries(vars)) args.push(typeof v === 'number' ? '-F' : '-f', `${k}=${v}`)
  const res = JSON.parse(await gh(args, opts)) as { data: T; errors?: { message: string }[] }
  if (res.errors?.length) throw new Error(res.errors.map((e) => e.message).join(' · '))
  return res.data
}

const split = (repo: string) => {
  const [owner, name] = repo.split('/')
  return { owner, name }
}

// ---------- CI ----------

interface RollupItem {
  __typename: 'CheckRun' | 'StatusContext'
  name?: string
  context?: string
  status?: string
  conclusion?: string
  state?: string
  detailsUrl?: string
  targetUrl?: string
  workflowName?: string
  startedAt?: string
  completedAt?: string
}

function checkState(i: RollupItem): CheckState {
  if (i.__typename === 'StatusContext') {
    return i.state === 'SUCCESS' ? 'pass' : i.state === 'PENDING' ? 'running' : 'fail'
  }
  if (i.status && i.status !== 'COMPLETED') return i.status === 'IN_PROGRESS' ? 'running' : 'pending'
  switch (i.conclusion) {
    case 'SUCCESS':
    case 'NEUTRAL':
      return 'pass'
    case 'SKIPPED':
    case 'CANCELLED':
      return 'skipped'
    default:
      return 'fail'
  }
}

function duration(a?: string, b?: string): string | null {
  if (!a || !b || a.startsWith('0001')) return null
  const s = Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000))
  return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`
}

export function ciFromRollup(items: RollupItem[] | null | undefined): CiSummary {
  const jobs: CiJob[] = (items ?? []).map((i, idx) => {
    const url = i.detailsUrl ?? i.targetUrl ?? null
    const m = url?.match(/actions\/runs\/(\d+)\/job\/(\d+)/)
    return {
      id: `${idx}-${i.name ?? i.context}`,
      name: i.name ?? i.context ?? 'check',
      workflow: i.workflowName ?? null,
      state: checkState(i),
      url,
      runId: m?.[1] ?? null,
      jobId: m?.[2] ?? null,
      duration: duration(i.startedAt, i.completedAt),
    }
  })
  const failing = jobs.filter((j) => j.state === 'fail').length
  const running = jobs.some((j) => j.state === 'running' || j.state === 'pending')
  return { state: jobs.length === 0 ? 'none' : failing ? 'fail' : running ? 'running' : 'pass', failing, total: jobs.length, jobs }
}

// ---------- PR ----------

const PR_FIELDS = 'number,title,state,url,author,headRefName,baseRefName,isDraft,additions,deletions,changedFiles,updatedAt,reviewDecision,statusCheckRollup,labels,latestReviews,reviewRequests,mergeable,createdAt'

interface GhPr {
  number: number
  title: string
  state: PullRequest['state']
  url: string
  author: { login: string }
  headRefName: string
  baseRefName: string
  isDraft: boolean
  additions: number
  deletions: number
  changedFiles: number
  createdAt: string
  updatedAt: string
  reviewDecision: string | null
  statusCheckRollup: RollupItem[]
  labels?: { name: string; color: string }[]
  latestReviews?: { author: { login: string } | null; state: PullRequest['reviews'][number]['state'] }[]
  reviewRequests?: { login?: string; name?: string; slug?: string }[]
  /** UNKNOWN tant que GitHub n'a pas fini de calculer. */
  mergeable?: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
}

function toPr(p: GhPr, mine: boolean, unresolved = 0): PullRequest {
  return {
    number: p.number,
    title: p.title,
    state: p.state,
    url: p.url,
    author: p.author?.login ?? '?',
    head: p.headRefName,
    base: p.baseRefName,
    isDraft: p.isDraft,
    additions: p.additions,
    deletions: p.deletions,
    changedFiles: p.changedFiles,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    reviewDecision: p.reviewDecision || null,
    ticketId: ticketFromBranch(p.headRefName) ?? ticketFromBranch(p.title),
    ci: ciFromRollup(p.statusCheckRollup),
    unresolvedThreads: unresolved,
    mine,
    labels: (p.labels ?? []).map((l) => ({ name: l.name, color: l.color })),
    reviews: (p.latestReviews ?? []).filter((r) => r.author).map((r) => ({ login: r.author!.login, state: r.state })),
    requestedReviewers: (p.reviewRequests ?? []).map((r) => r.login ?? r.slug ?? r.name ?? '').filter(Boolean),
    conflicts: p.mergeable === 'CONFLICTING',
    conflictsUnknown: p.mergeable === 'UNKNOWN',
  }
}

const prCache = ttlCache<PullRequest[]>(30_000)

export function myPrs(repo: string, force = false): Promise<PullRequest[]> {
  return prCache.get(
    `mine:${repo}`,
    async () => {
      const list = await runJson<GhPr[]>('gh', ['pr', 'list', '--repo', repo, '--author', '@me', '--state', 'open', '--limit', '50', '--json', PR_FIELDS])
      return Promise.all(list.map(async (p) => toPr(p, true, (await threads(repo, p.number, force)).filter((t) => !t.isResolved && !t.awaitingReviewer).length)))
    },
    force,
  )
}

export function reviewRequested(repo: string, force = false): Promise<PullRequest[]> {
  return prCache.get(
    `review:${repo}`,
    async () => {
      const list = await runJson<GhPr[]>('gh', ['pr', 'list', '--repo', repo, '--search', 'review-requested:@me', '--state', 'open', '--limit', '50', '--json', PR_FIELDS])
      return list.map((p) => toPr(p, false))
    },
    force,
  )
}

// Détail d'une PR, fils et fichiers : mis en cache par PR (clé `<repo>#<num>`), vidés par clearPrCache après une écriture.
const prDetailCache = ttlCache<PullRequest>(30_000)
const threadsCache = ttlCache<ReviewThread[]>(30_000)
const botCommentsCache = ttlCache<BotComments>(30_000)
const filesCache = ttlCache<{ prId: string; files: DiffFile[]; localDiff: boolean }>(60_000)

export function prByNumber(repo: string, num: number, force = false): Promise<PullRequest> {
  return prDetailCache.get(`${repo}#${num}`, async () => {
    const p = await runJson<GhPr>('gh', ['pr', 'view', String(num), '--repo', repo, '--json', PR_FIELDS])
    const login = await me()
    const mine = p.author?.login === login
    return toPr(p, mine, mine ? (await threads(repo, num, force)).filter((t) => !t.isResolved && !t.awaitingReviewer).length : 0)
  }, force)
}

export async function prForBranch(repo: string, branch: string): Promise<PullRequest | null> {
  const list = await runJson<GhPr[]>('gh', ['pr', 'list', '--repo', repo, '--head', branch, '--state', 'open', '--json', PR_FIELDS])
  if (!list[0]) return null
  return prByNumber(repo, list[0].number)
}

const clearListeners: ((repo: string) => void)[] = []
/** Prévenu à chaque écriture sur une PR du dépôt (ex. la vue du projet en cache devient périmée). */
export const onPrCacheClear = (fn: (repo: string) => void) => clearListeners.push(fn)

export function clearPrCache(repo: string) {
  for (const fn of clearListeners) fn(repo)
  prCache.clear(`mine:${repo}`)
  prCache.clear(`review:${repo}`)
  prDetailCache.clear(`${repo}#`)
  threadsCache.clear(`${repo}#`)
  botCommentsCache.clear(`${repo}#`)
  filesCache.clear(`${repo}#`)
}

// ---------- Paquets npm publiés sur GitHub Packages (SDK) ----------

/** Dernière version publiée d'un paquet npm d'une organisation, avec sa date. null si inaccessible. */
export async function packageLatest(org: string, pkg: string): Promise<{ version: string; at: string } | null> {
  const list = await runJson<{ name: string; created_at: string }[]>('gh', ['api', `/orgs/${org}/packages/npm/${encodeURIComponent(pkg)}/versions?per_page=1`]).catch(() => [])
  return list[0] ? { version: list[0].name, at: list[0].created_at } : null
}

/** Dépôt qui publie le paquet (ex. acme/app pour @acme/sdk). */
export async function packageRepo(org: string, pkg: string): Promise<string | null> {
  return (await runJson<{ repository?: { full_name: string } }>('gh', ['api', `/orgs/${org}/packages/npm/${encodeURIComponent(pkg)}`]).catch(() => null))?.repository?.full_name ?? null
}

export interface WorkflowRun { id: number; status: string; conclusion: string | null; event: string; createdAt: string; url: string }

/** Derniers passages d'un workflow (fichier .github/workflows/<file>). */
export async function workflowRuns(repo: string, file: string, limit = 5): Promise<WorkflowRun[]> {
  return runJson<WorkflowRun[]>('gh', ['run', 'list', '--repo', repo, '--workflow', file, '--limit', String(limit), '--json', 'databaseId,status,conclusion,event,createdAt,url', '--jq', 'map({id: .databaseId, status, conclusion, event, createdAt, url})'])
}

/** Lance un workflow à la demande (il doit déclarer workflow_dispatch). */
export async function dispatchWorkflow(repo: string, file: string, ref: string) {
  await gh(['workflow', 'run', file, '--repo', repo, '--ref', ref])
}

/** Jeton de gh : sert aussi à lire GitHub Packages (NODE_AUTH_TOKEN) pour installer un paquet privé. */
export async function authToken(): Promise<string> {
  return (await gh(['auth', 'token'])).trim()
}

// ---------- Blocage de GitHub Actions ----------

const actionsBlockCache = ttlCache<ActionsBlock | null>(5 * 60_000)

/** Message de GitHub quand un job n'est pas lancé pour une raison de compte (facturation, limite de dépenses). */
const ACCOUNT_BLOCK = /payments have failed|spending limit|billing/i

/**
 * GitHub Actions bloqué sur ce dépôt : le dernier run en échec a un job jamais démarré (aucune étape, aucune machine)
 * dont l'annotation donne une raison de compte. null sinon. Mis en cache 5 min.
 */
export function actionsBlock(repo: string, force = false): Promise<ActionsBlock | null> {
  return actionsBlockCache.get(repo, async () => {
    const runs = await runJson<{ workflow_runs: { id: number; conclusion: string | null; created_at: string }[] }>('gh', ['api', `repos/${repo}/actions/runs?per_page=5&status=completed`])
    const failed = runs.workflow_runs.find((r) => r.conclusion === 'failure')
    // Le run le plus récent a réussi : les jobs tournent.
    if (!failed || runs.workflow_runs[0]?.conclusion === 'success') return null
    const { jobs } = await runJson<{ jobs: { id: number; conclusion: string | null; runner_name: string | null; steps?: unknown[] }[] }>('gh', ['api', `repos/${repo}/actions/runs/${failed.id}/jobs`])
    const never = jobs.find((j) => j.conclusion === 'failure' && !j.runner_name && !j.steps?.length)
    if (!never) return null
    const notes = await runJson<{ message: string }[]>('gh', ['api', `repos/${repo}/check-runs/${never.id}/annotations`]).catch(() => [])
    const reason = notes.map((n) => n.message).find((m) => ACCOUNT_BLOCK.test(m))
    return reason ? { owner: split(repo).owner, repo, reason, at: failed.created_at } : null
  }, force)
}

// ---------- Commentaires des bots (rapports de contrôles) ----------

export interface BotComments {
  head: { oid: string; committedAt: string | null }
  comments: { author: string; body: string; updatedAt: string; url: string }[]
}

/** Commentaires de la PR (hors fils de review) postés par des bots, avec le dernier commit pour juger de leur fraîcheur. */
export function botComments(repo: string, num: number, force = false): Promise<BotComments> {
  return botCommentsCache.get(`${repo}#${num}`, async () => {
    const { owner, name } = split(repo)
    const data = await graphql<{ repository: { pullRequest: {
      headRefOid: string
      commits: { nodes: { commit: { committedDate: string } }[] }
      comments: { nodes: { author: { __typename: string; login: string } | null; body: string; updatedAt: string; url: string }[] }
    } } }>(
      `query($owner:String!,$name:String!,$num:Int!){repository(owner:$owner,name:$name){pullRequest(number:$num){headRefOid commits(last:1){nodes{commit{committedDate}}} comments(last:100){nodes{author{__typename login} body updatedAt url}}}}}`,
      { owner, name, num },
    )
    const pr = data.repository.pullRequest
    return {
      head: { oid: pr.headRefOid, committedAt: pr.commits.nodes[0]?.commit.committedDate ?? null },
      comments: pr.comments.nodes.filter((c) => c.author?.__typename === 'Bot').map((c) => ({ author: c.author!.login, body: c.body, updatedAt: c.updatedAt, url: c.url })),
    }
  }, force)
}

// ---------- Fils de discussion ----------

interface ThreadsQuery {
  repository: {
    pullRequest: {
      id: string
      reviewThreads: {
        nodes: {
          id: string
          isResolved: boolean
          resolvedBy: { login: string } | null
          isOutdated: boolean
          path: string
          line: number | null
          originalLine: number | null
          startLine: number | null
          comments: { nodes: { id: string; author: { login: string } | null; body: string; createdAt: string; url: string; state?: string; diffHunk?: string }[] }
        }[]
      }
    }
  }
}

/** Fils de discussion de la PR. force : relit GitHub (les actions IA travaillent toujours sur l'état à jour). */
export function threads(repo: string, num: number, force = false): Promise<ReviewThread[]> {
  return threadsCache.get(`${repo}#${num}`, () => loadThreads(repo, num), force)
}

async function loadThreads(repo: string, num: number): Promise<ReviewThread[]> {
  const { owner, name } = split(repo)
  const data = await graphql<ThreadsQuery>(
    `query($owner:String!,$name:String!,$num:Int!){repository(owner:$owner,name:$name){pullRequest(number:$num){id reviewThreads(first:100){nodes{id isResolved resolvedBy{login} isOutdated path line originalLine startLine comments(first:30){nodes{id author{login} body createdAt url state diffHunk}}}}}}}`,
    { owner, name, num },
  )
  const login = await me()
  return data.repository.pullRequest.reviewThreads.nodes.map((t) => ({
    id: t.id,
    path: t.path,
    line: t.line ?? t.originalLine,
    isResolved: t.isResolved,
    isOutdated: t.isOutdated,
    awaitingReviewer: t.comments.nodes.at(-1)?.author?.login === login,
    isDraft: t.comments.nodes[0]?.state === 'PENDING',
    byMe: t.comments.nodes[0]?.author?.login === login,
    resolvedByMe: t.isResolved && t.resolvedBy?.login === login,
    code: commentedLines(t.comments.nodes[0]?.diffHunk, t.line && t.startLine ? t.line - t.startLine + 1 : 1),
    comments: t.comments.nodes.map((c) => ({ id: c.id, author: c.author?.login ?? '?', body: c.body, createdAt: c.createdAt, url: c.url })),
  }))
}

/** Lignes commentées, côté PR : la fin du diff du commentaire, sans les lignes supprimées. */
function commentedLines(hunk: string | undefined, count: number): string[] | undefined {
  if (!hunk) return undefined
  const right = hunk.split('\n').filter((l) => !l.startsWith('@@') && !l.startsWith('-'))
  return right.slice(-count).map((l) => l.slice(1))
}

/** Répond dans le fil (sauf corps vide : résout seulement) et le résout si demandé. */
export async function replyToThread(threadId: string, body: string, resolve: boolean) {
  if (body.trim()) await graphql(`mutation($id:ID!,$body:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$id,body:$body}){comment{id}}}`, { id: threadId, body })
  if (resolve) await graphql(`mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{id}}}`, { id: threadId })
  threadsCache.clear()
}

// ---------- Diff et fichiers vus ----------

interface FilesQuery {
  repository: {
    pullRequest: {
      id: string
      files: { nodes: { path: string; additions: number; deletions: number; viewerViewedState: string }[]; pageInfo?: { hasNextPage: boolean; endCursor: string } }
    }
  }
}

const MAX_LINES_PER_FILE = 1500

/** Où calculer le diff en local quand GitHub refuse de le fournir (PR de plus de 300 fichiers). */
export interface LocalDiff {
  cwd: string
  base: string
}

/**
 * Diff d'une PR calculé avec git, sans limite de taille : la tête de la PR est récupérée depuis GitHub
 * (refs/pull/N/head) puis comparée à la base, comme le fait GitHub.
 */
export async function localPrDiff(num: number, local: LocalDiff): Promise<string> {
  const ref = `refs/devpanel/pr-${num}`
  await run('git', ['fetch', 'origin', `+refs/pull/${num}/head:${ref}`, local.base], { cwd: local.cwd, timeoutMs: 300_000 })
  return run('git', ['diff', '--no-color', '--no-ext-diff', `origin/${local.base}...${ref}`], { cwd: local.cwd, timeoutMs: 300_000 })
}

const TOO_LARGE = /too_large|exceeded the maximum|HTTP 406/i

/** Diff de la PR : GitHub d'abord, puis git en local si la PR est trop grosse pour l'API. */
export async function prDiffText(repo: string, num: number, local?: LocalDiff): Promise<string> {
  try {
    return await gh(['pr', 'diff', String(num), '--repo', repo], { timeoutMs: 120_000 })
  } catch (e) {
    if (!local || !TOO_LARGE.test((e as Error).message)) throw e
    return localPrDiff(num, local)
  }
}

/** Fichiers de la PR (paginés : au-delà de 100) avec leur état « vu » sur GitHub. */
async function prFileList(repo: string, num: number): Promise<{ prId: string; nodes: FilesQuery['repository']['pullRequest']['files']['nodes'] }> {
  const { owner, name } = split(repo)
  const nodes: FilesQuery['repository']['pullRequest']['files']['nodes'] = []
  let after = ''
  let prId = ''
  for (let page = 0; page < 40; page++) {
    const data = await graphql<FilesQuery>(
      `query($owner:String!,$name:String!,$num:Int!,$after:String){repository(owner:$owner,name:$name){pullRequest(number:$num){id files(first:100,after:$after){nodes{path additions deletions viewerViewedState} pageInfo{hasNextPage endCursor}}}}}`,
      after ? { owner, name, num, after } : { owner, name, num },
    )
    const pr = data.repository.pullRequest
    prId = pr.id
    nodes.push(...pr.files.nodes)
    if (!pr.files.pageInfo?.hasNextPage) break
    after = pr.files.pageInfo.endCursor
  }
  return { prId, nodes }
}

export function prFiles(repo: string, num: number, local?: LocalDiff, force = false): Promise<{ prId: string; files: DiffFile[]; localDiff: boolean }> {
  return filesCache.get(`${repo}#${num}`, () => loadPrFiles(repo, num, local), force)
}

async function loadPrFiles(repo: string, num: number, local?: LocalDiff): Promise<{ prId: string; files: DiffFile[]; localDiff: boolean }> {
  const [meta, diff] = await Promise.all([
    prFileList(repo, num),
    gh(['pr', 'diff', String(num), '--repo', repo], { timeoutMs: 120_000 })
      .then((d) => ({ d, local: false }))
      .catch(async (e: Error) => {
        if (!TOO_LARGE.test(e.message)) throw e
        // Sans emplacement local, on garde la liste des fichiers, sans le détail des lignes.
        return local ? { d: await localPrDiff(num, local), local: true } : { d: '', local: false }
      }),
  ])
  const parsed = parseUnifiedDiff(diff.d)
  return {
    prId: meta.prId,
    localDiff: diff.local,
    files: meta.nodes.map((f) => {
      const all = parsed.get(f.path) ?? []
      return {
        path: f.path,
        additions: f.additions,
        deletions: f.deletions,
        viewed: f.viewerViewedState === 'VIEWED',
        lines: all.slice(0, MAX_LINES_PER_FILE),
        truncated: all.length > MAX_LINES_PER_FILE,
      }
    }),
  }
}

export async function setViewed(prId: string, path: string, viewed: boolean) {
  const m = viewed ? 'markFileAsViewed' : 'unmarkFileAsViewed'
  await graphql(`mutation($id:ID!,$path:String!){${m}(input:{pullRequestId:$id,path:$path}){clientMutationId}}`, { id: prId, path })
  // Met à jour la liste en cache plutôt que de la recharger (le diff ne change pas).
  for (const entry of filesCache.values()) {
    const list = await entry.catch(() => null)
    const f = list?.prId === prId ? list.files.find((x) => x.path === path) : undefined
    if (f) f.viewed = viewed
  }
}


export async function prCommits(repo: string, num: number): Promise<string[]> {
  const out = await gh(['pr', 'view', String(num), '--repo', repo, '--json', 'commits', '--jq', '.commits[].messageHeadline'])
  return out.split('\n').filter(Boolean)
}

interface ReviewHistoryQuery {
  repository: {
    pullRequest: {
      headRefOid: string
      reviews: { nodes: { submittedAt: string | null; commit: { oid: string } | null }[] }
      commits: { nodes: { commit: { oid: string; messageHeadline: string; parents: { totalCount: number } } }[] }
    }
  }
}

/** Ma dernière review envoyée sur la PR et les commits de l'auteur poussés depuis (merges exclus). */
export async function reviewHistory(repo: string, num: number) {
  const { owner, name } = split(repo)
  const login = await me()
  const data = await graphql<ReviewHistoryQuery>(
    `query($owner:String!,$name:String!,$num:Int!,$login:String!){repository(owner:$owner,name:$name){pullRequest(number:$num){headRefOid reviews(last:50,author:$login){nodes{submittedAt commit{oid}}} commits(last:250){nodes{commit{oid messageHeadline parents{totalCount}}}}}}}`,
    { owner, name, num, login },
  )
  const pr = data.repository.pullRequest
  const last = pr.reviews.nodes.filter((r) => r.submittedAt && r.commit).at(-1)
  const commits = pr.commits.nodes.map((n) => n.commit)
  const at = last ? commits.findIndex((c) => c.oid === last.commit!.oid) : -1
  return {
    head: pr.headRefOid,
    lastReview: last ? { sha: last.commit!.oid, at: last.submittedAt! } : null,
    /** false si le commit de ma review n'est plus dans la branche (force-push, rebase). */
    refFound: at >= 0,
    since: at >= 0 ? commits.slice(at + 1).filter((c) => c.parents.totalCount < 2).map((c) => ({ sha: c.oid, message: c.messageHeadline })) : [],
  }
}

/** Patchs d'un commit, fichier par fichier. */
export async function commitPatches(repo: string, sha: string): Promise<{ filename: string; patch?: string }[]> {
  return (await runJson<{ files: { filename: string; patch?: string }[] }>('gh', ['api', `repos/${repo}/commits/${sha}`])).files
}

/** Patchs entre deux commits (utilisé quand la branche a été réécrite). */
export async function comparePatches(repo: string, base: string, head: string): Promise<{ filename: string; patch?: string }[]> {
  return (await runJson<{ files: { filename: string; patch?: string }[] }>('gh', ['api', `repos/${repo}/compare/${base}...${head}`])).files
}

// ---------- Review en attente ----------
// Une review « PENDING » n'est visible que par moi : les commentaires approuvés y sont ajoutés en lot,
// puis elle est envoyée à part. Celle que j'aurais commencée sur GitHub est reprise et part avec.

interface PendingComment { id: string; path: string; line: number | null; originalLine: number | null; body: string }
interface PendingQuery {
  repository: {
    pullRequest: {
      id: string
      reviews: { nodes: { id: string; comments: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: PendingComment[] } }[] }
    }
  }
}

async function pendingQuery(repo: string, num: number, after: string | null = null) {
  const { owner, name } = split(repo)
  const data = await graphql<PendingQuery>(
    `query($owner:String!,$name:String!,$num:Int!,$after:String){repository(owner:$owner,name:$name){pullRequest(number:$num){id reviews(first:1,states:PENDING){nodes{id comments(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{id path line originalLine body}}}}}}}`,
    after ? { owner, name, num, after } : { owner, name, num },
  )
  return data.repository.pullRequest
}

/** Ma review en attente avec tous ses commentaires (paginés par 100). */
export async function pendingReview(repo: string, num: number): Promise<PendingReview | null> {
  let page = (await pendingQuery(repo, num)).reviews.nodes[0]
  if (!page) return null
  const comments: PendingComment[] = [...page.comments.nodes]
  while (page.comments.pageInfo.hasNextPage) {
    const next = (await pendingQuery(repo, num, page.comments.pageInfo.endCursor)).reviews.nodes[0]
    if (!next) break
    comments.push(...next.comments.nodes)
    page = next
  }
  return { id: page.id, comments: comments.map((c) => ({ id: c.id, path: c.path, line: c.line ?? c.originalLine, body: c.body })) }
}

async function ensurePending(repo: string, num: number): Promise<string> {
  const pr = await pendingQuery(repo, num)
  if (pr.reviews.nodes[0]) return pr.reviews.nodes[0].id
  const data = await graphql<{ addPullRequestReview: { pullRequestReview: { id: string } } }>(
    `mutation($id:ID!){addPullRequestReview(input:{pullRequestId:$id}){pullRequestReview{id}}}`,
    { id: pr.id },
  )
  return data.addPullRequestReview.pullRequestReview.id
}

/** Ajoute un commentaire à ma review en attente : nouveau fil à la ligne, ou réponse à un fil. Renvoie l'id du commentaire. */
async function addThread(reviewId: string, c: ReviewDraftComment): Promise<string> {
  if (c.threadId) {
    const data = await graphql<{ addPullRequestReviewThreadReply: { comment: { id: string } } }>(
      `mutation($rid:ID!,$tid:ID!,$body:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewId:$rid,pullRequestReviewThreadId:$tid,body:$body}){comment{id}}}`,
      { rid: reviewId, tid: c.threadId, body: c.body },
    )
    return data.addPullRequestReviewThreadReply.comment.id
  }
  const data = await graphql<{ addPullRequestReviewThread: { thread: { comments: { nodes: { id: string }[] } } | null } }>(
    `mutation($rid:ID!,$path:String!,$line:Int!,$body:String!){addPullRequestReviewThread(input:{pullRequestReviewId:$rid,path:$path,line:$line,side:RIGHT,body:$body}){thread{comments(first:1){nodes{id}}}}}`,
    { rid: reviewId, path: c.path, line: c.line, body: c.body },
  )
  const id = data.addPullRequestReviewThread.thread?.comments.nodes[0]?.id
  if (!id) throw new Error('ligne absente du diff')
  return id
}

export interface PendingResult { key: string; commentId: string | null; error: string | null }

/**
 * Ajoute des commentaires à ma review en attente (créée au besoin, ou reprise si j'en ai commencé une sur GitHub),
 * sans l'envoyer : l'auteur ne voit rien tant que submitReview n'est pas appelé.
 */
export async function addPendingComments(repo: string, num: number, comments: (ReviewDraftComment & { key: string })[]): Promise<PendingResult[]> {
  const reviewId = await ensurePending(repo, num)
  // Un par un : GitHub rejette une partie des fils ajoutés en parallèle à une même review.
  const results: PendingResult[] = []
  for (const c of comments) {
    try {
      results.push({ key: c.key, commentId: await addThread(reviewId, c), error: null })
    } catch (e) {
      results.push({ key: c.key, commentId: null, error: (e as Error).message })
    }
  }
  return results
}

export async function deletePendingComment(commentId: string) {
  await graphql(`mutation($id:ID!){deletePullRequestReviewComment(input:{id:$id}){clientMutationId}}`, { id: commentId })
}

/**
 * Envoie ma review en attente avec tous ses commentaires (la crée si aucun commentaire n'a été préparé).
 * Sans délai maximal : une grosse review peut prendre plus d'une minute. Si l'appel échoue quand même,
 * GitHub peut l'avoir terminée de son côté : on vérifie avant de signaler l'échec.
 */
export async function submitReview(repo: string, num: number, event: ReviewEvent, body: string): Promise<{ url: string }> {
  const reviewId = await ensurePending(repo, num)
  try {
    const data = await graphql<{ submitPullRequestReview: { pullRequestReview: { url: string } } }>(
      `mutation($rid:ID!,$event:PullRequestReviewEvent!,$body:String!){submitPullRequestReview(input:{pullRequestReviewId:$rid,event:$event,body:$body}){pullRequestReview{url}}}`,
      { rid: reviewId, event, body },
      { timeoutMs: 0 },
    )
    return data.submitPullRequestReview.pullRequestReview
  } catch (e) {
    const sent = await graphql<{ node: { state: string; url: string } | null }>(`query($id:ID!){node(id:$id){... on PullRequestReview{state url}}}`, { id: reviewId }).catch(() => null)
    if (sent?.node && sent.node.state !== 'PENDING') return { url: sent.node.url }
    throw e
  }
}

/** Supprime ma review en attente et tous ses commentaires. */
export async function deletePendingReview(reviewId: string) {
  await graphql(`mutation($id:ID!){deletePullRequestReview(input:{pullRequestReviewId:$id}){clientMutationId}}`, { id: reviewId })
}

// ---------- Écritures ----------

/** Jamais en draft : CodeRabbit ne relit pas les PR en draft. */
export async function createPr(cwd: string, opts: { title: string; body: string; base: string; head: string }) {
  const args = ['pr', 'create', '--title', opts.title, '--body-file', '-', '--base', opts.base, '--head', opts.head]
  return (await gh(args, { cwd, input: opts.body, timeoutMs: 120_000 })).trim()
}

export async function requestReviewers(repo: string, num: number, reviewers: string[]) {
  await gh(['api', `repos/${repo}/pulls/${num}/requested_reviewers`, '-X', 'POST', '--input', '-'], { input: JSON.stringify({ reviewers }) })
}

/** Corps de ma dernière PR mergée : sert d'exemple de ton et de niveau de détail. */
export async function lastMergedPrBody(repo: string): Promise<string | null> {
  const out = await gh(['pr', 'list', '--repo', repo, '--author', '@me', '--state', 'merged', '--limit', '1', '--json', 'body', '--jq', '.[0].body // ""']).catch(() => '')
  return out.trim() || null
}

export async function repoLabels(repo: string): Promise<string[]> {
  const out = await gh(['label', 'list', '--repo', repo, '--limit', '200', '--json', 'name', '--jq', '.[].name'])
  return out.split('\n').filter(Boolean)
}

const labelDetailsCache = ttlCache<{ name: string; color: string; description: string }[]>(600_000)

/** Labels du dépôt avec leur couleur et leur description (sélecteur de labels d'une PR). */
export function repoLabelDetails(repo: string, force = false) {
  return labelDetailsCache.get(repo, () => runJson<{ name: string; color: string; description: string }[]>('gh', ['label', 'list', '--repo', repo, '--limit', '200', '--json', 'name,color,description']), force)
}

export async function editLabels(repo: string, num: number, add: string[], remove: string[]) {
  if (!add.length && !remove.length) return
  const args = ['pr', 'edit', String(num), '--repo', repo]
  for (const l of add) args.push('--add-label', l)
  for (const l of remove) args.push('--remove-label', l)
  await gh(args)
}

type ClosedPr = { number: number; state: 'MERGED' | 'CLOSED'; title: string; url: string; mergedAt: string | null }
const closedCache = ttlCache<Map<string, ClosedPr>>(120_000)

/** Mes PR fusionnées ou fermées, indexées par branche (nettoyage, worktrees à aboutir). */
export function closedPrsByBranch(repo: string, force = false): Promise<Map<string, ClosedPr>> {
  return closedCache.get(repo, () => loadClosedPrs(repo), force)
}

async function loadClosedPrs(repo: string): Promise<Map<string, ClosedPr>> {
  const list = await runJson<{ number: number; state: 'MERGED' | 'CLOSED'; title: string; url: string; mergedAt: string | null; headRefName: string }[]>('gh', [
    'pr', 'list', '--repo', repo, '--author', '@me', '--state', 'closed', '--limit', '300', '--json', 'number,state,title,url,mergedAt,headRefName',
  ])
  const map = new Map<string, ClosedPr>()
  for (const p of list) if (!map.has(p.headRefName)) map.set(p.headRefName, { number: p.number, state: p.state, title: p.title, url: p.url, mergedAt: p.mergedAt })
  return map
}

export async function failedJobLog(repo: string, jobId: string, maxLines = 250): Promise<string> {
  const out = await gh(['run', 'view', '--repo', repo, '--job', jobId, '--log-failed'], { timeoutMs: 120_000 }).catch(() =>
    gh(['api', `repos/${repo}/actions/jobs/${jobId}/logs`], { timeoutMs: 120_000 }),
  )
  const lines = out.split('\n')
  return lines.slice(-maxLines).join('\n')
}

/** Annotations d'un job (ex. « job not started… » quand GitHub refuse de le lancer) : l'explication quand il n'a pas de log. */
export async function jobAnnotations(repo: string, jobId: string): Promise<string[]> {
  return (await runJson<{ message: string }[]>('gh', ['api', `repos/${repo}/check-runs/${jobId}/annotations`]).catch(() => [])).map((a) => a.message)
}

export async function rerun(repo: string, runId: string, jobId?: string) {
  if (jobId) await gh(['run', 'rerun', '--repo', repo, '--job', jobId])
  else await gh(['run', 'rerun', runId, '--repo', repo, '--failed'])
}

export async function repoInfo(repo: string): Promise<{ defaultBranch: string; sshUrl: string }> {
  const r = await runJson<{ defaultBranchRef: { name: string }; sshUrl: string }>('gh', ['repo', 'view', repo, '--json', 'defaultBranchRef,sshUrl'])
  return { defaultBranch: r.defaultBranchRef?.name ?? 'main', sshUrl: r.sshUrl }
}

/** Clone avec le protocole configuré dans gh, puis en HTTPS si SSH n'est pas disponible. */
export async function cloneRepo(repo: string, dest: string) {
  try {
    await gh(['repo', 'clone', repo, dest], { timeoutMs: 600_000 })
  } catch (e) {
    if (!/publickey|Permission denied|Host key/i.test((e as Error).message)) throw e
    await run('git', ['clone', `https://github.com/${repo}.git`, dest], { timeoutMs: 600_000 })
  }
}

// ---------- Daily ----------

export interface ActivityPr {
  number: number
  title: string
  url: string
  state: 'mergée' | 'ouverte' | 'fermée'
  body: string
  head: string
  /** Mes commits sur la période. */
  commits: { headline: string; body: string; date: string }[]
  files: { path: string; additions: number; deletions: number }[]
}

interface ActivityRaw {
  number: number
  title: string
  url: string
  body: string
  headRefName: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  mergedAt: string | null
  closedAt: string | null
  commits: { authoredDate: string; messageHeadline: string; messageBody: string; authors: { login: string }[] }[]
  files: { path: string; additions: number; deletions: number }[]
}

const ACTIVITY_FIELDS = 'number,title,url,body,headRefName,state,mergedAt,closedAt,commits,files'

/**
 * Mes PR du dépôt actives entre `since` et `until` (dates ISO, `until` exclu ; sans `until` : jusqu'à maintenant) :
 * mergées ou fermées sur la période, et encore ouvertes à sa fin avec au moins un commit de ma part sur la période.
 * Chaque PR garde seulement mes commits de la période ; une PR mergée après la période y apparaît ouverte.
 */
export async function myActivity(repo: string, since: string, until?: string): Promise<ActivityPr[]> {
  const login = await me()
  const day = since.slice(0, 10)
  const list = (args: string[]) => runJson<ActivityRaw[]>('gh', ['pr', 'list', '--repo', repo, '--author', '@me', '--limit', '30', '--json', ACTIVITY_FIELDS, ...args])
  const [merged, closed, open] = await Promise.all([
    list(['--state', 'merged', '--search', `merged:>=${day}`]),
    list(['--state', 'closed', '--search', `closed:>=${day} is:unmerged`]),
    list(['--state', 'open']),
  ])
  const STATE = { MERGED: 'mergée', CLOSED: 'fermée', OPEN: 'ouverte' } as const
  const seen = new Set<number>()
  return [...merged, ...closed, ...open]
    .filter((p) => !seen.has(p.number) && seen.add(p.number))
    .map((p) => ({
      number: p.number,
      title: p.title,
      url: p.url,
      state: until && (p.mergedAt ?? p.closedAt ?? '') >= until ? STATE.OPEN : STATE[p.state],
      body: (p.body ?? '').slice(0, 1500),
      head: p.headRefName,
      commits: p.commits
        .filter((c) => c.authoredDate >= since && (!until || c.authoredDate < until) && c.authors.some((a) => a.login === login) && !/^Merge /.test(c.messageHeadline))
        .map((c) => ({ headline: c.messageHeadline, body: c.messageBody.slice(0, 400), date: c.authoredDate })),
      files: [...p.files].sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions)).slice(0, 15),
    }))
    .filter((p) => p.state !== 'ouverte' || p.commits.length > 0)
}

export interface ReviewActivity {
  number: number
  title: string
  url: string
  author: string
  state: 'mergée' | 'ouverte' | 'fermée'
  /** Mes reviews envoyées sur la période, dans l'ordre. */
  reviews: { state: string; date: string; body: string }[]
}

/** PR des autres que j'ai reviewées depuis `since` (date ISO), avec mes reviews de la période. */
export async function myReviews(repo: string, since: string, until?: string): Promise<ReviewActivity[]> {
  const login = await me()
  const list = await runJson<{ number: number; title: string; url: string; state: 'OPEN' | 'MERGED' | 'CLOSED'; author: { login: string }; reviews: { author: { login: string } | null; state: string; submittedAt: string; body: string }[] }[]>('gh', [
    'pr', 'list', '--repo', repo, '--state', 'all', '--limit', '30', '--search', `reviewed-by:@me -author:@me updated:>=${since.slice(0, 10)}`, '--json', 'number,title,url,state,author,reviews',
  ])
  const STATE = { MERGED: 'mergée', CLOSED: 'fermée', OPEN: 'ouverte' } as const
  return list
    .map((p) => ({
      number: p.number,
      title: p.title,
      url: p.url,
      author: p.author.login,
      state: STATE[p.state],
      reviews: p.reviews
        .filter((r) => r.author?.login === login && r.submittedAt >= since && (!until || r.submittedAt < until) && r.state !== 'PENDING')
        .map((r) => ({ state: r.state, date: r.submittedAt, body: r.body.replace(/\s+/g, ' ').slice(0, 300) })),
    }))
    .filter((p) => p.reviews.length > 0)
}

/** Description d'une PR (pour donner le contexte d'une modification à un agent). */
export async function prBody(repo: string, num: number): Promise<string> {
  return (await gh(['pr', 'view', String(num), '--repo', repo, '--json', 'body', '--jq', '.body']).catch(() => '')).trim()
}

/** Après un changement de jeton : oublie l'identité et les données en cache. */
export function resetGithub() {
  meLogin = null
  prCache.clear()
  prDetailCache.clear()
  closedCache.clear()
  threadsCache.clear()
  filesCache.clear()
}

/** Vérifie un jeton GitHub sans l'enregistrer : renvoie le login associé. */
export async function checkGithubToken(token: string): Promise<string> {
  const out = await run('gh', ['api', 'user', '--jq', '.login'], { env: { ...process.env, GH_TOKEN: token } }).catch((e: Error) => {
    throw new Error(`GitHub refuse le jeton : ${e.message.split('\n')[0]}`)
  })
  return out.trim()
}

// ---------- Frise ----------

interface TimelineQuery {
  repository: {
    pullRequest: {
      createdAt: string
      author: { login: string } | null
      timelineItems: { nodes: ({ __typename: string } & Record<string, unknown>)[] }
    }
  }
}

const timelineCache = ttlCache<TimelineEvent[]>(60_000)
onPrCacheClear((repo) => timelineCache.clear(`${repo}#`))

/** Frise d'une PR : création, reviews demandées et rendues, commits, brouillon, merge (100 derniers événements). */
export function prTimeline(repo: string, num: number, force = false): Promise<TimelineEvent[]> {
  return timelineCache.get(`${repo}#${num}`, async () => {
    const { owner, name } = split(repo)
    const data = await graphql<TimelineQuery>(
      `query($owner:String!,$name:String!,$num:Int!){repository(owner:$owner,name:$name){pullRequest(number:$num){createdAt author{login} timelineItems(last:100,itemTypes:[REVIEW_REQUESTED_EVENT,PULL_REQUEST_REVIEW,PULL_REQUEST_COMMIT,READY_FOR_REVIEW_EVENT,CONVERT_TO_DRAFT_EVENT,MERGED_EVENT,CLOSED_EVENT,REOPENED_EVENT]){nodes{__typename ... on ReviewRequestedEvent{createdAt actor{login} requestedReviewer{... on User{login} ... on Team{name}}} ... on PullRequestReview{submittedAt state author{login}} ... on PullRequestCommit{commit{committedDate messageHeadline author{user{login}}}} ... on ReadyForReviewEvent{createdAt actor{login}} ... on ConvertToDraftEvent{createdAt actor{login}} ... on MergedEvent{createdAt actor{login}} ... on ClosedEvent{createdAt actor{login}} ... on ReopenedEvent{createdAt actor{login}}}}}}}`,
      { owner, name, num },
    )
    const pr = data.repository.pullRequest
    const login = (o: unknown) => (o as { login?: string; name?: string } | null)?.login ?? (o as { name?: string } | null)?.name ?? null
    const events: TimelineEvent[] = [{ type: 'created', at: pr.createdAt, actor: pr.author?.login ?? null, detail: null }]
    for (const n of pr.timelineItems.nodes) {
      const at = (n.createdAt ?? n.submittedAt) as string | undefined
      switch (n.__typename) {
        case 'ReviewRequestedEvent':
          events.push({ type: 'review_requested', at: at!, actor: login(n.actor), detail: login(n.requestedReviewer) })
          break
        case 'PullRequestReview':
          if (n.state !== 'PENDING' && at) events.push({ type: 'review', at, actor: login(n.author), detail: n.state as string })
          break
        case 'PullRequestCommit': {
          const c = n.commit as { committedDate: string; messageHeadline: string; author: { user: { login: string } | null } | null }
          events.push({ type: 'commit', at: c.committedDate, actor: c.author?.user?.login ?? null, detail: c.messageHeadline })
          break
        }
        case 'ReadyForReviewEvent': events.push({ type: 'ready', at: at!, actor: login(n.actor), detail: null }); break
        case 'ConvertToDraftEvent': events.push({ type: 'draft', at: at!, actor: login(n.actor), detail: null }); break
        case 'MergedEvent': events.push({ type: 'merged', at: at!, actor: login(n.actor), detail: null }); break
        case 'ClosedEvent': events.push({ type: 'closed', at: at!, actor: login(n.actor), detail: null }); break
        case 'ReopenedEvent': events.push({ type: 'reopened', at: at!, actor: login(n.actor), detail: null }); break
      }
    }
    return events.filter((e) => e.at).sort((a, b) => a.at.localeCompare(b.at))
  }, force)
}

// ---------- Vidéos dans la description d'une PR (navigateur) ----------
// L'API de GitHub ne permet pas de joindre un fichier à une PR : une vidéo n'a de lecteur intégré que si elle est
// déposée dans l'éditeur web. Shipyard pilote donc Chrome, avec un profil à lui où je me connecte une fois à GitHub.

const BROWSER_PROFILE = join(DATA_DIR, 'github-browser')
const ATTACHMENT = /https:\/\/github\.com\/user-attachments\/assets\/[\w-]+/

async function githubBrowser(headless: boolean) {
  const { chromium } = await import('playwright-core')
  return chromium.launchPersistentContext(BROWSER_PROFILE, { channel: 'chrome', headless, viewport: headless ? { width: 1280, height: 900 } : null })
}

/** Ouvre la page de connexion de GitHub dans le Chrome de Shipyard : je me connecte, puis je ferme la fenêtre. */
export async function githubBrowserLogin() {
  const ctx = await githubBrowser(false)
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  await page.goto('https://github.com/login')
}

/** Compte GitHub connecté dans le Chrome de Shipyard, ou null. */
export async function githubBrowserUser(): Promise<string | null> {
  const ctx = await githubBrowser(true).catch(() => null)
  if (!ctx) return null
  try {
    const cookies = await ctx.cookies('https://github.com')
    const loggedIn = cookies.some((c) => c.name === 'logged_in' && c.value === 'yes')
    return loggedIn ? (cookies.find((c) => c.name === 'dotcom_user')?.value ?? '?') : null
  } finally {
    await ctx.close()
  }
}

/**
 * Dépose une vidéo dans la zone de commentaire de la PR (sans rien poster), comme un glisser-déposer,
 * et renvoie l'adresse que GitHub lui donne : collée dans la description, elle s'affiche avec un lecteur.
 */
export async function uploadToGithub(prUrl: string, file: string, log: (text: string) => void): Promise<string> {
  const ctx = await githubBrowser(true)
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage())
    await page.goto(prUrl, { waitUntil: 'domcontentloaded' })
    if (/\/login/.test(page.url())) throw new Error('Le Chrome de Shipyard n’est pas connecté à GitHub : Réglages › Connexions › Vidéos des tests sur GitHub.')
    const box = page.locator('#new_comment_field, textarea[name="comment[body]"]').first()
    await box.waitFor({ timeout: 30_000 })
    const input = page.locator('form:has(#new_comment_field) input[type="file"], form:has(textarea[name="comment[body]"]) input[type="file"]').first()
    log('Dépôt de la vidéo sur GitHub…')
    await input.setInputFiles(file)
    const deadline = Date.now() + 300_000
    let url: string | null = null
    while (!url && Date.now() < deadline) {
      url = (await box.inputValue()).match(ATTACHMENT)?.[0] ?? null
      if (!url) await page.waitForTimeout(1_000)
    }
    // Le commentaire n'est jamais posté : la zone est vidée.
    await box.fill('')
    if (!url) throw new Error('GitHub n’a pas renvoyé d’adresse pour la vidéo (envoi trop long, ou fichier refusé).')
    return url
  } finally {
    await ctx.close()
  }
}

export async function setPrBody(repo: string, num: number, body: string) {
  await gh(['pr', 'edit', String(num), '--repo', repo, '--body-file', '-'], { input: body })
  clearPrCache(repo)
}
