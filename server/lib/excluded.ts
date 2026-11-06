import { basename } from 'node:path'
import * as git from './git.ts'
import { loadPrompt } from './prompts.ts'

// Fichiers qu'on ne commite pas quand un hook les retouche (liste `exclude` du prompt Commits, ex. schema.prisma
// reformaté par `prisma format`). Seul un changement de pure forme (espaces, lignes vides) est annulé : un vrai
// changement de contenu (nouveau modèle…) est du travail à commiter, il reste et part dans un commit.

export const neverCommitted = (path: string) => loadPrompt('commit-plan').exclude.includes(basename(path))

/** Fichiers de la liste dont la modification non commitée n'est que de la forme : à annuler, jamais à commiter. */
export async function excludedNoise(cwd: string): Promise<{ status: string; path: string }[]> {
  const out: { status: string; path: string }[] = []
  for (const f of (await git.dirtyFiles(cwd)).filter((x) => neverCommitted(x.path))) {
    if (await git.isWhitespaceOnlyChange(cwd, f)) out.push(f)
  }
  return out
}

/** Annule les changements de forme des fichiers de la liste ; renvoie leurs chemins. */
export async function discardExcludedIn(cwd: string): Promise<string[]> {
  const skip = await excludedNoise(cwd)
  if (skip.length) await git.discardFiles(cwd, skip)
  return skip.map((f) => f.path)
}
