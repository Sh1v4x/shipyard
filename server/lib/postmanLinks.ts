import type { PostmanLink } from '../../shared/types.ts'
import { jsonFile } from './store.ts'

/** Dossier Postman lié à chaque worktree, par chemin de worktree. */
const file = jsonFile<Record<string, PostmanLink>>('worktree-postman.json', {})

export const postmanLink = (path: string): PostmanLink | null => file.read()[path] ?? null

export function setPostmanLink(path: string, link: PostmanLink | null) {
  const links = { ...file.read() }
  if (link) links[path] = link
  else delete links[path]
  file.write(links)
}

/**
 * Valeurs saisies dans Shipyard pour les variables d'un dossier lié (jeton de test, mot de passe…), par worktree.
 * Elles restent sur ce Mac : Postman ne partage pas par son API les valeurs « courantes » de son application.
 */
const vars = jsonFile<Record<string, Record<string, string>>>('worktree-postman-vars.json', {})

export const postmanVars = (path: string): Record<string, string> => vars.read()[path] ?? {}

export function setPostmanVar(path: string, key: string, value: string | null) {
  const all = { ...vars.read() }
  const mine = { ...all[path] }
  if (value === null) delete mine[key]
  else mine[key] = value
  if (Object.keys(mine).length) all[path] = mine
  else delete all[path]
  vars.write(all)
}

export function clearPostmanVars(path: string) {
  const all = { ...vars.read() }
  delete all[path]
  vars.write(all)
}
