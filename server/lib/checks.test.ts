import { describe, expect, it, vi } from 'vitest'

vi.mock('./github.ts', () => ({}))
vi.mock('./exec.ts', () => ({}))

const { parseReport } = await import('./checks.ts')

const head = { oid: 'abc123', committedAt: '2026-10-30T09:00:00Z' }

const qualityReport = (added: number) => `<!-- code-quality-report -->
## Code quality

Base: \`origin/develop\`. Advisory findings. Full report: \`bun run check-ai-code --full\`.

### Oxlint (added lines)

Findings on added lines: ${added}

> [!WARNING]
> 3 lint suppression(s) added.

- Ignored \`anti-slop/no-empty-fallback\`: a ghost line has either a debit or a credit (\`apps-v2/api/src/ledger.service.ts:634\`)

### Fallow

Complexity — Critical: 1 · High: 1 · Moderate: 6
Dead code: 1 · Duplication groups: 2
`

const parse = (body: string) => parseReport({ author: 'github-actions', body, updatedAt: '2026-10-30T10:00:00Z', url: 'https://github.com/o/r/pull/1' }, head)

describe('parseReport', () => {
  it('bloque la PR quand Oxlint signale des problèmes sur les lignes ajoutées', () => {
    expect(parse(qualityReport(4))).toMatchObject({ id: 'code-quality-report', status: 'fail', blocking: 4, command: 'bun run check-ai-code --full' })
  })

  it('laisse passer la PR sans problème Oxlint, quels que soient les autres compteurs', () => {
    const r = parse(qualityReport(0))
    expect(r).toMatchObject({ status: 'pass', blocking: 0 })
    expect(r?.metrics.map((m) => `${m.label}: ${m.value}`)).toEqual(['Complexity Critical: 1', 'Complexity High: 1', 'Complexity Moderate: 6', 'Dead code: 1', 'Duplication groups: 2'])
  })

  it('garde l’ancienne lecture pour un rapport sans section Oxlint', () => {
    expect(parse('<!-- env-check -->\n## Variables\n\nMissing: 2')).toMatchObject({ status: 'warn', blocking: null })
    expect(parse('<!-- env-check -->\n## ✅ Variables\n\nMissing: 0')).toMatchObject({ status: 'pass', blocking: null })
  })
})
