import { describe, expect, it } from 'vitest'
import { applyGhosts, ghostKey } from './queue.ts'
import type { QueueItem } from './types.ts'

const item = (key: string, over: Partial<QueueItem> = {}): QueueItem => ({
  key, group: 'me', tone: 'red', kind: 'mine', title: key, ref: null, worktree: null, prNumber: null, ticketId: null,
  reasons: [], detail: null, action: null, since: null, ...over,
})

describe('ghosts', () => {
  const ghost = { at: '2026-11-02T10:00:00Z', note: 'en attente du client' }

  it('range une PR ou un worktree mis de côté dans le groupe ghost, sans couleur', () => {
    const queue = [item('pr:12'), item('wt:abc', { kind: 'branch', group: 'progress', tone: 'blue' }), item('pr:13')]
    const out = applyGhosts(queue, { 'pr:12': ghost, 'wt:abc': ghost })
    expect(out.map((q) => [q.key, q.group, q.tone])).toEqual([['pr:12', 'ghost', 'gray'], ['wt:abc', 'ghost', 'gray'], ['pr:13', 'me', 'red']])
    expect(out[0].ghost).toEqual(ghost)
  })

  it('ne touche ni aux tickets à démarrer, ni aux résultats d’agents, ni à ce qui est à ranger', () => {
    const queue = [item('ticket:ENG-1', { kind: 'ticket', group: 'start' }), item('agent:r1', { kind: 'agent' }), item('wt:old', { group: 'clean' })]
    const out = applyGhosts(queue, { 'ticket:ENG-1': ghost, 'agent:r1': ghost, 'wt:old': ghost })
    expect(out.map((q) => q.group)).toEqual(['start', 'me', 'clean'])
  })

  it('identifie un worktree par sa PR quand il en a une', () => {
    expect(ghostKey(42, 'abc')).toBe('pr:42')
    expect(ghostKey(null, 'abc')).toBe('wt:abc')
    expect(ghostKey(undefined, undefined)).toBeNull()
  })
})
