import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostmanLink, PostmanOperation } from '../../shared/types.ts'
import { applyOperation, collectionFolders, createRequest, folderContent, resetPostman, updateRequest } from './postman.ts'

// Collection au format v2.1, telle que GET /collections/{id} la renvoie.
const collection = {
  collection: {
    info: { name: 'API' },
    item: [
      { id: 'r-root', name: 'Health', request: { method: 'get', url: 'https://x/health' } },
      {
        id: 'f-jobs', name: 'Jobs',
        item: [
          {
            id: 'r-create', name: 'Create job',
            request: {
              method: 'POST',
              url: { raw: '{{baseUrl}}/jobs?dry=1' },
              header: [{ key: 'Content-Type', value: 'application/json' }, { key: 'X-Old', value: '1', disabled: true }],
              body: { mode: 'raw', raw: '{"name":"a"}' },
              description: { content: 'Creates a job' },
            },
          },
          {
            id: 'f-admin', name: 'Admin',
            item: [{ uid: '42-r-purge', name: 'Purge', request: { method: 'DELETE', url: '{{baseUrl}}/jobs', body: { mode: 'urlencoded', urlencoded: [{ key: 'all', value: 'true' }] } } }],
          },
        ],
      },
    ],
  },
}

const link = (folderId: string | null): PostmanLink => ({ workspaceId: 'w', collectionId: 'c1', collectionName: 'API', folderId, folderPath: folderId ? 'Jobs' : null })

let calls: { url: string; method: string; body: unknown }[] = []
let responses: Record<string, unknown> = {}

beforeEach(() => {
  calls = []
  responses = {}
  resetPostman()
  process.env.POSTMAN_API_KEY = 'PMAK-test'
  vi.stubGlobal('fetch', async (url: string, init: { method: string; body?: string }) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined })
    const key = `${init.method} ${url.replace('https://api.getpostman.com', '').split('?')[0]}`
    return new Response(JSON.stringify(responses[key] ?? collection), { status: 200 })
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.POSTMAN_API_KEY
})

describe('lecture du dossier lié', () => {
  it('situe requêtes et sous-dossiers par rapport au dossier lié', async () => {
    const c = await folderContent(link('f-jobs'))
    expect(c.requests.map((r) => [r.id, r.folder])).toEqual([['r-create', ''], ['r-purge', 'Admin']])
    expect(c.folders).toEqual(['Admin'])
    expect(c.folderIds.get('admin')).toBe('f-admin')
  })

  it('lit toute la collection quand le lien est à sa racine', async () => {
    const c = await folderContent(link(null))
    expect(c.requests.map((r) => [r.id, r.folder])).toEqual([['r-root', ''], ['r-create', 'Jobs'], ['r-purge', 'Jobs / Admin']])
    expect(c.folders).toEqual(['Jobs', 'Jobs / Admin'])
  })

  it('normalise méthode, adresse, headers actifs, corps et description', async () => {
    const [create, purge] = (await folderContent(link('f-jobs'))).requests
    expect(create).toMatchObject({ method: 'POST', url: '{{baseUrl}}/jobs?dry=1', headers: [{ key: 'Content-Type', value: 'application/json' }], body: '{"name":"a"}', bodyMode: 'raw', description: 'Creates a job' })
    expect(purge).toMatchObject({ id: 'r-purge', body: 'all=true', bodyMode: 'urlencoded' })
    expect((await folderContent(link(null))).requests[0]).toMatchObject({ method: 'GET', body: null, bodyMode: 'none' })
  })

  it('refuse un dossier qui a disparu de la collection', async () => {
    await expect(folderContent(link('f-gone'))).rejects.toThrow(/n’existe plus/)
  })

  it('liste les dossiers avec leur chemin complet', async () => {
    expect(await collectionFolders('c1')).toEqual([{ id: 'f-jobs', name: 'Jobs', path: 'Jobs' }, { id: 'f-admin', name: 'Admin', path: 'Jobs / Admin' }])
  })

  it('ne relit pas la collection à chaque appel', async () => {
    await folderContent(link(null))
    await folderContent(link('f-jobs'))
    expect(calls).toHaveLength(1)
  })
})

describe('écriture d’une requête', () => {
  const data = { name: 'List jobs', method: 'get', url: '{{baseUrl}}/jobs', headers: [{ key: 'Accept', value: 'application/json' }], body: '{"a":{{id}}}', description: 'Lists' }

  it('crée dans le dossier demandé, au format des collection items', async () => {
    responses['POST /collections/c1/requests'] = { data: { id: 'new', folder: 'f-jobs' } }
    expect(await createRequest('c1', 'f-jobs', data)).toBe('new')
    expect(calls[0].url).toBe('https://api.getpostman.com/collections/c1/requests?folder=f-jobs&folderId=f-jobs')
    expect(calls[0].body).toEqual({
      name: 'List jobs', method: 'GET', url: '{{baseUrl}}/jobs', description: 'Lists',
      headerData: [{ key: 'Accept', value: 'application/json', description: '', enabled: true }], headers: 'Accept: application/json\n',
      dataMode: 'raw', rawModeData: '{"a":{{id}}}', dataOptions: { raw: { language: 'json' } },
    })
  })

  it('retire une requête que Postman a créée hors du dossier demandé', async () => {
    responses['POST /collections/c1/requests'] = { data: { id: 'new', folder: null } }
    await expect(createRequest('c1', 'f-jobs', data)).rejects.toThrow(/hors du dossier/)
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', url: 'https://api.getpostman.com/collections/c1/requests/new' })
  })

  it('n’envoie que les champs changés, et rien s’il n’y en a pas', async () => {
    await updateRequest('c1', 'r-create', {})
    expect(calls).toHaveLength(0)
    await updateRequest('c1', 'r-create', { url: '{{baseUrl}}/v2/jobs' })
    expect(calls[0]).toMatchObject({ method: 'PUT', url: 'https://api.getpostman.com/collections/c1/requests/r-create', body: { url: '{{baseUrl}}/v2/jobs' } })
  })

  it('lit une collection par son uid et écrit ses éléments par son id nu', async () => {
    await folderContent({ ...link(null), collectionId: '42-c1' })
    await updateRequest('42-c1', 'r-create', { name: 'x' })
    expect(calls.map((c) => `${c.method} ${c.url.replace('https://api.getpostman.com', '')}`)).toEqual(['GET /collections/42-c1', 'PUT /collections/c1/requests/r-create'])
  })

  it('relit la collection après une écriture', async () => {
    await folderContent(link(null))
    await updateRequest('c1', 'r-create', { name: 'x' })
    await folderContent(link(null))
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2)
  })
})

describe('propositions de l’agent', () => {
  const op = (o: Partial<PostmanOperation>): PostmanOperation => ({ op: 'create', requestId: null, folder: '', name: 'List jobs', method: 'GET', url: '{{baseUrl}}/jobs', headers: [], body: null, description: '', reason: '', ...o })
  const writes = () => calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.url.replace('https://api.getpostman.com', '')}`)

  it('crée les sous-dossiers manquants, une seule fois, puis la requête dedans', async () => {
    const content = await folderContent(link('f-jobs'))
    let n = 0
    vi.stubGlobal('fetch', async (url: string, init: { method: string; body?: string }) => {
      const body = init.body ? JSON.parse(init.body) : undefined
      calls.push({ url, method: init.method, body })
      const folder = url.includes('/folders')
      return new Response(JSON.stringify({ data: folder ? { id: `f-new-${++n}` } : { id: 'r-new', folder: new URL(url).searchParams.get('folder') } }), { status: 200 })
    })
    expect(await applyOperation(link('f-jobs'), content, op({ folder: 'admin / Exports' }))).toBe('r-new')
    await applyOperation(link('f-jobs'), content, op({ folder: 'Admin/Exports', name: 'Other' }))
    expect(writes()).toEqual([
      'POST /collections/c1/folders',
      'POST /collections/c1/requests?folder=f-new-1&folderId=f-new-1',
      'POST /collections/c1/requests?folder=f-new-1&folderId=f-new-1',
    ])
    // Le sous-dossier existant « Admin » est repris (casse ignorée), le nouveau est créé dedans.
    expect(calls.find((c) => c.url.endsWith('/folders'))?.body).toEqual({ name: 'Exports', folder: 'f-admin' })
  })

  it('crée à la racine de la collection quand le lien y est', async () => {
    const content = await folderContent(link(null))
    responses['POST /collections/c1/requests'] = { data: { id: 'r-new', folder: null } }
    await applyOperation(link(null), content, op({}))
    expect(writes()).toEqual(['POST /collections/c1/requests'])
  })

  it('ne modifie que ce qui change, et garde le corps quand body vaut null', async () => {
    const content = await folderContent(link('f-jobs'))
    await applyOperation(link('f-jobs'), content, op({ op: 'update', requestId: 'r-create', name: 'Create job', method: 'post', url: '{{baseUrl}}/v2/jobs', headers: [{ key: 'Content-Type', value: 'application/json' }], body: null, description: 'Creates a job' }))
    expect(calls.at(-1)).toMatchObject({ method: 'PUT', body: { url: '{{baseUrl}}/v2/jobs' } })
  })

  it('ne réécrit pas un corps qui n’est pas brut', async () => {
    const content = await folderContent(link('f-jobs'))
    await applyOperation(link('f-jobs'), content, op({ op: 'update', requestId: 'r-purge', name: 'Purge all', method: 'DELETE', url: '{{baseUrl}}/jobs', body: '{"all":true}' }))
    expect(calls.at(-1)?.body).toEqual({ name: 'Purge all' })
  })

  it('refuse de toucher une requête hors du dossier lié', async () => {
    const content = await folderContent(link('f-jobs'))
    await expect(applyOperation(link('f-jobs'), content, op({ op: 'delete', requestId: 'r-root', name: 'Health' }))).rejects.toThrow(/n’est plus dans le dossier lié/)
    expect(writes()).toEqual([])
  })

  it('supprime une requête du dossier lié', async () => {
    const content = await folderContent(link('f-jobs'))
    expect(await applyOperation(link('f-jobs'), content, op({ op: 'delete', requestId: 'r-purge' }))).toBe('r-purge')
    expect(writes()).toEqual(['DELETE /collections/c1/requests/r-purge'])
  })
})
