import { Hono } from 'hono'
import type { PostmanState } from '../../shared/types.ts'
import { appliedOf, applyOperations } from '../actions/postman.ts'
import { getProject } from '../lib/config.ts'
import type { PostmanOperation, PostmanRequestData } from '../../shared/types.ts'
import { HttpError } from '../lib/config.ts'
import * as postman from '../lib/postman.ts'
import { clearPostmanVars, postmanLink, setPostmanLink, setPostmanVar } from '../lib/postmanLinks.ts'
import { folderVariables, lastResponses, runRequest } from '../lib/postmanRun.ts'
import { force, jsonBody } from '../http.ts'
import * as inputs from '../inputs.ts'
import * as svc from '../services.ts'

export const postmanRoutes = new Hono()

const wt = '/projects/:id/worktrees/:wt/postman'

// Ce qu'il faut pour choisir un dossier : espaces de travail, collections d'un espace, dossiers d'une collection.
postmanRoutes.get('/postman/workspaces', async (c) => c.json(await postman.workspaces(force(c))))
postmanRoutes.get('/postman/workspaces/:ws/collections', async (c) => c.json(await postman.collections(c.req.param('ws'), force(c))))
postmanRoutes.get('/postman/workspaces/:ws/environments', async (c) => c.json(await postman.environments(c.req.param('ws'), force(c))))
postmanRoutes.get('/postman/collections/:col/folders', async (c) => c.json(await postman.collectionFolders(c.req.param('col'), force(c))))

const NO_AUTH: PostmanState['auth'] = { type: 'noauth', from: 'none', source: null, fields: [], supported: true }

/** Chemin du worktree et son dossier lié (409 s'il n'en a pas). */
async function linked(c: { req: { param: (k: string) => string } }) {
  const path = await svc.worktreePath(getProject(c.req.param('id')), c.req.param('wt'))
  const link = postmanLink(path)
  if (!link) throw new HttpError(409, 'Aucun dossier Postman lié à ce worktree')
  return { path, link }
}

/** Onglet Postman du worktree : son dossier lié, ses requêtes, l'autorisation et les variables qui servent à les envoyer. */
postmanRoutes.get(wt, async (c) => {
  const path = await svc.worktreePath(getProject(c.req.param('id')), c.req.param('wt'))
  const link = postmanLink(path)
  const state: PostmanState = { configured: postman.postmanConfigured(), link, requests: [], folders: [], auth: NO_AUTH, variables: [], responses: [], error: null }
  if (!state.configured || !link) return c.json(state)
  try {
    const content = await postman.folderContent(link, force(c))
    const variables = await folderVariables(link, path, force(c))
    return c.json({ ...state, requests: content.requests, folders: content.folders, auth: content.auth, variables, responses: lastResponses(path) } satisfies PostmanState)
  } catch (e) {
    return c.json({ ...state, error: (e as Error).message } satisfies PostmanState)
  }
})

postmanRoutes.put(wt, async (c) => {
  const path = await svc.worktreePath(getProject(c.req.param('id')), c.req.param('wt'))
  const b = await jsonBody(c, inputs.postmanLinkInput)
  const prev = postmanLink(path)
  const link = await postman.resolveLink(b)
  // Changer de dossier dans le même espace de travail garde l'environnement choisi.
  if (prev?.workspaceId && prev.workspaceId === b.workspaceId) Object.assign(link, { environmentId: prev.environmentId ?? null, environmentName: prev.environmentName ?? null })
  setPostmanLink(path, link)
  return c.json(link)
})

postmanRoutes.delete(wt, async (c) => {
  const path = await svc.worktreePath(getProject(c.req.param('id')), c.req.param('wt'))
  setPostmanLink(path, null)
  clearPostmanVars(path)
  return c.json({ ok: true })
})

/** Environnement Postman dont les variables servent à l'envoi (null : aucun). */
postmanRoutes.put(`${wt}/environment`, async (c) => {
  const { path, link } = await linked(c)
  const { environmentId } = await jsonBody(c, inputs.postmanEnvironmentInput)
  const name = environmentId ? (await postman.environment(environmentId, true)).name : null
  setPostmanLink(path, { ...link, environmentId, environmentName: name })
  return c.json({ ok: true })
})

/** Valeur d'une variable saisie dans Shipyard (null : retirée) : gardée sur ce Mac, jamais envoyée à Postman. */
postmanRoutes.put(`${wt}/variables`, async (c) => {
  const { path } = await linked(c)
  const b = await jsonBody(c, inputs.postmanVariableInput)
  setPostmanVar(path, b.key, b.value)
  return c.json({ ok: true })
})

/** Envoie une requête du dossier (ou un brouillon) et renvoie la réponse. */
postmanRoutes.post(`${wt}/run`, async (c) => {
  const { path, link } = await linked(c)
  const b = await jsonBody(c, inputs.postmanRunInput)
  return c.json(await runRequest(link, path, b))
})

// Requêtes écrites à la main : la même écriture que pour une proposition de l'agent, limitée au dossier lié.
const manual = (op: PostmanOperation['op'], requestId: string | null, data: PostmanRequestData, folder = ''): PostmanOperation => ({ ...data, op, requestId, folder, reason: '' })

postmanRoutes.post(`${wt}/requests`, async (c) => {
  const { link } = await linked(c)
  const { folder, ...data } = await jsonBody(c, inputs.postmanSaveInput)
  return c.json({ id: await postman.applyOperation(link, await postman.folderContent(link, true), manual('create', null, data, folder)) })
})

postmanRoutes.put(`${wt}/requests/:request`, async (c) => {
  const { link } = await linked(c)
  const { folder: _folder, ...data } = await jsonBody(c, inputs.postmanSaveInput)
  return c.json({ id: await postman.applyOperation(link, await postman.folderContent(link, true), manual('update', c.req.param('request'), data)) })
})

postmanRoutes.delete(`${wt}/requests/:request`, async (c) => {
  const { link } = await linked(c)
  const content = await postman.folderContent(link, true)
  const current = content.requests.find((r) => r.id === c.req.param('request'))
  if (!current) throw new HttpError(404, 'Cette requête n’est plus dans le dossier lié')
  await postman.applyOperation(link, content, manual('delete', current.id, current))
  return c.json({ ok: true })
})

/** Écrit dans Postman les propositions que j'ai approuvées. */
postmanRoutes.post(`${wt}/apply`, async (c) => {
  const path = await svc.worktreePath(getProject(c.req.param('id')), c.req.param('wt'))
  const b = await jsonBody(c, inputs.postmanApplyInput)
  return c.json(await applyOperations(path, c.req.param('wt'), b.runId, b.indexes))
})

/** Propositions d'un run déjà écrites dans Postman. */
postmanRoutes.get('/runs/:id/postman-applied', (c) => c.json(appliedOf(c.req.param('id'))))
