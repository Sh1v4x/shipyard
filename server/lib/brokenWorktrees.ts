import { existsSync } from 'node:fs'
import type { BrokenWorktree } from '../../shared/types.ts'
import { processesIn } from './agents.ts'
import { HttpError, loadProjects } from './config.ts'
import { ttlCache } from './exec.ts'
import * as git from './git.ts'

// Worktrees abîmés, tous projets confondus : dossier disparu, ou à moitié effacé par une suppression interrompue
// (« git worktree remove » qui bute sur un fichier en cours d'utilisation s'arrête en laissant le dossier à moitié vide).

const cache = ttlCache<BrokenWorktree[]>(120_000)

/** Au-delà, des suppressions sans aucune autre modification ne ressemblent pas à du travail en cours. */
const MASS_DELETION = 10

export function brokenWorktrees(force = false): Promise<BrokenWorktree[]> {
  return cache.get('all', async () => {
    const out: BrokenWorktree[] = []
    for (const project of loadProjects()) {
      const list = (await git.listWorktrees(project).catch(() => [])).filter((w) => !w.isMain)
      for (const w of list) {
        const base = { project: project.id, projectName: project.name, id: w.id, path: w.path, branch: w.branch }
        if (!existsSync(w.path)) {
          out.push({ ...base, reason: 'missing', deleted: 0, untracked: 0, untrackedSample: [], holders: [] })
          continue
        }
        const dirty = await git.dirtyFiles(w.path).catch(() => [])
        const deleted = dirty.filter((f) => f.status === 'D').length
        const changed = dirty.filter((f) => f.status !== 'D' && f.status !== '??').length
        if (deleted < MASS_DELETION || changed > 0) continue
        const untracked = dirty.filter((f) => f.status === '??').map((f) => f.path)
        // Deux niveaux suffisent pour savoir ce qu'on perdrait (packages/node_modules, apps-v2/api/.env.bak…).
        const sample = [...new Set(untracked.map((p) => p.split('/').slice(0, 2).join('/')))].slice(0, 6)
        out.push({ ...base, reason: 'half-deleted', deleted, untracked: untracked.length, untrackedSample: sample, holders: await processesIn(w.path) })
      }
    }
    return out
  }, force)
}

/**
 * restore : git remet les fichiers suivis (le worktree redevient utilisable, « Aboutir » aussi).
 * remove : suppression forcée du worktree (la branche reste), refusée tant qu'un processus tourne dedans.
 */
export async function repairWorktree(projectId: string, id: string, action: 'restore' | 'remove') {
  const b = (await brokenWorktrees(true)).find((x) => x.project === projectId && x.id === id)
  if (!b) throw new HttpError(404, 'Ce worktree n’est plus signalé comme abîmé')
  const project = loadProjects().find((p) => p.id === projectId)!
  if (action === 'restore') {
    if (b.reason === 'missing') throw new HttpError(409, 'Le dossier n’existe plus : il ne peut qu’être retiré')
    await git.restoreTracked(b.path)
  } else {
    if (b.holders.length) throw new HttpError(409, `Des processus tournent encore dans ce worktree (${b.holders.map((h) => h.command.split(' ')[0]).join(', ')}) : ferme-les d’abord.`)
    if (b.reason === 'missing') await git.pruneWorktrees(project)
    else await git.removeWorktree(project, b.path, true)
  }
  cache.clear('all')
}
