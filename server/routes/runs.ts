import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { streamSSE } from 'hono/streaming'
import type { ActionKind, ReviewDecisions, Run } from '../../shared/types.ts'
import { legacyInput, startAction } from '../actions.ts'
import { forgetRun, revertRun } from '../lib/snapshots.ts'
import { cancelRun, getRun, patchRun, listRuns, setRunDecision, setRunInput, subscribe } from '../lib/claude.ts'
import { HttpError, SHOTS_DIR, VIDEOS_DIR, decodeId } from '../lib/config.ts'
import { reviewDecisionsPath, shotsDirOf } from '../lib/runArtifacts.ts'
import { run } from '../lib/exec.ts'
import { dismissInbox, inboxItems } from '../inbox.ts'
import { Hono } from 'hono'
import { jsonBody } from '../http.ts'
import * as inputs from '../inputs.ts'

export const runsRoutes = new Hono()

runsRoutes.post('/actions/:kind', async (c) => {
  const input = await jsonBody(c, inputs.actionInput)
  const r = await startAction(c.req.param('kind') as ActionKind, input)
  setRunInput(r.id, input)
  return c.json({ id: r.id })
})

/** Relance une action avec les mêmes paramètres (run en échec, interrompu par un redémarrage, ou à refaire). */
runsRoutes.post('/runs/:id/retry', async (c) => {
  const prev = getRun(c.req.param('id'))
  if (!prev) throw new HttpError(404, 'Run introuvable')
  if (prev.status === 'running') throw new HttpError(409, 'Ce run est encore en cours')
  const saved = prev.input ?? legacyInput(prev)
  if (!saved) throw new HttpError(409, 'Ce run date d’avant l’enregistrement des paramètres : relance-le depuis son bouton habituel.')
  // Paramètres enregistrés avant la validation des requêtes : revalidés comme une requête neuve.
  const parsed = inputs.actionInput.safeParse(saved)
  if (!parsed.success) throw new HttpError(409, 'Paramètres enregistrés invalides : relance l’action depuis son bouton habituel.')
  const r = await startAction(prev.kind, parsed.data)
  setRunInput(r.id, parsed.data)
  return c.json({ id: r.id })
})

/** Test manuel : étapes cochées, gardées sur son run (étape « Tests », description de la PR). */
runsRoutes.put('/runs/:id/manual-steps', async (c) => {
  const run = getRun(c.req.param('id'))
  if (run?.kind !== 'test-manual') throw new HttpError(404, 'Test manuel introuvable')
  patchRun(run.id, { manualChecked: (await jsonBody(c, inputs.manualStepsInput)).checked })
  return c.json({ ok: true })
})

/** Vérification d'une étape : ma décision, qui remplace le verdict de l'IA. */
runsRoutes.put('/runs/:id/check-decision', async (c) => {
  const run = getRun(c.req.param('id'))
  if (run?.kind !== 'test-check') throw new HttpError(404, 'Vérification introuvable')
  patchRun(run.id, { checkDecision: (await jsonBody(c, inputs.checkDecisionInput)).decision })
  return c.json({ ok: true })
})

runsRoutes.get('/runs/:id/test-decisions', (c) => c.json(getRun(c.req.param('id'))?.testDecisions ?? {}))

/** Test IA : ma réponse à un point « à vérifier » (null pour la retirer). */
runsRoutes.put('/runs/:id/test-decision', async (c) => {
  const run = getRun(c.req.param('id'))
  if (run?.kind !== 'test' && run?.kind !== 'test-part') throw new HttpError(404, 'Test introuvable')
  const { name, decision } = await jsonBody(c, inputs.testDecisionInput)
  const { [name]: _old, ...rest } = run.testDecisions ?? {}
  patchRun(run.id, { testDecisions: decision ? { ...rest, [name]: decision } : rest })
  return c.json({ ok: true })
})

runsRoutes.get('/runs', (c) => {
  const q = c.req.query()
  return c.json(listRuns({ project: q.project, worktree: q.worktree, kind: q.kind, ref: q.ref, status: q.status, pr: q.pr ? Number(q.pr) : undefined }, Number(q.limit ?? 30)))
})

/** Run terminé avec ses paramètres, reconstruits si possible pour un run d'avant leur enregistrement. */
const withInput = (r: Run): Run => (r.input || r.status === 'running' ? r : { ...r, input: legacyInput(r) })

runsRoutes.get('/runs/:id', (c) => {
  const r = getRun(c.req.param('id'))
  if (!r) throw new HttpError(404, 'Run introuvable')
  return c.json(withInput(r))
})

// Captures avant/après d'un run ticket.
runsRoutes.get('/shots/:run/:file', (c) => {
  const { run: id, file } = c.req.param()
  if (!/^[\w-]+$/.test(id) || !/^[\w.-]+\.(png|jpe?g)$/i.test(file)) throw new HttpError(400, 'Nom invalide')
  const path = join(SHOTS_DIR, id, file)
  if (!existsSync(path)) throw new HttpError(404, 'Capture introuvable')
  return c.body(readFileSync(path), 200, { 'Content-Type': file.endsWith('.png') ? 'image/png' : 'image/jpeg', 'Cache-Control': 'no-store' })
})

/** Ma décision sur un résultat : les captures sont supprimées, et les changements annulés si je refuse avec `discard`. */
runsRoutes.post('/runs/:id/decision', async (c) => {
  const id = c.req.param('id')
  const b = await jsonBody(c, inputs.runDecisionInput)
  const r = getRun(id)
  if (!r) throw new HttpError(404, 'Run introuvable')
  if (b.decision === 'declined' && b.discard && r.scope.worktree) {
    // Avec la photo d'avant le travail, seuls les changements de l'agent sont annulés (worktrees liés compris).
    if (!(await revertRun(id))) {
      const cwd = decodeId(r.scope.worktree)
      await run('git', ['restore', '--staged', '--worktree', '.'], { cwd })
      await run('git', ['clean', '-fd'], { cwd })
    }
  } else if (b.decision === 'approved') await forgetRun(id)
  rmSync(shotsDirOf(id), { recursive: true, force: true })
  return c.json(setRunDecision(id, b.decision))
})

runsRoutes.get('/inbox', async (c) => c.json(await inboxItems()))

runsRoutes.post('/inbox/:run/dismiss', (c) => {
  dismissInbox(c.req.param('run'))
  return c.json({ ok: true })
})

runsRoutes.get('/runs/:id/videos', (c) => {
  const file = join(VIDEOS_DIR, c.req.param('id').replace(/[^\w-]/g, ''), 'videos.json')
  return c.json(existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [])
})

/** Une vidéo, servie par morceaux (Range) pour pouvoir avancer dans la lecture ; ?download=1 pour l'enregistrer. */
runsRoutes.get('/runs/:id/videos/:file', (c) => {
  const name = c.req.param('file')
  if (!/^[\w.-]+\.(mp4|webm)$/.test(name)) throw new HttpError(400, 'Fichier invalide')
  const path = join(VIDEOS_DIR, c.req.param('id').replace(/[^\w-]/g, ''), name)
  if (!existsSync(path)) throw new HttpError(404, 'Vidéo introuvable')
  const size = statSync(path).size
  const type = name.endsWith('.webm') ? 'video/webm' : 'video/mp4'
  const headers: Record<string, string> = { 'Content-Type': type, 'Accept-Ranges': 'bytes' }
  if (c.req.query('download')) headers['Content-Disposition'] = `attachment; filename="test-${name}"`
  const range = c.req.header('range')?.match(/bytes=(\d*)-(\d*)/)
  const start = range?.[1] ? Number(range[1]) : 0
  const end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1
  const stream = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream
  if (range) return new Response(stream, { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } })
  return new Response(stream, { headers: { ...headers, 'Content-Length': String(size) } })
})

// Tri des commentaires d'une review IA (approuvés, ignorés, textes modifiés), un fichier par run.


runsRoutes.get('/runs/:id/review-decisions', (c) => {
  const path = reviewDecisionsPath(c.req.param('id'))
  const empty: ReviewDecisions = { approved: [], ignored: [], dropped: [], text: {}, line: {}, posted: {}, failed: {}, summary: null, published: null }
  return c.json(existsSync(path) ? { ...empty, ...JSON.parse(readFileSync(path, 'utf8')) } : empty)
})

runsRoutes.put('/runs/:id/review-decisions', async (c) => {
  const path = reviewDecisionsPath(c.req.param('id'))
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(await jsonBody(c, inputs.reviewDecisionsInput), null, 2))
  return c.json({ ok: true })
})

runsRoutes.post('/runs/:id/cancel', (c) => c.json({ ok: cancelRun(c.req.param('id')) }))

runsRoutes.get('/runs/:id/stream', (c) => {
  const id = c.req.param('id')
  return streamSSE(c, async (stream) => {
    const r = getRun(id)
    if (!r) return
    for (const e of r.events) await stream.writeSSE({ event: 'event', data: JSON.stringify(e) })
    if (r.status !== 'running') {
      await stream.writeSSE({ event: 'end', data: JSON.stringify(withInput(r)) })
      return
    }
    await new Promise<void>((resolve) => {
      const off = subscribe(id, (e) => {
        if (e.t === 'end') {
          void stream.writeSSE({ event: 'end', data: JSON.stringify(e.run) }).then(() => {
            off()
            resolve()
          })
        } else void stream.writeSSE({ event: 'event', data: JSON.stringify(e) })
      })
      stream.onAbort(() => {
        off()
        resolve()
      })
    })
  })
})
