
import type { ActionInput, ActionKind, Project, Run } from '../shared/types.ts'
import { HttpError, getProject } from './lib/config.ts'
import { cancelRun, getRun, listRuns, setRunDecision, waitForRun } from './lib/claude.ts'
import { run } from './lib/exec.ts'
import * as git from './lib/git.ts'
import { shotsDirOf } from './lib/runArtifacts.ts'
import { revertRun } from './lib/snapshots.ts'
import { rmSync } from 'node:fs'
import { worktreeDetail, worktreePath } from './services.ts'
import { baseVars, type ProjectActions, type WorktreeActions } from './actions/context.ts'
import { ciActions } from './actions/ci.ts'
import { commentsActions } from './actions/comments.ts'
import { commitsActions } from './actions/commits.ts'
import { conflictsActions } from './actions/conflicts.ts'
import { dailyAction } from './actions/daily.ts'
import { reviewActions } from './actions/review.ts'
import { sdkActions } from './actions/sdk.ts'
import { testsActions } from './actions/tests.ts'
import { ticketsActions, ticketsProjectActions } from './actions/tickets.ts'

const PROJECT_ACTIONS: ProjectActions = { ...ticketsProjectActions }
const WORKTREE_ACTIONS: WorktreeActions = {
  ...ticketsActions,
  ...conflictsActions,
  ...commitsActions,
  ...reviewActions,
  ...commentsActions,
  ...testsActions,
  ...ciActions,
  ...sdkActions,
}

export async function startAction(kind: ActionKind, input: ActionInput): Promise<Run> {
  if (kind === 'daily') return dailyAction(input)

  const project = getProject(input.project)
  const projectAction = Object.hasOwn(PROJECT_ACTIONS, kind) ? PROJECT_ACTIONS[kind] : undefined
  if (projectAction) return projectAction({ kind, input, project })

  const worktreeAction = Object.hasOwn(WORKTREE_ACTIONS, kind) ? WORKTREE_ACTIONS[kind] : undefined
  if (!worktreeAction) throw new HttpError(400, `Action inconnue : ${kind}`)
  if (!input.worktree) throw new HttpError(400, 'Worktree manquant')
  const d = await worktreeDetail(project, input.worktree, true)
  const needPr = () => {
    if (!d.pr) throw new HttpError(400, 'Ce worktree n’a pas de PR')
    return d.pr
  }
  return worktreeAction({
    kind, input, project, d, needPr,
    vars: baseVars(d),
    scope: { project: project.id, worktree: input.worktree, pr: d.pr?.number },
    cwd: d.worktree.path,
  })
}

/**
 * Paramètres d'un run lancé avant leur enregistrement : seuls les plans se reconstruisent (message, demande,
 * et le dernier plan réussi qui le précède). Pour les autres actions, null.
 */
export function legacyInput(r: Run): ActionInput | null {
  if (r.kind !== 'ticket-plan' && r.kind !== 'change-plan') return null
  const prev = r.note
    ? listRuns({ project: r.scope.project, worktree: r.scope.worktree, kind: r.kind, status: 'success' }, 100).find((x) => x.startedAt < r.startedAt)
    : undefined
  if (r.note && !prev) return null
  return { project: r.scope.project, worktree: r.scope.worktree, extra: r.request ?? undefined, feedback: r.note ?? undefined, previousRunId: prev?.id }
}

/**
 * Abandonne la démarche en cours (plan et/ou travail) : arrête les agents encore actifs, remet les fichiers
 * qu'ils ont changés (worktree et worktrees liés, d'après la photo prise avant le travail), et écarte les runs
 * pour repartir d'une consigne neuve. Sans photo (travail lancé avant leur mise en place), `all` annule toutes
 * les modifications non commitées du worktree ; sinon rien n'est touché et `needsAll` le signale.
 */
export async function abandonAgent(project: Project, wtId: string, ids: { plan?: string; work?: string; all?: boolean }): Promise<{ reverted: 'agent' | 'all' | 'none'; needsAll: boolean }> {
  const wtPath = await worktreePath(project, wtId)
  const runs = [ids.plan, ids.work].filter((x): x is string => !!x)
  // Les ids désignent des fichiers (captures du run) : seuls les runs de ce worktree sont acceptés.
  for (const id of runs) if (getRun(id)?.scope.worktree !== wtId) throw new HttpError(404, `Run introuvable sur ce worktree : ${id}`)
  for (const id of runs) if (cancelRun(id)) await waitForRun(id)
  let reverted: 'agent' | 'all' | 'none' = 'none'
  let needsAll = false
  if (ids.work) {
    if (await revertRun(ids.work)) reverted = 'agent'
    else if (ids.all) {
      await run('git', ['restore', '--staged', '--worktree', '.'], { cwd: wtPath })
      await run('git', ['clean', '-fd'], { cwd: wtPath })
      reverted = 'all'
    } else needsAll = (await git.dirtyFiles(wtPath)).length > 0
    rmSync(shotsDirOf(ids.work), { recursive: true, force: true })
  }
  if (!needsAll) for (const id of runs) setRunDecision(id, 'declined')
  return { reverted, needsAll }
}
