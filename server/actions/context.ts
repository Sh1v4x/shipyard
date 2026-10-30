import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ActionInput, ActionKind, RunScope, ReviewThread, TicketPlanOutput, Project, Run, TicketWorkOutput, WorktreeDetail } from '../../shared/types.ts'
import { DATA_DIR, HttpError } from '../lib/config.ts'
import { getRun, listRuns, type RunSpec } from '../lib/claude.ts'
import * as git from '../lib/git.ts'
import * as gh from '../lib/github.ts'
import { fill, loadPrompt } from '../lib/prompts.ts'
import { languageVars } from '../lib/settings.ts'
import { rulesFor } from '../lib/rules.ts'
import { linkedWorktrees, type LinkedWorktree, localTicketMarkdown, localTicketType } from '../services.ts'
import { androidAvds, platformOf, type Platform } from '../lib/platform.ts'
import { warnOn } from '../lib/log.ts'

export const DIFFS_DIR = join(DATA_DIR, 'diffs')

mkdirSync(DIFFS_DIR, { recursive: true })

/** Variables communes à tous les prompts d'un worktree. */
export function baseVars(d: WorktreeDetail): Record<string, string | number | null> {
  // Sans ticket Linear, le ticket local (proposition gardée sur le Mac) en tient lieu.
  const local = !d.ticket ? d.worktree.localTicket : null
  return {
    'worktree.path': d.worktree.path,
    'worktree.branch': d.worktree.branch,
    'ticket.id': d.ticket?.id ?? (local ? 'local ticket (no Linear ticket)' : 'none'),
    'ticket.title': d.ticket?.title ?? local?.title ?? '',
    'ticket.description': d.ticket?.description || (local ? localTicketMarkdown(local) : '(no description)'),
    'ticket.url': d.ticket?.url ?? (local ? 'none (local ticket)' : ''),
    'ticket.type': d.ticket?.type ?? (local ? localTicketType(local.category) : 'feat'),
    'pr.number': d.pr?.number ?? null,
    'pr.title': d.pr?.title ?? '',
    'pr.author': d.pr?.author ?? '',
    'pr.base': d.pr?.base ?? d.project.baseBranch,
  }
}

/** Construit le RunSpec d'après le prompt (fichier prompts/<key>.md) et ses réglages en front matter. */
export function specFrom(key: string, vars: Record<string, string | number | null>, rest: Omit<RunSpec, 'prompt' | 'model' | 'permissionMode' | 'allowedTools'>): RunSpec {
  const p = loadPrompt(key)
  return {
    ...rest,
    promptKey: key,
    // Langues des réglages ({lang.app}, {lang.github}…) disponibles dans tous les prompts.
    prompt: fill(p.body, { ...languageVars(), ...vars }),
    model: p.model,
    permissionMode: p.permissionMode,
    allowedTools: p.allowedTools,
    disallowedTools: rest.disallowedTools ?? p.disallowedTools,
    agents: rest.agents ?? p.agents,
    ...(p.allowedTools.length === 0 ? { tools: '' } : {}),
  }
}

/** Écrit le diff de la PR sur disque (lu par l'agent et ses sous-agents) et renvoie la liste des commits. */
export async function prContext(repo: string, num: number, local?: gh.LocalDiff): Promise<{ context: string; diffPath: string; diff: string; commits: string[] }> {
  const [diff, commits] = await Promise.all([gh.prDiffText(repo, num, local), gh.prCommits(repo, num)])
  const diffPath = join(DIFFS_DIR, `${repo.replace('/', '__')}-${num}.diff`)
  writeFileSync(diffPath, diff)
  const files = (diff.match(/^diff --git /gm) ?? []).length
  return {
    diffPath,
    diff,
    commits,
    context: ['## Commits', commits.map((c) => `- ${c}`).join('\n'), '', `## Diff`, `${files} files, ${diff.split('\n').length} lines, in ${diffPath}.`].join('\n'),
  }
}

export async function pool<T, R>(items: T[], size: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const j = i++
      out[j] = await fn(items[j], j)
    }
  }))
  return out
}

/**
 * Règles du mono-repo : CLAUDE.md et .claude/rules/*.md du dossier parent du projet (ex. shop/).
 * Le CLAUDE.md du projet lui-même est déjà chargé par claude dans le worktree.
 */
export function repoRules(project: { id: string }): { text: string; dirs: string[] } {
  return { text: rulesFor(project.id), dirs: [] }
}

/** Un fil de discussion pour un prompt : identifiant, emplacement, état, et chaque message avec son auteur. */
export function threadText(t: ReviewThread, login: string): string {
  return [
    `#### threadId: ${t.id}`,
    `${t.path}${t.line ? `:${t.line}` : ''}${t.isResolved ? ' (marked resolved)' : ''}${t.isOutdated ? ' (line changed since)' : ''}`,
    ...t.comments.map((c) => `- ${c.author === login ? 'me' : c.author}: ${c.body.replace(/\n/g, '\n  ')}`),
  ].join('\n')
}

/**
 * Fils déjà ouverts sur la PR (hors brouillons, et hors ceux déjà listés ailleurs), pour qu'un agent de review
 * ne ressorte pas un point déjà discuté et rattache sa remarque au fil existant (relatedThreadId).
 */
export function priorThreadsText(threads: ReviewThread[], login: string, exclude: Set<string> = new Set()): string {
  const list = threads.filter((t) => !t.isDraft && !exclude.has(t.id))
  return list.length ? list.map((t) => threadText(t, login)).join('\n\n') : 'No existing comment on the PR.'
}

/**
 * État de la branche pour une modification libre : PR, ticket lié, commits, fichiers modifiés
 * et travail non commité. L'agent part de là pour intégrer la demande à ce qui est déjà fait.
 */
/**
 * Ce qui a déjà été fait sur la branche dans Shipyard : réalisation du ticket et modifications libres retenues
 * (les passages refusés ou remplacés par des corrections sont écartés), du plus ancien au plus récent.
 */
function workHistory(d: WorktreeDetail): string {
  const runs = listRuns({ project: d.project.id, worktree: d.worktree.id, status: 'success' }, 200)
    .filter((r) => r.kind === 'ticket' || r.kind === 'change')
    .map((r) => getRun(r.id))
    .filter((r): r is Run => !!r && r.decision !== 'declined' && r.decision !== 'revised' && !!r.structured)
    .slice(0, 6)
    .reverse()
  if (!runs.length) return ''
  const date = (iso: string) => new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
  return [
    'Work already done on this branch with Shipyard (oldest to newest):',
    ...runs.map((r) => {
      const out = r.structured as TicketWorkOutput
      const plan = r.scope.ref ? (getRun(r.scope.ref)?.structured as TicketPlanOutput | null) : null
      return [
        `### ${r.title} (${date(r.startedAt)})`,
        r.request ? `Request: ${r.request.slice(0, 1500)}` : '',
        plan ? `Plan: ${plan.summary}` : '',
        `Result: ${out.summary}`,
        out.changes.length ? out.changes.slice(0, 20).map((c) => `- ${c.file}: ${c.change}`).join('\n') : '',
      ].filter(Boolean).join('\n')
    }),
  ].join('\n\n')
}

/** Origine de la branche : le ticket (Linear ou local) et ce qui a été réalisé dans Shipyard. */
async function branchOrigin(d: WorktreeDetail): Promise<string> {
  const local = !d.ticket ? d.worktree.localTicket : null
  const ticket = d.ticket
    ? [`Linear ticket ${d.ticket.id}: ${d.ticket.title}`, (d.ticket.description || '(no description)').slice(0, 5000), await ticketCommentsText(d)].filter(Boolean).join('\n\n')
    : local ? `Local ticket (no Linear ticket):\n${localTicketMarkdown(local).slice(0, 5000)}` : ''
  const history = workHistory(d)
  if (!ticket && !history) return ''
  return [
    '## Branch origin',
    'The feature this branch is about. Context to understand the request (when the user talks about "the feature", "the screen", "what we did", this is what they mean): it is not a list of things to redo.',
    ticket,
    history,
  ].filter(Boolean).join('\n\n')
}

export async function branchContext(d: WorktreeDetail): Promise<string> {
  const base = d.pr?.base ?? d.project.baseBranch
  const [stat, body, origin] = await Promise.all([git.diffStat(d.worktree.path, base).catch(() => ''), d.pr ? gh.prBody(d.project.repo, d.pr.number) : Promise.resolve(''), branchOrigin(d)])
  return [
    d.pr
      ? `PR #${d.pr.number} "${d.pr.title}" (base ${d.pr.base}${d.pr.labels.length ? `, labels: ${d.pr.labels.map((l) => l.name).join(', ')}` : ''}). ${d.pr.unresolvedThreads ? `${d.pr.unresolvedThreads} review comment(s) still open, outside the scope of this request.` : ''}`
      : `No PR yet: branch compared to ${base}.`,
    body ? `PR description (excerpt):\n${body.slice(0, 2500)}` : '',
    `Branch commits since ${base}:\n${d.commitsAhead.map((c) => `- ${c}`).join('\n') || '(none)'}`,
    stat ? `Files changed by the branch:\n${stat}` : '',
    d.dirtyFiles.length ? `Uncommitted changes in progress (the user's work, to keep):\n${d.dirtyFiles.map((f) => `- ${f.status} ${f.path}`).join('\n')}` : 'No uncommitted change.',
    origin,
  ].filter(Boolean).join('\n\n')
}

type LinkMode = 'plan' | 'work' | 'review' | 'comments'

const LINK_INTRO: Record<LinkMode, string> = {
  plan: 'This task spans several repositories at once: their worktrees are linked to this one and readable by their absolute path. Explore them like the current directory. Your plan covers the whole: each step says which repository it happens in, and files outside the current directory are given by absolute path.',
  work: 'This task spans several repositories at once: their worktrees are linked to this one. You can read and modify their files by absolute path, like those of the current directory. Implement the feature in every repository involved. Commits are then made from each worktree in Shipyard: do not commit anything.',
  review: 'This PR is part of a feature spread over several repositories: the linked PRs below are its other half. Read their diff to understand the whole.',
  comments: 'This PR is part of a feature spread over several repositories: their worktrees are linked to this one and readable by their absolute path. A fix here may require adapting the other side, or break it if that is not done.',
}

const LINK_RULES: Record<LinkMode, string[]> = {
  plan: [
    'keep the whole consistent: API contracts, shared types and enums, SDK, screens on both sides;',
    'order the steps so that each repository stays functional (e.g. API and SDK before the screens that use them).',
  ],
  work: [
    'keep the whole consistent: API contracts, shared types and enums, SDK, screens on both sides;',
    'follow the conventions and the CLAUDE.md of each repository, not only those of the current directory;',
    'check each repository you touch (typecheck, tests, launch if needed), in its own worktree;',
    'for git in a linked worktree: `git -C <path> status`, `git -C <path> diff`, `git -C <path> log`;',
    'in your report, group the changes by repository.',
  ],
  review: [
    'check that both sides agree: API fields and types, names, enums, error cases, what one side sends and what the other expects;',
    'a mismatch between the PRs goes in summary and, if it shows on a line of this PR, in a comment on that line;',
    'your comments only cover this PR\'s diff: the other PR has its own review.',
  ],
  comments: [
    'for each fix, search (Grep) whether what it touches is used on the other side: API contract (route, field, type, error code), shared enum or type, SDK, event name, environment variable, migration;',
    'for git in a linked worktree: `git -C <path> diff`, `git -C <path> log`.',
  ],
}

/**
 * Contexte des worktrees associés à celui-ci (projets du même groupe), pour les prompts qui le prennent en compte.
 * Sans lien, renvoie un texte vide : le prompt reste celui du travail sur un seul dépôt.
 */
export async function linkedContext(d: WorktreeDetail, mode: LinkMode): Promise<{ text: string; dirs: string[] }> {
  const linked = await linkedWorktrees(d.worktree)
  if (!linked.length) return { text: '', dirs: [] }
  const lines = await Promise.all(linked.map(async (l) => {
    const pr = l.pr
    const head = `- ${l.project.name} (${l.project.repo}): ${l.worktree.path}, branch ${l.worktree.branch ?? 'detached'}${pr ? `, PR #${pr.number} "${pr.title}" by ${pr.author}` : ', no PR yet'}${l.ticket ? `, ticket ${l.ticket.id} "${l.ticket.title}"` : ''}`
    if (mode !== 'review' || !pr) return head
    const ctx = await prContext(l.project.repo, pr.number, { cwd: l.project.path, base: pr.base }).catch(() => null)
    return ctx ? `${head}\n  Diff: ${ctx.diffPath}\n  Commits: ${ctx.commits.slice(0, 15).join(' · ') || '(none)'}` : head
  }))
  const rules = mode === 'work' ? linked.map((l) => `### Rules of ${l.project.name}\n\n${rulesFor(l.project.id)}`).join('\n\n') : ''
  return {
    text: ['## Linked repositories', LINK_INTRO[mode], lines.join('\n'), LINK_RULES[mode].map((r) => `- ${r}`).join('\n'), rules].filter(Boolean).join('\n\n'),
    dirs: linked.map((l) => l.worktree.path),
  }
}

type CaptureMode = 'plan' | 'shots' | 'test'

/** Dépôts concernés par le worktree (lui et ses worktrees liés), avec leur plateforme. */
export async function reposOf(d: WorktreeDetail): Promise<{ name: string; path: string; platform: Platform }[]> {
  const linked = await linkedWorktrees(d.worktree)
  return [{ name: d.project.name, path: d.worktree.path }, ...linked.map((l) => ({ name: l.project.name, path: l.worktree.path }))]
    .map((r) => ({ ...r, platform: platformOf(r.path) }))
}

function androidGuide(names: string, shotsDir: string | null, mode: CaptureMode): string {
  const avds = androidAvds()
  return [
    `### Android: ${names}`,
    'Mobile app: it is tested on the Android emulator, not in a browser nor with Playwright.',
    `- Emulator: reuse the one already running (\`adb devices\` lists an \`emulator-…\`). Otherwise, start it in the background: \`emulator -avd ${avds[0] ?? '<avd>'} -no-snapshot-save -no-boot-anim\`${avds.length > 1 ? ` (available AVDs: ${avds.join(', ')})` : ''}, then \`adb wait-for-device\` and wait until \`adb shell getprop sys.boot_completed\` returns 1.`,
    '- App: start it the way the repository says (CLAUDE.md, README, package.json scripts). For Expo, usually `npx expo run:android` (the first native build is long) or Metro with the dev client already installed. An API running locally on the Mac is reachable from the emulator at `10.0.2.2:<port>`.',
    '- Navigation: by deep link (`adb shell am start -a android.intent.action.VIEW -d "<scheme>://<path>"`, the scheme is in app.json or app.config.ts), otherwise by hand: `adb shell uiautomator dump /sdcard/ui.xml` then `adb pull` to locate the elements, and `adb shell input tap <x> <y>`, `input text`, `input swipe`, `input keyevent 4` (back).',
    mode === 'shots' && shotsDir
      ? `- Screenshot: \`adb shell screencap -p /sdcard/<name>.png\`, then \`adb pull /sdcard/<name>.png ${shotsDir}/<name>.png\`. Open the screenshot with Read to check the screen (loaded, no splash nor red error screen) before moving to the next one.`
      : mode === 'test' ? '- Replay the scenarios on the emulator; check each screen with a screenshot (`adb shell screencap`) read with Read.' : '',
    mode === 'plan' ? '' : mode === 'test'
      ? '- At the end: stop Metro and whatever you started, but leave the emulator running (Shipyard retrieves the video, then stops it itself).'
      : '- At the end: stop Metro and whatever you started. If you started the emulator yourself, stop it (`adb emu kill`).',
  ].filter(Boolean).join('\n')
}

function webGuide(names: string, mode: CaptureMode): string {
  return [
    `### Web: ${names}`,
    mode === 'shots'
      ? '- With the Playwright tools, open each route and take the screenshot: pass only the file name to the tool, the screenshots folder is already configured.'
      : mode === 'test' ? '- Replay the scenarios with the Playwright tools (navigation, clicks, forms).' : '- Screens are captured in the browser, with Playwright, at their route.',
  ].join('\n')
}

/**
 * Comment tester et capturer pour ce worktree : navigateur pour un dépôt web, émulateur Android pour une app mobile,
 * les deux quand des worktrees web et mobile sont liés.
 */
export async function captureContext(d: WorktreeDetail, mode: CaptureMode, shotsDir: string | null = null, onlySelf = false): Promise<string> {
  const repos = onlySelf ? [{ name: d.project.name, path: d.worktree.path, platform: platformOf(d.worktree.path) }] : await reposOf(d)
  const by = (p: Platform) => repos.filter((r) => r.platform === p).map((r) => r.name).join(', ')
  const web = by('web')
  const android = by('android')
  const both = !!web && !!android
  const intro = mode === 'plan'
    ? both
      ? `This task touches a web app (${web}) and a mobile app (${android}). Plan the screens on both sides: for each screen, platform is web or android, and route is the web route, or for Android the screen and how to get there (deep link, or path from the home screen). Name them \`web-…\` and \`android-…\`.`
      : android
        ? 'Mobile app: screens are captured on the Android emulator. platform is android, and route describes the screen and how to get there (deep link, or path from the home screen).'
        : 'platform is web for each screen.'
    : both
      ? 'The work touches a web app and a mobile app: take the screenshots and run the checks on both sides, each screen on the platform given by the plan.'
      : ''
  return ['## How to test and capture', intro, web && webGuide(web, mode), android && androidGuide(android, shotsDir, mode)].filter(Boolean).join('\n\n')
}

/** Commentaires Linear du ticket (précisions ajoutées après la description), vide s'il n'y en a pas. */
export async function ticketCommentsText(d: WorktreeDetail): Promise<string> {
  if (!d.ticket) return ''
  const { linearConfigured, ticketComments } = await import('../lib/linear.ts')
  if (!linearConfigured()) return ''
  const comments = await ticketComments(d.ticket.id).catch(warnOn('linear.ticketComments', []))
  if (!comments.length) return ''
  const date = (iso: string) => new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
  return [
    'Ticket comments: clarifications added after the description, to take into account. In case of contradiction, the most recent one wins over the description.',
    ...comments.map((c) => `- ${c.author}, ${date(c.createdAt)}:\n  ${c.body.slice(0, 3000).replace(/\n/g, '\n  ')}`),
  ].join('\n')
}

/** Worktrees liés, et ceux qui n'avaient aucune modification avant la correction : seuls ceux-là seront commités. */
export async function linkedForFix(d: WorktreeDetail) {
  const linked = await linkedWorktrees(d.worktree)
  const clean = await Promise.all(linked.map(async (l) => !(await git.dirtyFiles(l.worktree.path).catch(() => [null])).length))
  return { linked, cleanBefore: new Set(linked.filter((_, i) => clean[i]).map((l) => l.worktree.path)) }
}

export const linkedFixText = (linked: LinkedWorktree[]) => linked.length ? [
  '## Linked repositories',
  'The PR is part of a feature spread over several repositories. Modify a linked repository (by its absolute path) only if the validated fix says so, or if not adapting it would break the other side (API contract, shared type or enum, SDK). Say so in summary in that case.',
  ...linked.map((l) => `- ${l.project.name}: ${l.worktree.path}, branch ${l.worktree.branch ?? 'detached'}`),
].join('\n') : ''

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Le worktree doit être propre avant une action qui commite. Une fusion de la base en cours (fichiers de la base
 * en attente du commit de fusion) se signale comme telle : ce ne sont pas mes modifications.
 */
export function assertClean(d: WorktreeDetail, what: string) {
  assertNoMerge(d, what)
  if (d.dirtyFiles.length) throw new HttpError(409, `${d.dirtyFiles.length} fichier(s) non commité(s) : commite-les ou annule-les avant de ${what}`)
}

/** Fusion de la base en cours : ses fichiers ne sont pas mon travail, ils partent dans le commit de fusion (onglet Conflits). */
export function assertNoMerge(d: WorktreeDetail, what: string) {
  if (d.merge) {
    const from = d.merge.base ?? 'la base'
    throw new HttpError(409, d.merge.remaining.length
      ? `Une fusion de ${from} est en cours, avec ${d.merge.remaining.length} conflit(s) : termine-la ou annule-la dans l’onglet Conflits avant de ${what}.`
      : `Une fusion de ${from} est en cours (${d.dirtyFiles.length} fichier(s) de ${from} en attente du commit de fusion) : valide-la ou annule-la dans l’onglet Conflits avant de ${what}.`)
  }
}

export interface ProjectAction {
  kind: ActionKind
  input: ActionInput
  project: Project
}

export interface WorktreeAction extends ProjectAction {
  d: WorktreeDetail
  vars: Record<string, string | number | null>
  scope: RunScope
  cwd: string
  needPr: () => NonNullable<WorktreeDetail['pr']>
}

export type ProjectActions = Partial<Record<ActionKind, (a: ProjectAction) => Promise<Run>>>
export type WorktreeActions = Partial<Record<ActionKind, (a: WorktreeAction) => Promise<Run>>>
