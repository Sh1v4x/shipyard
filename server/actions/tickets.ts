import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { Run, InsightsMode, TicketDraftOutput, TicketPlanOutput, TicketWorkOutput } from '../../shared/types.ts'
import { HttpError, loadProjects } from '../lib/config.ts'
import { getRun, setRunDecision, startRun } from '../lib/claude.ts'
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
  const planRun = input.planRunId ? getRun(input.planRunId) : null
  const plan = planRun?.structured as TicketPlanOutput | null
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
      id, kind, title: feedback ? 'Corrections' : kind === 'change' ? 'Modification libre' : d.ticket ? `Réaliser ${d.ticket.id}` : 'Tâche libre', scope: { ...scope, ref: input.planRunId }, cwd,
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
    const mode: InsightsMode = input.insights === 'improve' ? 'improve' : 'features'
    const digest = await buildDigest(project, input.digest === 'map' ? 'map' : 'auto')
    const grouped = groupedProjects(project).filter((p) => existsSync(p.path))
    return startRun(
      specFrom('insights', {
        'project.name': project.name,
        repo: project.repo,
        mode: mode === 'features'
          ? 'Ideas for new product features: what users are missing, what the existing data or screens would almost already allow, incomplete user flows. Each idea must be realistic in this code (category: feature).'
          : 'Areas of improvement for the existing code: performance, security, technical debt, missing tests, accessibility, UX, developer experience, architecture. Precise findings, with the files and what needs to change.',
        'digest.path': digest.path,
        'digest.mode': digest.mode === 'full' ? 'Full digest: the content of every analyzed file' : 'Project map only (tree and key files): the repository is too large for a full digest, read the rest of the code directly',
        'digest.stats': `${digest.files} files, ~${Math.round(digest.digestTokens / 1000)}k tokens, commit ${digest.sha}`,
        consigne: input.extra?.trim() || 'none',
        others: grouped.length ? grouped.map((p) => `  - ${p.name} (${p.repo}): ${p.path}`).join('\n') : '  (none)',
        rules: rulesFor(project.id),
      }, {
        kind, title: mode === 'features' ? 'Idées de features' : 'Axes d’amélioration', scope: { project: project.id, ref: mode }, cwd: project.path,
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
          '- in each ticket, list the repositories involved under the Référent line ("Dépôts : app, app-mobile");\n- in "Fichiers concernés", prefix each path with its repository (`app-mobile/src/…`);\n- split by repository only if each part can ship on its own; otherwise, one ticket covers the feature across all repositories.',
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
