import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import type {
  ChecksAnalyzeOutput, CiAllOutput, CommentsOutput, ConflictResolveOutput, ManualTestOutput, FollowupOutput, InboxItem, InsightsOutput, PrReviewOutput, ReviewDecisions, ReviewOutput, TicketDraftOutput, TicketPlanOutput,
} from '../shared/types.ts'
import { runHref } from '../shared/inbox.ts'
import { allRuns } from './lib/claude.ts'
import { readJsonFile } from './lib/store.ts'
import { isGhostRun } from './lib/ghosts.ts'
import { testIssues } from './lib/progress.ts'
import type { RunRecord } from './lib/runStore.ts'
import { manualEnvAlive } from './lib/manualEnv.ts'
import { decodeId, loadProjects } from './lib/config.ts'
import { createdTicketsPath, reviewDecisionsPath } from './lib/runArtifacts.ts'
import * as git from './lib/git.ts'
import * as gh from './lib/github.ts'
import { jsonFile } from './lib/store.ts'
import { warnOn } from './lib/log.ts'
import { plural } from '../shared/text.ts'

// « À valider » : ce que les agents terminés attendent de moi. Calculé à partir des runs enregistrés :
// seul le dernier run d'un même type et d'une même portée compte, et un élément disparaît dès qu'il est traité
// (plan lancé, travail décidé, review envoyée, tickets créés…), dès que je l'ouvre pour un simple résultat à lire
// (test, diagnostic, échec), ou que je l'écarte.

const dismissed = jsonFile<string[]>('inbox-dismissed.json', [])

export function dismissInbox(runId: string) {
  dismissed.write([runId, ...dismissed.read().filter((id) => id !== runId)].slice(0, 500))
}


/** Sous-runs d'une tâche découpée : seule la tâche parente apparaît. */
const PARTS = new Set(['review-part', 'self-review-part', 'test-part'])
/** Runs qui n'attendent rien de moi une fois finis (le correctif est déjà poussé, ou c'est une aide ponctuelle). */
const SILENT = new Set(['ci-fix-all', 'hook-fix-plan', 'findings-fix-all', 'finding-fix', 'ci-fix', 'commit-fix', 'branch-name', 'daily', 'commit-exec', 'comment-fix', 'general-fix', 'comments-fix-all', 'comment-reply', 'merge-finish', 'pr-video'])

type Draft = Pick<InboxItem, 'title' | 'detail' | 'tone'> & { until?: string; clearsOnOpen?: boolean } | null

/**
 * Fils analysés par le run encore à traiter : toujours ouverts sur GitHub, sans réponse de ma part depuis l'analyse.
 * null si GitHub ne répond pas (l'élément reste affiché).
 */
async function pendingThreads(run: RunRecord, repo: string | undefined, ids: string[]): Promise<string[] | null> {
  if (!repo || !run.scope.pr) return null
  const [threads, login] = await Promise.all([gh.threads(repo, run.scope.pr).catch(warnOn('gh.threads', null)), gh.me().catch(warnOn('gh.me', null))])
  if (!threads) return null
  return ids.filter((id) => {
    const t = threads.find((x) => x.id === id)
    if (!t || t.isResolved) return false
    const last = t.comments.at(-1)
    return !(last && last.author === login && last.createdAt > run.startedAt)
  })
}

/** Résultat à lire seulement : il disparaît dès qu'on l'ouvre. */
const READ = { clearsOnOpen: true, until: 'disparaît quand tu l’ouvres' }

/** Ce que le run attend de moi, ou null s'il n'attend rien (ou plus rien). */
async function awaiting(run: RunRecord, runs: RunRecord[], repo?: string): Promise<Draft> {
  const later = (kinds: string[], same: (r: RunRecord) => boolean = (r) => r.scope.worktree === run.scope.worktree) =>
    runs.some((r) => kinds.includes(r.kind) && same(r) && r.startedAt > run.startedAt)

  // Commit refusé par un hook : la correction attend que je valide une solution (sauf si une est déjà en cours).
  const blocked = run.blockedCommit
  if (blocked && !blocked.resolvedBy) {
    return later(['hook-fix'], (r) => r.scope.ref === run.id) ? null : { title: 'Commit refusé par un hook : solution à valider', detail: run.title, tone: 'amber', until: 'disparaît quand une solution est appliquée' }
  }
  if (run.status === 'error') return { title: 'Échec', detail: run.title, tone: 'red', ...READ }
  if (run.status !== 'success') return null
  const out = run.structured

  switch (run.kind) {
    case 'ticket-plan':
    case 'change-plan': {
      const work = run.kind === 'ticket-plan' ? 'ticket' : 'change'
      if (runs.some((r) => r.kind === work && r.scope.ref === run.id)) return null
      const q = (out as TicketPlanOutput | null)?.questions.length ?? 0
      const answered = !!run.note && !!(out as TicketPlanOutput | null)?.reply
      return { title: answered ? 'Plan : réponse à ton message' : 'Plan prêt à valider', detail: q ? `${q} question(s) à trancher` : null, tone: 'blue', until: 'disparaît quand tu lances le travail' }
    }
    case 'ticket':
    case 'change':
      if (run.decision) return null
      return { title: 'Travail terminé : approuver ou corriger', detail: 'Captures avant / après et audit', tone: 'green', until: 'disparaît quand tu approuves ou demandes une correction' }
    case 'review': {
      const d = readJsonFile<ReviewDecisions>(reviewDecisionsPath(run.id))
      if (d?.published) return null
      const total = (out as PrReviewOutput | null)?.comments.length ?? 0
      const sorted = (d?.approved.length ?? 0) + (d?.ignored.length ?? 0)
      return { title: total ? 'Review prête : commentaires à trier' : 'Review prête : rien à signaler', detail: total ? `${total - sorted} à trier sur ${total}` : null, tone: 'purple', until: 'disparaît quand la review est envoyée' }
    }
    case 'self-review': {
      const n = (out as ReviewOutput | null)?.findings.length ?? 0
      return { title: 'Auto-review terminée', detail: n ? `${n} remarque(s)` : 'Aucune remarque', tone: 'purple', ...READ }
    }
    case 'comments-analyze': {
      const all = (out as CommentsOutput | null)?.items ?? []
      const pending = await pendingThreads(run, repo, all.map((i) => i.threadId))
      if (pending && !pending.length) return null
      const n = pending ? pending.length : all.length
      return { title: 'Analyse des commentaires prête', detail: `${plural(n, 'commentaire', 'commentaires')} encore à traiter`, tone: 'amber', until: 'disparaît quand chaque commentaire est traité' }
    }
    case 'followup-check': {
      const all = (out as FollowupOutput | null)?.items ?? []
      // Disparaît une fois chaque fil traité (résolu, ou répondu depuis l'analyse).
      const pending = await pendingThreads(run, repo, all.map((i) => i.threadId))
      if (pending && !pending.length) return null
      const items = pending ? all.filter((i) => pending.includes(i.threadId)) : all
      const open = items.filter((i) => i.status !== 'corrigé').length
      return { title: 'Suivi de tes retours prêt', detail: `${plural(items.length, 'fil', 'fils')} à traiter · ${items.length - open} corrigé(s), ${open} à revoir`, tone: open ? 'amber' : 'green', until: 'disparaît quand chaque fil est traité' }
    }
    case 'conflict-resolve': {
      const wt = run.scope.worktree
      const merge = wt && existsSync(decodeId(wt)) ? await git.mergeState(decodeId(wt)).catch(() => null) : null
      if (!merge) return null
      const q = (out as ConflictResolveOutput | null)?.questions.length ?? 0
      return q
        ? { title: 'Conflits : questions en attente', detail: `${q} question(s)`, tone: 'amber', until: 'disparaît quand la fusion est validée' }
        : { title: merge.remaining.length ? 'Conflits : relecture nécessaire' : 'Conflits résolus : valider et pousser', detail: merge.remaining.length ? `${merge.remaining.length} fichier(s) encore en conflit` : null, tone: merge.remaining.length ? 'amber' : 'green', until: 'disparaît quand la fusion est validée' }
    }
    case 'dirty-triage': {
      const wt = run.scope.worktree
      const left = wt && existsSync(decodeId(wt)) ? (await git.dirtyFiles(decodeId(wt)).catch(() => [])).length : 0
      if (!left) return null
      return { title: 'Fichiers non commités : à trier avant la fusion', detail: `${left} fichier(s)`, tone: 'amber', until: 'disparaît quand les fichiers sont triés' }
    }
    case 'commit-plan':
      if (later(['commit-exec'])) return null
      return { title: 'Plan de commits à valider', detail: null, tone: 'blue', until: 'disparaît quand les commits sont faits' }
    case 'pr-prepare':
      return { title: 'PR prête à créer', detail: 'Relis le titre et la description, puis pousse', tone: 'blue', until: 'disparaît quand la PR est créée' }
    case 'test': {
      const ko = testIssues(run)
      return { title: 'Test terminé', detail: ko ? `${ko} point(s) en échec ou à vérifier` : 'Tout passe', tone: ko ? 'red' : 'green', ...READ }
    }
    case 'test-manual': {
      if (!manualEnvAlive(run.id)) return null
      const n = (out as ManualTestOutput | null)?.steps.length ?? 0
      return { title: 'Environnement prêt : à toi de tester', detail: `${plural(n, 'étape', 'étapes')} à suivre`, tone: 'green', ...READ }
    }
    case 'insights': {
      const n = (out as InsightsOutput | null)?.items.length ?? 0
      return { title: run.scope.ref === 'improve' ? 'Axes d’amélioration prêts' : 'Idées de features prêtes', detail: `${n} proposition(s)`, tone: 'blue', ...READ }
    }
    case 'checks-analyze': {
      if (later(['checks-fix'], (r) => r.scope.worktree === run.scope.worktree && r.scope.ref === run.scope.ref)) return null
      const n = (out as ChecksAnalyzeOutput | null)?.items.filter((i) => i.verdict === 'fix').length ?? 0
      return { title: 'Contrôle analysé', detail: n ? `${plural(n, 'problème', 'problèmes')} à corriger` : 'Rien à corriger', tone: n ? 'amber' : 'green', ...READ }
    }
    case 'ci-analyze-all': {
      if (later(['ci-fix-all'])) return null
      const n = (out as CiAllOutput | null)?.jobs.filter((j) => j.fixable).length ?? 0
      return { title: 'Diagnostic CI prêt', detail: n ? `${plural(n, 'job corrigeable', 'jobs corrigeables')}` : 'Rien à corriger dans le code', tone: 'amber', ...READ }
    }
    case 'ci-analyze':
      return { title: 'Diagnostic CI prêt', detail: null, tone: 'amber', ...READ }
    case 'ticket-draft': {
      const created = readJsonFile<unknown[]>(createdTicketsPath(run.id)) ?? []
      const n = (out as TicketDraftOutput | null)?.tickets.length ?? 0
      if (created.length >= n) return null
      const q = (out as TicketDraftOutput | null)?.questions.length ?? 0
      return { title: 'Tickets rédigés : à créer', detail: q ? `${n} ticket(s), ${q} question(s)` : `${n} ticket(s)`, tone: 'blue', until: 'disparaît quand les tickets sont créés' }
    }
    default:
      return null
  }
}

export async function inboxItems(): Promise<InboxItem[]> {
  const projects = new Map(loadProjects().map((p) => [p.id, p]))
  const hidden = new Set(dismissed.read())
  const runs = allRuns().filter((r) => !PARTS.has(r.kind) && (projects.has(r.scope.project) || r.scope.project === 'all'))
  // Seul le dernier run d'un même type et d'une même portée compte (un plan révisé remplace le précédent).
  const latest = new Map<string, RunRecord>()
  for (const r of runs) {
    const ref = r.kind === 'ticket' || r.kind === 'change' ? '' : r.scope.ref ?? ''
    const key = `${r.kind}|${r.scope.project}|${r.scope.worktree ?? ''}|${ref}`
    const cur = latest.get(key)
    if (!cur || r.startedAt > cur.startedAt) latest.set(key, r)
  }
  const items: InboxItem[] = []
  for (const r of latest.values()) {
    if (hidden.has(r.id) || r.status === 'running' || r.status === 'cancelled') continue
    // PR ou worktree mis de côté : ses résultats d'agents attendent qu'il soit réveillé.
    if (isGhostRun(r.scope.project, r.scope)) continue
    // Un échec se signale toujours ; un succès seulement s'il attend une action.
    // Un commit en attente (refusé par un hook) se signale même pour une action d'habitude silencieuse.
    if (SILENT.has(r.kind) && r.status !== 'error' && !(r.blockedCommit && !r.blockedCommit.resolvedBy)) continue
    // Worktree supprimé depuis : plus rien à y faire.
    if (r.scope.worktree && !existsSync(decodeId(r.scope.worktree))) continue
    const a = await awaiting(r, runs, projects.get(r.scope.project)?.repo)
    if (!a) continue
    const p = projects.get(r.scope.project)
    items.push({
      runId: r.id,
      kind: r.kind,
      project: r.scope.project,
      projectName: p?.name ?? 'Tous les projets',
      worktree: r.scope.worktree ?? null,
      label: r.scope.worktree ? basename(decodeId(r.scope.worktree)) : r.title,
      href: runHref(r.kind, r.scope),
      at: r.endedAt ?? r.startedAt,
      title: a.title,
      detail: a.detail,
      tone: a.tone,
      clearsOnOpen: a.clearsOnOpen ?? false,
      until: a.until ?? 'disparaît quand c’est traité',
    })
  }
  return items.sort((a, b) => b.at.localeCompare(a.at))
}
