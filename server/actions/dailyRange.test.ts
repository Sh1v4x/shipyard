import { afterEach, describe, expect, it, vi } from 'vitest'
import { customRange, dailyRange } from './dailyRange.ts'

const at = (iso: string) => vi.setSystemTime(new Date(iso))
const day = (d: Date | null) => d && `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

describe('dailyRange', () => {
  afterEach(() => vi.useRealTimers())

  it('remonte au vendredi un lundi', () => {
    vi.useFakeTimers()
    at('2026-10-26T09:00:00')
    const r = dailyRange('yesterday')
    expect([day(r.since), r.until]).toEqual(['2026-10-23', null])
  })

  it('prend la veille un autre jour', () => {
    vi.useFakeTimers()
    at('2026-10-29T09:00:00')
    expect(day(dailyRange('yesterday').since)).toBe('2026-10-28')
  })

  it('part du lundi pour la semaine en cours, y compris un dimanche', () => {
    vi.useFakeTimers()
    at('2026-11-01T18:00:00')
    expect(day(dailyRange('week').since)).toBe('2026-10-26')
  })

  it('couvre la semaine dernière entière, fin exclue', () => {
    vi.useFakeTimers()
    at('2026-10-29T09:00:00')
    const r = dailyRange('last-week')
    expect([day(r.since), day(r.until)]).toEqual(['2026-10-19', '2026-10-26'])
  })

  it('prend une plage choisie, fin comprise', () => {
    const r = customRange('2026-09-01', '2026-10-31')
    expect([day(r.since), day(r.until)]).toEqual(['2026-09-01', '2026-11-01'])
  })
})
