import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DiffLine, PromptSource, PromptVersion } from '../../shared/types.ts'
import { DATA_DIR, HttpError } from './config.ts'
import { parseUnifiedDiff } from './diff.ts'
import { diffTexts } from './git.ts'

const HISTORY_DIR = join(DATA_DIR, 'prompt-history')
/** L'éditeur enregistre à chaque pause de frappe : une version par séance suffit. */
const SESSION_MS = 10 * 60_000
const MAX_VERSIONS = 20

const dirOf = (source: PromptSource, key: string) => join(HISTORY_DIR, `${source}-${key}`)
const versionFiles = (dir: string) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => /^\d+\.md$/.test(f)).sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10)) : []

/**
 * Avant d'enregistrer `next`, garde le texte `current` s'il change : une fois par séance, et seulement s'il
 * diffère de la dernière version gardée.
 */
export function keepVersion(source: PromptSource, key: string, current: string, next: string, now = Date.now()) {
  if (current.trim() === next.trim()) return
  const dir = dirOf(source, key)
  const files = versionFiles(dir)
  const last = files.at(-1)
  if (last && (now - Number.parseInt(last, 10) < SESSION_MS || readFileSync(join(dir, last), 'utf8') === current)) return
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${now}.md`), current)
  for (const f of files.slice(0, Math.max(0, files.length + 1 - MAX_VERSIONS))) rmSync(join(dir, f))
}

/** Versions précédentes, de la plus récente à la plus ancienne. */
export function promptVersions(source: PromptSource, key: string): PromptVersion[] {
  const dir = dirOf(source, key)
  return versionFiles(dir).reverse().map((f) => ({ id: f.slice(0, -3), savedAt: new Date(Number.parseInt(f, 10)).toISOString(), content: readFileSync(join(dir, f), 'utf8') }))
}

/** Ce qui a changé entre une version et le texte actuel. */
export async function versionDiff(source: PromptSource, key: string, id: string, current: string): Promise<DiffLine[]> {
  const file = join(dirOf(source, key), `${id}.md`)
  if (!/^\d+$/.test(id) || !existsSync(file)) throw new HttpError(404, `Version inconnue : ${id}`)
  return [...parseUnifiedDiff(await diffTexts(readFileSync(file, 'utf8'), current)).values()][0] ?? []
}
