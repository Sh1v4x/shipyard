import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { MergeState, Project, Worktree } from '../../shared/types.ts'
import { CHECKOUTS_DIR, encodeId } from './config.ts'
import { CommandError, run } from './exec.ts'
import { removeLocalTicket } from './localTickets.ts'

const git = (cwd: string, args: string[], timeoutMs?: number) => run('git', args, { cwd, timeoutMs })

export const TICKET_RE = /\b([A-Za-z]{2,10}-\d{1,6})\b/

export function ticketFromBranch(branch: string | null): string | null {
  const m = branch?.match(TICKET_RE)
  if (!m || /^pr-/i.test(m[1])) return null // review/pr-855 n'est pas un ticket
  return m[1].toUpperCase()
}

/** `git worktree list --porcelain` → liste typée (sans le lien PR, ajouté plus tard). */
export async function listWorktrees(project: Project): Promise<Worktree[]> {
  const out = await git(project.path, ['worktree', 'list', '--porcelain'])
  const list: Worktree[] = []
  let cur: Partial<Worktree> = {}
  const flush = () => {
    if (cur.path) {
      list.push({
        id: encodeId(cur.path),
        path: cur.path,
        branch: cur.branch ?? null,
        head: cur.head ?? '',
        isMain: list.length === 0,
        ticketId: ticketFromBranch(cur.branch ?? null),
        prNumber: null,
        kind: 'none',
      })
    }
    cur = {}
  }
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) cur.path = line.slice(9)
    else if (line.startsWith('HEAD ')) cur.head = line.slice(5)
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace('refs/heads/', '')
    else if (line === '') flush()
  }
  flush()
  // Les copies temporaires des re-tests ne sont pas des worktrees de travail.
  return list.filter((w) => !w.path.startsWith(CHECKOUTS_DIR))
}

/** Oublie les worktrees dont le dossier a disparu (copies temporaires supprimées à la main ou par un redémarrage). */
/** Remet sur le disque les fichiers suivis supprimés (et annule toute modification de fichier suivi). */
export async function restoreTracked(cwd: string) {
  await git(cwd, ['restore', '--worktree', '--', '.'], 300_000)
}

export async function pruneWorktrees(project: Project) {
  await git(project.path, ['worktree', 'prune'])
}

/** Copie détachée d'un commit, sans branche (captures « avant » d'un re-test). À retirer avec removeWorktree(…, true). */
export async function addDetachedCheckout(project: Project, path: string, ref: string) {
  await git(project.path, ['worktree', 'add', '--detach', path, ref])
}

export async function remoteBranches(project: Project): Promise<string[]> {
  const out = await git(project.path, ['branch', '-r', '--format=%(refname:short)'])
  return out
    .split('\n')
    .map((b) => b.trim().replace(/^origin\//, ''))
    .filter((b) => b && b !== 'HEAD' && b !== 'origin')
}

export async function fetchOrigin(cwd: string) {
  await git(cwd, ['fetch', 'origin', '--prune'], 120_000)
}

/** Met à jour origin/<branch> seulement. */
export async function fetchBranch(cwd: string, branch: string) {
  await git(cwd, ['fetch', 'origin', branch], 120_000)
}

export async function addWorktree(
  project: Project,
  opts: { dir: string; branch: string; mode: 'new' | 'existing' | 'pr'; base?: string; prNumber?: number },
): Promise<string> {
  mkdirSync(project.worktreeRoot, { recursive: true })
  const target = join(project.worktreeRoot, opts.dir)
  if (existsSync(target)) throw new Error(`Le dossier ${target} existe déjà`)
  await fetchOrigin(project.path)
  if (opts.mode === 'new') {
    await git(project.path, ['worktree', 'add', target, '-b', opts.branch, `origin/${opts.base ?? project.baseBranch}`])
    await git(target, ['branch', '--unset-upstream']).catch(() => undefined)
  } else if (opts.mode === 'existing') {
    const local = await git(project.path, ['branch', '--list', opts.branch])
    if (local.trim()) await git(project.path, ['worktree', 'add', target, opts.branch])
    else await git(project.path, ['worktree', 'add', '--track', '-b', opts.branch, target, `origin/${opts.branch}`])
  } else {
    await git(project.path, ['fetch', 'origin', `pull/${opts.prNumber}/head:${opts.branch}`, '--force'], 120_000)
    await git(project.path, ['worktree', 'add', target, opts.branch])
  }
  return target
}

/** `force` abandonne les changements non commités du worktree. */
export async function removeWorktree(project: Project, path: string, force = false) {
  await git(project.path, ['worktree', 'remove', ...(force ? ['--force'] : []), path])
  // Le ticket local du worktree (proposition gardée sur le Mac) part avec lui.
  removeLocalTicket(path)
}

export async function pushNewBranch(project: Project, branch: string, base: string) {
  await fetchOrigin(project.path)
  await git(project.path, ['push', 'origin', `origin/${base}:refs/heads/${branch}`])
}

export async function dirtyFiles(cwd: string): Promise<{ status: string; path: string }[]> {
  const out = await git(cwd, ['status', '--porcelain=v1', '--untracked-files=all'])
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => ({ status: l.slice(0, 2).trim() || '?', path: l.slice(3) }))
}

/** Fichier suivi dont la modification ne touche qu'aux espaces et lignes vides (reformatage par un hook). */
export async function isWhitespaceOnlyChange(cwd: string, f: { status: string; path: string }): Promise<boolean> {
  if (f.status === '?' || f.status === '??') return false
  return git(cwd, ['diff', '--quiet', 'HEAD', '--ignore-all-space', '--ignore-blank-lines', '--', f.path]).then(() => true, () => false)
}

/** Annule les modifications non commitées de ces fichiers (suivis : restaurés ; nouveaux : supprimés). */
export async function discardFiles(cwd: string, files: { status: string; path: string }[]) {
  const tracked = files.filter((f) => f.status !== '?' && f.status !== '??').map((f) => f.path)
  const untracked = files.filter((f) => f.status === '?' || f.status === '??').map((f) => f.path)
  if (tracked.length) await git(cwd, ['restore', '--staged', '--worktree', '--', ...tracked])
  for (const f of untracked) rmSync(join(cwd, f), { force: true })
}

export async function commitsAhead(cwd: string, base: string): Promise<string[]> {
  const out = await git(cwd, ['log', '--format=%s', `origin/${base}..HEAD`]).catch(() => '')
  return out.split('\n').filter(Boolean)
}

export async function diffStat(cwd: string, base: string): Promise<string> {
  const committed = await git(cwd, ['diff', '--stat', `origin/${base}...HEAD`]).catch(() => '')
  const local = await git(cwd, ['diff', '--stat', 'HEAD']).catch(() => '')
  return [committed && `Déjà commité :\n${committed}`, local && `Non commité :\n${local}`].filter(Boolean).join('\n')
}

/** Fichiers et lignes modifiés depuis la base (point de divergence), changements non commités compris. */
export async function numstat(cwd: string, base: string): Promise<{ files: number; additions: number; deletions: number }> {
  const mb = (await git(cwd, ['merge-base', `origin/${base}`, 'HEAD']).catch(() => '')).trim()
  const out = await git(cwd, ['diff', '--numstat', mb || 'HEAD']).catch(() => '')
  const rows = out.split('\n').filter(Boolean).map((l) => l.split('\t'))
  // Fichiers binaires : « - - chemin », comptés sans lignes.
  return {
    files: rows.length,
    additions: rows.reduce((a, [add]) => a + (Number(add) || 0), 0),
    deletions: rows.reduce((a, [, del]) => a + (Number(del) || 0), 0),
  }
}

/** État d'un worktree avant le passage d'un agent : de quoi remettre ses fichiers tels quels, sans toucher aux commits. */
export interface Snapshot { path: string; sha: string; index: string | null; untracked: string[] }

const untrackedFiles = async (cwd: string) => (await git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']).catch(() => '')).split('\0').filter(Boolean)

/**
 * Photographie le worktree : fichiers suivis (modifiés compris, via `git stash create`, sans rien changer sur le disque),
 * index, et liste des fichiers non suivis. Le commit est épinglé sous refs/shipyard/ pour ne pas être nettoyé par git.
 */
export async function snapshot(cwd: string, id: string): Promise<Snapshot> {
  const stash = (await git(cwd, ['stash', 'create']).catch(() => '')).trim()
  const sha = stash || (await git(cwd, ['rev-parse', 'HEAD'])).trim()
  await git(cwd, ['update-ref', `refs/shipyard/${id}`, sha])
  return { path: cwd, sha, index: stash ? `${stash}^2` : null, untracked: await untrackedFiles(cwd) }
}

/** Remet le worktree dans l'état de la photo : fichiers suivis, index, et suppression des fichiers non suivis apparus depuis. */
export async function restoreSnapshot(snap: Snapshot, id: string) {
  const cwd = snap.path
  await git(cwd, ['checkout', snap.sha, '--', '.'])
  await git(cwd, ['read-tree', snap.index ?? 'HEAD'])
  const before = new Set(snap.untracked)
  const created = (await untrackedFiles(cwd)).filter((f) => !before.has(f))
  if (created.length) await git(cwd, ['clean', '-f', '-q', '--', ...created])
  await dropSnapshot(cwd, id)
}

export const dropSnapshot = (cwd: string, id: string) => git(cwd, ['update-ref', '-d', `refs/shipyard/${id}`]).catch(() => undefined)

export async function commitFiles(cwd: string, title: string, files: string[] | 'all'): Promise<string | null> {
  if (files === 'all') await git(cwd, ['add', '-A'])
  else if (files.length) await git(cwd, ['add', '--', ...files])
  const staged = await git(cwd, ['diff', '--cached', '--name-only'])
  if (!staged.trim()) return null
  await git(cwd, ['commit', '-m', title], 900_000) // les hooks (typecheck) peuvent être longs
  return (await git(cwd, ['rev-parse', 'HEAD'])).trim()
}

/** Refus passager de GitHub (erreur interne, réseau) : le même push passe en général au deuxième essai. */
const TRANSIENT_PUSH = /fatal error in commit_refs|\(failure\)|internal server error|HTTP 5\d\d|RPC failed|early EOF|unexpected disconnect|Connection (reset|timed out)|Could not resolve host/i

export async function push(cwd: string, branch: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await git(cwd, ['push', '-u', 'origin', branch], 120_000)
    } catch (e) {
      if (attempt >= 3 || !TRANSIENT_PUSH.test(String((e as Error).message))) throw e
      await new Promise((r) => setTimeout(r, attempt * 5_000))
    }
  }
}

export async function currentBranch(cwd: string): Promise<string> {
  return (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
}

export async function originRepo(path: string): Promise<string | null> {
  const url = (await git(path, ['remote', 'get-url', 'origin']).catch(() => '')).trim()
  const m = url.match(/github\.com[:/]([^/]+\/[^/.]+)(\.git)?$/)
  return m ? m[1] : null
}

export async function defaultBranch(path: string): Promise<string> {
  const ref = (await git(path, ['symbolic-ref', 'refs/remotes/origin/HEAD']).catch(() => '')).trim()
  return ref ? ref.replace('refs/remotes/origin/', '') : 'main'
}

// ---------- Fusion de la base (résolution de conflits) ----------

const MARKERS = /^(<{7}|>{7})( |$)/m

/** Fusion en cours dans le worktree : fichiers en conflit, et ceux qui gardent encore des marqueurs. */
export async function mergeState(cwd: string): Promise<MergeState | null> {
  const head = (await git(cwd, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).catch(() => '')).trim()
  if (!head) return null
  const msgPath = (await git(cwd, ['rev-parse', '--git-path', 'MERGE_MSG'])).trim()
  const msg = existsSync(join(cwd, msgPath)) ? readFileSync(join(cwd, msgPath), 'utf8') : existsSync(msgPath) ? readFileSync(msgPath, 'utf8') : ''
  const base = msg.match(/branch '(?:origin\/)?([^']+)'/)?.[1] ?? null
  const conflicted = (await git(cwd, ['diff', '--name-only', '--diff-filter=U'])).split('\n').filter(Boolean)
  const remaining = conflicted.filter((f) => {
    const path = join(cwd, f)
    return existsSync(path) && MARKERS.test(readFileSync(path, 'utf8'))
  })
  return { base, conflicted, remaining }
}

/**
 * Fusionne origin/<base> dans la branche sans commiter : les conflits restent dans les fichiers.
 * Renvoie null si la branche est déjà à jour (rien à fusionner).
 */
export async function startMerge(cwd: string, base: string): Promise<MergeState | null> {
  await git(cwd, ['fetch', 'origin', base], 120_000)
  await git(cwd, ['merge', '--no-ff', '--no-commit', `origin/${base}`], 120_000).catch(() => undefined)
  return mergeState(cwd)
}

export async function abortMerge(cwd: string) {
  await git(cwd, ['merge', '--abort'])
}

/**
 * Termine la fusion : tout est ajouté, commit de fusion avec le message par défaut de git, puis push.
 * Relançable : si le commit est déjà fait (étape interrompue), seul le push est refait.
 */
export async function finishMerge(cwd: string, branch: string, log: (text: string) => void = () => undefined): Promise<string> {
  if (await mergeState(cwd)) {
    await git(cwd, ['add', '-A'])
    // La base apporte souvent des migrations : sans client Prisma régénéré, la vérification des types du hook
    // de pre-commit échoue sur les nouvelles tables. prisma generate ne touche à aucune base de données.
    const schemas = (await git(cwd, ['diff', '--cached', '--name-only'])).split('\n').filter((f) => /(^|\/)prisma\/schema\.prisma$/.test(f))
    for (const schema of schemas) {
      // Depuis le paquet du schéma (ses générateurs y sont référencés en chemins relatifs), via son script s'il en a un.
      const pkg = join(cwd, dirname(dirname(schema)))
      const scripts = (JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }).scripts ?? {}
      const script = Object.entries(scripts).find(([, v]) => /^prisma generate\b/.test(v))?.[0]
      log(`Schéma Prisma modifié par la fusion : ${script ? `bun run ${script}` : 'prisma generate'} dans ${dirname(dirname(schema))}`)
      // prisma generate ne se connecte pas : une URL fictive suffit quand le worktree n'a pas de .env.
      const env = { ...process.env, PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}`, DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://user:pass@localhost:5432/generate' }
      await run('bun', script ? ['run', script] : ['x', 'prisma', 'generate'], { cwd: pkg, timeoutMs: 300_000, env })
    }
    // Types générés par `next dev` avant la fusion : ils référencent des pages déplacées par la base et font échouer
    // la vérification des types du hook. Cache ignoré par git, régénéré au prochain `next dev`.
    for (const dir of nextDevTypes(cwd)) {
      rmSync(dir, { recursive: true, force: true })
      log(`Cache Next.js périmé supprimé : ${dir.slice(cwd.length + 1)}`)
    }
    log('Commit de fusion (hooks de pre-commit compris)…')
    await git(cwd, ['commit', '--no-edit'], 300_000)
  }
  log(`Push de ${branch}…`)
  try {
    await git(cwd, ['push', 'origin', branch], 120_000)
  } catch (e) {
    // La branche distante a avancé (PR empilée mergée dedans, push d'un collègue) : on intègre ses commits, puis on repousse.
    if (!/non-fast-forward|\[rejected\]|fetch first/.test(String((e as Error).message))) throw e
    await git(cwd, ['fetch', 'origin', branch], 120_000)
    const behind = await behindRemote(cwd, branch)
    log(`La branche distante a ${behind} commit(s) absent(s) en local : fusion de origin/${branch}…`)
    await git(cwd, ['merge', '--no-ff', '--no-commit', `origin/${branch}`], 120_000).catch(() => undefined)
    const state = await mergeState(cwd)
    if (state?.conflicted.length) throw new Error(`La branche distante a avancé et sa fusion produit ${state.conflicted.length} conflit(s) : résous-les avec l’IA dans cet onglet, puis valide.`)
    return finishMerge(cwd, branch, log)
  }
  return (await git(cwd, ['rev-parse', 'HEAD'])).trim()
}

/** Commits de origin/<branch> absents en local (après un fetch). */
/**
 * Rafraîchit origin/<base> (ou la branche elle-même) en arrière-plan, au plus une fois toutes les 5 minutes par dépôt et ref :
 * le retard affiché au chargement suivant est alors à jour, sans ralentir celui-ci.
 */
const baseFetchedAt = new Map<string, number>()
export function refreshBaseInBackground(cwd: string, base: string) {
  const key = `${cwd}|${base}`
  if (Date.now() - (baseFetchedAt.get(key) ?? 0) < 5 * 60_000) return
  baseFetchedAt.set(key, Date.now())
  void git(cwd, ['fetch', 'origin', base], 120_000).catch(() => baseFetchedAt.delete(key))
}

/** Récupère une branche et les tags du dépôt distant. */
export async function fetchWithTags(cwd: string, branch: string) {
  await git(cwd, ['fetch', '--tags', 'origin', branch], 120_000)
}

/** Fichiers suivis à une révision (sans les dossiers). */
export async function filesAt(cwd: string, ref: string): Promise<string[]> {
  return (await git(cwd, ['ls-tree', '-r', '--name-only', ref])).split('\n').filter(Boolean)
}

/** Contenu d'un fichier à une révision, ou null s'il n'existe pas. */
export async function showFile(cwd: string, ref: string, path: string): Promise<string | null> {
  return git(cwd, ['show', `${ref}:${path}`]).catch(() => null)
}

/** Tags correspondant à un motif (glob git), du plus récent au plus ancien. */
export async function tagsMatching(cwd: string, pattern: string): Promise<string[]> {
  return (await git(cwd, ['tag', '--list', '--sort=-creatordate', pattern])).split('\n').filter(Boolean)
}

/** Titres des commits de la branche elle-même (first-parent : un merge de PR compte pour un) sur une plage, limités à un dossier. */
export async function mainlineSubjects(cwd: string, range: string, path?: string): Promise<string[]> {
  return (await git(cwd, ['log', '--first-parent', '--format=%s', range, ...(path ? ['--', path] : [])])).split('\n').filter(Boolean)
}

export async function behindRemote(cwd: string, branch: string): Promise<number> {
  return Number((await git(cwd, ['rev-list', '--count', `HEAD..origin/${branch}`]).catch(() => '0')).trim()) || 0
}

/** Dossiers `.next/dev/types` des applications du dépôt (jusqu'à trois niveaux : apps-v2/web/.next…). */
function nextDevTypes(cwd: string): string[] {
  const out: string[] = []
  const walk = (dir: string, depth: number) => {
    const types = join(dir, '.next', 'dev', 'types')
    if (existsSync(types)) out.push(types)
    if (depth >= 3) return
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') walk(join(dir, e.name), depth + 1)
    }
  }
  walk(cwd, 0)
  return out
}

/** Fichiers modifiés par la branche depuis origin/<base> (ceux de la PR). */
export async function changedFiles(cwd: string, base: string): Promise<string[]> {
  return (await git(cwd, ['diff', '--name-only', '--diff-filter=d', `origin/${base}...HEAD`])).split('\n').filter(Boolean)
}

/** Auteurs des commits de origin/<branch> absents en local. */
export async function remoteAuthors(cwd: string, branch: string): Promise<string[]> {
  const out = await git(cwd, ['log', '--format=%an', `HEAD..origin/${branch}`]).catch(() => '')
  return [...new Set(out.split('\n').filter(Boolean))]
}

/** Avance la branche sur origin/<branch> sans commit de fusion ; false si l'historique a divergé. */
export async function fastForward(cwd: string, branch: string): Promise<boolean> {
  return git(cwd, ['merge', '--ff-only', `origin/${branch}`], 120_000).then(() => true, () => false)
}

/** Commits locaux pas encore poussés sur origin/<branch>. */
export async function unpushedCount(cwd: string, branch: string): Promise<number> {
  return Number((await git(cwd, ['rev-list', '--count', `origin/${branch}..HEAD`]).catch(() => '0')).trim()) || 0
}

/** Commite uniquement ces fichiers (le reste de l'index n'est pas embarqué). Renvoie le sha. */
export async function commitPaths(cwd: string, title: string, paths: string[]): Promise<string> {
  await git(cwd, ['add', '--', ...paths])
  await git(cwd, ['commit', '-m', title, '--', ...paths], 300_000)
  return (await git(cwd, ['rev-parse', 'HEAD'])).trim()
}

/** Annule les modifications de ces fichiers : retour à HEAD pour un fichier suivi, suppression pour un fichier nouveau. */
export async function discardPaths(cwd: string, files: { status: string; path: string }[]) {
  for (const f of files) {
    const abs = join(cwd, f.path)
    if (!abs.startsWith(`${cwd}/`)) continue
    if (f.status === '?') rmSync(abs, { recursive: true, force: true })
    else if (f.status.includes('A')) {
      await git(cwd, ['rm', '-f', '--cached', '--', f.path])
      rmSync(abs, { recursive: true, force: true })
    } else await git(cwd, ['restore', '--source=HEAD', '--staged', '--worktree', '--', f.path])
  }
}

// ---------- Branche de base ----------

/** On ne part jamais de main / master quand le dépôt a une branche develop. */
export const FORBIDDEN_BASES = ['main', 'master']

/** Le dépôt distant a-t-il une branche develop ? */
export async function hasDevelop(path: string): Promise<boolean> {
  const out = await git(path, ['ls-remote', '--heads', 'origin', 'develop'], 30_000).catch(() => '')
  return out.includes('refs/heads/develop')
}

/** Diff unifié entre deux textes (hors dépôt). */
export async function diffTexts(before: string, after: string): Promise<string> {
  const tmp = mkdtempSync(join(tmpdir(), 'shipyard-diff-'))
  try {
    writeFileSync(join(tmp, 'before'), before)
    writeFileSync(join(tmp, 'after'), after)
    // git diff --no-index sort en code 1 quand les fichiers diffèrent.
    return await run('git', ['diff', '--no-index', '--no-color', '-U2', 'before', 'after'], { cwd: tmp }).catch((e) => {
      if (e instanceof CommandError && e.code === 1) return e.stdout
      throw e
    })
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}
