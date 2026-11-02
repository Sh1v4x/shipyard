import { describe, expect, it, vi } from 'vitest'

vi.mock('./config.ts', () => ({ loadProjects: () => [] }))
vi.mock('./github.ts', () => ({}))
vi.mock('./linear.ts', () => ({}))

const { buildStats } = await import('./stats.ts')

const pr = (repo: string, number: number, mergedAt: string, additions: number, commits: number) =>
  ({ repo, number, title: `PR ${number}`, url: `https://github.com/${repo}/pull/${number}`, mergedAt, additions, deletions: 10, commits, head: `feat/${number}` })

const contributions = {
  login: 'me',
  merged: [pr('acme/app', 1, '2026-08-03T10:00:00Z', 500, 4), pr('acme/app', 2, '2026-10-20T10:00:00Z', 50, 2), pr('me/side', 3, '2026-10-21T10:00:00Z', 900, 9)],
  opened: [{ repo: 'acme/app', createdAt: '2026-08-01T10:00:00Z', head: 'feat/1' }, { repo: 'acme/app', createdAt: '2026-10-19T10:00:00Z', head: 'feat/2' }, { repo: 'me/side', createdAt: '2026-10-20T10:00:00Z', head: 'feat/3' }],
  reviews: [
    { repo: 'acme/app', pr: 7, state: 'CHANGES_REQUESTED', date: '2026-09-02T10:00:00Z' },
    { repo: 'acme/app', pr: 7, state: 'APPROVED', date: '2026-09-03T10:00:00Z' },
    { repo: 'acme/web', pr: 8, state: 'COMMENTED', date: '2026-10-05T10:00:00Z' },
  ],
  truncated: false,
}
const tickets = [{ id: 'ENG-1', title: 'a', url: 'u', completedAt: '2026-10-02T10:00:00Z' }]

describe('buildStats', () => {
  it('additionne tout, par dépôt et par mois, mois vides compris', () => {
    const r = buildStats(contributions, tickets, { from: '2026-08-01', to: '2026-10-31', scope: 'all', repos: null })
    expect(r.totals).toEqual({
      commits: 15, prsOpened: 3, prsMerged: 3, reviews: 3, linesAdded: 1450, linesDeleted: 30,
      reviewedPrs: 2, approvals: 1, changesRequested: 1, ticketsCompleted: 1,
    })
    expect(r.byMonth.map((m) => [m.month, m.prsMerged, m.reviews, m.ticketsCompleted])).toEqual([['2026-08', 1, 0, 0], ['2026-09', 0, 2, 0], ['2026-10', 2, 1, 1]])
    expect(r.mergedPrs.map((p) => p.number)).toEqual([3, 1, 2])
  })

  it('se limite aux dépôts des projets suivis', () => {
    const r = buildStats(contributions, null, { from: '2026-08-01', to: '2026-10-31', scope: 'tracked', repos: new Set(['acme/app']) })
    expect(r.byRepo.map((x) => x.repo)).toEqual(['acme/app'])
    expect(r.totals).toMatchObject({ prsMerged: 2, prsOpened: 2, reviews: 2, commits: 6, ticketsCompleted: null })
  })

  it('ne compte pas les PR de release, qui reprennent celles des fonctionnalités', () => {
    const release = { ...pr('acme/app', 9, '2026-10-25T10:00:00Z', 5000, 80), head: 'develop' }
    const r = buildStats({ ...contributions, merged: [...contributions.merged, release] }, null, { from: '2026-08-01', to: '2026-10-31', scope: 'all', repos: null })
    expect(r.totals).toMatchObject({ prsMerged: 3, commits: 15, linesAdded: 1450 })
    expect(r.notes.some((n) => n.startsWith('1 PR de release'))).toBe(true)
  })

  it('couvre une période sur deux années', () => {
    const r = buildStats({ ...contributions, merged: [], opened: [], reviews: [] }, null, { from: '2025-11-15', to: '2026-02-03', scope: 'all', repos: null })
    expect(r.byMonth.map((m) => m.month)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
  })
})
