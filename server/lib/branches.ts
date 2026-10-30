import type { BranchDeleteResult, BranchInfo, Project } from '../../shared/types.ts'
import { run } from './exec.ts'
import { dirtyFiles, fetchOrigin, listWorktrees, removeWorktree } from './git.ts'
import * as gh from './github.ts'

const git = (cwd: string, args: string[]) => run('git', args, { cwd })
const STALE_DAYS = 30
const PROTECTED = /^(main|master|develop|dev|staging|production|release\/.*)$/

/** Limite le nombre de commandes git lancées en même temps. */
async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const j = i++
      out[j] = await fn(items[j])
    }
  }))
  return out
}

interface Ref {
  name: string
  date: string
  subject: string
  email: string
  author: string
}

async function refs(cwd: string, prefix: string): Promise<Ref[]> {
  const out = await git(cwd, ['for-each-ref', prefix, '--format=%(refname:short)%09%(committerdate:iso-strict)%09%(authoremail)%09%(authorname)%09%(subject)'])
  return out.split('\n').filter(Boolean).map((l) => {
    const [name, date, email, author, ...subject] = l.split('\t')
    return { name, date, email: email.replace(/[<>]/g, '').toLowerCase(), author, subject: subject.join('\t') }
  })
}

const count = async (cwd: string, range: string) => Number((await git(cwd, ['rev-list', '--count', range]).catch(() => '0')).trim()) || 0

/** Auteur du premier commit qui n'est pas dans la base : git ne garde pas le créateur d'une branche, c'est le meilleur indicateur. */
async function creatorOf(cwd: string, base: string, ref: string): Promise<{ email: string; name: string } | null> {
  const out = await git(cwd, ['log', '--reverse', '--format=%ae%x09%an', `${base}..${ref}`]).catch(() => '')
  const first = out.split('\n').find(Boolean)
  if (!first) return null
  const [email, name] = first.split('\t')
  return { email: email.toLowerCase(), name }
}

/**
 * Branches locales et distantes du projet, avec leur créateur et des indicateurs pour décider du ménage.
 * Seules celles créées par moi (ou portant une de mes PR) sont marquées `mine` et peuvent être supprimées.
 */
export async function listMyBranches(project: Project, refresh = false): Promise<BranchInfo[]> {
  const cwd = project.path
  if (refresh) await fetchOrigin(cwd)
  const [locals, remotes, repoEmail, me, worktrees, open, closed] = await Promise.all([
    refs(cwd, 'refs/heads'),
    refs(cwd, 'refs/remotes/origin'),
    git(cwd, ['config', 'user.email']).then((s) => s.trim().toLowerCase()).catch(() => ''),
    gh.identity(),
    listWorktrees(project),
    gh.myPrs(project.repo),
    gh.closedPrsByBranch(project.repo).catch(() => new Map()),
  ])
  const myEmails = new Set([...me.emails, repoEmail].filter(Boolean))
  const remoteMap = new Map(remotes.filter((r) => r.name !== 'origin/HEAD' && r.name !== 'origin').map((r) => [r.name.replace(/^origin\//, ''), r]))
  const names = new Set<string>([...locals.map((l) => l.name), ...remoteMap.keys()])

  const base = `origin/${project.baseBranch}`
  const list = await pool([...names], 8, async (name): Promise<BranchInfo> => {
    const local = locals.find((l) => l.name === name)
    const remote = remoteMap.get(name)
    const ref = local ? name : `origin/${name}`
    const tip = local ?? remote!
    const [aheadBehind, unpushed, first] = await Promise.all([
      git(cwd, ['rev-list', '--left-right', '--count', `${base}...${ref}`]).catch(() => '0\t0'),
      local && remote ? count(cwd, `origin/${name}..${name}`) : Promise.resolve(local ? -1 : 0),
      creatorOf(cwd, base, ref),
    ])
    const [behind, ahead] = aheadBehind.trim().split(/\s+/).map(Number)
    const openPr = open.find((p) => p.head === name)
    const pr = openPr
      ? { number: openPr.number, state: 'OPEN' as const, title: openPr.title, url: openPr.url, mergedAt: null }
      : closed.get(name) ?? null
    const creator = first ?? { email: tip.email, name: tip.author }
    const mine = myEmails.has(creator.email) || !!pr // `pr` ne contient que mes PR
    const isProtected = PROTECTED.test(name) || worktrees.some((w) => w.isMain && w.branch === name)
    const wtPath = worktrees.find((w) => w.branch === name && !w.isMain)?.path ?? null
    const dirty = wtPath ? (await dirtyFiles(wtPath).catch(() => [])).length : 0
    const days = (Date.now() - Date.parse(tip.date)) / 86_400_000
    let suggestion: BranchInfo['suggestion'] = 'keep'
    if (mine && !isProtected && !openPr) {
      if (pr?.state === 'MERGED' || (ahead === 0 && behind > 0)) suggestion = 'delete-merged'
      else if (pr?.state === 'CLOSED') suggestion = 'delete-closed'
      else if (days > STALE_DAYS) suggestion = 'stale'
    }
    return {
      name,
      creator: myEmails.has(creator.email) ? me.login : creator.name,
      mine,
      local: !!local,
      remote: !!remote,
      lastCommitAt: tip.date,
      lastCommitSubject: tip.subject,
      ahead: ahead || 0,
      behind: behind || 0,
      // -1 : branche locale jamais poussée → tous ses commits propres sont non poussés.
      unpushed: pr?.state === 'MERGED' ? 0 : unpushed === -1 ? ahead || 0 : unpushed,
      worktree: wtPath,
      dirty,
      pr,
      suggestion,
      protected: isProtected,
    }
  })
  const order = { 'delete-merged': 0, 'delete-closed': 1, stale: 2, keep: 3 }
  return list.sort((a, b) => Number(b.mine) - Number(a.mine) || order[a.suggestion] - order[b.suggestion] || a.lastCommitAt.localeCompare(b.lastCommitAt))
}

/**
 * Supprime les branches demandées : worktree, branche locale, branche distante. Refuse celles des autres.
 * Avec `discard`, les changements non commités du worktree et les commits non poussés sont abandonnés.
 */
export async function deleteBranches(project: Project, names: string[], opts: { local: boolean; remote: boolean; discard?: boolean }): Promise<BranchDeleteResult[]> {
  const all = await listMyBranches(project)
  const results: BranchDeleteResult[] = []
  for (const name of names) {
    const b = all.find((x) => x.name === name)
    const done: string[] = []
    try {
      if (!b) throw new Error('branche introuvable')
      if (!b.mine) throw new Error(`branche créée par ${b.creator}, pas par toi`)
      if (b.protected) throw new Error('branche protégée')
      if (b.pr?.state === 'OPEN') throw new Error(`PR #${b.pr.number} encore ouverte`)
      if (b.worktree) {
        const dirty = (await dirtyFiles(b.worktree)).length
        if (dirty && !opts.discard) throw new Error('worktree avec des changements non commités')
        await removeWorktree(project, b.worktree, dirty > 0)
        done.push(dirty ? `worktree (${dirty} fichier(s) abandonné(s))` : 'worktree')
      }
      if (opts.local && b.local) {
        if (b.unpushed > 0 && !opts.discard) throw new Error(`${b.unpushed} commit(s) non poussé(s)`)
        await git(project.path, ['branch', '-D', name]) // -D : supprime même si les commits ne sont mergés nulle part
        done.push(b.unpushed > 0 ? `locale (${b.unpushed} commit(s) abandonné(s))` : 'locale')
      }
      if (opts.remote && b.remote) {
        await git(project.path, ['push', 'origin', '--delete', name])
        done.push('distante')
      }
      results.push({ name, ok: true, done })
    } catch (e) {
      results.push({ name, ok: false, done, error: (e as Error).message })
    }
  }
  return results
}
