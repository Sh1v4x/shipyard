import { basename } from 'node:path'
import * as git from './git.ts'
import { loadPrompt } from './prompts.ts'

// Fichiers qu'on ne commite jamais : la liste `exclude` du prompt Commits (front matter), ex. schema.prisma que
// le hook de pre-commit régénère. Leurs modifications non commitées sont annulées plutôt que de bloquer un commit,
// une fusion ou une PR.

export const neverCommitted = (path: string) => loadPrompt('commit-plan').exclude.includes(basename(path))

/** Annule les modifications non commitées des fichiers à ne jamais commiter dans ce dépôt ; renvoie leurs chemins. */
export async function discardExcludedIn(cwd: string): Promise<string[]> {
  const skip = (await git.dirtyFiles(cwd)).filter((f) => neverCommitted(f.path))
  if (skip.length) await git.discardFiles(cwd, skip)
  return skip.map((f) => f.path)
}
