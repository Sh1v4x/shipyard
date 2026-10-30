import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

vi.mock('./lib/config.ts', () => ({
  PORT: 4317,
  HttpError: class extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message)
    }
  },
}))

const { jsonBody, localOnly } = await import('./http.ts')
const { HttpError } = await import('./lib/config.ts')

const app = new Hono()
app.onError((err, c) => c.json({ error: err.message }, err instanceof HttpError ? err.status : 500))
app.use('/api/*', localOnly)
app.get('/api/ping', (c) => c.json({ ok: true }))
app.post('/api/echo', async (c) => c.json(await jsonBody(c, z.object({ name: z.string() }))))

// Comme un vrai client HTTP : app.request() n'ajoute pas content-length.
const send = (path: string, init: RequestInit & { body?: string; headers?: Record<string, string> } = {}) =>
  app.request(path, { ...init, headers: { host: '127.0.0.1:4317', ...(init.body ? { 'content-length': String(Buffer.byteLength(init.body)) } : {}), ...init.headers } })

const json = { 'content-type': 'application/json' }

describe('localOnly', () => {
  it("laisse passer l'interface locale, en dev comme en production", async () => {
    expect((await send('/api/ping')).status).toBe(200)
    expect((await send('/api/ping', { headers: { host: 'localhost:4317' } })).status).toBe(200)
    const post = { method: 'POST', body: '{"name":"a"}', headers: { ...json, origin: 'http://localhost:5173' } }
    expect((await send('/api/echo', post)).status).toBe(200)
  })

  it('refuse un autre hôte (DNS rebinding)', async () => {
    expect((await send('/api/ping', { headers: { host: 'evil.example:4317' } })).status).toBe(403)
  })

  it('refuse une page d’une autre origine', async () => {
    const res = await send('/api/echo', { method: 'POST', body: '{"name":"a"}', headers: { ...json, origin: 'https://evil.example' } })
    expect(res.status).toBe(403)
  })

  it('refuse un corps non JSON, qui partirait sans contrôle CORS', async () => {
    const res = await send('/api/echo', { method: 'POST', body: '{"name":"a"}', headers: { 'content-type': 'text/plain' } })
    expect(res.status).toBe(415)
  })
})

describe('jsonBody', () => {
  it('rejette un corps invalide ou mal formé', async () => {
    const invalid = await send('/api/echo', { method: 'POST', body: '{"name":1}', headers: json })
    expect(invalid.status).toBe(400)
    expect(((await invalid.json()) as { error: string }).error).toMatch(/^Requête invalide : name/)
    expect((await send('/api/echo', { method: 'POST', body: '{', headers: json })).status).toBe(400)
  })
})
