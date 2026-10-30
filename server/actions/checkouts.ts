import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Project } from '../../shared/types.ts'
import { onRunEnd } from '../lib/claude.ts'
import { CHECKOUTS_DIR, loadProjects } from '../lib/config.ts'
import * as git from '../lib/git.ts'

const checkouts = new Map<string, { project: Project; path: string }>()

/** Copie du code d'avant le travail, pour un run : retirée à la fin du run, quelle qu'en soit l'issue. */
export async function createCheckout(runId: string, project: Project): Promise<string> {
  const path = join(CHECKOUTS_DIR, runId)
  mkdirSync(CHECKOUTS_DIR, { recursive: true })
  await git.addDetachedCheckout(project, path, 'HEAD')
  checkouts.set(runId, { project, path })
  return path
}

export async function releaseCheckout(runId: string) {
  const c = checkouts.get(runId)
  if (!c) return
  checkouts.delete(runId)
  await git.removeWorktree(c.project, c.path, true).catch(() => rmSync(c.path, { recursive: true, force: true }))
}

onRunEnd((run) => void releaseCheckout(run.id))

// Au démarrage : copies laissées par un serveur précédent (run interrompu).
if (existsSync(CHECKOUTS_DIR) && readdirSync(CHECKOUTS_DIR).length) {
  rmSync(CHECKOUTS_DIR, { recursive: true, force: true })
  for (const p of loadProjects()) void git.pruneWorktrees(p).catch(() => undefined)
}
