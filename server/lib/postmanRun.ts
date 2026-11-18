import { randomUUID } from 'node:crypto'
import type { PostmanHeader, PostmanLink, PostmanRequestData, PostmanResponse, PostmanVariable } from '../../shared/types.ts'
import { HttpError } from './config.ts'
import { type CollectionTree, type RawAuth, type TreeRequest, SUPPORTED_AUTH, collectionTree, environment, mask } from './postman.ts'
import { postmanVars } from './postmanLinks.ts'

// Envoi d'une requête du dossier lié depuis Shipyard : Postman ne l'exécute pas par son API, c'est donc le serveur
// local qui remplace les variables, applique l'autorisation héritée et appelle l'adresse. Les scripts Postman
// (pre-request, tests) ne sont pas exécutés.

const TIMEOUT_MS = 30_000
/** Au-delà, le corps de la réponse est coupé à l'affichage. */
const BODY_MAX = 300_000
const VAR = /\{\{\s*([^{}]+?)\s*\}\}/g
const HAS_VAR = /\{\{\s*[^{}]+?\s*\}\}/
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const SECRET_KEY = /token|secret|password|passwd|pwd|api[-_]?key|authorization|credential|cookie|session/i

interface Value { value: string; source: PostmanVariable['source']; secret: boolean }

/** Variables dynamiques de Postman les plus courantes. */
const DYNAMIC: Record<string, () => string> = {
  $guid: () => randomUUID(),
  $randomUUID: () => randomUUID(),
  $timestamp: () => String(Math.floor(Date.now() / 1000)),
  $isoTimestamp: () => new Date().toISOString(),
  $randomInt: () => String(Math.floor(Math.random() * 1001)),
}

/**
 * Valeur de chaque variable, par priorité : saisie dans Shipyard, puis environnement choisi, puis variables de la
 * collection (l'ordre de Postman, les valeurs locales tenant lieu de ses valeurs « courantes »).
 */
export async function variableValues(link: PostmanLink, wtPath: string, tree: CollectionTree, force = false): Promise<Map<string, Value>> {
  const out = new Map<string, Value>()
  for (const v of tree.variables) out.set(v.key, { value: v.value, source: 'collection', secret: SECRET_KEY.test(v.key) })
  if (link.environmentId) {
    const env = await environment(link.environmentId, force)
    for (const v of env.values) out.set(v.key, { value: v.value, source: 'environment', secret: v.secret || SECRET_KEY.test(v.key) })
  }
  for (const [key, value] of Object.entries(postmanVars(wtPath))) out.set(key, { value, source: 'local', secret: out.get(key)?.secret || SECRET_KEY.test(key) })
  return out
}

const namesIn = (text: string) => [...text.matchAll(VAR)].map((m) => m[1]).filter((k) => !(k in DYNAMIC))

/** Tout ce qu'une requête contient de texte à variables : adresse, headers, corps, autorisation. */
const textsOf = (r: TreeRequest) => [r.url, r.body ?? '', ...r.headers.flatMap((h) => [h.key, h.value]), ...r.pathVars.map((p) => p.value), ...r.pairs.map((p) => p.value), ...Object.values(r.rawAuth.params)]

/** Variables utilisées par les requêtes du dossier (et celles saisies dans Shipyard), avec la source de leur valeur. */
export async function folderVariables(link: PostmanLink, wtPath: string, force = false): Promise<PostmanVariable[]> {
  const tree = await collectionTree(link.collectionId, force)
  const values = await variableValues(link, wtPath, tree, force)
  const inside = tree.requests.filter((r) => !link.folderId || r.ancestors.includes(link.folderId))
  const used = new Set([...inside.flatMap((r) => textsOf(r).flatMap(namesIn)), ...Object.keys(postmanVars(wtPath))])
  // Une valeur peut elle-même citer une variable ({{baseUrl}} = {{host}}/api) : elle compte aussi.
  for (const key of [...used]) for (const inner of namesIn(values.get(key)?.value ?? '')) used.add(inner)
  return [...used].sort().map((key) => {
    const v = values.get(key)
    return v ? { key, value: v.secret && v.value ? mask(v.value) : v.value, source: v.source, secret: v.secret } : { key, value: null, source: 'missing', secret: SECRET_KEY.test(key) }
  })
}

/** Remplace les {{variables}} (jusqu'à 5 niveaux d'imbrication) ; note celles restées sans valeur. */
function resolver(values: Map<string, Value>) {
  const missing = new Set<string>()
  const once = (text: string) => text.replace(VAR, (m, k: string) => {
    if (k in DYNAMIC) return DYNAMIC[k]()
    const v = values.get(k)
    if (!v) missing.add(k)
    return v ? v.value : m
  })
  const resolve = (text: string) => {
    let cur = text
    for (let i = 0; i < 5 && HAS_VAR.test(cur); i++) {
      const next = once(cur)
      if (next === cur) break
      cur = next
    }
    return cur
  }
  return { resolve, missing }
}

/** Applique l'autorisation à la requête sortante ; renvoie ce qui a été fait, en clair pour l'œil. */
function applyAuth(auth: RawAuth, resolve: (t: string) => string, headers: Headers, url: URL): string {
  const p = (k: string) => resolve(auth.params[k] ?? '')
  const where = auth.source ? ` · ${auth.from === 'request' ? 'la requête' : auth.source}` : ''
  // Un header Authorization écrit sur la requête passe avant l'autorisation héritée, comme dans Postman.
  const setHeader = (name: string, value: string) => { if (!headers.has(name)) headers.set(name, value) }
  if (auth.type === 'noauth') return 'Aucune autorisation'
  if (!SUPPORTED_AUTH.includes(auth.type)) return `Autorisation « ${auth.type} » non gérée par Shipyard : requête envoyée sans${where}`
  if (auth.type === 'bearer') {
    if (!p('token')) return `Bearer sans jeton${where} : requête envoyée sans`
    setHeader('Authorization', `Bearer ${p('token')}`)
    return `Bearer${where}`
  }
  if (auth.type === 'basic') {
    setHeader('Authorization', `Basic ${Buffer.from(`${p('username')}:${p('password')}`).toString('base64')}`)
    return `Basic (${p('username') || 'sans utilisateur'})${where}`
  }
  if (auth.type === 'apikey') {
    if (!p('key')) return `Clé d’API sans nom${where} : requête envoyée sans`
    if (p('in') === 'query') url.searchParams.set(p('key'), p('value'))
    else setHeader(p('key'), p('value'))
    return `Clé d’API ${p('key')} (${p('in') === 'query' ? 'paramètre d’URL' : 'header'})${where}`
  }
  // OAuth 2.0 : Shipyard ne fait pas le parcours d'obtention du jeton, il envoie celui que Postman a gardé.
  if (!p('accessToken')) return `OAuth 2.0 sans jeton enregistré${where} : requête envoyée sans (donne le jeton dans une variable locale)`
  if (p('addTokenTo') === 'queryParams') url.searchParams.set('access_token', p('accessToken'))
  else setHeader('Authorization', `${p('headerPrefix') || 'Bearer'} ${p('accessToken')}`.trim())
  return `OAuth 2.0 (jeton enregistré)${where}`
}

/** Dernière réponse de chaque requête envoyée, par worktree : en mémoire, perdue au redémarrage du serveur. */
const last = new Map<string, Map<string, PostmanResponse>>()

export const lastResponses = (wtPath: string): PostmanResponse[] => [...(last.get(wtPath)?.values() ?? [])]

export interface RunTarget { requestId?: string; request?: PostmanRequestData }

/**
 * Envoie une requête du dossier lié, ou un brouillon (qui prend l'autorisation du dossier), et renvoie la réponse.
 * Une erreur réseau (hôte injoignable, délai dépassé) est une erreur ; un statut 4xx ou 5xx est une réponse.
 */
export async function runRequest(link: PostmanLink, wtPath: string, target: RunTarget): Promise<PostmanResponse> {
  const tree = await collectionTree(link.collectionId)
  const root = link.folderId ? tree.folders.find((f) => f.id === link.folderId) : null
  let req: Pick<TreeRequest, 'method' | 'url' | 'headers' | 'body' | 'bodyMode' | 'rawAuth' | 'pathVars' | 'pairs' | 'graphql'>
  let requestId: string | null = null
  const found = target.requestId ? tree.requests.find((r) => r.id === target.requestId && (!link.folderId || r.ancestors.includes(link.folderId))) : null
  if (target.requestId && !found) throw new HttpError(404, 'Cette requête n’est pas dans le dossier lié')
  if (target.request) {
    // Brouillon : l'autorisation du dossier, ou celle de la requête qu'il modifie.
    const d = target.request
    req = { method: d.method.toUpperCase(), url: d.url, headers: d.headers, body: d.body || null, bodyMode: d.body ? 'raw' : 'none', rawAuth: found?.rawAuth ?? root?.rawAuth ?? tree.rawAuth, pathVars: found?.pathVars ?? [], pairs: [], graphql: null }
  } else if (found) {
    req = found
    requestId = found.id
  } else throw new HttpError(400, 'Aucune requête à envoyer')
  if (req.bodyMode === 'file') throw new HttpError(400, 'Cette requête envoie un fichier : Shipyard ne sait pas l’envoyer, lance-la depuis Postman.')

  const { resolve, missing } = resolver(await variableValues(link, wtPath, tree))
  let address = resolve(req.url)
  for (const v of req.pathVars) address = address.replace(new RegExp(`/:${escapeRe(v.key)}(?=/|\\?|#|$)`), `/${encodeURIComponent(resolve(v.value))}`)
  if (!/^https?:\/\//i.test(address)) address = `http://${address}`
  let url: URL
  try {
    url = new URL(address)
  } catch {
    throw new HttpError(400, `Adresse invalide une fois les variables remplacées : ${address}${missing.size ? ` (sans valeur : ${[...missing].join(', ')})` : ''}`)
  }
  const headers = new Headers()
  for (const h of req.headers) {
    try {
      headers.set(resolve(h.key), resolve(h.value))
    } catch {
      throw new HttpError(400, `Header invalide : ${h.key}`)
    }
  }
  let body: BodyInit | undefined
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (req.bodyMode === 'raw' && req.body) {
      body = resolve(req.body)
      if (!headers.has('Content-Type') && /^\s*[{[]/.test(body)) headers.set('Content-Type', 'application/json')
    } else if (req.bodyMode === 'urlencoded') body = new URLSearchParams(req.pairs.map((p) => [resolve(p.key), resolve(p.value)]))
    else if (req.bodyMode === 'formdata') {
      const form = new FormData()
      for (const p of req.pairs) form.append(resolve(p.key), resolve(p.value))
      body = form
    } else if (req.bodyMode === 'graphql' && req.graphql) {
      let variables: unknown = {}
      try {
        variables = JSON.parse(resolve(req.graphql.variables) || '{}')
      } catch {
        throw new HttpError(400, 'Variables GraphQL illisibles (JSON attendu)')
      }
      body = JSON.stringify({ query: resolve(req.graphql.query), variables })
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    }
  }
  const auth = applyAuth(req.rawAuth, resolve, headers, url)

  const started = Date.now()
  let res: Response
  try {
    res = await fetch(url, { method: req.method, headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (e) {
    const err = e as Error & { cause?: { code?: string; message?: string } }
    const why = err.name === 'TimeoutError' ? `pas de réponse en ${TIMEOUT_MS / 1000} s` : err.cause?.code ?? err.cause?.message ?? err.message
    throw new HttpError(502, `${req.method} ${url.origin}${url.pathname} : ${why}${missing.size ? ` · variables sans valeur : ${[...missing].join(', ')}` : ''}`)
  }
  const text = await res.text().catch(() => '')
  const out: PostmanResponse = {
    requestId, method: req.method, url: url.toString(), status: res.status, statusText: res.statusText, timeMs: Date.now() - started, size: Buffer.byteLength(text),
    headers: [...res.headers].map(([key, value]): PostmanHeader => ({ key, value })),
    body: text.slice(0, BODY_MAX), truncated: text.length > BODY_MAX, unresolved: [...missing], auth, at: new Date().toISOString(),
  }
  if (requestId) {
    if (!last.has(wtPath)) last.set(wtPath, new Map())
    last.get(wtPath)!.set(requestId, out)
  }
  return out
}
