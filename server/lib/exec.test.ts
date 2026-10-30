import { afterEach, describe, expect, it, vi } from 'vitest'
import { ttlCache } from './exec.ts'

describe('ttlCache', () => {
  afterEach(() => vi.useRealTimers())

  it('sert la valeur en cache pendant sa durée de vie, puis recharge', async () => {
    vi.useFakeTimers()
    const cache = ttlCache<number>(1000)
    const load = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2)
    expect(await cache.get('k', load)).toBe(1)
    expect(await cache.get('k', load)).toBe(1)
    vi.advanceTimersByTime(1001)
    expect(await cache.get('k', load)).toBe(2)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('oublie un chargement en échec et recharge sur demande', async () => {
    const cache = ttlCache<number>(60_000)
    await expect(cache.get('k', () => Promise.reject(new Error('panne')))).rejects.toThrow('panne')
    expect(await cache.get('k', async () => 3)).toBe(3)
    expect(await cache.get('k', async () => 4, true)).toBe(4)
  })

  it('vide les clés par préfixe', async () => {
    const cache = ttlCache<string>(60_000)
    await cache.get('repo:a', async () => 'a')
    await cache.get('other', async () => 'o')
    cache.clear('repo:')
    expect(await cache.get('repo:a', async () => 'a2')).toBe('a2')
    expect(await cache.get('other', async () => 'o2')).toBe('o')
  })
})
