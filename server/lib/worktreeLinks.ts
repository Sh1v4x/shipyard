import { existsSync } from 'node:fs'
import { jsonFile } from './store.ts'

// Worktrees associés entre projets d'un même groupe (ex. la PR API et la PR mobile d'une même feature).
// Chaque entrée est un ensemble de worktrees liés entre eux ; un worktree n'appartient qu'à un ensemble.

export interface LinkRef { project: string; path: string }

const file = jsonFile<LinkRef[][]>('worktree-links.json', [])

const same = (a: LinkRef, b: LinkRef) => a.project === b.project && a.path === b.path

/** Worktrees liés à celui-ci (hors lui-même), encore présents sur le disque. */
export function linksOf(ref: LinkRef): LinkRef[] {
  const set = file.read().find((s) => s.some((r) => same(r, ref)))
  return (set ?? []).filter((r) => !same(r, ref) && existsSync(r.path))
}

/** Lie deux worktrees : leurs ensembles sont fusionnés. */
export function linkWorktrees(a: LinkRef, b: LinkRef) {
  const sets = file.read()
  const sa = sets.find((s) => s.some((r) => same(r, a))) ?? [a]
  const sb = sets.find((s) => s.some((r) => same(r, b))) ?? [b]
  const merged = [...sa, ...sb.filter((r) => !sa.some((x) => same(x, r)))]
  file.write([...sets.filter((s) => s !== sa && s !== sb), merged])
}

/** Retire un worktree de son ensemble (supprimé, ou délié à la main). */
export function unlinkWorktree(ref: LinkRef) {
  file.write(file.read().map((s) => s.filter((r) => !same(r, ref))).filter((s) => s.length > 1))
}
