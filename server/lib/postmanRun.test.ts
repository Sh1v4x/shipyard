import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostmanLink } from '../../shared/types.ts'

// Valeurs saisies dans Shipyard : en mémoire pour le test, au lieu du fichier de .data/.
const local: Record<string, string> = {}
vi.mock('./postmanLinks.ts', () => ({ postmanVars: () => local }))

const { folderContent, resetPostman } = await import('./postman.ts')
const { folderVariables, lastResponses, runRequest } = await import('./postmanRun.ts')

const bearer = { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] }
const collection = {
  collection: {
    info: { name: 'API' },
    auth: bearer,
    variable: [{ key: 'baseUrl', value: 'https://api.test' }, { key: 'token', value: 'col-token' }],
    item: [
      { id: 'r-me', name: 'Me', request: { method: 'GET', url: '{{baseUrl}}/me' } },
      {
        id: 'f-auth', name: 'Auth', auth: { type: 'noauth' },
        item: [
          { id: 'r-login', name: 'Login', request: { method: 'POST', url: '{{baseUrl}}/login', header: [{ key: 'X-Trace', value: '{{trace}}' }], body: { mode: 'raw', raw: '{"email":"{{email}}"}' } } },
          { id: 'r-basic', name: 'Basic', request: { method: 'GET', url: '{{baseUrl}}/users/:id?x=1', auth: { type: 'basic', basic: [{ key: 'username', value: 'bob' }, { key: 'password', value: 's3cretpass!' }] } } },
        ],
      },
      { id: 'r-key', name: 'Key', request: { method: 'GET', url: { raw: '{{baseUrl}}/k/:id', variable: [{ key: 'id', value: '{{userId}}' }] }, auth: { type: 'apikey', apikey: [{ key: 'key', value: 'X-Api-Key' }, { key: 'value', value: 'abcdefghijkl' }, { key: 'in', value: 'header' }] } } },
      { id: 'r-form', name: 'Form', request: { method: 'POST', url: '{{baseUrl}}/form', body: { mode: 'urlencoded', urlencoded: [{ key: 'grant_type', value: 'password' }, { key: 'off', value: '1', disabled: true }] } } },
    ],
  },
}
const env = { environment: { name: 'Local', values: [{ key: 'token', value: 'env-token', type: 'secret' }, { key: 'userId', value: '7' }, { key: 'old', value: 'x', enabled: false }] } }

const link = (folderId: string | null = null, environmentId: string | null = null): PostmanLink => ({ workspaceId: 'w', collectionId: 'c1', collectionName: 'API', folderId, folderPath: folderId ? 'Auth' : null, environmentId })

let sent: { url: string; method: string; headers: Record<string, string>; body: unknown }[] = []

beforeEach(() => {
  sent = []
  for (const k of Object.keys(local)) delete local[k]
  resetPostman()
  process.env.POSTMAN_API_KEY = 'PMAK-test'
  vi.stubGlobal('fetch', async (input: string | URL, init: { method?: string; headers?: Headers | Record<string, string>; body?: unknown }) => {
    const url = String(input)
    if (url.startsWith('https://api.getpostman.com/environments/')) return new Response(JSON.stringify(env), { status: 200 })
    if (url.startsWith('https://api.getpostman.com/')) return new Response(JSON.stringify(collection), { status: 200 })
    sent.push({ url, method: init.method ?? 'GET', headers: Object.fromEntries(init.headers instanceof Headers ? init.headers : Object.entries(init.headers ?? {})), body: init.body instanceof URLSearchParams ? init.body.toString() : init.body })
    return new Response('{"ok":true}', { status: 201, statusText: 'Created', headers: { 'Content-Type': 'application/json' } })
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.POSTMAN_API_KEY
})

describe('autorisation héritée', () => {
  it('une requête hérite du dossier, sinon de la collection, sauf si elle a la sienne', async () => {
    const auth = Object.fromEntries((await folderContent(link())).requests.map((r) => [r.id, `${r.auth.type}:${r.auth.from}:${r.auth.source}`]))
    expect(auth).toEqual({ 'r-me': 'bearer:collection:API', 'r-login': 'noauth:none:null', 'r-basic': 'basic:request:Basic', 'r-key': 'apikey:request:Key', 'r-form': 'bearer:collection:API' })
  })

  it('masque une valeur en clair, laisse lisible une référence à une variable', async () => {
    const { requests, auth } = await folderContent(link())
    expect(auth.fields).toEqual([{ key: 'token', value: '{{token}}' }])
    expect(requests.find((r) => r.id === 'r-basic')?.auth.fields).toEqual([{ key: 'username', value: 'bob' }, { key: 'password', value: '••••ass!' }])
    expect(requests.find((r) => r.id === 'r-key')?.auth.fields).toEqual([{ key: 'key', value: 'X-Api-Key' }, { key: 'value', value: '••••ijkl' }, { key: 'in', value: 'header' }])
  })

  it('le dossier lié donne sa propre autorisation', async () => {
    expect((await folderContent(link('f-auth'))).auth).toMatchObject({ type: 'noauth', from: 'none' })
  })
})

describe('variables', () => {
  it('prend la valeur locale, puis l’environnement, puis la collection, et signale celles sans valeur', async () => {
    local.email = 'a@b.c'
    local.token = 'local-token-123456'
    const vars = Object.fromEntries((await folderVariables(link(null, 'e1'), '/wt')).map((v) => [v.key, `${v.source}:${v.value}`]))
    expect(vars).toEqual({ baseUrl: 'collection:https://api.test', email: 'local:a@b.c', token: 'local:••••3456', trace: 'missing:null', userId: 'environment:7' })
  })

  it('ne liste que les variables du dossier lié', async () => {
    expect((await folderVariables(link('f-auth'), '/wt')).map((v) => v.key)).toEqual(['baseUrl', 'email', 'trace'])
  })
})

describe('envoi', () => {
  it('remplace les variables, applique le Bearer hérité et garde la réponse', async () => {
    const res = await runRequest(link(null, 'e1'), '/wt', { requestId: 'r-me' })
    expect(sent[0]).toMatchObject({ url: 'https://api.test/me', method: 'GET', headers: { authorization: 'Bearer env-token' } })
    expect(res).toMatchObject({ requestId: 'r-me', status: 201, statusText: 'Created', body: '{"ok":true}', unresolved: [], auth: 'Bearer · API' })
    expect(lastResponses('/wt').map((r) => r.requestId)).toEqual(['r-me'])
  })

  it('n’envoie pas d’autorisation à une requête dont le dossier dit « aucune », et signale les variables sans valeur', async () => {
    local.email = 'a@b.c'
    const res = await runRequest(link(), '/wt', { requestId: 'r-login' })
    expect(sent[0].headers).toEqual({ 'content-type': 'application/json', 'x-trace': '{{trace}}' })
    expect(sent[0].body).toBe('{"email":"a@b.c"}')
    expect(res.unresolved).toEqual(['trace'])
    expect(res.auth).toBe('Aucune autorisation')
  })

  it('applique Basic, une clé d’API, les segments :nom et un corps urlencoded', async () => {
    await runRequest(link(null, 'e1'), '/wt', { requestId: 'r-basic' })
    await runRequest(link(null, 'e1'), '/wt', { requestId: 'r-key' })
    await runRequest(link(null, 'e1'), '/wt', { requestId: 'r-form' })
    expect(sent[0]).toMatchObject({ url: 'https://api.test/users/:id?x=1', headers: { authorization: `Basic ${Buffer.from('bob:s3cretpass!').toString('base64')}` } })
    expect(sent[1]).toMatchObject({ url: 'https://api.test/k/7', headers: { 'x-api-key': 'abcdefghijkl' } })
    expect(sent[2]).toMatchObject({ method: 'POST', body: 'grant_type=password' })
  })

  it('un brouillon prend l’autorisation du dossier lié et n’est pas gardé', async () => {
    const draft = { name: 'New', method: 'post', url: '{{baseUrl}}/new', headers: [], body: '{"a":1}', description: '' }
    const res = await runRequest(link(), '/wt2', { request: draft })
    expect(sent[0]).toMatchObject({ url: 'https://api.test/new', method: 'POST', headers: { authorization: 'Bearer col-token', 'content-type': 'application/json' } })
    expect(res.requestId).toBeNull()
    expect(lastResponses('/wt2')).toEqual([])
    await runRequest(link('f-auth'), '/wt2', { request: draft })
    expect(sent[1].headers.authorization).toBeUndefined()
  })

  it('refuse une requête hors du dossier lié', async () => {
    await expect(runRequest(link('f-auth'), '/wt', { requestId: 'r-me' })).rejects.toThrow(/pas dans le dossier lié/)
    expect(sent).toEqual([])
  })

  it('un hôte injoignable est une erreur lisible, pas une réponse', async () => {
    vi.stubGlobal('fetch', async (input: string | URL) => {
      if (String(input).startsWith('https://api.getpostman.com/')) return new Response(JSON.stringify(collection), { status: 200 })
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
    })
    await expect(runRequest(link(), '/wt', { requestId: 'r-me' })).rejects.toThrow('GET https://api.test/me : ECONNREFUSED')
  })
})
