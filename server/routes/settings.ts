import { HttpError } from '../lib/config.ts'
import * as gh from '../lib/github.ts'
import * as svc from '../services.ts'
import { sendNotification } from '../notifier.ts'
import { getSettings, saveSettings } from '../lib/settings.ts'
import { claudeLogin, claudeLogout, getCredentials, setGithubToken, setLinearKey } from '../lib/credentials.ts'
import { Hono } from 'hono'
import { jsonBody } from '../http.ts'
import * as inputs from '../inputs.ts'

export const settingsRoutes = new Hono()

settingsRoutes.get('/settings', (c) => c.json(getSettings()))

settingsRoutes.get('/settings/credentials', async (c) => c.json(await getCredentials()))

/** Claude Code : connexion dans une fenêtre Terminal, ou déconnexion. */
settingsRoutes.post('/settings/claude/:action', async (c) => {
  const action = c.req.param('action')
  if (action === 'login') await claudeLogin()
  else if (action === 'logout') await claudeLogout()
  else throw new HttpError(404, 'Action inconnue')
  return c.json(await getCredentials())
})

/** Change une clé : vérifiée auprès de Linear ou GitHub avant d'être enregistrée (champ à null : retirée). */
settingsRoutes.get('/settings/github-browser', async (c) => c.json({ user: await gh.githubBrowserUser() }))

settingsRoutes.post('/settings/github-browser/login', async (c) => {
  await gh.githubBrowserLogin()
  return c.json({ ok: true })
})

settingsRoutes.put('/settings/credentials', async (c) => {
  const b = await jsonBody(c, inputs.credentialsInput)
  try {
    if (b.linearKey !== undefined) await setLinearKey(b.linearKey)
    if (b.githubToken !== undefined) await setGithubToken(b.githubToken)
  } catch (e) {
    throw new HttpError(400, (e as Error).message)
  }
  svc.clearOverviews()
  return c.json(await getCredentials())
})

settingsRoutes.put('/settings', async (c) => {
  const patch = await jsonBody(c, inputs.settingsInput)
  const saved = saveSettings(patch)
  // Les labels reconnus changent les compteurs « à faire » : les vues en cache sont recalculées.
  if (patch.labels) svc.clearOverviews()
  return c.json(saved)
})

settingsRoutes.post('/notifications/test', async (c) => {
  const via = await sendNotification({ title: 'Notification de test', body: 'Les nouvelles tâches s’afficheront ainsi. Clique pour ouvrir les réglages.', href: '#/settings' })
  return c.json({ via })
})
