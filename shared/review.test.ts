import { describe, expect, it } from 'vitest'
import { DEFAULT_LABEL_RULES, needsReviewer } from './review.ts'

const pr = (over: Partial<Parameters<typeof needsReviewer>[0]> = {}) => ({ isDraft: false, labels: [], reviews: [], requestedReviewers: [], ...over })

describe('needsReviewer', () => {
  it('demande un reviewer à une PR que personne ne regarde', () => {
    expect(needsReviewer(pr(), DEFAULT_LABEL_RULES)).toBe(true)
    // Seul un bot l'a relue : ça ne compte pas.
    expect(needsReviewer(pr({ reviews: [{ login: 'coderabbitai' }] }), DEFAULT_LABEL_RULES)).toBe(true)
  })

  it('ne demande rien quand une review est demandée ou rendue, ni pour un brouillon', () => {
    expect(needsReviewer(pr({ requestedReviewers: ['alice'] }), DEFAULT_LABEL_RULES)).toBe(false)
    expect(needsReviewer(pr({ reviews: [{ login: 'bob' }] }), DEFAULT_LABEL_RULES)).toBe(false)
    expect(needsReviewer(pr({ isDraft: true }), DEFAULT_LABEL_RULES)).toBe(false)
  })
})
