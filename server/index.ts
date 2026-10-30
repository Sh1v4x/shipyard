
import { existsSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { onRunEnd, purgeRuns } from './lib/claude.ts'
import { HttpError, PORT, ROOT, loadProjects } from './lib/config.ts'
import * as svc from './services.ts'
import { sendNotification, startNotifier } from './notifier.ts'
import { inboxItems } from './inbox.ts'
import { getSettings } from './lib/settings.ts'
import { mockMiddleware } from './lib/mock.ts'


import { localOnly } from './http.ts'
import { removeRunArtifacts } from './lib/runArtifacts.ts'
import { notesRoutes } from './routes/notes.ts'
import { projectsRoutes } from './routes/projects.ts'
import { promptsRoutes } from './routes/prompts.ts'
import { runsRoutes } from './routes/runs.ts'
import { settingsRoutes } from './routes/settings.ts'
import { systemRoutes } from './routes/system.ts'
import { worktreesRoutes } from './routes/worktrees.ts'

/** Boucle locale uniquement : l'API n'est jamais exposée au réseau. */
const HOST = '127.0.0.1'
const PURGE_INTERVAL_MS = 24 * 3600_000

const app = new Hono()

app.onError((err, c) => {
  const status = err instanceof HttpError ? err.status : 500
  if (status === 500) console.error(err)
  return c.json({ error: err.message }, status)
})

app.use('*', localOnly)
// Projet de démo (SHIPYARD_MOCK) : servi avant les vraies routes.
app.use('/api/*', mockMiddleware)

for (const routes of [systemRoutes, projectsRoutes, worktreesRoutes, runsRoutes, notesRoutes, settingsRoutes, promptsRoutes]) app.route('/api', routes)

const DIST = join(ROOT, 'dist')

if (process.env.NODE_ENV === 'production' && existsSync(DIST)) {
  const { serveStatic } = await import('@hono/node-server/serve-static')
  app.use('/*', serveStatic({ root: relative(process.cwd(), DIST) }))
  app.get('*', (c) => c.html(readFileSync(join(DIST, 'index.html'), 'utf8')))
}

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, () => {
  console.log(`Shipyard API sur http://${HOST}:${PORT}`)
  // Préchauffe la vue de chaque projet : la première page s'affiche sans attendre GitHub et Linear.
  // develop comme base partout où elle existe, avant de calculer les vues.
  void svc.enforceDevelopBase().finally(() => {
    for (const p of loadProjects()) svc.overview(p).catch(() => undefined)
  })
  purgeRuns(removeRunArtifacts)
  setInterval(() => purgeRuns(removeRunArtifacts), PURGE_INTERVAL_MS).unref()
  startNotifier()
  // Un agent a fini et attend quelque chose de moi : notification macOS, avec un lien vers l'endroit où agir.
  onRunEnd((run) => {
    if (!getSettings().notifications.enabled) return
    void inboxItems().then((items) => {
      const item = items.find((i) => i.runId === run.id)
      if (item) void sendNotification({ title: item.title, body: [`${item.projectName} · ${item.label}`, item.detail].filter(Boolean).join(' — '), href: item.href })
    })
  })
})
