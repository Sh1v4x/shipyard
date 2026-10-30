import { describe, expect, it } from 'vitest'
import type { PrReviewOutput, ReviewComment } from '../../shared/types.ts'
import { checkLines, diffLines, lineFixer, mergeReviews, splitIntoLots } from './reviewDiff.ts'

const fileDiff = (path: string, body = ['@@ -1,2 +1,3 @@', ' a', '+b', ' c']) =>
  [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, ...body, ''].join('\n')

const comment = (over: Partial<ReviewComment>): ReviewComment => ({
  id: 'c1', file: 'src/a.ts', line: 2, severity: 'suggestion', body: 'Remarque', threadId: null, followUp: null, pattern: null, also: [], ...over,
})

const review = (comments: ReviewComment[], summary = 'ok'): PrReviewOutput => ({ mode: 'review', verdict: 'COMMENT', summary, fixedThreads: [], comments })

describe('splitIntoLots', () => {
  it('écarte les lockfiles et sources générées', () => {
    const diff = fileDiff('pnpm-lock.yaml') + fileDiff('src/__generated__/api.ts') + fileDiff('src/a.ts')
    const { lots, skipped } = splitIntoLots(diff, false)
    expect(skipped).toEqual(['pnpm-lock.yaml', 'src/__generated__/api.ts'])
    expect(lots).toHaveLength(1)
    expect(lots[0]).toMatchObject({ name: 'src', files: 1 })
  })

  it('regroupe par zone dans un mono-repo', () => {
    const diff = fileDiff('apps/api/src/a.ts') + fileDiff('apps/web/src/b.ts') + fileDiff('packages/sdk/c.ts')
    const names = splitIntoLots(diff, true).lots.map((l) => l.name)
    expect(names).toEqual(['API · apps/api/src', 'Web · apps/web/src', 'SDK · packages/sdk'])
  })

  it('coupe un lot au-delà de 40 fichiers', () => {
    const diff = Array.from({ length: 45 }, (_, i) => fileDiff(`src/f${String(i).padStart(2, '0')}.ts`)).join('')
    expect(splitIntoLots(diff, false).lots.map((l) => l.files)).toEqual([40, 5])
  })
})

describe('diffLines', () => {
  it('donne les lignes commentables du côté droit', () => {
    const diff = fileDiff('src/a.ts', ['@@ -10,3 +20,4 @@', ' ctx', '-old', '+new1', '+new2', ' ctx2'])
    expect(diffLines(diff).get('src/a.ts')).toEqual([20, 21, 22, 23])
  })
})

describe('lineFixer', () => {
  const fix = lineFixer(fileDiff('src/a.ts', ['@@ -10,2 +10,3 @@', ' a', '+b', ' c']))
  const loc = (line: number, file = 'src/a.ts'): { file: string; line: number; lineWarning?: string } => ({ file, line })

  it('garde une ligne du diff', () => {
    expect(fix(loc(11))).toEqual({ file: 'src/a.ts', line: 11 })
  })

  it('recale un léger décalage', () => {
    expect(fix(loc(14))).toEqual({ file: 'src/a.ts', line: 12, lineWarning: 'Ligne recalée de 14 à 12' })
  })

  it('signale une ligne trop loin ou un fichier absent', () => {
    expect(fix(loc(40)).lineWarning).toMatch(/hors du diff/)
    expect(fix(loc(1, 'src/b.ts')).lineWarning).toMatch(/absent du diff/)
  })
})

describe('checkLines', () => {
  it('laisse les réponses à un fil existant telles quelles', () => {
    const diff = fileDiff('src/a.ts')
    const out = checkLines(review([comment({ line: 90, threadId: 'T1' }), comment({ id: 'c2', line: 90 })]), diff)
    expect(out.comments[0].lineWarning).toBeUndefined()
    expect(out.comments[1].lineWarning).toMatch(/hors du diff/)
  })
})

describe('mergeReviews', () => {
  it('fusionne un même motif trouvé dans deux lots, au niveau le plus grave', () => {
    const a = review([comment({ id: 'x', pattern: 'Cast inutile', severity: 'suggestion' })], 'lot A')
    const b = review([comment({ id: 'y', file: 'src/b.ts', line: 5, pattern: 'cast inutile ', severity: 'important' })], 'lot B')
    const out = mergeReviews([{ zone: 'API', out: a }, { zone: 'Web', out: b }])
    expect(out.comments).toHaveLength(1)
    expect(out.comments[0]).toMatchObject({ id: 'l1-x', severity: 'important', also: [{ file: 'src/b.ts', line: 5, body: 'Remarque' }] })
    expect(out.verdict).toBe('REQUEST_CHANGES')
    expect(out.summary).toBe('**API** : lot A\n\n**Web** : lot B')
  })

  it('approuve sans commentaire et ne modifie pas les sorties reçues', () => {
    expect(mergeReviews([{ zone: 'API', out: review([]) }]).verdict).toBe('APPROVE')
    const a = review([comment({ pattern: 'p', also: [] })])
    const b = review([comment({ pattern: 'p' })])
    mergeReviews([{ zone: 'A', out: a }, { zone: 'B', out: b }])
    expect(a.comments[0].also).toEqual([])
  })
})
