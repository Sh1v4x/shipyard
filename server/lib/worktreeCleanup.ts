import { existsSync } from 'node:fs'
import type { BranchDeleteResult, Project, WorktreeCleanupInfo } from '../../shared/types.ts'
import { encodeId } from './config.ts'
import { run } from './exec.ts'
import { dirtyFiles, listWorktrees, removeWorktree } from './git.ts'
import * as gh from './github.ts'
import * as linear from './linear.ts'
import { warnOn } from './log.ts'

const git = (cwd: string, args: string[]) => run('git', args, { cwd })
const STALE_DAYS = 30
const REVIEW_BRANCH = /^review\/pr-(\d+)$/

/** État d'une PR quelconque (y compris celles des autres, pour les worktrees de review). */
async function prState(repo: string, num: number) {
  const out = await run('gh', ['pr', 'view', String(num), '--repo', repo, '--json', 'state,url,latestReviews,author,reviewRequests']).catch(warnOn('gh pr view', null))
  return out
    ? (JSON.parse(out) as {
        state: 'OPEN' | 'MERGED' | 'CLOSED'
        url: string
        author: { login: string }
        latestReviews: { author: { login: string } | null }[]
        reviewRequests: { login?: string }[]
      })
    : null
}

/** Worktrees du projet (hors clone principal) avec ce qui permet de décider de les supprimer. */
export async function listWorktreeCleanup(project: Project): Promise<WorktreeCleanupInfo[]> {
  const [worktrees, mine, closed, me] = await Promise.all([
    listWorktrees(project),
    gh.myPrs(project.repo),
    gh.closedPrsByBranch(project.repo).catch(() => new Map()),
    gh.me(),
  ])
  const base = `origin/${project.baseBranch}`
  const list = await Promise.all(
    worktrees.filter((w) => !w.isMain && existsSync(w.path)).map(async (w): Promise<WorktreeCleanupInfo> => {
      const [dirty, last, upstream] = await Promise.all([
        dirtyFiles(w.path).catch(() => []),
        git(w.path, ['log', '-1', '--format=%cI']).then((s) => s.trim() || null).catch(() => null),
        git(w.path, ['rev-parse', '--abbrev-ref', '@{u}']).then((s) => s.trim()).catch(() => ''),
      ])
      const reviewNum = Number(w.branch?.match(REVIEW_BRANCH)?.[1] ?? 0)
      // Sans branche distante, tout ce qui n'est pas dans la base est non poussé.
      // Un worktree de review contient les commits du collègue, pas les miens : rien à perdre.
      const unpushed = reviewNum ? 0 : Number((await git(w.path, ['rev-list', '--count', upstream ? '@{u}..HEAD' : `${base}..HEAD`]).catch(() => '0')).trim()) || 0

      let pr: WorktreeCleanupInfo['pr'] = null
      let reviewed: boolean | null = null
      let rerequested = false
      if (reviewNum) {
        const st = await prState(project.repo, reviewNum)
        if (st) {
          pr = { number: reviewNum, state: st.state, mine: st.author.login === me, url: st.url }
          // Review faite = j'ai déjà reviewé et on ne me la redemande pas.
          rerequested = st.reviewRequests.some((r) => r.login === me)
          reviewed = st.latestReviews.some((r) => r.author?.login === me) && !rerequested
        }
      } else if (w.branch) {
        const open = mine.find((p) => p.head === w.branch)
        const done = closed.get(w.branch)
        if (open) pr = { number: open.number, state: 'OPEN', mine: true, url: open.url }
        else if (done) pr = { number: done.number, state: done.state, mine: true, url: done.url }
      }

      const ticketId = w.ticketId ?? (pr && !reviewNum ? mine.find((p) => p.number === pr!.number)?.ticketId ?? null : null)
      const t = ticketId && linear.linearConfigured() ? await linear.ticketById(ticketId).catch(warnOn('linear.ticketById', null)) : null
      const ticket = t ? { id: t.id, status: t.status, done: t.statusType === 'completed' || t.statusType === 'canceled' } : null

      const days = last ? (Date.now() - Date.parse(last)) / 86_400_000 : 0
      let suggestion: WorktreeCleanupInfo['suggestion'] = 'keep'
      let reason = 'En cours'
      if (pr?.state === 'MERGED') [suggestion, reason] = ['pr-merged', `PR #${pr.number} mergée`]
      else if (pr?.state === 'CLOSED') [suggestion, reason] = ['pr-closed', `PR #${pr.number} fermée`]
      else if (ticket?.done) [suggestion, reason] = ['ticket-done', `Ticket ${ticket.id} ${ticket.status.toLowerCase()}`]
      else if (reviewNum && reviewed && pr?.state === 'OPEN') [suggestion, reason] = ['review-done', 'Ma review est faite : le worktree se recrée si une nouvelle review est demandée']
      else if (reviewNum && rerequested) reason = 'Nouvelle review demandée : à garder'
      else if (reviewNum && pr?.state === 'OPEN') reason = 'Review à faire'
      else if (days > STALE_DAYS && pr?.state !== 'OPEN') [suggestion, reason] = ['stale', `Aucun commit depuis ${Math.round(days)} jours`]
      else if (pr?.state === 'OPEN') reason = `PR #${pr.number} ouverte`

      return {
        id: encodeId(w.path), path: w.path, branch: w.branch, kind: w.kind, ticket, pr, reviewed,
        lastCommitAt: last, dirty: dirty.length, unpushed, suggestion, reason,
      }
    }),
  )
  const order = { 'pr-merged': 0, 'pr-closed': 1, 'ticket-done': 2, 'review-done': 3, stale: 4, keep: 5 }
  return list.sort((a, b) => order[a.suggestion] - order[b.suggestion])
}

/**
 * Supprime les worktrees demandés. Avec `discard`, les changements non commités sont abandonnés.
 * Avec `deleteBranch`, la branche locale est supprimée aussi (jamais la distante).
 */
export async function removeWorktrees(project: Project, paths: string[], opts: { discard: boolean; deleteBranch: boolean }): Promise<BranchDeleteResult[]> {
  const known = await listWorktrees(project)
  const results: BranchDeleteResult[] = []
  for (const path of paths) {
    const w = known.find((x) => x.path === path)
    const done: string[] = []
    try {
      if (!w) throw new Error('worktree introuvable')
      if (w.isMain) throw new Error('clone principal : jamais supprimé')
      const dirty = (await dirtyFiles(path).catch(() => [])).length
      if (dirty && !opts.discard) throw new Error(`${dirty} fichier(s) non commité(s)`)
      await removeWorktree(project, path, dirty > 0)
      done.push(dirty ? `worktree (${dirty} fichier(s) abandonné(s))` : 'worktree')
      if (opts.deleteBranch && w.branch && !/^(main|master|develop|dev|staging|production)$/.test(w.branch)) {
        await git(project.path, ['branch', '-D', w.branch])
        done.push(`branche locale ${w.branch}`)
      }
      results.push({ name: w.branch ?? path, ok: true, done })
    } catch (e) {
      results.push({ name: w?.branch ?? path, ok: false, done, error: (e as Error).message })
    }
  }
  return results
}
