import { existsSync } from 'node:fs'
import type { LocalTicket } from '../../shared/types.ts'
import { jsonFile } from './store.ts'

// Tickets locaux : une proposition de « Features & optimisations » gardée avec son worktree, sans passer par Linear.
// Indexés par chemin de worktree ; retirés avec le worktree, ou quand ils deviennent un vrai ticket Linear.

const file = jsonFile<Record<string, LocalTicket>>('local-tickets.json', {})

export const localTicketOf = (path: string): LocalTicket | null => file.read()[path] ?? null

export function saveLocalTicket(t: LocalTicket) {
  file.write({ ...file.read(), [t.path]: t })
}

export function removeLocalTicket(path: string) {
  const all = file.read()
  if (!all[path]) return
  delete all[path]
  file.write(all)
}

/** Déplace le ticket local avec son worktree (changement de projet). */
export function moveLocalTicket(from: string, to: { path: string; project: string }) {
  const t = localTicketOf(from)
  if (!t) return
  removeLocalTicket(from)
  saveLocalTicket({ ...t, ...to })
}

/**
 * Tickets locaux orphelins : leur worktree n'existe plus (supprimé hors de Shipyard, ou projet retiré).
 * `known` : chemins des worktrees de tous les projets.
 */
export function orphanLocalTickets(known: Set<string>, projects: Set<string>): LocalTicket[] {
  return Object.values(file.read()).filter((t) => !projects.has(t.project) || !existsSync(t.path) || !known.has(t.path))
}

export const allLocalTickets = () => Object.values(file.read())
