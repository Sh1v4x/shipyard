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
