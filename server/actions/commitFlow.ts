import { stripVTControlCharacters } from 'node:util'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BlockedCommit, RunEvent, Run, WorktreeDetail } from '../../shared/types.ts'
import { CommandError, run } from '../lib/exec.ts'
import * as git from '../lib/git.ts'
import * as gh from '../lib/github.ts'
import type { LinkedWorktree } from '../services.ts'
import { discardExcludedIn } from '../lib/excluded.ts'

/** Sortie complète d'un hook git en échec (lefthook écrit sur stdout et stderr). */
export function hookOutput(e: unknown): string {
  const out = e instanceof CommandError ? `${e.stdout}\n${e.stderr}` : (e as Error).message
  return stripVTControlCharacters(out).trim().split('\n').slice(-150).join('\n')
}

/** Règle de format des messages de commit imposée par le dépôt, si on la trouve. */
export function commitRule(cwd: string): string {
  const candidates = ['scripts/validate-commit-msg.sh', 'commitlint.config.js', 'commitlint.config.ts', 'commitlint.config.mjs', '.commitlintrc', '.commitlintrc.json']
  const file = candidates.find((f) => existsSync(join(cwd, f)))
  if (!file) return ''
  const src = readFileSync(join(cwd, file), 'utf8')
  const rule = file.endsWith('.sh') ? src.split('\n').filter((l) => /grep -qE|Format:|Types:|^#/.test(l.trim())).join('\n') : src.slice(0, 1500)
  return `commit-msg hook rule (${file}), which is authoritative:\n${rule.slice(0, 2000)}`
}

/**
 * Après une correction : les worktrees liés qu'elle a modifiés, à commiter avec le même titre. Un worktree lié qui
 * avait déjà des modifications avant n'est pas commité (elles se mélangeraient) : il est signalé.
 */
export async function linkedToCommit(fix: { linked: LinkedWorktree[]; cleanBefore: Set<string> }, log: (e: RunEvent) => void): Promise<CommitRepo[]> {
  const out: CommitRepo[] = []
  for (const l of fix.linked) {
    if (!(await git.dirtyFiles(l.worktree.path).catch(() => [])).length) continue
    if (!fix.cleanBefore.has(l.worktree.path) || !l.worktree.branch) {
      log({ t: 'error', text: `${l.project.name} modifié mais pas commité : le worktree avait déjà des modifications avant la correction. Commite-le toi-même.` })
      continue
    }
    out.push(repoOf({ project: l.project, worktree: l.worktree }))
  }
  return out
}

/** URL d'un commit déjà présent sur la branche (le pousse s'il ne l'est pas encore), ou null s'il n'en fait pas partie. */
export async function existingCommitUrl(d: WorktreeDetail, ref: string): Promise<string | null> {
  const cwd = d.worktree.path
  const sha = (await run('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd }).catch(() => '')).trim()
  if (!sha) return null
  const onBranch = await run('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { cwd }).then(() => true, () => false)
  if (!onBranch) return null
  const pushed = await run('git', ['merge-base', '--is-ancestor', sha, `origin/${d.worktree.branch}`], { cwd }).then(() => true, () => false)
  if (!pushed) await git.push(cwd, d.worktree.branch!)
  return `https://github.com/${d.project.repo}/commit/${sha}`
}

export type CommitRepo = BlockedCommit['repos'][number]

export const repoOf = (d: Pick<WorktreeDetail, 'project' | 'worktree'>): CommitRepo =>
  ({ name: d.project.name, repo: d.project.repo, path: d.worktree.path, branch: d.worktree.branch! })

/** Commit refusé par un hook git : sa sortie, les dépôts restant à commiter (le refusé en premier) et les commits déjà poussés. */
export class HookRefused extends Error {
  constructor(readonly output: string, readonly remaining: CommitRepo[], readonly done: string[]) {
    super(`Commit refusé par un hook git : une solution peut être proposée, à valider.\n${output.split('\n').slice(-12).join('\n')}`)
  }
}

/** Commite et pousse chaque dépôt modifié, dans l'ordre, et renvoie les liens des commits. HookRefused au premier refus. */
export async function commitRepos(repos: CommitRepo[], title: string): Promise<string[]> {
  const urls: string[] = []
  for (const [i, r] of repos.entries()) {
    let sha: string | null
    try {
      await discardExcludedIn(r.path)
      sha = await git.commitFiles(r.path, title, 'all')
    } catch (e) {
      throw new HookRefused(hookOutput(e), repos.slice(i), urls)
    }
    if (!sha) continue
    await git.push(r.path, r.branch)
    gh.clearPrCache(r.repo)
    urls.push(`https://github.com/${r.repo}/commit/${sha}`)
  }
  return urls
}

/** Commite les fichiers modifiés par l'agent, pousse, et renvoie l'URL du commit. */
export async function commitAndPush(d: Pick<WorktreeDetail, 'project' | 'worktree'>, title: string): Promise<string | null> {
  return (await commitRepos([repoOf(d)], title))[0] ?? null
}

export const toBlocked = (e: HookRefused, title: string, threads: string[], done: string[]): BlockedCommit =>
  ({ title, repos: e.remaining, done: [...done, ...e.done], threads, error: e.output })

/**
 * Commit refusé par un hook : il reste en attente sur le run (les changements sont gardés dans le worktree),
 * avec les fils qui attendent leur « DONE ». L'interface propose alors une correction à valider (hook-fix).
 */
export function blockOnRefusal(run: Run, e: unknown, title: string, threads: string[] = [], done: string[] = []): never {
  if (e instanceof HookRefused) run.blockedCommit = toBlocked(e, title, threads, done)
  throw e
}
