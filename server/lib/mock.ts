import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Context, Next } from 'hono'
import type { Project } from '../../shared/types.ts'
import { ROOT, loadProjects } from './config.ts'

// Projet de démo pour retravailler l'interface : SHIPYARD_MOCK=mock/demo.json pnpm dev.
// Ses lectures sont servies depuis le JSON (généré par server/mock/generate.ts), sans GitHub, Linear ni git.
// Ses écritures et ses actions IA sont refusées. Les autres projets fonctionnent normalement.

export interface MockData {
  /** Date de génération : les dates du fichier sont décalées d'autant, pour garder « il y a 2 h » au fil des jours. */
  generatedAt: string
  project: Project
  /** Réponse de chaque GET, par chemin sous /api/projects/<id> (ex. /overview, /worktrees/<wt>/threads). */
  routes: Record<string, unknown>
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

function load(): MockData | null {
  const file = process.env.SHIPYARD_MOCK
  if (!file) return null
  const raw = JSON.parse(readFileSync(resolve(ROOT, file), 'utf8')) as MockData
  const shift = Date.now() - Date.parse(raw.generatedAt)
  const data = JSON.parse(JSON.stringify(raw.routes), (_k, v: unknown) =>
    typeof v === 'string' && ISO_DATE.test(v) ? new Date(Date.parse(v) + shift).toISOString() : v) as MockData['routes']
  console.log(`Projet de démo « ${raw.project.name} » chargé depuis ${file}`)
  return { ...raw, routes: data }
}

const mock = load()

const READ_ONLY = 'Projet de démo : rien n’est envoyé ni lancé.'

/** Middleware placé avant les routes : sert le projet de démo, laisse passer tout le reste. */
export async function mockMiddleware(c: Context, next: Next) {
  if (!mock) return next()
  const path = c.req.path
  const prefix = `/api/projects/${mock.project.id}`
  if (path === '/api/projects' && c.req.method === 'GET') return c.json([...loadProjects(), mock.project])
  if (path.startsWith('/api/actions/') && c.req.method === 'POST') {
    const b = (await c.req.json().catch(() => ({}))) as { project?: string }
    if (b.project === mock.project.id) return c.json({ error: READ_ONLY }, 400)
    return next()
  }
  if (path !== prefix && !path.startsWith(`${prefix}/`)) return next()
  const sub = path.slice(prefix.length)
  // « Tout actualiser » : la vue de démo telle quelle.
  if (sub === '/refresh') return c.json(mock.routes['/overview'])
  if (c.req.method !== 'GET') return c.json({ error: READ_ONLY }, 400)
  if (sub in mock.routes) return c.json(mock.routes[sub])
  return c.json({ error: `Projet de démo : aucune donnée pour ${sub || '/'}` }, 404)
}
