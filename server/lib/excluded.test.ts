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

  it('annule un changement de forme, garde un vrai changement et les autres fichiers', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'shipyard-excluded-'))
    await run('git', ['init', '-q'], { cwd })
    await run('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd })
    writeFileSync(join(cwd, 'schema.prisma'), 'model a {}')
    await run('git', ['add', '.'], { cwd })
    await run('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'schema'], { cwd })
    // Reformatage seul (espaces, ligne vide) : annulé.
    writeFileSync(join(cwd, 'schema.prisma'), 'model   a   {}\n\n')
    writeFileSync(join(cwd, 'other.ts'), 'export {}')
    expect(await discardExcludedIn(cwd)).toEqual(['schema.prisma'])
    expect((await dirtyFiles(cwd)).map((f) => f.path)).toEqual(['other.ts'])
    expect(existsSync(join(cwd, 'other.ts'))).toBe(true)
    // Vrai changement (nouveau modèle) : gardé, il se commite.
    writeFileSync(join(cwd, 'schema.prisma'), 'model a {}\nmodel b {}')
    expect(await discardExcludedIn(cwd)).toEqual([])
    expect((await dirtyFiles(cwd)).map((f) => f.path).sort()).toEqual(['other.ts', 'schema.prisma'])
  })
})
