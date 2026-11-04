import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActionKind, Run } from '../../shared/types.ts'
import type { RunRecord } from './runStore.ts'

let records: RunRecord[] = []
let decisions: Record<string, unknown> = {}
vi.mock('./claude.ts', () => ({ allRuns: () => records, getRun: (id: string) => records.find((r) => r.id === id) ?? null }))
vi.mock('./runArtifacts.ts', () => ({ reviewDecisionsPath: (id: string) => id }))
vi.mock('./store.ts', () => ({ readJsonFile: (path: string) => decisions[path] ?? null }))

const { manualTest, selfReviewSummary, testsSummary } = await import('./progress.ts')

const WT = 'wt1'
let clock = 0
const run = (kind: ActionKind, over: Partial<Run> = {}): RunRecord => ({
  id: `${kind}-${++clock}`, kind, title: kind, status: 'success', startedAt: new Date(Date.UTC(2026, 9, 30, 10, clock)).toISOString(), endedAt: null,
  costUsd: null, scope: { project: 'app', worktree: WT }, result: null, structured: null, sessionId: null, ...over,
})
const steps = (n: number) => ({ setup: '', services: [], url: null, access: '', steps: Array.from({ length: n }, (_, i) => ({ title: `Étape ${i + 1}`, detail: '', expected: 'ok' })) })
const finding = (id: string) => ({ id, file: 'a.ts', line: 1, severity: 'suggestion' as const, title: id, body: '', fix: '' })

beforeEach(() => {
  records = []
  decisions = {}
})

describe('testsSummary', () => {
  it('ne voit rien sans test lancé', () => {
    expect(testsSummary(WT)).toEqual({ running: false, ai: null, manual: null })
  })

  it('compte les points du dernier test IA et les étapes faites du test manuel', () => {
    const manual = run('test-manual', { structured: steps(3), manualChecked: [0] })
    records = [
      run('test', { structured: { suite: { command: 'bun test', passed: 3, failed: 1, summary: '' }, scenarios: [{ name: 'a', status: 'pass', detail: '' }, { name: 'b', status: 'warn', detail: '' }] } }),
      manual,
      // Étape 2 jugée conforme par sa vérification ; étape 3 non conforme mais tranchée « conforme » par moi.
      run('test-check', { scope: { project: 'app', worktree: WT, ref: `${manual.id}:1` }, structured: { verdict: 'pass', command: '', output: '', explanation: '' } }),
      run('test-check', { scope: { project: 'app', worktree: WT, ref: `${manual.id}:2` }, structured: { verdict: 'fail', command: '', output: '', explanation: '' }, checkDecision: 'pass' }),
    ]
    const s = testsSummary(WT)
    expect(s.ai).toMatchObject({ failed: 1, toCheck: 1 })
    expect(s.manual).toMatchObject({ done: 3, total: 3 })
    expect(manualTest(WT)?.steps.map((x) => x.check?.decided ?? null)).toEqual([null, false, true])
  })

  it('ne compte plus un point à vérifier auquel j’ai répondu, dépôts liés compris', () => {
    const scenarios = [{ name: 'a', status: 'warn', detail: '' }, { name: 'b', status: 'warn', detail: '' }]
    const suite = { command: '', passed: 0, failed: 0, summary: '' }
    const web = run('test-part', { structured: { suite, scenarios }, testDecisions: { a: 'Garder' } })
    const mobile = run('test-part', { structured: { suite, scenarios }, testDecisions: { a: 'Garder', b: 'Corriger' } })
    const part = (r: RunRecord) => ({ project: 'app', projectName: 'app', worktree: WT, platform: 'web', runId: r.id, output: r.structured, error: null })
    records = [web, mobile, run('test', { structured: { parts: [part(web), part(mobile)] } })]
    expect(testsSummary(WT).ai).toMatchObject({ failed: 0, toCheck: 1 })
  })

  it('ignore les runs en échec et signale un test en cours', () => {
    records = [run('test', { status: 'error' }), run('test-manual', { status: 'running' })]
    expect(testsSummary(WT)).toEqual({ running: true, ai: null, manual: null })
  })
})

describe('selfReviewSummary', () => {
  it('est null sans auto-review', () => {
    expect(selfReviewSummary(WT)).toBeNull()
  })

  it('compte les remarques ni ignorées ni corrigées', () => {
    const self = run('self-review', { structured: { summary: '', findings: [finding('f1'), finding('f2'), finding('f3'), finding('f4')] } })
    decisions = { [self.id]: { approved: ['f2', 'f3'], ignored: ['f1'] } }
    records = [
      self,
      run('findings-fix-all', { scope: { project: 'app', worktree: WT, ref: self.id }, structured: { url: null, results: [{ id: 'f2', ok: true, detail: '' }, { id: 'f3', ok: false, detail: '' }] } }),
    ]
    expect(selfReviewSummary(WT)).toEqual({ running: false, at: self.startedAt, findings: 4, pending: 2 })
  })

  it('garde la dernière auto-review aboutie pendant qu’une nouvelle tourne', () => {
    const done = run('self-review', { structured: { summary: '', findings: [] } })
    records = [done, run('self-review', { status: 'running' })]
    expect(selfReviewSummary(WT)).toEqual({ running: true, at: done.startedAt, findings: 0, pending: 0 })
  })
})
