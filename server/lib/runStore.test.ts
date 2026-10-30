import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Run } from '../../shared/types.ts'
import { costsByPrompt, createRunStore } from './runStore.ts'

const DAY = 86_400_000
const NOW = Date.parse('2026-10-29T12:00:00Z')

const makeRun = (id: string, over: Partial<Run> = {}): Run => ({
  id, kind: 'review', title: 'Review', scope: { project: 'p', worktree: 'w' }, status: 'success',
  startedAt: new Date(NOW).toISOString(), endedAt: null, costUsd: null, events: [], result: null, structured: null, sessionId: null, ...over,
})

describe('createRunStore', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'shipyard-runs-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it("n'ajoute au journal que les nouveaux événements", () => {
    const store = createRunStore(dir)
    const run = makeRun('a', { status: 'running' })
    run.events.push({ t: 'info', text: 'un' })
    store.save(run)
    run.events.push({ t: 'info', text: 'deux' })
    store.save(run)
    store.save(run)
    expect(readFileSync(join(dir, 'a.events.jsonl'), 'utf8').trim().split('\n')).toHaveLength(2)
    expect(JSON.parse(readFileSync(join(dir, 'a.json'), 'utf8'))).not.toHaveProperty('events')
    expect(createRunStore(dir).get('a')?.events.map((e) => ('text' in e ? e.text : ''))).toEqual(['un', 'deux'])
  })

  it('reprend un run relu sans dupliquer son journal', () => {
    createRunStore(dir).save(makeRun('a', { events: [{ t: 'info', text: 'un' }] }))
    const store = createRunStore(dir)
    const run = store.get('a')
    if (!run) throw new Error('run absent')
    run.decision = 'approved'
    store.save(run)
    expect(readFileSync(join(dir, 'a.events.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1)
    expect(createRunStore(dir).records()[0].decision).toBe('approved')
  })

  it("convertit l'ancien format (journal dans le fichier du run)", () => {
    writeFileSync(join(dir, 'old.json'), JSON.stringify(makeRun('old', { events: [{ t: 'info', text: 'ancien' }] })))
    const store = createRunStore(dir)
    expect(store.records().map((r) => r.id)).toEqual(['old'])
    expect(store.get('old')?.events).toEqual([{ t: 'info', text: 'ancien' }])
    expect(JSON.parse(readFileSync(join(dir, 'old.json'), 'utf8'))).not.toHaveProperty('events')
  })

  it('purge les vieux runs, sauf le dernier de chaque portée et ceux en cours', () => {
    const store = createRunStore(dir)
    const old = (days: number) => new Date(NOW - days * DAY).toISOString()
    store.save(makeRun('old', { startedAt: old(90) }))
    store.save(makeRun('latest', { startedAt: old(70) }))
    store.save(makeRun('alone', { startedAt: old(90), scope: { project: 'p', worktree: 'other' } }))
    store.save(makeRun('running', { startedAt: old(90), status: 'running', scope: { project: 'p', worktree: 'w', ref: 'r' } }))
    store.save(makeRun('running-newer', { startedAt: old(80), scope: { project: 'p', worktree: 'w', ref: 'r' } }))
    store.save(makeRun('recent', { startedAt: old(10), kind: 'test' }))
    const removed: string[] = []
    expect(store.purge(NOW, (id) => removed.push(id))).toEqual(['old'])
    expect(removed).toEqual(['old'])
    expect(existsSync(join(dir, 'old.json'))).toBe(false)
    expect(existsSync(join(dir, 'old.events.jsonl'))).toBe(false)
    expect(store.records().map((r) => r.id).sort()).toEqual(['alone', 'latest', 'recent', 'running', 'running-newer'])
  })
})

describe('costsByPrompt', () => {
  it('additionne les agents par prompt, sans les tâches serveur ni les vieux runs', () => {
    const records = [
      makeRun('job', { costUsd: 5 }),
      makeRun('lot1', { costUsd: 2, promptKey: 'review' }),
      makeRun('lot2', { costUsd: 3, promptKey: 'review' }),
      makeRun('retest', { kind: 'ticket', costUsd: 0.5, promptKey: 'retest' }),
      makeRun('no-cost', { costUsd: null, promptKey: 'retest' }),
      makeRun('old', { costUsd: 9, promptKey: 'retest', startedAt: new Date(NOW - 40 * DAY).toISOString() }),
    ].map(({ events: _e, ...r }) => r)
    expect(Object.fromEntries(costsByPrompt(records, NOW - 30 * DAY))).toEqual({
      review: { runs: 2, totalUsd: 5, averageUsd: 2.5 },
      retest: { runs: 1, totalUsd: 0.5, averageUsd: 0.5 },
    })
  })
})
