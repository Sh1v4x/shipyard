import { jsonFile } from './store.ts'

/** Tickets liés à la main, par chemin de worktree : priment sur le ticket déduit de la branche. */
const file = jsonFile<Record<string, string>>('worktree-tickets.json', {})

export const ticketLinks = () => file.read()

export function setTicketLink(path: string, ticketId: string | null) {
  const links = { ...file.read() }
  if (ticketId) links[path] = ticketId
  else delete links[path]
  file.write(links)
}

/** Tickets associés à un worktree en plus de son ticket principal (faits dans la même branche et la même PR), par chemin. */
const extras = jsonFile<Record<string, string[]>>('worktree-extra-tickets.json', {})

export const extraTicketLinks = () => extras.read()

export function setExtraTickets(path: string, ids: string[]) {
  const all = { ...extras.read() }
  const unique = [...new Set(ids)]
  if (unique.length) all[path] = unique
  else delete all[path]
  extras.write(all)
}
