/** « 1 commit », « 3 commits ». */
export const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`

/** Morceau de nom de branche : minuscules, tirets, sans accents ni ponctuation (appliqué pendant la frappe : un tiret final reste). */
export const slugify = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-')
