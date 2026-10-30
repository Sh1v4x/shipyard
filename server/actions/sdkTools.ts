import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SdkStatus, WorktreeDetail } from '../../shared/types.ts'
import type { JobContext } from '../lib/claude.ts'
import { run } from '../lib/exec.ts'
import * as gh from '../lib/github.ts'
import { lockedVersion, packageManager, sdkStatus } from '../lib/sdk.ts'
import { HookRefused, commitAndPush, hookOutput, toBlocked } from './commitFlow.ts'
import { sleep } from './context.ts'
import { warnOn } from '../lib/log.ts'

/**
 * Remet node_modules d'accord avec le lockfile (celui de la fusion) avant un commit de fusion : le typecheck du hook
 * tourne sur node_modules, et une fusion apporte souvent des dépendances nouvelles ou plus récentes (SDK privé compris,
 * lu avec le jeton de gh). Un échec n'arrête rien : le hook dira ce qui manque.
 */
export async function installDeps(cwd: string, log: (text: string) => void) {
  if (!existsSync(join(cwd, 'package.json'))) return
  const pm = packageManager(cwd)
  log(`Dépendances : ${pm} install (accord avec le lockfile de la fusion)…`)
  const env = { ...process.env, NODE_AUTH_TOKEN: await gh.authToken().catch(() => ''), PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}` }
  await run(pm, ['install'], { cwd, timeoutMs: 600_000, env }).then(
    () => log('Dépendances à jour.'),
    (e) => log(`Installation des dépendances en échec, le commit est tenté quand même :\n${hookOutput(e).split('\n').slice(-10).join('\n')}`),
  )
}

/** Installe la version donnée d'un paquet GitHub Packages (contrainte ^version), sans commiter. Jeton de gh en NODE_AUTH_TOKEN. */
async function installSdk(ctx: JobContext, cwd: string, name: string, version: string) {
  const pm = packageManager(cwd)
  const spec = `${name}@^${version}`
  const args = pm === 'npm' ? ['install', spec] : ['add', spec]
  ctx.log({ t: 'info', text: `${pm} ${args.join(' ')}…` })
  const env = { ...process.env, NODE_AUTH_TOKEN: await gh.authToken(), PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}` }
  try {
    await run(pm, args, { cwd, timeoutMs: 600_000, env })
  } catch (e) {
    throw new Error(`Installation de ${spec} en échec :\n${hookOutput(e).split('\n').slice(-20).join('\n')}`)
  }
  ctx.log({ t: 'info', text: `${name} figé en ${lockedVersion(cwd, name) ?? '?'}` })
}

/** Installe une version d'un SDK, commite package.json et le lockfile, et pousse : la CI se relance. */
export async function updateSdk(ctx: JobContext, d: WorktreeDetail, name: string, version: string): Promise<string | null> {
  await installSdk(ctx, d.worktree.path, name, version)
  const title = `chore(deps): bump ${name} to ${version}`
  try {
    const url = await commitAndPush(d, title)
    ctx.log({ t: 'info', text: url ? `Poussé, la CI va se relancer : ${url}` : 'Rien à commiter.' })
    return url
  } catch (e) {
    if (!(e instanceof HookRefused)) throw e
    ctx.run.blockedCommit = toBlocked(e, title, [], [])
    ctx.log({ t: 'error', text: e.message })
    return null
  }
}

/**
 * Avant le commit de fusion de « Récupérer <base> » : chaque SDK privé passe à sa dernière version, après l'avoir fait
 * publier si son dépôt source a des merges non publiés (et accepte une publication à la demande). Le changement de
 * version part dans le commit de fusion : le typecheck du hook voit le SDK dont la base a besoin.
 */
export async function refreshSdks(ctx: JobContext, cwd: string) {
  for (const st of await sdkStatus(cwd, true)) {
    let target = st.latest
    if (st.unpublished?.length) {
      if (st.workflow?.dispatchable) {
        ctx.log({ t: 'info', text: `${st.name} : ${st.unpublished.length} merge(s) non publiés dans ${st.sourceRepo}, publication d’abord…` })
        target = await publishSdk(ctx, st).catch((e: Error) => {
          ctx.log({ t: 'error', text: `${e.message} On continue avec ${st.latest}.` })
          return st.latest
        })
      } else {
        ctx.log({ t: 'error', text: `${st.name} : ${st.unpublished.length} merge(s) de ${st.sourceRepo} ne sont pas publiés, et ${st.workflow?.file ?? 'son workflow'} ne se lance pas à la demande : la dernière version publiée (${st.latest}) peut ne pas suffire.` })
      }
    }
    if (target && st.locked !== target) await installSdk(ctx, cwd, st.name, target)
    else if (target) ctx.log({ t: 'info', text: `${st.name} déjà en ${target}.` })
  }
}

/**
 * Fait publier un SDK par son dépôt source (workflow lancé à la demande) et attend la nouvelle version.
 * Renvoie la version publiée ; erreur si le workflow échoue ou ne publie rien.
 */
export async function publishSdk(ctx: JobContext, st: SdkStatus): Promise<string> {
  const wf = st.workflow
  if (!wf?.dispatchable || !st.sourceRepo || !st.sourceBranch) throw new Error(`${st.name} ne peut pas être publié à la demande`)
  const [org, pkg] = [st.name.split('/')[0].slice(1), st.name.split('/')[1]]
  const startedAt = Date.now()
  await gh.dispatchWorkflow(st.sourceRepo, wf.file, st.sourceBranch)
  ctx.log({ t: 'info', text: `${wf.file} lancé sur ${st.sourceRepo}@${st.sourceBranch}…` })
  // Le passage apparaît quelques secondes après le lancement.
  let ghRun: gh.WorkflowRun | undefined
  for (let i = 0; i < 24 && !ghRun && !ctx.cancelled(); i++) {
    await sleep(5000)
    ghRun = (await gh.workflowRuns(st.sourceRepo, wf.file, 5).catch(warnOn('gh.workflowRuns', []))).find((r) => r.event === 'workflow_dispatch' && Date.parse(r.createdAt) >= startedAt - 10_000)
  }
  if (!ghRun) throw new Error('Le passage du workflow n’est pas apparu sur GitHub au bout de 2 minutes.')
  ctx.log({ t: 'info', text: `Publication en cours : ${ghRun.url}` })
  for (let i = 0; i < 120 && ghRun.status !== 'completed' && !ctx.cancelled(); i++) {
    await sleep(15_000)
    ghRun = (await gh.workflowRuns(st.sourceRepo, wf.file, 5).catch(warnOn('gh.workflowRuns', []))).find((r) => r.id === ghRun!.id) ?? ghRun
  }
  if (ctx.cancelled()) throw new Error('Arrêté.')
  if (ghRun.status !== 'completed') throw new Error(`Publication toujours en cours après 30 minutes : ${ghRun.url}`)
  if (ghRun.conclusion !== 'success') throw new Error(`La publication a échoué (${ghRun.conclusion}) : ${ghRun.url}`)
  // Le registre peut mettre un moment à exposer la nouvelle version.
  let latest = await gh.packageLatest(org, pkg)
  for (let i = 0; i < 8 && latest?.version === st.latest; i++) {
    await sleep(15_000)
    latest = await gh.packageLatest(org, pkg)
  }
  if (!latest || latest.version === st.latest) {
    throw new Error(`Le workflow a réussi mais aucune nouvelle version n’est sortie (toujours ${st.latest}) : semantic-release n’a rien trouvé à publier, ou ${st.sourceBranch} a bougé pendant le passage. Relance la publication. ${ghRun.url}`)
  }
  ctx.log({ t: 'info', text: `${st.name} ${latest.version} publié.` })
  return latest.version
}
