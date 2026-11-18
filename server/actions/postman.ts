import type { PostmanApplied, PostmanAuthInfo, PostmanOutput, PostmanRequest, Run } from '../../shared/types.ts'
import { writeFileAtomic } from '../lib/atomicWrite.ts'
import { HttpError, PORT } from '../lib/config.ts'
import { getRun, setRunDecision, startRun } from '../lib/claude.ts'
import { postmanAppliedPath } from '../lib/runArtifacts.ts'
import { readJsonFile } from '../lib/store.ts'
import * as postman from '../lib/postman.ts'
import { postmanLink } from '../lib/postmanLinks.ts'
import { folderVariables, lastResponses } from '../lib/postmanRun.ts'
import * as schemas from '../schemas.ts'
import { linkedWorktrees } from '../services.ts'
import { type WorktreeAction, type WorktreeActions, branchContext, specFrom } from './context.ts'

/** Au-delà, le corps d'une requête existante est coupé dans le prompt : l'agent garde alors le corps actuel (body null). */
const BODY_MAX = 4000

/** Autorisation pour le prompt : type, qui la porte, et ses paramètres (valeurs en clair déjà masquées). */
const authText = (a: PostmanAuthInfo) =>
  a.type === 'noauth' ? 'none' : `${a.type}${a.from === 'request' ? ' (set on the request)' : a.source ? ` (inherited from ${a.from} "${a.source}")` : ''}${a.fields.length ? `: ${a.fields.map((f) => `${f.key}=${f.value}`).join(', ')}` : ''}`

/** Une requête du dossier pour le prompt : tout ce que l'agent peut reprendre ou changer. */
function requestText(r: PostmanRequest): string {
  const body = r.body == null
    ? ''
    : r.bodyMode !== 'raw'
      ? `Body (${r.bodyMode}, not editable: give body null on update):\n${r.body.slice(0, BODY_MAX)}`
      : r.body.length > BODY_MAX ? `Body (cut at ${BODY_MAX} characters: give body null on update to keep it):\n${r.body.slice(0, BODY_MAX)}` : `Body:\n${r.body}`
  return [
    `### ${r.method} ${r.name}`,
    `id: ${r.id}`,
    `folder: ${r.folder || '(linked folder itself)'}`,
    `url: ${r.url}`,
    r.headers.length ? `headers: ${r.headers.map((h) => `${h.key}: ${h.value}`).join(' · ')}` : '',
    `auth: ${authText(r.auth)}`,
    r.description ? `description: ${r.description.slice(0, 1500)}` : '',
    body,
  ].filter(Boolean).join('\n')
}

/** Au-delà, le contexte Postman donné aux autres agents ne détaille plus les requêtes. */
const CONTEXT_MAX = 80

/**
 * Le dossier Postman lié au worktree, pour les agents du ticket, des modifications libres et des questions : ses
 * requêtes, l'autorisation, les variables (valeurs sensibles masquées) et mes dernières réponses. Lecture seule : ces
 * agents ne l'envoient ni ne le modifient. Vide sans dossier lié ; une ligne si Postman ne répond pas.
 */
export async function postmanContext(d: WorktreeAction['d']): Promise<string> {
  const link = postman.postmanConfigured() ? postmanLink(d.worktree.path) : null
  if (!link) return ''
  const where = `collection "${link.collectionName}", ${link.folderPath ? `folder "${link.folderPath}"` : 'at its root'}`
  try {
    const [content, variables] = await Promise.all([postman.folderContent(link), folderVariables(link, d.worktree.path)])
    const responses = lastResponses(d.worktree.path)
    const name = (id: string | null) => content.requests.find((r) => r.id === id)?.name ?? id
    return [
      '## Postman folder linked to this worktree',
      `The user keeps the requests of this branch in Postman (${where}). It is given to you as context: how the API is called today, with which authorization, and what came back. You cannot send these requests nor change the folder: when a route you add or change should be reflected there, say so in your output (the user updates it from the Postman tab of the worktree).`,
      `Authorization of the folder: ${authText(content.auth)}.${link.environmentName ? ` Environment: "${link.environmentName}".` : ''}`,
      variables.length ? `Variables (sensitive values hidden):\n${variables.map((v) => `- {{${v.key}}}: ${v.source === 'missing' ? 'no value' : v.secret ? 'set (hidden)' : v.value || '(empty)'}`).join('\n')}` : '',
      content.requests.length
        ? `Requests:\n${content.requests.slice(0, CONTEXT_MAX).map((r) => [`- ${r.method} ${r.url} · "${r.name}"${r.folder ? ` (in ${r.folder})` : ''} · auth: ${authText(r.auth)}`, r.body ? `  body${r.bodyMode === 'raw' ? '' : ` (${r.bodyMode})`}: ${r.body.slice(0, 1200).replace(/\n/g, '\n  ')}` : ''].filter(Boolean).join('\n')).join('\n')}${content.requests.length > CONTEXT_MAX ? `\n(${content.requests.length - CONTEXT_MAX} more not listed)` : ''}`
        : 'The folder has no request yet.',
      responses.length ? `Last responses the user got from Shipyard:\n${responses.map((r) => `- ${r.method} "${name(r.requestId)}" → ${r.status} ${r.statusText} (${r.auth})${r.unresolved.length ? `, variables without value: ${r.unresolved.join(', ')}` : ''}\n  ${r.body.slice(0, 1200).replace(/\n/g, '\n  ') || '(empty body)'}`).join('\n')}` : '',
    ].filter(Boolean).join('\n\n')
  } catch (e) {
    return `## Postman folder linked to this worktree\n\nA Postman folder is linked (${where}) but could not be read: ${(e as Error).message}`
  }
}

/** Échange précédent, pour une reprise : ce qui était demandé et ce qui avait été proposé. */
function previousText(prev: Run | null): string {
  const out = prev?.structured as PostmanOutput | null
  if (!prev || !out) return ''
  return [
    '## Previous exchange',
    'The folder content above is the current one: what the user approved since is already in it.',
    prev.request ? `Request: ${prev.request}` : '',
    `Your answer: ${out.summary}`,
    out.operations.length ? out.operations.map((o) => `- ${o.op} ${o.method} ${o.name} (${o.url})`).join('\n') : '',
  ].filter(Boolean).join('\n\n')
}

/**
 * Travail sur le dossier Postman lié au worktree : l'agent lit le code de la branche et le contenu du dossier, puis
 * propose des requêtes à créer, modifier ou supprimer. Rien n'est écrit ici : l'onglet Postman les applique après accord.
 */
async function postmanAction({ kind, input, d, scope, cwd, vars }: WorktreeAction): Promise<Run> {
  const request = input.extra?.trim()
  if (!request) throw new HttpError(400, 'Décris ce que tu veux faire dans le dossier Postman')
  const link = postmanLink(d.worktree.path)
  if (!link) throw new HttpError(409, 'Aucun dossier Postman lié à ce worktree')
  const prev = input.previousRunId ? getRun(input.previousRunId) : null
  const [content, context, linked] = await Promise.all([postman.folderContent(link, true), branchContext(d), linkedWorktrees(d.worktree)])
  const variables = await folderVariables(link, d.worktree.path)
  const responses = lastResponses(d.worktree.path)
  const name = (id: string | null) => content.requests.find((r) => r.id === id)?.name ?? id
  // L'envoi passe par Shipyard : l'agent ne voit ni jeton ni mot de passe, seulement la réponse.
  const runUrl = `http://127.0.0.1:${PORT}/api/projects/${scope.project}/worktrees/${scope.worktree}/postman/run`
  const curl = `curl -s -X POST ${runUrl} -H 'Content-Type: application/json' -d`
  const spec = specFrom(kind, {
      ...vars,
      consigne: request,
      collection: [
        `Collection "${link.collectionName}", ${link.folderPath ? `folder "${link.folderPath}"` : 'at its root'}.`,
        content.folders.length ? `Subfolders: ${content.folders.join(', ')}.` : 'No subfolder.',
      ].join(' '),
      requests: content.requests.length ? content.requests.map(requestText).join('\n\n') : '(empty: no request yet)',
      auth: [
        `Authorization of the linked folder (what a request inherits when it sets none, and what a new request gets): ${authText(content.auth)}.`,
        link.environmentName ? `Postman environment used to send the requests: "${link.environmentName}".` : 'No Postman environment chosen: values come from the collection variables and from the ones the user typed in Shipyard.',
        variables.length
          ? `Variables the folder uses (sensitive values are hidden from you):\n${variables.map((v) => `- {{${v.key}}}: ${v.source === 'missing' ? 'NO VALUE: a request using it is sent with the name in braces' : `${v.secret ? 'set (hidden)' : v.value || '(empty)'} · from ${v.source === 'local' ? 'Shipyard (typed by the user)' : `the ${v.source}`}`}`).join('\n')}`
          : 'The folder uses no variable.',
      ].join('\n\n'),
      responses: responses.length
        ? ['## Last responses', 'What the user got when they last sent these requests from Shipyard:', ...responses.map((r) => `### ${r.method} ${name(r.requestId)} → ${r.status} ${r.statusText} (${r.timeMs} ms, ${new Date(r.at).toISOString()})\nURL: ${r.url}\nAuthorization applied: ${r.auth}${r.unresolved.length ? `\nVariables without value: ${r.unresolved.join(', ')}` : ''}\n${r.body.slice(0, 2000) || '(empty body)'}`)].join('\n\n')
        : '',
      running: input.runCalls
        ? [
            '## Sending requests',
            'The user allowed you to send requests yourself. They really reach the API the variables point at: send what the request needs, nothing more. Read-only calls freely; a call that writes (POST, PUT, PATCH, DELETE) only when it is the point of the request (a login, the route being worked on), never to clean up or to explore. Shipyard replaces the variables and applies the authorization: you get the response, never the secrets.',
            `- An existing request, by its id: \`${curl} '{"requestId":"<id>"}'\``,
            `- A request you are about to propose, before proposing it: \`${curl} '{"request":{"name":"…","method":"POST","url":"{{baseUrl}}/…","headers":[{"key":"Content-Type","value":"application/json"}],"body":"{…}","description":""}}'\` (body is a JSON string, or null). It gets the authorization of the linked folder.`,
            'The answer is JSON: status, statusText, timeMs, headers, body, auth (what was applied), unresolved (variables without value). An "error" field means the request could not be sent (host unreachable, invalid URL). Use the responses to get the examples and the descriptions right, and report in details what you sent and what came back.',
          ].join('\n\n')
        : 'You cannot send requests in this run: reason from the code and from the last responses above, and say in details which call the user should send to check a doubt.',
      context,
      previous: previousText(prev),
      linked: linked.length
        ? ['## Linked repositories', 'Worktrees of the same feature in other repositories, readable by their absolute path (the client calling these routes, for instance):', ...linked.map((l) => `- ${l.project.name}: ${l.worktree.path}`)].join('\n')
        : '',
    }, {
      kind, title: `Postman : ${request.split('\n')[0].slice(0, 60)}`, scope, cwd, schema: schemas.postmanSchema, request,
      addDirs: linked.map((l) => l.worktree.path),
      // Une précision reprend la session : l'agent a déjà lu les routes.
      resume: prev?.sessionId ?? null,
    })
  if (input.runCalls) spec.allowedTools = [...(spec.allowedTools ?? []), `Bash(curl -s -X POST ${runUrl} *)`]
  return startRun(spec)
}

export const postmanActions: WorktreeActions = { postman: postmanAction }

// ---------- Écriture des propositions approuvées ----------

export const appliedOf = (runId: string): PostmanApplied[] => readJsonFile<PostmanApplied[]>(postmanAppliedPath(runId)) ?? []

/**
 * Écrit dans Postman les propositions choisies d'un run, dans l'ordre donné par l'agent. Chaque écriture est notée
 * aussitôt : un échec en cours de lot ne fait pas rejouer les premières, et une proposition déjà écrite est passée.
 */
export async function applyOperations(wtPath: string, wtId: string, runId: string, indexes: number[]): Promise<{ applied: PostmanApplied[]; error: string | null }> {
  const run = getRun(runId)
  if (run?.kind !== 'postman' || run.scope.worktree !== wtId) throw new HttpError(404, 'Propositions introuvables sur ce worktree')
  const out = run.structured as PostmanOutput | null
  if (run.status !== 'success' || !out) throw new HttpError(409, 'Ce passage n’a pas abouti : relance-le')
  const link = postmanLink(wtPath)
  if (!link) throw new HttpError(409, 'Aucun dossier Postman lié à ce worktree')
  const content = await postman.folderContent(link, true)
  const path = postmanAppliedPath(runId)
  const applied = appliedOf(runId)
  let error: string | null = null
  for (const index of [...new Set(indexes)].sort((a, b) => a - b)) {
    const op = out.operations[index]
    if (!op || applied.some((a) => a.index === index)) continue
    try {
      applied.push({ index, requestId: await postman.applyOperation(link, content, op) })
      writeFileAtomic(path, JSON.stringify(applied, null, 2))
    } catch (e) {
      error = `${op.name} : ${(e as Error).message}`
      break
    }
  }
  if (!error && applied.length >= out.operations.length) setRunDecision(runId, 'approved')
  return { applied, error }
}
