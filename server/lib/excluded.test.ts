import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { run } from './exec.ts'

vi.mock('./prompts.ts', () => ({ loadPrompt: () => ({ exclude: ['schema.prisma'] }) }))

const { discardExcludedIn, neverCommitted } = await import('./excluded.ts')
const { dirtyFiles } = await import('./git.ts')

describe('fichiers à ne jamais commiter', () => {
  it('reconnaît un fichier de la liste par son nom, où qu’il soit', () => {
    expect(neverCommitted('apps/api/prisma/schema.prisma')).toBe(true)
    expect(neverCommitted('apps/api/src/main.ts')).toBe(false)
  })

  it('annule leurs modifications (suivi restauré, nouveau supprimé) et laisse les autres', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'shipyard-excluded-'))
    await run('git', ['init', '-q'], { cwd })
    await run('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd })
    writeFileSync(join(cwd, 'schema.prisma'), 'model a {}')
    await run('git', ['add', '.'], { cwd })
    await run('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'schema'], { cwd })
    writeFileSync(join(cwd, 'schema.prisma'), 'model a {}\nmodel b {}')
    writeFileSync(join(cwd, 'other.ts'), 'export {}')
    expect(await discardExcludedIn(cwd)).toEqual(['schema.prisma'])
    expect((await dirtyFiles(cwd)).map((f) => f.path)).toEqual(['other.ts'])
    expect(existsSync(join(cwd, 'other.ts'))).toBe(true)
  })
})
