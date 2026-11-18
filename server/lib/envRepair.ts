import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { run } from './exec.ts'
import * as git from './git.ts'
import * as gh from './github.ts'
import { packageManager } from './sdk.ts'

// Un worktree neuf n'a ni dépendances installées ni code généré (client Prisma…). Les hooks de pre-commit du dépôt
// (typecheck, lint) échouent alors sur tout le projet, sans rapport avec les fichiers commités. Ces causes-là se
// réparent sans rien décider : on installe, on génère, et le commit est retenté.

const tail = (e: unknown, lines: number) => String((e as Error).message ?? e).split('\n').slice(-lines).join('\n')

/**
 * Remet node_modules d'accord avec le lockfile (SDK privé compris, lu avec le jeton de gh).
 * Un échec n'arrête rien : le hook dira ce qui manque.
 */
export async function installDeps(cwd: string, log: (text: string) => void): Promise<boolean> {
  if (!existsSync(join(cwd, 'package.json'))) return false
  const pm = packageManager(cwd)
  log(`Dépendances : ${pm} install…`)
  const env = { ...process.env, NODE_AUTH_TOKEN: await gh.authToken().catch(() => ''), PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}` }
  return run(pm, ['install'], { cwd, timeoutMs: 600_000, env }).then(
    () => { log('Dépendances à jour.'); return true },
    (e) => { log(`Installation des dépendances en échec, le commit est tenté quand même :\n${tail(e, 10)}`); return false },
  )
}

/** Le hook échoue faute de client Prisma généré : `@prisma/client` vide, ou dossier `prisma/generated` absent. */
const PRISMA_MISSING = /Module '"@prisma\/client"' has no exported member|prisma\/generated\/|@prisma\/client did not initialize|run "?prisma generate/i
/** Le hook échoue faute de dépendances : un outil ou un module introuvable. */
const DEPS_MISSING = /Cannot find module '[^.'][^']*'|command not found|ERR_MODULE_NOT_FOUND|Cannot find package|is not recognized as/i

/**
 * Répare ce qui, dans la sortie d'un hook refusé, vient de l'état du worktree et pas du code : dépendances absentes,
 * client Prisma jamais généré. Renvoie ce qui a été fait (vide : rien à réparer ici, la cause est ailleurs).
 */
export async function repairForHook(cwd: string, output: string, log: (text: string) => void): Promise<string[]> {
  const done: string[] = []
  const prisma = PRISMA_MISSING.test(output)
  const noModules = !existsSync(join(cwd, 'node_modules'))
  if ((prisma && noModules) || (noModules && DEPS_MISSING.test(output))) {
    log('Le worktree n’a pas ses dépendances : installation avant de retenter le commit.')
    if (await installDeps(cwd, log)) done.push('dépendances installées')
  }
  if (prisma) {
    log('Le client Prisma n’est pas généré dans ce worktree : génération avant de retenter le commit.')
    const generated = await git.generatePrismaClients(cwd, log).catch((e) => { log(`Génération Prisma en échec :\n${tail(e, 10)}`); return [] })
    if (generated.length) done.push(`client Prisma généré (${generated.join(', ')})`)
  }
  return done
}
