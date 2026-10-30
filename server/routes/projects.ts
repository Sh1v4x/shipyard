import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { CreatedTicket } from '../../shared/types.ts'
import { buildDigest } from '../lib/digest.ts'
import { deleteBranches, listMyBranches } from '../lib/branches.ts'
import { listWorktreeCleanup, removeWorktrees } from '../lib/worktreeCleanup.ts'
import { setRunDecision } from '../lib/claude.ts'
import { HttpError, getProject, loadProjects } from '../lib/config.ts'
import { createdTicketsPath } from '../lib/runArtifacts.ts'
import * as git from '../lib/git.ts'
import * as gh from '../lib/github.ts'
import * as linear from '../lib/linear.ts'
import * as svc from '../services.ts'
import { projectTestMemory, saveProjectTestMemory } from '../lib/testMemory.ts'
import { Hono } from 'hono'
import { jsonBody, force } from '../http.ts'
import * as inputs from '../inputs.ts'

export const projectsRoutes = new Hono()

projectsRoutes.get('/projects/:id/ticket-states', async (c) => {
  const p = getProject(c.req.param('id'))
  return c.json(p.team && linear.linearConfigured() ? await linear.teamStates(p.team) : [])
})

projectsRoutes.post('/projects/:id/tickets/:ticket/state', async (c) => {
  const { stateId } = await jsonBody(c, inputs.ticketStateInput)
  return c.json(await linear.setTicketState(c.req.param('ticket'), stateId))
})

projectsRoutes.get('/projects', (c) => c.json(loadProjects()))

projectsRoutes.post('/projects', async (c) => c.json(await svc.addProject(await jsonBody(c, inputs.addProjectInput))))

projectsRoutes.patch('/projects/:id', async (c) => c.json(svc.updateProject(c.req.param('id'), await jsonBody(c, inputs.updateProjectInput))))

projectsRoutes.get('/projects/:id/labels', async (c) => c.json(await gh.repoLabels(getProject(c.req.param('id')).repo)))

// Digest du dépôt (façon gitingest) : infos, ou le texte avec ?download=1.
projectsRoutes.get('/projects/:id/digest', async (c) => {
  const project = getProject(c.req.param('id'))
  const d = await buildDigest(project, c.req.query('mode') === 'map' ? 'map' : c.req.query('mode') === 'full' ? 'full' : 'auto')
  if (c.req.query('download') !== '1') return c.json(d)
  c.header('Content-Type', 'text/plain; charset=utf-8')
  c.header('Content-Disposition', `attachment; filename="${project.id}-digest-${d.mode}.txt"`)
  return c.body(readFileSync(d.path, 'utf8'))
})

// Tickets locaux : branche + worktree d'une proposition, et ceux dont le worktree n'existe plus.
projectsRoutes.post('/projects/:id/local-tickets', async (c) => c.json(await svc.createLocalTicketWorktree(getProject(c.req.param('id')), await jsonBody(c, inputs.localTicketInput))))

projectsRoutes.get('/local-tickets/orphans', async (c) => c.json(await svc.localTicketOrphans()))

projectsRoutes.post('/local-tickets/orphans/delete', async (c) => {
  const { paths } = await jsonBody(c, inputs.pathsInput)
  const orphans = new Set((await svc.localTicketOrphans()).map((t) => t.path))
  for (const p of paths) if (orphans.has(p)) svc.removeLocalTicket(p)
  return c.json({ ok: true })
})

projectsRoutes.get('/projects/:id/labels/details', async (c) => c.json(await gh.repoLabelDetails(getProject(c.req.param('id')).repo, force(c))))

projectsRoutes.delete('/projects/:id', (c) => {
  svc.removeProject(c.req.param('id'))
  return c.json({ ok: true })
})

projectsRoutes.get('/projects/:id/overview', async (c) => c.json(await svc.overview(getProject(c.req.param('id')), force(c))))

projectsRoutes.post('/projects/:id/refresh', async (c) => c.json(await svc.refreshProject(getProject(c.req.param('id')))))

projectsRoutes.get('/projects/:id/branches', async (c) => c.json(await git.remoteBranches(getProject(c.req.param('id')))))

projectsRoutes.post('/projects/:id/worktrees', async (c) => c.json(await svc.createWorktree(getProject(c.req.param('id')), await jsonBody(c, inputs.createWorktreeInput))))

projectsRoutes.get('/projects/:id/worktrees/cleanup', async (c) => c.json(await listWorktreeCleanup(getProject(c.req.param('id')))))

projectsRoutes.post('/projects/:id/worktrees/cleanup', async (c) => {
  const b = await jsonBody(c, inputs.worktreeCleanupInput)
  return c.json(await removeWorktrees(getProject(c.req.param('id')), b.paths, b))
})

projectsRoutes.get('/projects/:id/branches/mine', async (c) => c.json(await listMyBranches(getProject(c.req.param('id')), force(c))))

projectsRoutes.post('/projects/:id/branches/delete', async (c) => {
  const b = await jsonBody(c, inputs.deleteBranchesInput)
  return c.json(await deleteBranches(getProject(c.req.param('id')), b.names, b))
})

projectsRoutes.post('/projects/:id/branches', async (c) => {
  const b = await jsonBody(c, inputs.createBranchInput)
  await svc.createBranchOnly(getProject(c.req.param('id')), b.branch, b.base)
  return c.json({ ok: true })
})

projectsRoutes.get('/projects/:id/test-memory', (c) => c.json({ text: projectTestMemory(getProject(c.req.param('id')).id) }))

projectsRoutes.put('/projects/:id/test-memory', async (c) => {
  const p = getProject(c.req.param('id'))
  saveProjectTestMemory(p.id, (await jsonBody(c, inputs.textInput)).text)
  return c.json({ text: projectTestMemory(p.id) })
})



projectsRoutes.get('/projects/:id/linear/meta', async (c) => {
  const p = getProject(c.req.param('id'))
  if (!p.team) throw new HttpError(400, 'Aucune équipe Linear configurée pour ce projet')
  return c.json(await linear.teamMeta(p.team))
})

/** Tickets déjà créés depuis un brouillon : évite de les recréer après un rechargement. */
projectsRoutes.get('/runs/:id/created-tickets', (c) => {
  const path = createdTicketsPath(c.req.param('id'))
  return c.json(existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [])
})

projectsRoutes.post('/projects/:id/linear/issues', async (c) => {
  const p = getProject(c.req.param('id'))
  if (!p.team) throw new HttpError(400, 'Aucune équipe Linear configurée pour ce projet')
  const b = await jsonBody(c, inputs.createIssuesInput)
  const path = createdTicketsPath(b.runId)
  const created: (CreatedTicket & { index: number })[] = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : []
  mkdirSync(dirname(path), { recursive: true })
  // Enregistré après chaque création : un échec en cours de lot ne fait pas recréer les premiers.
  let error: string | null = null
  for (const issue of b.issues) {
    if (created.some((x) => x.index === issue.index)) continue
    try {
      created.push({ ...(await linear.createIssue(p.team, issue)), index: issue.index })
      writeFileSync(path, JSON.stringify(created, null, 2))
    } catch (e) {
      error = (e as Error).message
      break
    }
  }
  if (!error) setRunDecision(b.runId, 'approved')
  return c.json({ created, error })
})
