import { agentProcesses, killOrphan } from '../lib/agents.ts'
import { HttpError, loadProjects } from '../lib/config.ts'
import { run } from '../lib/exec.ts'
import * as gh from '../lib/github.ts'
import * as linear from '../lib/linear.ts'
import * as svc from '../services.ts'
import { claudeUsage } from '../lib/usage.ts'
import { brokenWorktrees, repairWorktree } from '../lib/brokenWorktrees.ts'
import { Hono } from 'hono'
import { force } from '../http.ts'

export const systemRoutes = new Hono()

systemRoutes.get('/health', async (c) => {
  const [ghUser, claude] = await Promise.all([gh.me().catch(() => null), run('claude', ['--version']).then((v) => v.trim()).catch(() => null)])
  return c.json({ github: ghUser, linear: linear.linearConfigured(), claude })
})

/** GitHub Actions bloqué (facturation…) sur les comptes des projets suivis : un par organisation. */
systemRoutes.get('/github/actions-status', async (c) => {
  const blocks = await Promise.all(loadProjects().map((p) => gh.actionsBlock(p.repo, force(c)).catch(() => null)))
  const byOwner = new Map(blocks.filter((b) => !!b).map((b) => [b.owner, b]))
  return c.json([...byOwner.values()])
})

systemRoutes.get('/linear/teams', async (c) => c.json(linear.linearConfigured() ? await linear.teams() : []))

systemRoutes.get('/claude/usage', async (c) => c.json(await claudeUsage(force(c))))

systemRoutes.get('/agents', async (c) => c.json(await agentProcesses()))

/** Worktrees abîmés (dossier disparu, ou à moitié effacé) : restaurer les fichiers, ou retirer le worktree. */
systemRoutes.get('/worktrees/broken', async (c) => c.json(await brokenWorktrees(force(c))))

systemRoutes.post('/worktrees/broken/:project/:wt/:action', async (c) => {
  const action = c.req.param('action')
  if (action !== 'restore' && action !== 'remove') throw new HttpError(404, 'Action inconnue')
  await repairWorktree(c.req.param('project'), c.req.param('wt'), action)
  svc.clearOverviews()
  return c.json({ ok: true })
})

systemRoutes.post('/agents/:pgid/kill', async (c) => {
  await killOrphan(Number(c.req.param('pgid')))
  return c.json({ ok: true })
})
