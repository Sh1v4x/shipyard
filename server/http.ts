import type { Context, MiddlewareHandler } from 'hono'
import type { z } from 'zod'
import { HttpError, PORT } from './lib/config.ts'

const DEV_PORT = 5173
const LOCAL_HOSTS = ['localhost', '127.0.0.1']
const LOCAL_ADDRESSES = LOCAL_HOSTS.flatMap((h) => [`${h}:${PORT}`, `${h}:${DEV_PORT}`])
const ALLOWED_HOSTS = new Set(LOCAL_ADDRESSES)
const ALLOWED_ORIGINS = new Set(LOCAL_ADDRESSES.map((a) => `http://${a}`))
/** Requête d'une autre page (même un autre port de localhost) : le navigateur ne met pas d'Origin sur un GET. */
const FOREIGN_FETCH = new Set(['cross-site', 'same-site'])
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * L'API pilote des agents qui écrivent du code : seule l'interface locale peut l'appeler. Le Host bloque le
 * DNS rebinding, l'Origin et Sec-Fetch-Site les requêtes envoyées par une autre page du navigateur (y compris
 * les GET qui ont des effets), et le JSON imposé les requêtes « simples » qui partent sans vérification CORS.
 */
export const localOnly: MiddlewareHandler = async (c, next) => {
  if (!ALLOWED_HOSTS.has(c.req.header('host') ?? '')) throw new HttpError(403, 'Hôte non autorisé')
  const origin = c.req.header('origin')
  if (origin && !ALLOWED_ORIGINS.has(origin)) throw new HttpError(403, 'Origine non autorisée')
  if (FOREIGN_FETCH.has(c.req.header('sec-fetch-site') ?? '')) throw new HttpError(403, 'Requête d’une autre page refusée')
  const hasBody = Number(c.req.header('content-length') ?? 0) > 0 || c.req.header('transfer-encoding') != null
  if (!SAFE_METHODS.has(c.req.method) && hasBody && !c.req.header('content-type')?.startsWith('application/json')) {
    throw new HttpError(415, 'Corps JSON attendu')
  }
  await next()
}

/** Corps JSON de la requête, validé : un corps absent vaut un objet vide. */
export async function jsonBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  const text = await c.req.text()
  let raw: unknown = {}
  try {
    if (text) raw = JSON.parse(text)
  } catch {
    throw new HttpError(400, 'JSON invalide')
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) throw new HttpError(400, `Requête invalide : ${parsed.error.issues.map((i) => `${i.path.join('.') || 'corps'} ${i.message}`).join(', ')}`)
  return parsed.data
}

export const force = (c: Context) => c.req.query('refresh') === '1'
