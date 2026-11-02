import type { DailyPeriod } from '../../shared/types.ts'

/**
 * Période d'un Daily : depuis le lundi de la semaine, depuis le dernier jour ouvré (vendredi si on est lundi),
 * ou la semaine dernière entière (lundi au dimanche, until exclu). Sans until : jusqu'à maintenant.
 */
export function dailyRange(period: DailyPeriod): { since: Date; until: Date | null } {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  const day = d.getDay()
  if (period === 'yesterday') {
    d.setDate(d.getDate() - (day === 1 ? 3 : day === 0 ? 2 : 1))
    return { since: d, until: null }
  }
  d.setDate(d.getDate() - ((day + 6) % 7))
  if (period === 'week') return { since: d, until: null }
  const since = new Date(d)
  since.setDate(since.getDate() - 7)
  return { since, until: d }
}

/** Jour AAAA-MM-JJ à minuit, heure locale. */
const localDay = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Période choisie, bornes comprises : until est exclu, donc le lendemain de `to`. */
export function customRange(from: string, to: string): { since: Date; until: Date } {
  const since = localDay(from)
  const until = localDay(to)
  until.setDate(until.getDate() + 1)
  return { since, until }
}
