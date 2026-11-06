import { existsSync, readdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { join } from 'node:path'
import type { Ghost, CreateWorktreeInput, InsightItem, LabelRole, LocalTicket, Project, ProjectOverview, PullRequest, Ticket, Worktree, WorktreeDetail, WorktreeStat } from '../shared/types.ts'
import { HttpError, PROJECTS_ROOT, decodeId, defaultWorktreeRoot, encodeId, expandHome, getProject, loadProjects, saveProjects } from './lib/config.ts'
import { run } from './lib/exec.ts'
import * as git from './lib/git.ts'
import * as gh from './lib/github.ts'
import * as linear from './lib/linear.ts'
import { awaitsReview, needsChanges, needsRerequest, needsTesting, repoLabelsWithRole } from '../shared/review.ts'
import { applyGhosts, buildQueue } from '../shared/queue.ts'
import { ghostsOf } from './lib/ghosts.ts'
import { labelRules } from './lib/settings.ts'
import { setTicketLink, ticketLinks } from './lib/ticketLinks.ts'
import { linkWorktrees, linksOf, unlinkWorktree } from './lib/worktreeLinks.ts'
import { clearSdkCache } from './lib/sdk.ts'
import { allLocalTickets, localTicketOf, moveLocalTicket, orphanLocalTickets, removeLocalTicket, saveLocalTicket } from './lib/localTickets.ts'
import { warnOn } from './lib/log.ts'
import { selfReviewSummary, testsSummary } from './lib/progress.ts'
import { discardExcludedIn } from './lib/excluded.ts'

// ---------- Projets ----------

const CANDIDATE_DIRS = [PROJECTS_ROOT, '~/Documents/Github', '~/Documents/GitHub', '~/code', '~/dev']

function parseRepo(input: string): string {
  const m = input.trim().replace(/\.git$/, '').match(/(?:github\.com[/:])?([\w.-]+)\/([\w.-]+)\/?$/)
  if (!m) throw new HttpError(400, 'URL invalide : il faut https://github.com/<org>/<repo>')
  return `${m[1]}/${m[2]}`
}

export async function addProject(input: { url: string; path?: string; team?: string | null }): Promise<Project> {
  const repo = parseRepo(input.url)
  const name = repo.split('/')[1]
  const projects = loadProjects()
  const existing = projects.find((p) => p.repo.toLowerCase() === repo.toLowerCase())
  if (existing) return existing

  let path = input.path ? expandHome(input.path) : await findLocalClone(repo, projects.map((p) => dirname(p.path)))
  if (!path) {
    path = join(expandHome(PROJECTS_ROOT), name)
    if (existsSync(path)) throw new HttpError(409, `${path} existe déjà mais ne pointe pas vers ${repo}. Indique le chemin local.`)
    await gh.cloneRepo(repo, path)
  }
  const info = await gh.repoInfo(repo)
  const project: Project = {
    id: name.toLowerCase(),
    name,
    repo,
    path,
    team: input.team || null,
    // develop dès qu'elle existe : on ne part jamais de main.
    baseBranch: (await git.hasDevelop(path)) ? 'develop' : info.defaultBranch,
    worktreeRoot: defaultWorktreeRoot(name),
  }
  if (projects.some((p) => p.id === project.id)) project.id = `${project.id}-${repo.split('/')[0].toLowerCase()}`
  saveProjects([...projects, project])
  return project
}

/** Cherche un clone existant : dossiers usuels, un niveau en dessous, et à côté des projets déjà suivis. */
async function findLocalClone(repo: string, extraDirs: string[]): Promise<string | null> {
  const name = repo.split('/')[1]
  const roots = [...new Set([...CANDIDATE_DIRS.map(expandHome), ...extraDirs])].filter((d) => existsSync(d))
  const candidates: string[] = []
  for (const root of roots) {
    candidates.push(join(root, name))
    try {
      for (const sub of readdirSync(root, { withFileTypes: true })) if (sub.isDirectory() && !sub.name.startsWith('.')) candidates.push(join(root, sub.name, name))
    } catch {
      /* dossier illisible */
    }
  }
  for (const p of candidates) {
    if (existsSync(join(p, '.git')) && (await git.originRepo(p))?.toLowerCase() === repo.toLowerCase()) return p
  }
  return null
}

export function updateProject(id: string, patch: Partial<Pick<Project, 'team' | 'baseBranch' | 'worktreeRoot' | 'path' | 'group'>>): Project {
  const projects = loadProjects()
  const i = projects.findIndex((p) => p.id === id)
  if (i < 0) throw new HttpError(404, `Projet inconnu : ${id}`)
  projects[i] = { ...projects[i], ...patch }
  if ('group' in patch) projects[i].group = patch.group?.trim() || null
  saveProjects(projects)
  return projects[i]
}

/** Autres projets du même groupe que celui-ci (vide s'il n'est pas groupé). */
export function groupedProjects(project: Project): Project[] {
  return project.group ? loadProjects().filter((p) => p.id !== project.id && p.group === project.group) : []
}

/** Arrête le suivi d'un projet. Rien n'est supprimé sur le disque ni sur GitHub (clone, worktrees, branches). */
export function removeProject(id: string) {
  getProject(id)
  saveProjects(loadProjects().filter((p) => p.id !== id))
  overviews.delete(id)
}

// ---------- Vue d'ensemble ----------

const REVIEW_BRANCH = /^review\/pr-(\d+)$/

/** Au-delà, la vue en cache est encore renvoyée tout de suite, mais recalculée en arrière-plan. */
const OVERVIEW_FRESH_MS = 20_000
const overviews = new Map<string, { at: number; value: Promise<ProjectOverview>; refreshing: boolean }>()
/** Oublie toutes les vues en cache (changement de compte GitHub ou Linear). */
export const clearOverviews = () => overviews.clear()

// Après une écriture sur GitHub (commit, push, réponse, review), la vue en cache n'est plus servie : elle est recalculée.
gh.onPrCacheClear((repo) => {
  for (const p of loadProjects()) if (p.repo === repo) overviews.delete(p.id)
})

/**
 * Vue d'un projet, servie depuis le cache (stale-while-revalidate) : la page s'affiche sans attendre GitHub et Linear.
 * force (bouton Actualiser, après une écriture) : recalcule et attend le résultat.
 */
export function overview(project: Project, force = false): Promise<ProjectOverview> {
  return cachedOverview(project, force).then((ov) => withGhosts(ov, ghostsOf(project.id)))
}

/**
 * Les ghosts s'appliquent à chaque lecture, pas dans la vue en cache : en mettre un de côté prend effet tout de suite.
 * Le total affiché partout est ce qui m'attend dans la file, ghosts exclus (les résultats d'agents s'y ajoutent côté front).
 */
function withGhosts(ov: ProjectOverview, ghosts: Record<string, Ghost>): ProjectOverview {
  const queue = applyGhosts(ov.queue, ghosts)
  return { ...ov, ghosts, queue, todo: { ...ov.todo, total: queue.filter((q) => q.group === 'me').length } }
}

function cachedOverview(project: Project, force: boolean): Promise<ProjectOverview> {
  const hit = overviews.get(project.id)
  if (hit && !force) {
    if (Date.now() - hit.at > OVERVIEW_FRESH_MS && !hit.refreshing) {
      hit.refreshing = true
      loadOverview(project, false)
        .then((ov) => overviews.set(project.id, { at: Date.now(), value: Promise.resolve(ov), refreshing: false }))
        .catch(() => { hit.refreshing = false })
    }
    return hit.value
  }
  const value = loadOverview(project, force)
  overviews.set(project.id, { at: Date.now(), value, refreshing: false })
  value.catch(() => overviews.delete(project.id))
  return value
}

/** « Tout actualiser » : oublie tout ce qui est en cache pour les PR du projet (CI, fils, contrôles, fichiers, SDK) et recalcule la vue. */
export function refreshProject(project: Project): Promise<ProjectOverview> {
  gh.clearPrCache(project.repo)
  clearSdkCache()
  return overview(project, true)
}

async function loadOverview(project: Project, force: boolean): Promise<ProjectOverview> {
  const errors: string[] = []
  const soft = <T>(label: string, p: Promise<T>, fallback: T) =>
    p.catch((e: Error) => {
      errors.push(`${label} : ${e.message}`)
      return fallback
    })

  const [all, mine, requested, teamTickets, closed] = await Promise.all([
    soft('git', git.listWorktrees(project), [] as Worktree[]),
    soft('GitHub (mes PR)', gh.myPrs(project.repo, force), [] as PullRequest[]),
    soft('GitHub (reviews)', gh.reviewRequested(project.repo, force), [] as PullRequest[]),
    project.team && linear.linearConfigured() ? soft('Linear', linear.teamTickets(project.team, force), [] as Ticket[]) : Promise.resolve([] as Ticket[]),
    soft('GitHub (PR mergées)', gh.closedPrsByBranch(project.repo, force), new Map() as Awaited<ReturnType<typeof gh.closedPrsByBranch>>),
  ])
  const worktrees = all
  // Ticket lié à la main : prime sur la branche et sur la PR.
  const links = ticketLinks()
  for (const wt of worktrees) {
    const linked = links[wt.path]
    if (linked) {
      wt.ticketId = linked
      wt.ticketLinked = true
    }
  }

  // PR de review absentes des demandes en cours (déjà faites) : chargées en parallèle, avant la boucle.
  const missing = [...new Set(worktrees.map((wt) => Number(wt.branch?.match(REVIEW_BRANCH)?.[1] ?? 0)).filter((n) => n && !requested.some((p) => p.number === n) && !mine.some((p) => p.number === n)))]
  const fetched = await Promise.all(missing.map((n) => soft(`GitHub (#${n})`, gh.prByNumber(project.repo, n, force), null)))
  const reviewPrs = [...requested, ...fetched.filter((p): p is PullRequest => !!p)]
  // Frise de chaque PR (depuis quand elle attend, et qui) : en parallèle, en cache 1 min. Sans elle, la PR s'affiche quand même.
  await Promise.all([...mine, ...reviewPrs].map(async (pr) => {
    pr.timeline = await gh.prTimeline(project.repo, pr.number, force).catch(warnOn('gh.prTimeline', undefined))
  }))
  for (const wt of worktrees) {
    wt.links = linksOf({ project: project.id, path: wt.path }).map((r) => ({ project: r.project, path: r.path, id: encodeId(r.path) }))
    wt.localTicket = localTicketOf(wt.path)
    if (!wt.branch) continue
    const own = mine.find((p) => p.head === wt.branch)
    if (own) {
      wt.kind = 'mine'
      wt.prNumber = own.number
      wt.ticketId ??= own.ticketId
      continue
    }
    const num = Number(wt.branch.match(REVIEW_BRANCH)?.[1] ?? 0) || requested.find((p) => p.head === wt.branch)?.number
    if (num) {
      wt.kind = 'review'
      wt.prNumber = num
      let pr = reviewPrs.find((p) => p.number === num)
      if (!pr) {
        pr = await soft(`GitHub (#${num})`, gh.prByNumber(project.repo, num), null as unknown as PullRequest)
        if (pr) reviewPrs.push(pr)
      }
      wt.ticketId ??= pr?.ticketId ?? null
      continue
    }
    const done = closed.get(wt.branch)
    if (done?.state === 'MERGED') wt.merged = { number: done.number, title: done.title, url: done.url, mergedAt: done.mergedAt }
  }
  // Review d'une PR mergée ou fermée : plus rien à traiter, elle sort de la vue (le nettoyage propose de supprimer le worktree).
  // Review d'une PR mergée ou fermée : plus rien à reviewer, le worktree passe dans « Mergées · à nettoyer » pour être supprimé.
  const gone = new Set(reviewPrs.filter((p) => p.state !== 'OPEN').map((p) => p.number))
  for (const w of worktrees) {
    const p = w.kind === 'review' && w.prNumber && gone.has(w.prNumber) ? reviewPrs.find((x) => x.number === w.prNumber) : undefined
    if (p) w.merged = { number: p.number, title: p.title, url: p.url, mergedAt: null, state: p.state === 'CLOSED' ? 'CLOSED' : 'MERGED' }
  }
  const openReviewPrs = reviewPrs.filter((p) => !gone.has(p.number))

  // Tickets liés à un worktree mais absents de « mes tickets » (assignés à quelqu'un d'autre).
  const tickets = [...teamTickets]
  if (linear.linearConfigured()) {
    const missingTickets = [...new Set(worktrees.map((w) => w.ticketId).filter((id): id is string => !!id && !tickets.some((t) => t.id === id)))]
    const extra = await Promise.all(missingTickets.map((id) => linear.ticketById(id, force).catch(warnOn('linear.ticketById', null))))
    tickets.push(...extra.filter((t): t is Ticket => !!t))
  }

  // Une tâche par PR, quel que soit le nombre de commentaires ou de jobs en échec.
  const comments = mine.filter((p) => p.unresolvedThreads > 0).length
  const todo = tickets.filter((t) => t.isMine && t.statusType === 'unstarted').length
  const ci = mine.filter((p) => p.ci.failing > 0).length
  const rules = labelRules()
  const rerequest = mine.filter((p) => needsRerequest(p, rules)).length
  const testing = mine.filter((p) => needsTesting(p, rules)).length
  const conflicts = mine.filter((p) => p.conflicts).length
  const changes = mine.filter((p) => needsChanges(p, rules)).length
  // Reviews à faire : demandées sur GitHub, ou PR déjà reviewées que l'auteur a remises en « Waiting review ».
  const toReview = [...new Set([...requested.map((p) => p.number), ...openReviewPrs.filter((p) => awaitsReview(p, rules)).map((p) => p.number)])]
  const reviews = toReview.length
  const login = await gh.me().catch(warnOn('gh.me', null))
  // Seul contributeur humain : la liste des membres du dépôt, sans moi ni les bots, est vide. En cas de doute, non.
  const members = await gh.repoMembers(project.repo).catch(warnOn('gh.repoMembers', null))
  const solo = !!login && !!members && members.every((m) => m === login)
  const ov = {
    project,
    solo,
    worktrees: worktrees.filter((w) => !w.isMain),
    tickets,
    myPrs: mine,
    reviewPrs: openReviewPrs,
    requestedReviews: toReview,
    todo: { comments, todo, reviews, ci, rerequest, testing, conflicts, changes, total: 0 },
    linearConfigured: linear.linearConfigured(),
    errors,
    fetchedAt: new Date().toISOString(),
  }
  return { ...ov, ghosts: {}, queue: buildQueue(ov, rules, login) }
}

// ---------- Worktree ----------

/** PR d'un worktree (numéro et base), depuis la vue en cache : évite de recalculer tout le détail. */
export async function worktreePr(project: Project, wtId: string): Promise<{ number: number; base: string; author: string } | null> {
  const ov = await overview(project)
  const wt = ov.worktrees.find((w) => w.id === wtId) ?? ov.worktrees.find((w) => w.path === decodeId(wtId))
  if (!wt?.prNumber) return null
  const pr = [...ov.myPrs, ...ov.reviewPrs].find((p) => p.number === wt.prNumber) ?? (await gh.prByNumber(project.repo, wt.prNumber))
  return { number: pr.number, base: pr.base, author: pr.author }
}

/** Lignes ajoutées / supprimées d'un worktree, pour la barre d'état. */
export async function worktreeStat(project: Project, wtId: string): Promise<WorktreeStat> {
  const ov = await overview(project)
  const path = decodeId(wtId)
  const wt = ov.worktrees.find((w) => w.path === path)
  if (!wt) throw new HttpError(404, `Worktree introuvable : ${path}`)
  const pr = wt.prNumber ? [...ov.myPrs, ...ov.reviewPrs].find((p) => p.number === wt.prNumber) : undefined
  const base = pr?.base ?? project.baseBranch
  return { branch: wt.branch, title: wt.kind === 'review' ? (pr?.title ?? null) : null, base, ...(await git.numstat(path, base)) }
}

/** Worktree du projet désigné par son id d'URL : un chemin hors du projet est refusé. */
async function projectWorktree(project: Project, wtId: string) {
  const ov = await overview(project)
  const path = decodeId(wtId)
  const worktree = ov.worktrees.find((w) => w.path === path)
  if (!worktree) throw new HttpError(404, `Worktree introuvable : ${path}`)
  return { ov, worktree }
}

export const worktreePath = async (project: Project, wtId: string) => (await projectWorktree(project, wtId)).worktree.path

/** Détail d'un worktree. force : relit la PR et le ticket (les actions IA partent de l'état à jour). */
export async function worktreeDetail(project: Project, wtId: string, force = false): Promise<WorktreeDetail> {
  const { ov, worktree } = await projectWorktree(project, wtId)
  const path = worktree.path
  const ticket = worktree.ticketId
    ? (!force && ov.tickets.find((t) => t.id === worktree.ticketId)) || (linear.linearConfigured() ? await linear.ticketById(worktree.ticketId, force).catch(warnOn('linear.ticketById', null)) : null)
    : null
  const pr = worktree.prNumber ? await gh.prByNumber(project.repo, worktree.prNumber, force) : null
  if (pr) pr.timeline = await gh.prTimeline(project.repo, pr.number, force).catch(warnOn('gh.prTimeline', undefined))
  const base = pr?.base ?? project.baseBranch
  const own = worktree.kind !== 'review' ? worktree.branch : null
  if (worktree.kind !== 'review') git.refreshBaseInBackground(path, base)
  // Ma branche sur GitHub : un collègue a pu y pousser des commits.
  if (own) git.refreshBaseInBackground(path, own)
  const [commitsAhead, dirtyFiles, merge, behindBase, behindRemote, remoteAuthors] = await Promise.all([
    worktree.kind === 'review' ? Promise.resolve([]) : git.commitsAhead(path, base),
    git.dirtyFiles(path),
    git.mergeState(path),
    worktree.kind === 'review' ? Promise.resolve(0) : git.behindRemote(path, base),
    own ? git.behindRemote(path, own) : Promise.resolve(0),
    own ? git.remoteAuthors(path, own) : Promise.resolve([]),
  ])
  const linked = await Promise.all((await linkedWorktrees(worktree)).map(async (l) => ({
    project: l.project.id, name: l.project.name, id: l.worktree.id, path: l.worktree.path, branch: l.worktree.branch, dirtyFiles: await git.dirtyFiles(l.worktree.path).catch(() => []),
  })))
  return { project, worktree, ticket, pr, commitsAhead, dirtyFiles, merge, behindBase, behindRemote, remoteAuthors, linked, solo: ov.solo, tests: testsSummary(wtId), selfReview: selfReviewSummary(wtId) }
}

/**
 * Worktrees d'un ticket qui touche plusieurs dépôts du même groupe : un par projet, même branche, chacun depuis sa
 * base, puis liés entre eux pour que plan, travail et review portent sur l'ensemble. Un worktree déjà créé pour ce
 * ticket dans un projet est repris tel quel.
 */
export async function createTicketWorktrees(project: Project, input: { ticketId: string; branch: string; projects: string[] }): Promise<{ project: string; id: string }[]> {
  const targets = [...new Set(input.projects)].map(getProject)
  if (!targets.length) throw new HttpError(400, 'Aucun projet choisi')
  for (const t of targets) {
    if (t.id !== project.id && (!project.group || t.group !== project.group)) throw new HttpError(400, `${t.name} n’est pas dans le groupe de ${project.name} (Réglages › Projets liés)`)
  }
  const out: { project: string; id: string; path: string }[] = []
  for (const t of targets) {
    const existing = (await overview(t)).worktrees.find((w) => w.ticketId === input.ticketId)
    const wt = existing ?? (await createWorktree(t, { mode: 'ticket', branch: input.branch, base: t.baseBranch, ticketId: input.ticketId }))
    out.push({ project: t.id, id: wt.id, path: wt.path })
  }
  const [first, ...rest] = out
  for (const r of rest) linkWorktrees({ project: first.project, path: first.path }, { project: r.project, path: r.path })
  for (const t of targets) overviews.delete(t.id)
  return out.map(({ project, id }) => ({ project, id }))
}

export async function createWorktree(project: Project, input: CreateWorktreeInput): Promise<{ path: string; id: string }> {
  let dir: string
  let branch: string
  let mode: 'new' | 'existing' | 'pr'
  if (input.mode === 'review') {
    if (!input.prNumber) throw new HttpError(400, 'Numéro de PR manquant')
    branch = `review/pr-${input.prNumber}`
    dir = `pr-${input.prNumber}`
    mode = 'pr'
  } else {
    branch = (input.branch ?? '').trim()
    if (!/^[\w./-]+$/.test(branch)) throw new HttpError(400, `Nom de branche invalide : ${branch}`)
    dir = input.mode === 'ticket' && input.ticketId ? input.ticketId : branch.split('/').pop()!
    mode = input.mode === 'existing' ? 'existing' : 'new'
  }
  const base = input.base?.trim() || project.baseBranch
  if (mode === 'new') await assertBase(project, base)
  const path = await git.addWorktree(project, { dir, branch, mode, base, prNumber: input.prNumber })
  return { path, id: Buffer.from(path).toString('base64url') }
}

/** Lie un ticket Linear à un worktree existant (null : revient au ticket déduit de la branche). */
export async function linkTicket(project: Project, wtId: string, ticketId: string | null) {
  const path = decodeId(wtId)
  if (!(await git.listWorktrees(project)).some((w) => w.path === path)) throw new HttpError(404, `Worktree introuvable : ${path}`)
  const id = ticketId?.trim().toUpperCase() || null
  if (id) {
    if (!/^[A-Z][A-Z0-9]*-\d+$/.test(id)) throw new HttpError(400, `Identifiant de ticket invalide : ${id}`)
    if (linear.linearConfigured() && !(await linear.ticketById(id).catch(() => null))) throw new HttpError(404, `Ticket introuvable sur Linear : ${id}`)
  }
  setTicketLink(path, id)
  overviews.delete(project.id)
  return { ticketId: id }
}

/** Supprime le worktree (refusé par git s'il reste des changements non commités). La branche est conservée. */
export async function removeWorktree(project: Project, wtId: string) {
  const path = decodeId(wtId)
  const known = (await git.listWorktrees(project)).find((w) => w.path === path && !w.isMain)
  if (!known) throw new HttpError(404, `Worktree introuvable : ${path}`)
  const dirty = await git.dirtyFiles(path)
  if (dirty.length) throw new HttpError(409, `${dirty.length} fichier(s) non commité(s) dans ce worktree : commite ou annule-les avant de le supprimer.`)
  await git.removeWorktree(project, path)
  unlinkWorktree({ project: project.id, path })
}

// ---------- Tickets locaux (Features & optimisations) ----------

const BRANCH_PREFIX: Record<string, string> = { feature: 'feat', performance: 'perf', sécurité: 'fix', tests: 'test', dette: 'refactor', architecture: 'refactor', accessibilité: 'fix', ux: 'feat', dx: 'chore' }

/** Type de commit et de branche d'une proposition, selon sa catégorie. */
export const localTicketType = (category: string): Ticket['type'] => {
  const p = BRANCH_PREFIX[category] ?? 'feat'
  return p === 'feat' || p === 'fix' || p === 'refactor' ? p : 'chore'
}

/** Crée la branche et le worktree d'une proposition, et l'y enregistre comme ticket local. */
export async function createLocalTicketWorktree(project: Project, input: { branch: string; item: InsightItem }) {
  const created = await createWorktree(project, { mode: 'new', branch: input.branch })
  const i = input.item
  saveLocalTicket({
    project: project.id, path: created.path, branch: input.branch.trim(), title: i.title, category: i.category,
    why: i.why, proposal: i.proposal, files: i.files, risk: i.risk, createdAt: new Date().toISOString(),
  })
  // La vue en cache ne connaît pas encore ce worktree : sa page doit s'ouvrir tout de suite.
  await overview(project, true).catch(() => undefined)
  return created
}

/** Description Markdown d'un ticket local, dans le style des tickets de l'équipe. */
export const localTicketMarkdown = (t: LocalTicket) => [
  '**Référent :** à définir', '', t.why, '', '## À faire', '', t.proposal,
  t.files.length ? `\n## Fichiers concernés\n\n${t.files.map((f) => `* \`${f}\``).join('\n')}` : '',
  t.risk ? `\n## Risque\n\n${t.risk}` : '',
].filter((x) => x !== '').join('\n')

/** Le ticket local devient un vrai ticket Linear (en cours, assigné à moi), lié au worktree ; l'entrée locale est retirée. */
export async function promoteLocalTicket(project: Project, wtId: string) {
  const path = decodeId(wtId)
  const t = localTicketOf(path)
  if (!t) throw new HttpError(404, 'Aucun ticket local sur ce worktree')
  if (!project.team || !linear.linearConfigured()) throw new HttpError(400, 'Aucune équipe Linear liée à ce projet')
  const meta = await linear.teamMeta(project.team)
  const state = meta.states.find((s) => s.type === 'started') ?? meta.states.find((s) => s.type === 'unstarted')
  const created = await linear.createIssue(project.team, {
    title: t.title, description: localTicketMarkdown(t), assigneeId: meta.me, stateId: state?.id ?? null, priority: 3, labelIds: [], projectId: null,
  })
  setTicketLink(path, created.id)
  removeLocalTicket(path)
  return created
}

/** Tickets locaux dont le worktree n'existe plus (supprimé hors de Shipyard, projet retiré). */
export async function localTicketOrphans(): Promise<LocalTicket[]> {
  if (!allLocalTickets().length) return []
  const projects = loadProjects()
  const known = new Set((await Promise.all(projects.map((p) => git.listWorktrees(p).catch(() => [])))).flat().map((w) => w.path))
  return orphanLocalTickets(known, new Set(projects.map((p) => p.id)))
}

export { removeLocalTicket }

// ---------- Changer un worktree de projet ----------

/**
 * Worktree créé dans le mauvais projet : le recrée dans `target` (même branche, même ticket), puis supprime
 * l'original et sa branche locale. Refusé s'il contient déjà du travail (commits ou fichiers non commités),
 * qui appartient au dépôt d'origine et ne se déplace pas.
 */
export async function moveWorktree(project: Project, wtId: string, targetId: string): Promise<{ path: string; id: string }> {
  const target = getProject(targetId)
  if (target.id === project.id) throw new HttpError(400, 'Le worktree est déjà dans ce projet')
  const path = decodeId(wtId)
  const wt = (await git.listWorktrees(project)).find((w) => w.path === path && !w.isMain)
  if (!wt) throw new HttpError(404, `Worktree introuvable : ${path}`)
  if (!wt.branch) throw new HttpError(400, 'Worktree sans branche')
  if (wt.kind === 'review' || /^review\/pr-\d+$/.test(wt.branch)) throw new HttpError(400, 'Une review est liée à sa PR : recrée-la depuis la PR du bon projet')
  const [dirty, ahead] = await Promise.all([git.dirtyFiles(path), git.commitsAhead(path, project.baseBranch)])
  if (dirty.length || ahead.length) {
    throw new HttpError(409, `Ce worktree contient déjà du travail (${[dirty.length && `${dirty.length} fichier(s) non commité(s)`, ahead.length && `${ahead.length} commit(s)`].filter(Boolean).join(', ')}) : il appartient à ${project.name} et ne peut pas être déplacé.`)
  }
  const linked = ticketLinks()[path] ?? null
  const ticketId = linked ?? wt.ticketId
  // Même branche dans le bon dépôt : nouvelle depuis sa base, ou reprise si elle y existe déjà.
  const created = await createWorktree(target, { mode: ticketId ? 'ticket' : 'new', branch: wt.branch, ticketId: ticketId ?? undefined })
    .catch(() => createWorktree(target, { mode: 'existing', branch: wt.branch! }))
  if (linked) setTicketLink(created.path, linked)
  moveLocalTicket(path, { path: created.path, project: target.id })
  await removeWorktree(project, wtId)
  setTicketLink(path, null)
  // Branche locale vide (aucun commit) : elle ne sert plus dans ce dépôt.
  await run('git', ['branch', '-D', wt.branch], { cwd: project.path }).catch(() => undefined)
  return created
}

// ---------- Worktrees liés (projets d'un même groupe) ----------

/** Associe ce worktree à celui d'un autre projet du groupe. */
export async function linkWorktree(project: Project, wtId: string, other: { project: string; wt: string }) {
  const target = getProject(other.project)
  if (target.id === project.id) throw new HttpError(400, 'Choisis un worktree d’un autre projet')
  if (!project.group || target.group !== project.group) throw new HttpError(400, `${target.name} n’est pas dans le groupe de ${project.name} (Réglages › Projets liés)`)
  const [mine, theirs] = await Promise.all([git.listWorktrees(project), git.listWorktrees(target)])
  const a = mine.find((w) => w.path === decodeId(wtId) && !w.isMain)
  const b = theirs.find((w) => w.path === decodeId(other.wt) && !w.isMain)
  if (!a || !b) throw new HttpError(404, 'Worktree introuvable')
  linkWorktrees({ project: project.id, path: a.path }, { project: target.id, path: b.path })
}

export function unlinkWorktreeFrom(project: Project, wtId: string) {
  unlinkWorktree({ project: project.id, path: decodeId(wtId) })
}

export interface LinkedWorktree {
  project: Project
  worktree: Worktree
  pr: PullRequest | null
  ticket: Ticket | null
}

/** Worktrees liés à celui-ci, avec leur PR et leur ticket (depuis la vue en cache de chaque projet). */
export async function linkedWorktrees(wt: Worktree): Promise<LinkedWorktree[]> {
  const out = await Promise.all((wt.links ?? []).map(async (l): Promise<LinkedWorktree | null> => {
    const p = loadProjects().find((x) => x.id === l.project)
    if (!p) return null
    const ov = await overview(p).catch(() => null)
    const w = ov?.worktrees.find((x) => x.path === l.path)
    if (!ov || !w) return null
    const pr = w.prNumber ? ([...ov.myPrs, ...ov.reviewPrs].find((x) => x.number === w.prNumber) ?? null) : null
    return { project: p, worktree: w, pr, ticket: ov.tickets.find((t) => t.id === w.ticketId) ?? null }
  }))
  return out.filter((x): x is LinkedWorktree => !!x)
}

/**
 * Aboutit un worktree dont la PR est mergée : passe son ticket Linear dans l'état terminé de l'équipe (« Done »),
 * puis supprime le worktree. Refusé avant toute écriture s'il reste des changements non commités.
 */
export async function finishWorktree(project: Project, wtId: string): Promise<{ ticket: { id: string; state: string } | null }> {
  const path = decodeId(wtId)
  const wt = (await overview(project)).worktrees.find((w) => w.path === path)
  if (!wt) throw new HttpError(404, `Worktree introuvable : ${path}`)
  const [dirty, merge] = await Promise.all([git.dirtyFiles(path), git.mergeState(path)])
  if (merge) throw new HttpError(409, `Une fusion de ${merge.base ?? 'la base'} est en cours dans ce worktree : valide-la ou annule-la dans l’onglet Conflits avant de l'aboutir.`)
  if (dirty.length) throw new HttpError(409, `${dirty.length} fichier(s) non commité(s) dans ce worktree : commite ou annule-les avant de l'aboutir.`)
  let ticket: { id: string; state: string } | null = null
  // Le ticket d'une review appartient à son auteur : on n'y touche pas.
  if (wt.kind !== 'review' && wt.ticketId && project.team && linear.linearConfigured()) {
    const states = await linear.teamStates(project.team)
    const done = states.find((s) => s.type === 'completed' && /^done$/i.test(s.name)) ?? states.find((s) => s.type === 'completed')
    if (!done) throw new HttpError(400, `Aucun état « terminé » dans l'équipe Linear ${project.team}`)
    await linear.setTicketState(wt.ticketId, done.id)
    ticket = { id: wt.ticketId, state: done.name }
  }
  await removeWorktree(project, wtId)
  return { ticket }
}

/**
 * Après l'envoi de ma review : si je demande des changements (ou laisse des commentaires), pose le label « à corriger »
 * du dépôt et retire « review en cours » / « review demandée ». Sur une approbation, pose « approuvée » et retire les trois.
 * Les labels viennent des réglages (rôles) : si le dépôt n'en a aucun, rien n'est ajouté.
 */
export async function applyReviewLabels(project: Project, num: number, event: 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE', hasComments: boolean) {
  const [available, pr] = await Promise.all([gh.repoLabels(project.repo), gh.prByNumber(project.repo, num)])
  const rules = labelRules()
  const pick = (...roles: LabelRole[]) => roles.flatMap((r) => repoLabelsWithRole(rules, r, available))
  const current = pr.labels.map((l) => l.name)
  const needsChanges = event === 'REQUEST_CHANGES' || (event === 'COMMENT' && hasComments)
  const approved = event === 'APPROVE'
  const add = (needsChanges ? pick('changes') : approved ? pick('approved') : []).slice(0, 1).filter((l) => !current.includes(l))
  const remove = (approved ? pick('inProgress', 'awaitingReview', 'changes') : needsChanges ? pick('inProgress', 'awaitingReview') : pick('inProgress'))
    .filter((l) => current.includes(l))
  await gh.editLabels(project.repo, num, add, remove)
  gh.clearPrCache(project.repo)
  return { added: add, removed: remove }
}

/** Re-demande la review aux reviewers donnés et passe les labels de « à corriger » à « review demandée ». */
export async function rerequestReview(project: Project, wtId: string, reviewers: string[]) {
  const detail = await worktreeDetail(project, wtId)
  const pr = detail.pr
  if (!pr) throw new HttpError(400, 'Pas de PR')
  if (!pr.mine) throw new HttpError(403, 'Ce n’est pas ta PR')
  await gh.requestReviewers(project.repo, pr.number, reviewers)

  const available = await gh.repoLabels(project.repo).catch(() => [] as string[])
  const rules = labelRules()
  const current = pr.labels.map((l) => l.name)
  const remove = repoLabelsWithRole(rules, 'changes', available).filter((l) => current.includes(l))
  const add = repoLabelsWithRole(rules, 'awaitingReview', available).slice(0, 1).filter((l) => !current.includes(l))
  await gh.editLabels(project.repo, pr.number, add, remove)
  gh.clearPrCache(project.repo)
  return { reviewers, added: add, removed: remove }
}

/** Interdit de partir de main / master quand le dépôt a une branche develop. */
async function assertBase(project: Project, base: string) {
  if (git.FORBIDDEN_BASES.includes(base) && (await git.hasDevelop(project.path))) {
    throw new HttpError(400, `Interdit de partir de ${base} : la branche de base est develop.`)
  }
}

/**
 * Au démarrage : un projet configuré sur main / master alors que le dépôt a develop passe sur develop.
 * Toutes les comparaisons (commits de la branche, diff des agents, tests) partent alors de develop.
 */
export async function enforceDevelopBase() {
  const projects = loadProjects()
  let changed = false
  for (const p of projects) {
    if (git.FORBIDDEN_BASES.includes(p.baseBranch) && existsSync(p.path) && (await git.hasDevelop(p.path))) {
      p.baseBranch = 'develop'
      changed = true
    }
  }
  if (changed) {
    saveProjects(projects)
    overviews.clear()
  }
}

export async function createBranchOnly(project: Project, branch: string, base: string) {
  if (!/^[\w./-]+$/.test(branch)) throw new HttpError(400, `Nom de branche invalide : ${branch}`)
  await assertBase(project, base)
  await git.pushNewBranch(project, branch, base)
}

export async function createPullRequest(
  project: Project,
  wtId: string,
  input: { commits: { title: string; files: string[] }[]; title: string; body: string; base?: string },
): Promise<{ url: string; commits: string[]; label: string | null }> {
  const path = decodeId(wtId)
  const branch = await git.currentBranch(path)
  const done: string[] = []
  for (const c of input.commits) {
    const sha = await git.commitFiles(path, c.title, c.files)
    if (sha) done.push(`${sha.slice(0, 7)} ${c.title}`)
  }
  await discardExcludedIn(path)
  const leftover = await git.dirtyFiles(path)
  if (leftover.length && input.commits.length) {
    throw new HttpError(409, `Fichiers non commités restants : ${leftover.map((f) => f.path).join(', ')}. Ajoute-les à un commit ou régénère le plan.`)
  }
  await git.push(path, branch)
  // PR déjà ouverte pour cette branche (premier essai abouti malgré une erreur affichée, double clic) : on la reprend.
  const url = await gh.createPr(path, { title: input.title, body: input.body, base: input.base || project.baseBranch, head: branch }).catch((e: Error) => {
    const existing = e.message.match(/already exists:\s*(https:\/\/\S+\/pull\/\d+)/)?.[1]
    if (!existing) throw e
    return existing
  })
  // Label « CodeRabbit en cours » du dépôt, s'il en a un : la PR est créée même si sa pose échoue.
  const label = repoLabelsWithRole(labelRules(), 'aiReview', await gh.repoLabels(project.repo).catch(warnOn('gh.repoLabels', [])))[0] ?? null
  const num = Number(url.match(/\/pull\/(\d+)/)?.[1])
  const labeled = label && num ? await gh.editLabels(project.repo, num, [label], []).then(() => label, () => null) : null
  gh.clearPrCache(project.repo)
  return { url, commits: done, label: labeled }
}

