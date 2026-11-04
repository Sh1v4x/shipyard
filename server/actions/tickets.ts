import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { Run, InsightsMode, TicketDraftOutput, TicketPlanOutput, TicketWorkOutput } from '../../shared/types.ts'
import { HttpError, loadProjects } from '../lib/config.ts'
import { getRun, listRuns, setRunDecision, startRun } from '../lib/claude.ts'
import { run } from '../lib/exec.ts'
import * as git from '../lib/git.ts'
import { rulesFor } from '../lib/rules.ts'
import * as schemas from '../schemas.ts'
import { groupedProjects, linkedWorktrees } from '../services.ts'
import { saveSnapshots, takeSnapshots } from '../lib/snapshots.ts'
import { DIGESTS_DIR, buildDigest } from '../lib/digest.ts'
import { type ProjectActions, type WorktreeAction, type WorktreeActions, branchContext, captureContext, linkedContext, specFrom, ticketCommentsText } from './context.ts'
import { createCheckout, releaseCheckout } from './checkouts.ts'
import { shotsDirOf } from '../lib/runArtifacts.ts'

/** Ce que demande chaque mode de « Features & optimisations ». */
const INSIGHTS_MODE: Record<InsightsMode, string> = {
  features: 'Ideas for new product features: what users are missing, what the existing data or screens would almost already allow, incomplete user flows. Each idea must be realistic in this code (category: feature).',
  improve: 'Areas of improvement for the existing code: performance, security, technical debt, missing tests, accessibility, UX, developer experience, architecture. Precise findings, with the files and what needs to change.',
  // La review d'une PR porte sur un diff : ici, la même exigence sur tout le code du dépôt.
  review: [
    'A review of the whole project, as strict as the review of a PR whose diff would be the entire codebase. Apply the team dev rules and review standard below (they win over your own preferences):',
    '1. Fast pass: run the mechanical checks of the review standard and of the audit checklist across the repository with Grep (arbitrary Tailwind values, raw elements, string literals where an enum exists, locale/country/currency hardcoding, console.log, avoidable casts, comments…). Check every hit in the code before keeping it.',
    '2. Then read by hand, area by area (use subagents in parallel): correctness (inverted logic, unhandled edge cases, silent fallbacks, race conditions, missing cleanup), security, architecture as the standard demands (shared code in packages/, enums, no hardcoding, duplicated rules), dead code, hand-rolled code where a library or helper exists, database/money/types/tests/async as the checklist says.',
    'Each finding names the rule or the bug, the files, and the fix. Category: bug, sécurité, convention, architecture, dette, tests or performance. Impact: fort for a bug, a security hole or a hard rule broken.',
  ].join('\n'),
}

/** Plan validé, mis en forme pour le prompt de travail. */
function formatPlan(p: TicketPlanOutput): string {
  return [
    p.summary,
    '',
    ...p.steps.map((st, i) => `${i + 1}. ${st.title}\n   ${st.details}${st.files.length ? `\n   Files: ${st.files.join(', ')}` : ''}`),
    '',
    p.screenshots.length ? `Screens to capture:\n${p.screenshots.map((x) => `- ${x.name}: ${x.route} (${x.description})`).join('\n')}` : 'No screen to capture: no visible effect.',
    p.risks.length ? `\nPoints of attention:\n${p.risks.map((r) => `- ${r}`).join('\n')}` : '',
  ].join('\n')
}

/** Dernier plan réussi du worktree, pour un correctif lancé hors de l'onglet Ticket. */
function lastPlanId({ project, worktree }: WorktreeAction['scope']): string | null {
  return [...listRuns({ project, worktree, kind: 'ticket-plan', status: 'success' }, 1), ...listRuns({ project, worktree, kind: 'change-plan', status: 'success' }, 1)]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]?.id ?? null
}

/** Plan d'une seule étape tiré de la consigne, quand le worktree n'a jamais eu de plan. */
function requestPlan(request: string): TicketPlanOutput {
  return { summary: request, steps: [{ title: 'Apply the requested fix', details: request, files: [] }], screenshots: [], risks: [], questions: [] }
}

async function planAction({ kind, input, d, scope, cwd, vars }: WorktreeAction): Promise<Run> {
  const prev = input.previousRunId ? getRun(input.previousRunId) : null
  const prevPlan = prev?.structured as TicketPlanOutput | null
  const feedback = input.feedback?.trim()
  // Lors d'un échange sur le plan, la demande d'origine vient du plan précédent (l'écran ne la garde pas).
  const request = input.extra?.trim() || (feedback ? prev?.request?.trim() : '') || ''
  if (kind === 'change-plan' && !request && !(feedback && prevPlan)) throw new HttpError(400, 'Décris la modification à faire')
  const [linked, capture, comments] = await Promise.all([linkedContext(d, 'plan'), captureContext(d, 'plan'), kind === 'ticket-plan' ? ticketCommentsText(d) : ''])
  return startRun(
    specFrom(kind, {
      ...vars,
      'ticket.comments': comments,
      linked: linked.text,
      capture,
      context: kind === 'change-plan' ? await branchContext(d) : '',
      consigne: request || (feedback && prevPlan ? 'the one from the previous plan below' : 'none'),
      previous: prevPlan && feedback ? `Previous plan:\n${formatPlan(prevPlan)}` : '',
      feedback: feedback ? `The user's message about this plan:\n${feedback}` : '',
    }, {
      kind, title: feedback ? 'Échange sur le plan' : kind === 'change-plan' ? 'Plan de la modification' : `Plan ${d.ticket?.id ?? 'de la tâche'}`, scope, cwd, schema: schemas.ticketPlanSchema, note: feedback ?? null, request: request || null,
      addDirs: linked.dirs,
      // En révision, on reprend la session : l'agent a déjà exploré le code.
      resume: feedback ? prev?.sessionId : null,
    }),
  )
}

async function workAction({ kind, input, project, d, scope, cwd, vars }: WorktreeAction): Promise<Run> {
  // Un correctif demandé depuis l'onglet Tests n'a pas de plan à lui : il reprend le dernier plan du worktree,
  // sinon sa consigne fait office de plan.
  const planId = input.planRunId ?? (input.extra?.trim() ? lastPlanId(scope) : null)
  const planRun = planId ? getRun(planId) : null
  const plan = (planRun?.structured as TicketPlanOutput | null) ?? (input.extra?.trim() ? requestPlan(input.extra.trim()) : null)
  if (!plan) throw new HttpError(400, 'Approuve d’abord un plan')
  const previous = input.resumeFrom ? getRun(input.resumeFrom) : null
  const feedback = input.feedback?.trim()
  const id = randomUUID()
  const shotsDir = shotsDirOf(id)
  const playwright = { playwright: { command: 'npx', args: ['-y', '@playwright/mcp@latest', '--headless', '--isolated', '--viewport-size', '1440,900', '--output-dir', shotsDir] } }

  if (input.retest) {
    const report = previous?.structured as TicketWorkOutput | null
    if (!previous || !report) throw new HttpError(400, 'Aucun compte rendu à re-tester')
    // Le re-test reprend les captures existantes et les remplace au besoin.
    if (existsSync(shotsDirOf(previous.id))) renameSync(shotsDirOf(previous.id), shotsDir)
    else mkdirSync(shotsDir, { recursive: true })
    setRunDecision(previous.id, 'revised')
    // La photo d'avant le travail suit le dernier compte rendu.
    const snaps = takeSnapshots(previous.id)
    if (snaps) saveSnapshots(id, snaps)
    // Captures « avant » manquantes : tant que le travail n'est pas commité, le dernier commit est l'état d'avant.
    const hasBefore = report.screenshots.some((s) => s.before && existsSync(join(shotsDir, s.before.split('/').pop()!)))
    let beforeDir: string | null = null
    if (!hasBefore && d.dirtyFiles.length) {
      beforeDir = await createCheckout(id, project)
    }
    try {
      return startRun(
        specFrom('retest', {
          ...vars,
          plan: formatPlan(plan),
          report: JSON.stringify(report, null, 2),
          'shots.dir': shotsDir,
          capture: await captureContext(d, 'shots', shotsDir),
          'before.dir': beforeDir ?? (hasBefore ? 'none: the "before" screenshots already exist, keep them' : 'none: the work is already committed, there is no "before" state left to run'),
          note: feedback ? `## The user's note for this re-test\n\n${feedback}` : '',
        }, {
          id, kind, title: 'Re-test', scope: { ...scope, ref: input.planRunId }, cwd,
          schema: schemas.ticketWorkSchema, addDirs: [shotsDir, ...(beforeDir ? [beforeDir] : []), ...(await linkedWorktrees(d.worktree)).map((l) => l.worktree.path)],
          resume: previous.sessionId, mcpServers: playwright,
        }),
      )
    } catch (e) {
      if (beforeDir) await releaseCheckout(id)
      throw e
    }
  }

  // Photo des worktrees (lui et ses liés) avant le travail, pour pouvoir l'annuler sans toucher au reste.
  // Des corrections reprennent la photo du premier passage.
  const inherited = previous ? takeSnapshots(previous.id) : null
  const linkedDirs = (await linkedWorktrees(d.worktree)).map((l) => l.worktree.path)
  saveSnapshots(id, inherited ?? { ref: id, snaps: await Promise.all([cwd, ...linkedDirs].map((p) => git.snapshot(p, id))) })

  // Des corrections gardent les captures « avant » du passage précédent.
  if (previous && existsSync(shotsDirOf(previous.id))) {
    renameSync(shotsDirOf(previous.id), shotsDir)
    setRunDecision(previous.id, 'revised')
  } else mkdirSync(shotsDir, { recursive: true })
  const key = kind === 'change' ? 'change' : d.ticket || d.worktree.localTicket ? 'ticket' : 'free'
  const [linked, capture, comments] = await Promise.all([linkedContext(d, 'work'), captureContext(d, 'shots', shotsDir), key === 'ticket' ? ticketCommentsText(d) : ''])
  return startRun(
    specFrom(key, {
      ...vars,
      'ticket.comments': comments,
      linked: linked.text,
      capture,
      context: kind === 'change' ? await branchContext(d) : '',
      consigne: input.extra?.trim() || planRun?.request?.trim() || 'none',
      plan: formatPlan(plan),
      feedback: feedback ?? '',
      'shots.dir': shotsDir,
      rules: rulesFor(project.id),
    }, {
      id, kind, title: feedback ? 'Corrections' : kind === 'change' ? 'Modification libre' : d.ticket ? `Réaliser ${d.ticket.id}` : d.worktree.localTicket ? `Réaliser « ${d.worktree.localTicket.title.slice(0, 60)} »` : 'Tâche libre', scope: { ...scope, ref: planId ?? undefined }, cwd,
      schema: schemas.ticketWorkSchema, addDirs: [shotsDir, ...linked.dirs], resume: feedback ? previous?.sessionId : null,
      mcpServers: playwright,
    }),
  )
}

export const ticketsActions: WorktreeActions = {
  'ticket-plan': planAction,
  'change-plan': planAction,
  ticket: workAction,
  change: workAction,
}

export const ticketsProjectActions: ProjectActions = {
  'branch-name': async ({ kind, input, project }) => {
    const { ticketById } = await import('../lib/linear.ts')
    const t = input.ticketId ? await ticketById(input.ticketId) : null
    if (!t) throw new HttpError(404, `Ticket introuvable : ${input.ticketId}`)
    return startRun(
      specFrom('branch-name', { 'ticket.id': t.id, 'ticket.title': t.title, 'ticket.type': t.type }, {
        kind, title: `Nom de branche · ${t.id}`, scope: { project: project.id, ref: t.id }, cwd: project.path, schema: schemas.branchNameSchema,
      }),
    )
  },
  insights: async ({ kind, input, project }) => {
    const mode: InsightsMode = input.insights === 'improve' || input.insights === 'review' ? input.insights : 'features'
    const digest = await buildDigest(project, input.digest === 'map' ? 'map' : 'auto')
    const grouped = groupedProjects(project).filter((p) => existsSync(p.path))
    return startRun(
      specFrom('insights', {
        'project.name': project.name,
        repo: project.repo,
        mode: INSIGHTS_MODE[mode],
        count: mode === 'review'
          ? '10 to 30 findings, depending on what the code justifies. Group a recurring problem into one finding that lists every file where it occurs.'
          : '5 to 12 proposals, depending on what the project justifies. Better 5 solid proposals than 12 average ones.',
        'digest.path': digest.path,
        'digest.mode': digest.mode === 'full' ? 'Full digest: the content of every analyzed file' : 'Project map only (tree and key files): the repository is too large for a full digest, read the rest of the code directly',
        'digest.stats': `${digest.files} files, ~${Math.round(digest.digestTokens / 1000)}k tokens, commit ${digest.sha}`,
        consigne: input.extra?.trim() || 'none',
        others: grouped.length ? grouped.map((p) => `  - ${p.name} (${p.repo}): ${p.path}`).join('\n') : '  (none)',
        rules: rulesFor(project.id),
      }, {
        kind, title: { features: 'Idées de features', improve: 'Axes d’amélioration', review: 'Analyse du projet' }[mode], scope: { project: project.id, ref: mode }, cwd: project.path,
        schema: schemas.insightsSchema, addDirs: [DIGESTS_DIR, ...grouped.map((p) => p.path)], request: input.extra?.trim() || null,
      }),
    )
  },
  'ticket-draft': async ({ kind, input, project }) => {
    if (!project.team) throw new HttpError(400, 'Aucune équipe Linear configurée pour ce projet')
    const { teamMeta } = await import('../lib/linear.ts')
    const prev = input.previousRunId ? getRun(input.previousRunId) : null
    const prevDraft = prev?.structured as TicketDraftOutput | null
    const feedback = input.feedback?.trim()
    const [meta, branch] = await Promise.all([teamMeta(project.team), run('git', ['branch', '--show-current'], { cwd: project.path }).catch(() => '')])
    // Projets du groupe : la feature peut se développer sur plusieurs dépôts. Les autres restent consultables en lecture.
    const grouped = groupedProjects(project).filter((p) => existsSync(p.path))
    const others = loadProjects().filter((p) => p.id !== project.id && existsSync(p.path) && !grouped.includes(p))
    return startRun(
      specFrom('ticket-draft', {
        'project.name': project.name,
        repo: project.repo,
        base: project.baseBranch,
        branch: branch.trim() || 'unknown',
        feature: input.extra?.trim() || '(not specified)',
        previous: prevDraft && feedback ? `## Previous draft\n\n${prevDraft.tickets.map((t) => `### ${t.title}\n\n${t.description}`).join('\n\n')}` : '',
        feedback: feedback ? `## The user's answers and feedback\n\n${feedback}` : '',
        others: others.length ? others.map((p) => `  - ${p.name} (${p.repo}): ${p.path}`).join('\n') : '  (none)',
        linked: grouped.length ? [
          '## Linked repositories',
          `${project.name} is grouped with other repositories: a feature is often developed on several of them at once (e.g. API and SDK on one side, screens on the other). Explore them like the main repository, not only for what is shared:`,
          grouped.map((p) => `- ${p.name} (${p.repo}): ${p.path}`).join('\n'),
          '- in each ticket, list the repositories involved under the Référent line ("Dépôts : app, app-mobile") and in repos;\n- in "Fichiers concernés", prefix each path with its repository (`app-mobile/src/…`);\n- one ticket covers the feature across all repositories: never split by repository on your own.',
        ].join('\n\n') : '',
        rules: rulesFor(project.id),
        labels: meta.labels.map((l) => l.name).join(', ') || '(none)',
        projects: meta.projects.map((p) => p.name).join(', ') || '(none)',
        repos: [project, ...grouped].map((p) => p.name).join(', '),
      }, {
        kind, title: feedback ? 'Affinage des tickets' : 'Rédaction des tickets', scope: { project: project.id, ref: 'ticket-draft' }, cwd: project.path,
        schema: schemas.ticketDraftSchema, addDirs: [...grouped, ...others].map((p) => p.path),
        // En affinage, on reprend la session : l'agent a déjà exploré le code.
        resume: feedback ? prev?.sessionId : null,
      }),
    )
  },
}
