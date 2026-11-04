import type { ActionKind, FindingsFixAllOutput, ManualTestOutput, MultiTestOutput, ReviewDecisions, ReviewOutput, SelfReviewSummary, TestCheckOutput, TestOutput, TestsSummary } from '../../shared/types.ts'
import { allRuns, getRun } from './claude.ts'
import { reviewDecisionsPath } from './runArtifacts.ts'
import { readJsonFile } from './store.ts'
import type { RunRecord } from './runStore.ts'

/** Dernier run d'une action sur le worktree (le plus récent d'abord), éventuellement limité à une ref ou aux réussis. */
function latest(worktree: string, kind: ActionKind, opts: { ref?: string; success?: boolean } = {}): RunRecord | null {
  let best: RunRecord | null = null
  for (const r of allRuns()) {
    if (r.kind !== kind || r.scope.worktree !== worktree) continue
    if (opts.ref != null && r.scope.ref !== opts.ref) continue
    if (opts.success && r.status !== 'success') continue
    if (!best || r.startedAt > best.startedAt) best = r
  }
  return best
}

/**
 * Points du test IA : en échec (scénarios, suite, dépôts liés en erreur) et à vérifier.
 * Un point « à vérifier » auquel j'ai répondu (réponse gardée sur le run du dépôt) n'est plus à vérifier.
 */
function testPoints(run: RunRecord | null): { failed: number; toCheck: number } {
  const out = run?.structured as TestOutput | MultiTestOutput | null | undefined
  if (!run || !out) return { failed: 0, toCheck: 0 }
  const parts = ('parts' in out ? out.parts.map((p) => ({ t: p.output, decisions: (p.runId ? getRun(p.runId)?.testDecisions : null) ?? {} })) : [{ t: out, decisions: run.testDecisions ?? {} }])
    .flatMap(({ t, decisions }) => (t ? [{ t, decisions }] : []))
  const errors = 'parts' in out ? out.parts.filter((p) => p.error).length : 0
  return {
    failed: parts.reduce((a, { t }) => a + t.scenarios.filter((s) => s.status === 'fail').length + t.suite.failed, errors),
    toCheck: parts.reduce((a, p) => a + p.t.scenarios.filter((s) => s.status === 'warn' && !p.decisions[s.name]).length, 0),
  }
}

export const testIssues = (run: RunRecord | null) => {
  const p = testPoints(run)
  return p.failed + p.toCheck
}

export interface ManualStep {
  step: ManualTestOutput['steps'][number]
  /** Cochée, ou jugée conforme par sa vérification. */
  done: boolean
  check: { run: RunRecord; output: TestCheckOutput; verdict: TestCheckOutput['verdict']; decided: boolean } | null
}

/** Dernier test manuel préparé et l'état de chaque étape. */
export function manualTest(worktree: string): { run: RunRecord; steps: ManualStep[] } | null {
  const run = latest(worktree, 'test-manual', { success: true })
  const out = run?.structured as ManualTestOutput | null | undefined
  if (!run || !out?.steps.length) return null
  const checked = run.manualChecked ?? []
  return {
    run,
    steps: out.steps.map((step, i) => {
      const checkRun = latest(worktree, 'test-check', { ref: `${run.id}:${i}`, success: true })
      const output = checkRun?.structured as TestCheckOutput | null | undefined
      const check = checkRun && output ? { run: checkRun, output, verdict: checkRun.checkDecision ?? output.verdict, decided: checkRun.checkDecision != null } : null
      return { step, done: checked.includes(i) || check?.verdict === 'pass', check }
    }),
  }
}

export function testsSummary(worktree: string): TestsSummary {
  const ai = latest(worktree, 'test', { success: true })
  const manual = manualTest(worktree)
  return {
    running: latest(worktree, 'test')?.status === 'running' || latest(worktree, 'test-manual')?.status === 'running',
    ai: ai ? { ...testPoints(ai), at: ai.startedAt } : null,
    manual: manual ? { done: manual.steps.filter((s) => s.done).length, total: manual.steps.length, at: manual.run.startedAt } : null,
  }
}

/** Remarques de la dernière auto-review encore ouvertes : sans décision, ou acceptées mais pas encore corrigées. */
export function selfReviewSummary(worktree: string): SelfReviewSummary | null {
  const last = latest(worktree, 'self-review')
  if (!last) return null
  const done = last.status === 'success' ? last : latest(worktree, 'self-review', { success: true })
  const findings = (done?.structured as ReviewOutput | null | undefined)?.findings ?? []
  const decisions = done ? readJsonFile<Partial<ReviewDecisions>>(reviewDecisionsPath(done.id)) : null
  const fixAll = done ? (latest(worktree, 'findings-fix-all', { ref: done.id, success: true })?.structured as FindingsFixAllOutput | null | undefined) : null
  const fixed = (id: string) =>
    !!fixAll?.results.some((r) => r.id === id && r.ok) || !!(done && latest(worktree, 'finding-fix', { ref: `${done.id}:${id}`, success: true }))
  const pending = findings.filter((f) => !decisions?.ignored?.includes(f.id) && !fixed(f.id)).length
  return { running: last.status === 'running', at: done?.startedAt ?? null, findings: findings.length, pending }
}
