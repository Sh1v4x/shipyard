// Sauvegarde privée : le dépôt public ne reçoit jamais prompts.local/, rules.local/ ni les données locales. Ce script
// en envoie une copie complète (code public + fichiers locaux) vers un second dépôt, privé, et sait les en rapporter
// sur une autre machine. Il ne touche ni à la branche courante ni à l'index : le commit de sauvegarde est construit à part.
//
//   pnpm private:push   envoie HEAD + les fichiers locaux sur la branche main du remote `private`
//   pnpm private:pull   rapporte les fichiers locaux depuis ce remote (après un clone du dépôt public)
//
// Fichiers locaux : prompts.local/ et rules.local/, plus les chemins listés dans `private.local` (un par ligne, ignoré par git).
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const REMOTE = 'private'
const BRANCH = 'main'
const LIST = 'private.local'
const DEFAULT_PATHS = ['prompts.local', 'rules.local']

const [command, ...flags] = process.argv.slice(2)
const quiet = flags.includes('--if-configured')
const force = flags.includes('--force')

const git = (args: string[], opts: { env?: NodeJS.ProcessEnv; input?: string | Buffer } = {}) =>
  execFileSync('git', args, { env: { ...process.env, ...opts.env }, input: opts.input, maxBuffer: 256 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] })
const text = (args: string[], opts?: { env?: NodeJS.ProcessEnv; input?: string }) => git(args, opts).toString().trim()
const ok = (args: string[]) => {
  try {
    git(args)
    return true
  } catch {
    return false
  }
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

if (!ok(['remote', 'get-url', REMOTE])) {
  // Hook de push chez quelqu'un qui n'a pas de dépôt privé : rien à faire, sans bruit.
  if (quiet) process.exit(0)
  fail(`Aucun remote « ${REMOTE} ». Ajoute ton dépôt privé : git remote add ${REMOTE} <url>`)
}

const localPaths = () => {
  const extra = existsSync(LIST) ? readFileSync(LIST, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')) : []
  return [...new Set([...DEFAULT_PATHS, ...extra, LIST])].filter((p) => existsSync(p))
}

/** Tête du dépôt privé, null s'il est vide ou injoignable. */
function fetchPrivate(): string | null {
  if (!ok(['fetch', '--quiet', REMOTE, BRANCH])) return null
  return text(['rev-parse', 'FETCH_HEAD'])
}

function push() {
  const head = text(['rev-parse', 'HEAD'])
  const prev = fetchPrivate()
  // Index à part : l'arbre de HEAD, plus les fichiers locaux (ignorés par git, donc ajoutés de force).
  const dir = mkdtempSync(join(tmpdir(), 'shipyard-private-'))
  const env = { GIT_INDEX_FILE: join(dir, 'index') }
  try {
    git(['read-tree', head], { env })
    const paths = localPaths()
    if (paths.length) git(['add', '--force', '--', ...paths], { env })
    const tree = text(['write-tree'], { env })
    if (prev && text(['rev-parse', `${prev}^{tree}`]) === tree) return console.log('Dépôt privé déjà à jour.')
    // Parents : la sauvegarde précédente, et HEAD pour que l'historique public se retrouve aussi dans le dépôt privé.
    const parents = [prev, prev && ok(['merge-base', '--is-ancestor', head, prev]) ? null : head].filter((p): p is string => !!p)
    const title = `sync: ${text(['log', '-1', '--format=%h %s', head])}`
    const commit = text(['commit-tree', tree, ...parents.flatMap((p) => ['-p', p]), '-m', title])
    // --no-verify : ce push part lui-même du hook de push.
    git(['push', '--quiet', '--no-verify', REMOTE, `${commit}:refs/heads/${BRANCH}`])
    console.log(`Dépôt privé à jour (${commit.slice(0, 7)}) : code public + ${paths.join(', ')}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function pull() {
  const prev = fetchPrivate()
  if (!prev) fail(`Impossible de lire ${REMOTE}/${BRANCH} (dépôt vide ou injoignable).`)
  // Les fichiers locaux sont ceux de la sauvegarde que le dépôt public ne suit pas.
  const tracked = new Set(text(['ls-files']).split('\n'))
  const entries = text(['ls-tree', '-r', prev]).split('\n').filter(Boolean).map((l) => {
    const [meta, path] = l.split('\t')
    const [mode, , sha] = meta.split(' ')
    return { mode, sha, path }
  }).filter((e) => !tracked.has(e.path))
  const differs = entries.filter((e) => existsSync(e.path) && text(['hash-object', e.path]) !== e.sha)
  if (differs.length && !force) {
    fail(`Ces fichiers existent déjà ici avec un autre contenu :\n${differs.map((e) => `  ${e.path}`).join('\n')}\nRelance avec --force pour les remplacer par la sauvegarde.`)
  }
  let written = 0
  for (const e of entries) {
    if (existsSync(e.path) && !differs.includes(e)) continue
    mkdirSync(dirname(e.path), { recursive: true })
    writeFileSync(e.path, git(['cat-file', 'blob', e.sha]))
    // Les clés restent lisibles par moi seul.
    chmodSync(e.path, e.path.startsWith('.env') ? 0o600 : e.mode === '100755' ? 0o755 : 0o644)
    written++
  }
  console.log(`${written} fichier(s) rapporté(s) depuis le dépôt privé, ${entries.length - written} déjà identique(s).`)
}

try {
  if (command === 'push') push()
  else if (command === 'pull') pull()
  else fail('Usage : tsx scripts/private.ts push|pull [--force]')
} catch (e) {
  // Depuis le hook de push, un dépôt privé injoignable ne doit pas empêcher le push public.
  const message = e instanceof Error ? e.message.split('\n').slice(0, 4).join('\n') : String(e)
  if (quiet) {
    console.error(`Sauvegarde privée non faite : ${message}`)
    process.exit(0)
  }
  fail(message)
}
