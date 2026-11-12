import { describe, expect, it, vi } from 'vitest'

vi.mock('./exec.ts', () => ({ run: vi.fn(), runJson: vi.fn(), ttlCache: () => ({ get: (_k: string, load: () => unknown) => load(), values: () => [] }) }))

const { ciFromRollup } = await import('./github.ts')

const job = (name: string, conclusion: string, startedAt: string, run: number) => ({
  __typename: 'CheckRun' as const, name, status: 'COMPLETED', conclusion, startedAt, completedAt: startedAt, workflowName: 'CI',
  detailsUrl: `https://github.com/acme/app/actions/runs/${run}/job/${run + 1}`,
})

describe('ciFromRollup', () => {
  it('ne garde que la dernière exécution d’un job lancé deux fois sur le même commit', () => {
    const ci = ciFromRollup([
      job('test-web', 'FAILURE', '2026-11-12T08:11:02Z', 100),
      job('test-web', 'SUCCESS', '2026-11-12T08:11:03Z', 200),
      job('build', 'SUCCESS', '2026-11-12T08:11:00Z', 300),
    ])
    expect(ci.jobs.map((j) => [j.name, j.state, j.runId])).toEqual([['test-web', 'pass', '200'], ['build', 'pass', '300']])
    expect(ci).toMatchObject({ state: 'pass', failing: 0, total: 2 })
  })

  it('compte un échec quand la dernière exécution a échoué', () => {
    const ci = ciFromRollup([job('test-web', 'SUCCESS', '2026-11-12T08:11:02Z', 100), job('test-web', 'FAILURE', '2026-11-12T08:12:00Z', 200)])
    expect(ci).toMatchObject({ state: 'fail', failing: 1, total: 1 })
  })
})
