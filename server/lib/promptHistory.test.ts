import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const dataDir = mkdtempSync(join(tmpdir(), 'shipyard-history-'))
vi.mock('./config.ts', () => ({ DATA_DIR: dataDir, HttpError: Error }))

const { keepVersion, promptVersions, versionDiff } = await import('./promptHistory.ts')

const MIN = 60_000
const T0 = Date.parse('2026-10-29T10:00:00Z')

describe('historique des prompts', () => {
  afterAll(() => rmSync(dataDir, { recursive: true, force: true }))

  it('garde une version par séance, seulement quand le texte change', () => {
    keepVersion('prompt', 'review', 'v1', 'v1', T0)
    keepVersion('prompt', 'review', 'v1', 'v2', T0 + MIN)
    keepVersion('prompt', 'review', 'v2', 'v3', T0 + 2 * MIN)
    keepVersion('prompt', 'review', 'v3', 'v4', T0 + 20 * MIN)
    expect(promptVersions('prompt', 'review').map((v) => v.content)).toEqual(['v3', 'v1'])
    expect(promptVersions('prompt', 'review')[0].savedAt).toBe(new Date(T0 + 20 * MIN).toISOString())
  })

  it('donne les différences avec le texte actuel, à la demande', async () => {
    keepVersion('rule', 'tests', 'a\nb\n', 'x', T0)
    const [v] = promptVersions('rule', 'tests')
    const diff = await versionDiff('rule', 'tests', v.id, 'a\nc\n')
    expect(diff.filter((l) => l.t !== '@').map((l) => `${l.t}${l.code}`)).toEqual([' a', '-b', '+c'])
    await expect(versionDiff('rule', 'tests', '../x', '')).rejects.toThrow()
  })

  it('limite le nombre de versions gardées', () => {
    for (let i = 0; i < 25; i++) keepVersion('prompt', 'many', `v${i}`, 'next', T0 + i * 20 * MIN)
    const versions = promptVersions('prompt', 'many')
    expect(versions).toHaveLength(20)
    expect(versions.at(-1)?.content).toBe('v5')
  })
})
