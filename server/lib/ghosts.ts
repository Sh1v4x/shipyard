import type { Ghost } from '../../shared/types.ts'
import { HttpError } from './config.ts'
import { jsonFile } from './store.ts'

/** Mes ghosts, par projet puis par clé de ligne de la file (`pr:<numéro>` ou `wt:<id>`). */
const file = jsonFile<Record<string, Record<string, Ghost>>>('ghosts.json', {})

const GHOST_KEY = /^(pr:\d+|wt:[\w-]+)$/

export const ghostsOf = (project: string): Record<string, Ghost> => file.read()[project] ?? {}

/** Un run (résultat d'agent) appartient-il à un ghost ? Par sa PR ou par son worktree. */
export const isGhostRun = (project: string, scope: { pr?: number; worktree?: string }) => {
  const g = ghostsOf(project)
  return (scope.pr != null && `pr:${scope.pr}` in g) || (scope.worktree != null && `wt:${scope.worktree}` in g)
}

export function setGhost(project: string, key: string, note: string | null): Ghost {
  if (!GHOST_KEY.test(key)) throw new HttpError(400, `Clé de ghost invalide : ${key}`)
  const all = file.read()
  const ghost: Ghost = { at: new Date().toISOString(), note: note?.trim() || null }
  file.write({ ...all, [project]: { ...all[project], [key]: ghost } })
  return ghost
}

export function removeGhost(project: string, key: string) {
  const all = file.read()
  if (!all[project]?.[key]) return
  const { [key]: _removed, ...rest } = all[project]
  file.write({ ...all, [project]: rest })
}
