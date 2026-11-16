/** « 1 commit », « 3 commits ». */
export const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`

/** Morceau de nom de branche : minuscules, tirets, sans accents ni ponctuation (appliqué pendant la frappe : un tiret final reste). */
export const slugify = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-')

/** Identifiant d'un ticket (« ENG-142 ») tiré de son URL Linear ou d'un texte qui le contient, null s'il n'y en a pas. */
export function ticketIdFrom(text: string): string | null {
  const t = text.trim()
  const m = t.match(/\/issue\/([A-Za-z][A-Za-z0-9]*-\d+)/) ?? t.match(/(?:^|[^A-Za-z0-9])([A-Za-z][A-Za-z0-9]*-\d+)(?![A-Za-z0-9])/)
  return m ? m[1].toUpperCase() : null
}
