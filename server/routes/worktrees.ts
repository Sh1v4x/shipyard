import { stripVTControlCharacters } from 'node:util'
import { resolve, sep } from 'node:path'
import { abandonAgent } from '../actions.ts'
import { attachTestVideo } from '../actions/tests.ts'
import { HttpError, decodeId, getProject } from '../lib/config.ts'
import { CommandError, run } from '../lib/exec.ts'
import * as git from '../lib/git.ts'
import * as gh from '../lib/github.ts'
import * as svc from '../services.ts'
import { branchTestMemory, saveBranchTestMemory } from '../lib/testMemory.ts'
import { manualEnv, openManualEnv, stopManualEnv } from '../lib/manualEnv.ts'
import { checkReports } from '../lib/checks.ts'
import { sdkStatus } from '../lib/sdk.ts'
import { Hono } from 'hono'
import { jsonBody, force } from '../http.ts'
import * as inputs from '../inputs.ts'
import { warnOn } from '../lib/log.ts'

export const worktreesRoutes = new Hono()

const wt = '/projects/:id/worktrees/:wt'

worktreesRoutes.get(wt, async (c) => c.json(await svc.worktreeDetail(getProject(c.req.param('id')), c.req.param('wt'), force(c))))

worktreesRoutes.delete(wt, async (c) => {
  await stopManualEnv(c.req.param('wt'))
  await svc.removeWorktree(getProject(c.req.param('id')), c.req.param('wt'))
  return c.json({ ok: true })
})

worktreesRoutes.post(`${wt}/local-ticket/promote`, async (c) => c.json(await svc.promoteLocalTicket(getProject(c.req.param('id')), c.req.param('wt'))))

worktreesRoutes.delete(`${wt}/local-ticket`, (c) => {
  getProject(c.req.param('id'))
  svc.removeLocalTicket(decodeId(c.req.param('wt')))
  return c.json({ ok: true })
})

worktreesRoutes.post(`${wt}/move`, async (c) => c.json(await svc.moveWorktree(getProject(c.req.param('id')), c.req.param('wt'), (await jsonBody(c, inputs.moveWorktreeInput)).project)))

worktreesRoutes.post(`${wt}/links`, async (c) => {
  await svc.linkWorktree(getProject(c.req.param('id')), c.req.param('wt'), await jsonBody(c, inputs.linkWorktreeInput))
  return c.json({ ok: true })
})

worktreesRoutes.delete(`${wt}/links`, (c) => {
  svc.unlinkWorktreeFrom(getProject(c.req.param('id')), c.req.param('wt'))
  return c.json({ ok: true })
})

worktreesRoutes.post(`${wt}/labels`, async (c) => {
  const project = getProject(c.req.param('id'))
  const pr = await svc.worktreePr(project, c.req.param('wt'))
  if (!pr) throw new HttpError(400, 'Ce worktree n’a pas de PR')
  const b = await jsonBody(c, inputs.labelsInput)
  await gh.editLabels(project.repo, pr.number, b.add ?? [], b.remove ?? [])
  gh.clearPrCache(project.repo)
  return c.json({ ok: true })
})

worktreesRoutes.post(`${wt}/abandon`, async (c) => {
  return c.json(await abandonAgent(getProject(c.req.param('id')), c.req.param('wt'), await jsonBody(c, inputs.abandonInput)))
})

worktreesRoutes.post(`${wt}/finish`, async (c) => c.json(await svc.finishWorktree(getProject(c.req.param('id')), c.req.param('wt'))))

worktreesRoutes.get(`${wt}/stat`, async (c) => c.json(await svc.worktreeStat(getProject(c.req.param('id')), c.req.param('wt'))))

worktreesRoutes.get(`${wt}/files`, async (c) => {
  const p = getProject(c.req.param('id'))
  const pr = await svc.worktreePr(p, c.req.param('wt'))
  if (!pr) throw new HttpError(400, 'Pas de PR')
  const [files, threads] = await Promise.all([gh.prFiles(p.repo, pr.number, { cwd: p.path, base: pr.base }, force(c)), gh.threads(p.repo, pr.number, force(c))])
  return c.json({ ...files, threads })
})

worktreesRoutes.post(`${wt}/files/viewed`, async (c) => {
  const b = await jsonBody(c, inputs.fileViewedInput)
  await gh.setViewed(b.prId, b.path, b.viewed)
  return c.json({ ok: true })
})

/** SDK privés (GitHub Packages) dont dépend le worktree : version figée, publiée, et ce qui attend d'être publié. */
worktreesRoutes.get(`${wt}/sdk`, async (c) => c.json(await sdkStatus(await svc.worktreePath(getProject(c.req.param('id')), c.req.param('wt')), force(c))))

worktreesRoutes.get(`${wt}/checks`, async (c) => {
  const p = getProject(c.req.param('id'))
  const pr = await svc.worktreePr(p, c.req.param('wt'))
  return c.json(pr ? await checkReports(p.repo, pr.number, force(c)) : [])
})

worktreesRoutes.get(`${wt}/threads`, async (c) => {
  const p = getProject(c.req.param('id'))
  const pr = await svc.worktreePr(p, c.req.param('wt'))
  return c.json(pr ? await gh.threads(p.repo, pr.number, force(c)) : [])
})

worktreesRoutes.put(`${wt}/ticket`, async (c) => {
  const b = await jsonBody(c, inputs.linkTicketInput)
  return c.json(await svc.linkTicket(getProject(c.req.param('id')), c.req.param('wt'), b.ticketId))
})

worktreesRoutes.post(`${wt}/threads/reply`, async (c) => {
  const b = await jsonBody(c, inputs.threadReplyInput)
  await gh.replyToThread(b.threadId, b.body, b.resolve)
  gh.clearPrCache(getProject(c.req.param('id')).repo)
  return c.json({ ok: true })
})

worktreesRoutes.post(`${wt}/pr`, async (c) => {
  const p = getProject(c.req.param('id'))
  const out = await svc.createPullRequest(p, c.req.param('wt'), await jsonBody(c, inputs.createPullRequestInput))
  // La vidéo du dernier test part dans la description en arrière-plan (Chrome de Shipyard) : la PR est déjà créée.
  const video = attachTestVideo(p, c.req.param('wt'), out.url)
  return c.json({ ...out, videoRunId: video?.id ?? null })
})

/** Projet et numéro de PR d'un worktree. */
async function prOf(projectId: string, wtId: string) {
  const p = getProject(projectId)
  const pr = await svc.worktreePr(p, wtId)
  if (!pr) throw new HttpError(400, 'Pas de PR')
  return { repo: p.repo, num: pr.number }
}

worktreesRoutes.get(`${wt}/review/pending`, async (c) => {
  const { repo, num } = await prOf(c.req.param('id'), c.req.param('wt'))
  return c.json(await gh.pendingReview(repo, num))
})

worktreesRoutes.delete(`${wt}/review/pending`, async (c) => {
  const { repo, num } = await prOf(c.req.param('id'), c.req.param('wt'))
  const pending = await gh.pendingReview(repo, num)
  if (pending) await gh.deletePendingReview(pending.id)
  return c.json({ ok: true })
})

/** Ajoute des commentaires à ma review en attente, sans l'envoyer. */
worktreesRoutes.post(`${wt}/review/pending`, async (c) => {
  const { repo, num } = await prOf(c.req.param('id'), c.req.param('wt'))
  const b = await jsonBody(c, inputs.pendingReviewInput)
  return c.json({ results: await gh.addPendingComments(repo, num, b.comments) })
})

worktreesRoutes.delete(`${wt}/review/pending/:comment`, async (c) => {
  await gh.deletePendingComment(c.req.param('comment'))
  return c.json({ ok: true })
})

worktreesRoutes.post(`${wt}/review/submit`, async (c) => {
  const { repo, num } = await prOf(c.req.param('id'), c.req.param('wt'))
  const b = await jsonBody(c, inputs.submitReviewInput)
  // L'approbation avec une CI rouge reste possible : l'interface prévient, c'est à moi de décider.
  const pending = await gh.pendingReview(repo, num).catch(warnOn('gh.pendingReview', null))
  const res = await gh.submitReview(repo, num, b.event, b.body)
  // Labels de l'équipe : « à corriger » si je demande des changements, et retrait de « review in progress ».
  const labels = await svc
    .applyReviewLabels(getProject(c.req.param('id')), num, b.event, (pending?.comments.length ?? 0) > 0)
    .catch((e: Error) => ({ added: [], removed: [], error: e.message }))
  gh.clearPrCache(repo)
  return c.json({ ...res, labels })
})

/** Applique le tri des fichiers non commités : commite ceux à garder, annule les autres. */
worktreesRoutes.post(`${wt}/dirty/apply`, async (c) => {
  const p = getProject(c.req.param('id'))
  const d = await svc.worktreeDetail(p, c.req.param('wt'), true)
  const b = await jsonBody(c, inputs.dirtyApplyInput)
  const known = new Map(d.dirtyFiles.map((f) => [f.path, f]))
  const unknown = [...b.commit, ...b.discard].filter((f) => !known.has(f))
  if (unknown.length) throw new HttpError(400, `Fichiers inconnus : ${unknown.join(', ')}`)
  if (b.commit.length && !b.title?.trim()) throw new HttpError(400, 'Titre de commit manquant')
  let sha: string | null = null
  try {
    if (b.commit.length) sha = await git.commitPaths(d.worktree.path, b.title!.trim(), b.commit)
  } catch (e) {
    const out = e instanceof CommandError ? stripVTControlCharacters(`${e.stdout}\n${e.stderr}`).trim().slice(-1500) : (e as Error).message
    throw new HttpError(409, `Commit refusé : ${out}`)
  }
  await git.discardPaths(d.worktree.path, b.discard.map((f) => known.get(f)!))
  return c.json({ sha, remaining: (await git.dirtyFiles(d.worktree.path)).length })
})

/** Annule la fusion de la base en cours : le worktree revient à l'état d'avant. */
worktreesRoutes.post(`${wt}/merge/abort`, async (c) => {
  await git.abortMerge(await svc.worktreePath(getProject(c.req.param('id')), c.req.param('wt')))
  return c.json({ ok: true })
})

/** Termine la fusion (plus aucun marqueur de conflit) : commit de fusion, puis push. */
worktreesRoutes.post(`${wt}/merge/finish`, async (c) => {
  const p = getProject(c.req.param('id'))
  const d = await svc.worktreeDetail(p, c.req.param('wt'))
  if (!d.merge) throw new HttpError(409, 'Aucune fusion en cours')
  if (d.merge.remaining.length) throw new HttpError(409, `Conflits encore présents dans : ${d.merge.remaining.join(', ')}`)
  const sha = await git.finishMerge(d.worktree.path, d.worktree.branch!) // l'interface passe par l'action « merge-finish »
  gh.clearPrCache(p.repo)
  return c.json({ url: `https://github.com/${p.repo}/commit/${sha}` })
})

worktreesRoutes.get(`${wt}/general-comments`, async (c) => {
  const p = getProject(c.req.param('id'))
  const pr = await svc.worktreePr(p, c.req.param('wt'))
  return c.json(pr ? await gh.generalComments(p.repo, pr.number, force(c)) : [])
})

worktreesRoutes.get(`${wt}/reviewer-candidates`, async (c) => {
  const p = getProject(c.req.param('id'))
  const pr = await svc.worktreePr(p, c.req.param('wt'))
  return c.json(pr ? await gh.reviewerCandidates(p.repo, pr.number, pr.author, force(c)) : [])
})

worktreesRoutes.post(`${wt}/rerequest`, async (c) => {
  const { reviewers } = await jsonBody(c, inputs.rerequestInput)
  return c.json(await svc.rerequestReview(getProject(c.req.param('id')), c.req.param('wt'), reviewers))
})

worktreesRoutes.post(`${wt}/ci/rerun`, async (c) => {
  const b = await jsonBody(c, inputs.ciRerunInput)
  await gh.rerun(getProject(c.req.param('id')).repo, b.runId, b.jobId)
  return c.json({ ok: true })
})

worktreesRoutes.post(`${wt}/open`, async (c) => {
  const b = await jsonBody(c, inputs.openFileInput)
  const path = await svc.worktreePath(getProject(c.req.param('id')), c.req.param('wt'))
  const target = b.file ? resolve(path, b.file) : path
  if (target !== path && !target.startsWith(path + sep)) throw new HttpError(400, 'Fichier hors du worktree')
  // « -- » : un chemin commençant par un tiret ne peut pas devenir une option de l'éditeur.
  await run('code', ['--', target]).catch(() => run('open', [path]))
  return c.json({ ok: true })
})

worktreesRoutes.get(`${wt}/test-memory`, (c) => c.json({ text: branchTestMemory(c.req.param('wt')) }))

worktreesRoutes.put(`${wt}/test-memory`, async (c) => {
  saveBranchTestMemory(c.req.param('wt'), (await jsonBody(c, inputs.textInput)).text)
  return c.json({ text: branchTestMemory(c.req.param('wt')) })
})

worktreesRoutes.get(`${wt}/manual-env`, (c) => c.json(manualEnv(c.req.param('wt'))))

worktreesRoutes.delete(`${wt}/manual-env`, async (c) => {
  await stopManualEnv(c.req.param('wt'))
  return c.json({ ok: true })
})

worktreesRoutes.post(`${wt}/manual-env/open`, async (c) => {
  await openManualEnv(c.req.param('wt'))
  return c.json({ ok: true })
})
