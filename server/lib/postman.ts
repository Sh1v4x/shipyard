import type { PostmanAuthInfo, PostmanBodyMode, PostmanFolder, PostmanHeader, PostmanLink, PostmanOperation, PostmanRef, PostmanRequest, PostmanRequestData } from '../../shared/types.ts'
import { HttpError } from './config.ts'
import { ttlCache } from './exec.ts'

// API Postman (https://api.getpostman.com), avec une clé personnelle (POSTMAN_API_KEY, réglée dans Réglages › Connexions).
// Lecture : la collection entière, au format v2.1. Écriture : requête par requête (les « collection items »), pour ne
// jamais renvoyer la collection entière et écraser ce qu'un collègue y change au même moment.

/** Autre adresse que celle par défaut : hébergement Postman dans une autre région, ou un faux serveur pour les essais. */
const endpoint = () => (process.env.POSTMAN_API_URL || 'https://api.getpostman.com').replace(/\/+$/, '')
/** Séparateur des chemins de dossiers affichés et proposés par l'agent. */
export const PATH_SEP = ' / '

export const postmanConfigured = () => Boolean(process.env.POSTMAN_API_KEY)

async function call<T>(path: string, init: { method?: string; body?: unknown; key?: string } = {}): Promise<T> {
  const key = init.key ?? process.env.POSTMAN_API_KEY
  if (!key) throw new HttpError(400, 'Clé Postman manquante : renseigne-la dans Réglages › Connexions')
  const res = await fetch(`${endpoint()}${path}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: { 'X-API-Key': key, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  })
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; name?: string }; detail?: string; title?: string }
  if (!res.ok) {
    if (res.status === 429) throw new HttpError(429, 'Postman : trop de requêtes, réessaie dans une minute')
    throw new HttpError(res.status === 401 || res.status === 403 ? 400 : 502, `Postman : ${json.error?.message ?? json.detail ?? json.title ?? res.statusText}`)
  }
  return json as T
}

// Postman limite la liste des espaces et des collections à 10 appels par 10 secondes.
const lists = ttlCache<PostmanRef[]>(5 * 60_000)
const trees = ttlCache<CollectionTree>(30_000)
const users = ttlCache<string>(10 * 60_000)

/** Après un changement de clé : rien de l'ancien compte ne reste en mémoire. */
export function resetPostman() {
  lists.clear()
  trees.clear()
  users.clear()
  envs.clear()
}

interface MeResponse { user: { username: string; fullName?: string | null } }

/** Vérifie une clé et renvoie le nom de son compte. */
export async function checkPostmanKey(key: string): Promise<{ name: string }> {
  const { user } = await call<MeResponse>('/me', { key })
  return { name: user.fullName || user.username }
}

/** Nom du compte de la clé enregistrée. */
export const me = () => users.get('me', async () => (await checkPostmanKey(process.env.POSTMAN_API_KEY ?? '')).name)

export const workspaces = (force = false) =>
  lists.get('workspaces', async () => {
    const r = await call<{ workspaces: { id: string; name: string }[] }>('/workspaces')
    return r.workspaces.map((w) => ({ id: w.id, name: w.name })).sort((a, b) => a.name.localeCompare(b.name))
  }, force)

export const collections = (workspaceId: string, force = false) =>
  lists.get(`collections:${workspaceId}`, async () => {
    const r = await call<{ collections: { id: string; uid?: string; name: string }[] }>(`/collections?workspace=${encodeURIComponent(workspaceId)}`)
    // L'uid (« <propriétaire>-<id> ») : Postman ne retrouve pas par son id seul une collection créée par un collègue.
    return r.collections.map((c) => ({ id: c.uid ?? c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name))
  }, force)

export const environments = (workspaceId: string, force = false) =>
  lists.get(`environments:${workspaceId}`, async () => {
    const r = await call<{ environments: { id: string; uid?: string; name: string }[] }>(`/environments?workspace=${encodeURIComponent(workspaceId)}`)
    return r.environments.map((e) => ({ id: e.uid ?? e.id, name: e.name })).sort((a, b) => a.name.localeCompare(b.name))
  }, force)

export interface EnvValue { key: string; value: string; secret: boolean }
const envs = ttlCache<{ name: string; values: EnvValue[] }>(60_000)

/** Variables d'un environnement : les valeurs partagées dans Postman (les valeurs « courantes » de l'application n'en sortent pas). */
export const environment = (id: string, force = false) =>
  envs.get(id, async () => {
    const r = await call<{ environment: { name: string; values?: { key?: string; value?: unknown; enabled?: boolean; type?: string }[] } }>(`/environments/${encodeURIComponent(id)}`)
    return {
      name: r.environment.name,
      values: (r.environment.values ?? []).filter((v) => !!v.key && v.enabled !== false).map((v) => ({ key: v.key!, value: v.value == null ? '' : String(v.value), secret: v.type === 'secret' })),
    }
  }, force)

// ---------- Lecture d'une collection (format v2.1) ----------

interface V2Url { raw?: string; variable?: { key?: string; value?: string }[] }
/** Autorisation : `type`, et ses paramètres sous la clé du même nom (liste clé/valeur en v2.1, objet en v2.0). */
type V2Auth = { type?: string } & Record<string, unknown>
interface V2Body {
  mode?: string
  raw?: string
  urlencoded?: { key: string; value?: string; disabled?: boolean }[]
  formdata?: { key: string; value?: string; type?: string; disabled?: boolean }[]
  graphql?: { query?: string; variables?: string }
}
interface V2Request {
  method?: string
  url?: string | V2Url
  header?: { key: string; value?: string; disabled?: boolean }[] | string
  body?: V2Body | null
  auth?: V2Auth | null
  description?: string | { content?: string } | null
}
interface V2Item {
  auth?: V2Auth | null
  id?: string
  uid?: string
  name?: string
  description?: string | { content?: string } | null
  item?: V2Item[]
  request?: V2Request | string
}

/** Requête d'une collection, située par ses dossiers parents (du plus haut au plus proche). */
export interface TreeRequest extends Omit<PostmanRequest, 'folder' | 'auth'> {
  ancestors: string[]
  path: string[]
  /** Autorisation qui s'applique, avec ses valeurs telles qu'écrites dans Postman. */
  rawAuth: RawAuth
  /** Valeurs des segments `:nom` de l'adresse. */
  pathVars: PostmanHeader[]
  /** Champs d'un corps urlencoded ou form-data, et corps GraphQL, pour l'envoi. */
  pairs: PostmanHeader[]
  graphql: { query: string; variables: string } | null
}
interface TreeFolder { id: string; name: string; ancestors: string[]; path: string[]; rawAuth: RawAuth }
export interface CollectionTree { name: string; folders: TreeFolder[]; requests: TreeRequest[]; variables: PostmanHeader[]; rawAuth: RawAuth }

/** Autorisation lue dans la collection : son type, ses paramètres, et qui la porte. */
export interface RawAuth { type: string; params: Record<string, string>; from: PostmanAuthInfo['from']; source: string | null }

const NO_AUTH: RawAuth = { type: 'noauth', params: {}, from: 'none', source: null }

/** Autorisation posée sur un élément ; null s'il hérite de son parent. */
function ownAuth(auth: V2Auth | null | undefined, from: RawAuth['from'], source: string): RawAuth | null {
  const type = auth?.type
  if (!auth || !type || type === 'inherit') return null
  const raw = auth[type]
  const params: Record<string, string> = {}
  if (Array.isArray(raw)) for (const p of raw as { key?: string; value?: unknown }[]) { if (p.key) params[p.key] = p.value == null ? '' : String(p.value) }
  else if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw)) params[k] = v == null ? '' : String(v)
  return { type, params, from: type === 'noauth' ? 'none' : from, source: type === 'noauth' ? null : source }
}

/** Types que Shipyard sait appliquer à l'envoi. */
export const SUPPORTED_AUTH = ['noauth', 'bearer', 'basic', 'apikey', 'oauth2']
/** Paramètres d'autorisation dont la valeur en clair ne s'affiche pas. */
const SECRET_PARAM = /token|password|secret|value|key$/i

/** Masque une valeur sensible : ses 4 derniers caractères suffisent à la reconnaître. */
export const mask = (v: string) => (v.length > 8 ? `••••${v.slice(-4)}` : '••••')

/** Autorisation telle qu'on l'affiche : une valeur en clair est masquée, une référence à une variable reste lisible. */
export function authInfo(a: RawAuth): PostmanAuthInfo {
  const shown = (k: string, v: string) => (!v || v.includes('{{') || !SECRET_PARAM.test(k) || (a.type === 'apikey' && k === 'key') ? v : mask(v))
  return { type: a.type, from: a.from, source: a.source, supported: SUPPORTED_AUTH.includes(a.type), fields: Object.entries(a.params).filter(([, v]) => v !== '').map(([key, v]) => ({ key, value: shown(key, v) })) }
}

const text = (d: V2Item['description']) => (typeof d === 'string' ? d : d?.content ?? '')

/** Les points d'accès par élément attendent l'id nu ; l'uid est « <propriétaire>-<id> ». */
const bare = (uid: string) => uid.replace(/^\d+-/, '')
const bareId = (i: V2Item) => i.id ?? (i.uid ? bare(i.uid) : null)
/** Chemin des éléments d'une collection (dossiers, requêtes) : la collection y est désignée par son id nu. */
const items = (collectionId: string) => `/collections/${encodeURIComponent(bare(collectionId))}`

const BODY_MODES: PostmanBodyMode[] = ['raw', 'urlencoded', 'formdata', 'graphql', 'file']

function bodyOf(b: V2Body | null | undefined): { body: string | null; bodyMode: PostmanBodyMode } {
  const mode = BODY_MODES.find((m) => m === b?.mode)
  if (!b || !mode) return { body: null, bodyMode: 'none' }
  const pairs = (list: { key: string; value?: string; disabled?: boolean }[] | undefined) => (list ?? []).filter((p) => !p.disabled).map((p) => `${p.key}=${p.value ?? ''}`).join('\n')
  if (mode === 'raw') return b.raw ? { body: b.raw, bodyMode: 'raw' } : { body: null, bodyMode: 'none' }
  if (mode === 'urlencoded') return { body: pairs(b.urlencoded), bodyMode: mode }
  if (mode === 'formdata') return { body: pairs(b.formdata), bodyMode: mode }
  if (mode === 'graphql') return { body: [b.graphql?.query, b.graphql?.variables].filter(Boolean).join('\n\n'), bodyMode: mode }
  return { body: '(fichier)', bodyMode: mode }
}

function headersOf(h: V2Request['header']): PostmanHeader[] {
  if (typeof h === 'string') {
    return h.split('\n').map((l) => l.match(/^([^:]+):\s*(.*)$/)).filter((m) => !!m).map((m) => ({ key: m[1].trim(), value: m[2] }))
  }
  return (h ?? []).filter((x) => !x.disabled).map((x) => ({ key: x.key, value: x.value ?? '' }))
}

const livePairs = (list: { key: string; value?: string; type?: string; disabled?: boolean }[] | undefined): PostmanHeader[] =>
  (list ?? []).filter((p) => !p.disabled && p.type !== 'file').map((p) => ({ key: p.key, value: p.value ?? '' }))

/** `inherited` : l'autorisation du parent, qu'un élément sans la sienne reprend. */
function walk(items: V2Item[], ancestors: string[], path: string[], inherited: RawAuth, out: CollectionTree) {
  for (const it of items) {
    const id = bareId(it)
    const name = it.name ?? ''
    if (Array.isArray(it.item)) {
      const rawAuth = ownAuth(it.auth, 'folder', name) ?? inherited
      // Dossier sans identifiant (jamais vu, mais le format le permet) : ses requêtes restent lisibles, rangées chez son parent.
      if (id) out.folders.push({ id, name, ancestors, path: [...path, name], rawAuth })
      walk(it.item, id ? [...ancestors, id] : ancestors, id ? [...path, name] : path, rawAuth, out)
      continue
    }
    if (!id || it.request == null) continue
    const req: V2Request = typeof it.request === 'string' ? { url: it.request } : it.request
    out.requests.push({
      id, name, ancestors, path,
      rawAuth: ownAuth(req.auth, 'request', name) ?? inherited,
      pathVars: (typeof req.url === 'object' ? req.url?.variable ?? [] : []).filter((v) => !!v.key).map((v) => ({ key: v.key!, value: v.value ?? '' })),
      pairs: req.body?.mode === 'urlencoded' ? livePairs(req.body.urlencoded) : req.body?.mode === 'formdata' ? livePairs(req.body.formdata) : [],
      graphql: req.body?.mode === 'graphql' ? { query: req.body.graphql?.query ?? '', variables: req.body.graphql?.variables ?? '' } : null,
      method: (req.method ?? 'GET').toUpperCase(),
      url: typeof req.url === 'string' ? req.url : req.url?.raw ?? '',
      headers: headersOf(req.header),
      description: text(req.description) || text(it.description),
      ...bodyOf(req.body),
    })
  }
}

export const collectionTree = (collectionId: string, force = false) =>
  trees.get(collectionId, async () => {
    const r = await call<{ collection: { info: { name: string }; item?: V2Item[]; auth?: V2Auth | null; variable?: { key?: string; value?: unknown; disabled?: boolean }[] } }>(`/collections/${encodeURIComponent(collectionId)}`)
    const c = r.collection
    const out: CollectionTree = {
      name: c.info.name, folders: [], requests: [],
      variables: (c.variable ?? []).filter((v) => !!v.key && !v.disabled).map((v) => ({ key: v.key!, value: v.value == null ? '' : String(v.value) })),
      rawAuth: ownAuth(c.auth, 'collection', c.info.name) ?? NO_AUTH,
    }
    walk(c.item ?? [], [], [], out.rawAuth, out)
    return out
  }, force)

/** Dossiers d'une collection, pour en choisir un. */
export async function collectionFolders(collectionId: string, force = false): Promise<PostmanFolder[]> {
  return (await collectionTree(collectionId, force)).folders.map((f) => ({ id: f.id, name: f.name, path: f.path.join(PATH_SEP) }))
}

/** Lien complet (noms et chemin lus dans Postman) vers un dossier d'une collection, ou sa racine. */
export async function resolveLink(input: { workspaceId: string | null; collectionId: string; folderId: string | null }): Promise<PostmanLink> {
  const tree = await collectionTree(input.collectionId, true)
  const folder = input.folderId ? tree.folders.find((f) => f.id === input.folderId) : null
  if (input.folderId && !folder) throw new HttpError(404, 'Dossier introuvable dans cette collection')
  return { workspaceId: input.workspaceId, collectionId: input.collectionId, collectionName: tree.name, folderId: folder?.id ?? null, folderPath: folder ? folder.path.join(PATH_SEP) : null }
}

export interface FolderContent {
  /** Autorisation du dossier lié (celle de la collection à sa racine). */
  auth: PostmanAuthInfo
  requests: PostmanRequest[]
  /** Sous-dossiers du dossier lié : chemins relatifs. */
  folders: string[]
  /** Identifiant de chaque sous-dossier, par chemin relatif en minuscules. */
  folderIds: Map<string, string>
}

export const folderKey = (segments: string[]) => segments.map((s) => s.trim().toLowerCase()).join(PATH_SEP)

/** Contenu du dossier lié : ses requêtes et ses sous-dossiers, à tous les niveaux, situés par rapport à lui. */
export async function folderContent(link: PostmanLink, force = false): Promise<FolderContent> {
  const tree = await collectionTree(link.collectionId, force)
  const root = link.folderId ? tree.folders.find((f) => f.id === link.folderId) : null
  if (link.folderId && !root) throw new HttpError(404, `Le dossier « ${link.folderPath} » n’existe plus dans la collection ${tree.name} : lie un autre dossier.`)
  const depth = root ? root.path.length : 0
  const inside = (ancestors: string[]) => !link.folderId || ancestors.includes(link.folderId)
  const sub = tree.folders.filter((f) => inside(f.ancestors))
  return {
    auth: authInfo(root?.rawAuth ?? tree.rawAuth),
    requests: tree.requests.filter((r) => inside(r.ancestors)).map(({ ancestors: _a, path, rawAuth, pathVars: _p, pairs: _f, graphql: _g, ...r }) => ({ ...r, folder: path.slice(depth).join(PATH_SEP), auth: authInfo(rawAuth) })),
    folders: sub.map((f) => f.path.slice(depth).join(PATH_SEP)),
    folderIds: new Map(sub.map((f) => [folderKey(f.path.slice(depth)), f.id])),
  }
}

// ---------- Écriture, requête par requête ----------

interface ItemResponse { data: { id: string; folder?: string | null } }

const isJson = (body: string) => {
  try {
    JSON.parse(body)
    return true
  } catch {
    // Un corps JSON avec des variables Postman hors chaîne ({{id}}) ne se parse pas : sa forme suffit.
    return /^\s*[{[]/.test(body)
  }
}

/** Champs d'une requête au format attendu par les « collection items » (celui des collections v1). */
function itemFields(data: Partial<PostmanRequestData>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (data.name !== undefined) out.name = data.name
  if (data.method !== undefined) out.method = data.method.toUpperCase()
  if (data.url !== undefined) out.url = data.url
  if (data.description !== undefined) out.description = data.description
  if (data.headers !== undefined) {
    out.headerData = data.headers.map((h) => ({ key: h.key, value: h.value, description: '', enabled: true }))
    out.headers = data.headers.map((h) => `${h.key}: ${h.value}\n`).join('')
  }
  if (data.body !== undefined && data.body !== null) {
    out.dataMode = 'raw'
    out.rawModeData = data.body
    out.dataOptions = { raw: { language: isJson(data.body) ? 'json' : 'text' } }
  }
  return out
}

export async function createFolder(collectionId: string, name: string, parentId: string | null): Promise<string> {
  const r = await call<ItemResponse>(`${items(collectionId)}/folders`, { body: { name, ...(parentId ? { folder: parentId } : {}) } })
  trees.clear(collectionId)
  return r.data.id
}

export async function createRequest(collectionId: string, folderId: string | null, data: PostmanRequestData): Promise<string> {
  // Le dossier cible se passe en paramètre d'URL : `folder` pour les clients officiels, `folderId` d'après la spécification.
  const query = folderId ? `?${new URLSearchParams({ folder: folderId, folderId })}` : ''
  const r = await call<ItemResponse>(`${items(collectionId)}/requests${query}`, { body: itemFields(data) })
  trees.clear(collectionId)
  // Requête créée ailleurs que dans le dossier demandé : on la retire plutôt que de la laisser traîner à la racine.
  const landed = r.data.folder
  if (folderId && landed !== undefined && !(landed ?? '').endsWith(folderId)) {
    await deleteRequest(collectionId, r.data.id).catch(() => undefined)
    throw new HttpError(502, `Postman a créé « ${data.name} » hors du dossier demandé : la requête a été retirée.`)
  }
  return r.data.id
}

/** Ne change que les champs donnés : le reste de la requête (auth, scripts, exemples) est gardé par Postman. */
export async function updateRequest(collectionId: string, requestId: string, patch: Partial<PostmanRequestData>) {
  const body = itemFields(patch)
  if (!Object.keys(body).length) return
  await call(`${items(collectionId)}/requests/${encodeURIComponent(requestId)}`, { method: 'PUT', body })
  trees.clear(collectionId)
}

export async function deleteRequest(collectionId: string, requestId: string) {
  await call(`${items(collectionId)}/requests/${encodeURIComponent(requestId)}`, { method: 'DELETE' })
  trees.clear(collectionId)
}

// ---------- Propositions de l'agent ----------

/** Sous-dossier d'une proposition (créé avec ses parents s'il manque) ; null : le dossier lié lui-même, à la racine de la collection. */
async function targetFolder(link: PostmanLink, content: FolderContent, folder: string): Promise<string | null> {
  const segments = folder.split('/').map((x) => x.trim()).filter(Boolean)
  let parent = link.folderId
  for (let i = 0; i < segments.length; i++) {
    const key = folderKey(segments.slice(0, i + 1))
    let id = content.folderIds.get(key)
    if (!id) {
      id = await createFolder(link.collectionId, segments[i], parent)
      content.folderIds.set(key, id)
    }
    parent = id
  }
  return parent
}

/** Champs qu'une modification change vraiment : seuls ceux-là partent chez Postman. */
export function changes(current: PostmanRequest, op: PostmanOperation): Partial<PostmanRequestData> {
  const patch: Partial<PostmanRequestData> = {}
  if (op.name !== current.name) patch.name = op.name
  if (op.method.toUpperCase() !== current.method) patch.method = op.method
  if (op.url !== current.url) patch.url = op.url
  if (op.description !== current.description) patch.description = op.description
  if (JSON.stringify(op.headers) !== JSON.stringify(current.headers)) patch.headers = op.headers
  // Un corps qui n'est pas brut (form-data, GraphQL…) n'est pas réécrit ; null garde le corps actuel.
  const editable = current.bodyMode === 'raw' || current.bodyMode === 'none'
  if (editable && op.body !== null && op.body !== (current.body ?? '')) patch.body = op.body
  return patch
}

/** Écrit une proposition de l'agent dans le dossier lié ; renvoie l'identifiant de la requête concernée. */
export async function applyOperation(link: PostmanLink, content: FolderContent, op: PostmanOperation): Promise<string | null> {
  if (op.op === 'create') {
    const { name, method, url, headers, description } = op
    return createRequest(link.collectionId, await targetFolder(link, content, op.folder), { name, method, url, headers, description, body: op.body || null })
  }
  // L'agent ne désigne que des requêtes du dossier lié : rien d'autre dans la collection ne peut être touché.
  const current = content.requests.find((r) => r.id === op.requestId)
  if (!current) throw new HttpError(409, `« ${op.name} » n’est plus dans le dossier lié`)
  if (op.op === 'delete') await deleteRequest(link.collectionId, current.id)
  else await updateRequest(link.collectionId, current.id, changes(current, op))
  return current.id
}
