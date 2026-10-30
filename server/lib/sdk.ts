import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { SdkStatus } from '../../shared/types.ts'
import { loadProjects } from './config.ts'
import { ttlCache } from './exec.ts'
import * as git from './git.ts'
import * as gh from './github.ts'
import { warnOn } from './log.ts'

// Paquets privés publiés sur GitHub Packages par un autre dépôt suivi (ex. @acme/sdk, publié par app) :
// sert à la CI quand la branche dépend d'une version du SDK qui n'est pas (encore) installée ou publiée.

const statusCache = ttlCache<SdkStatus[]>(60_000)
/** « Tout actualiser » : l'état des SDK est relu au prochain affichage. */
export const clearSdkCache = () => statusCache.clear()

/** Scopes servis par GitHub Packages d'après le .npmrc (ex. @acme). */
function githubScopes(cwd: string): string[] {
  const npmrc = join(cwd, '.npmrc')
  if (!existsSync(npmrc)) return []
  return [...readFileSync(npmrc, 'utf8').matchAll(/^\s*(@[\w-]+):registry\s*=\s*https:\/\/npm\.pkg\.github\.com/gm)].map((m) => m[1].toLowerCase())
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

/** Version figée par le lockfile (bun, npm, pnpm), sinon celle installée dans node_modules. */
export function lockedVersion(cwd: string, name: string): string | null {
  const read = (f: string) => (existsSync(join(cwd, f)) ? readFileSync(join(cwd, f), 'utf8') : null)
  const bun = read('bun.lock')
  const fromBun = bun?.match(new RegExp(`"${escapeRegExp(name)}": \\["${escapeRegExp(name)}@([^"]+)"`))?.[1]
  if (fromBun) return fromBun
  const npm = read('package-lock.json')
  if (npm) {
    const v = (JSON.parse(npm) as { packages?: Record<string, { version?: string }> }).packages?.[`node_modules/${name}`]?.version
    if (v) return v
  }
  const fromPnpm = read('pnpm-lock.yaml')?.match(new RegExp(`['/]?${escapeRegExp(name)}@(\\d+\\.\\d+\\.\\d+[^:('\\s]*)`))?.[1]
  if (fromPnpm) return fromPnpm
  const installed = read(`node_modules/${name}/package.json`)
  return installed ? ((JSON.parse(installed) as { version?: string }).version ?? null) : null
}

/** Gestionnaire de paquets du dépôt, d'après son lockfile. */
export function packageManager(cwd: string): 'bun' | 'pnpm' | 'npm' | 'yarn' {
  if (existsSync(join(cwd, 'bun.lock')) || existsSync(join(cwd, 'bun.lockb'))) return 'bun'
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn'
  return 'npm'
}

/** Dossier du paquet dans le dépôt source (le package.json qui porte ce nom), à la révision donnée. */
async function packageDir(cwd: string, ref: string, name: string): Promise<string | null> {
  const candidates = (await git.filesAt(cwd, ref)).filter((f) => basename(f) === 'package.json' && !f.includes('node_modules/'))
  for (const f of candidates) {
    const content = await git.showFile(cwd, ref, f)
    if (content && (JSON.parse(content) as { name?: string }).name === name) return dirname(f)
  }
  return null
}

/** Workflow qui publie le paquet : celui qui surveille son dossier et lance une publication. */
async function publishWorkflow(cwd: string, ref: string, dir: string): Promise<{ file: string; dispatchable: boolean } | null> {
  const files = (await git.filesAt(cwd, ref)).filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f))
  for (const f of files) {
    const content = await git.showFile(cwd, ref, f)
    if (content?.includes(`${dir}/**`) && /semantic-release|npm publish|bun publish|changeset publish/.test(content)) {
      return { file: basename(f), dispatchable: /^\s*workflow_dispatch\s*:/m.test(content) }
    }
  }
  return null
}

async function statusOf(name: string, range: string, cwd: string): Promise<SdkStatus> {
  const [scope, pkg] = name.split('/')
  const org = scope.slice(1)
  const [latest, sourceRepo] = await Promise.all([gh.packageLatest(org, pkg), gh.packageRepo(org, pkg)])
  const source = sourceRepo ? loadProjects().find((p) => p.repo.toLowerCase() === sourceRepo.toLowerCase()) ?? null : null
  const status: SdkStatus = {
    name, range, locked: lockedVersion(cwd, name), latest: latest?.version ?? null, latestAt: latest?.at ?? null,
    sourceRepo, sourceProject: source?.id ?? null, sourceBranch: source?.baseBranch ?? null, unpublished: null, workflow: null, lastRun: null,
  }
  if (!source || !sourceRepo) return status
  // Dépôt source suivi par Shipyard : son clone local dit ce qui attend d'être publié et quel workflow publie.
  const ref = `origin/${source.baseBranch}`
  await git.fetchWithTags(source.path, source.baseBranch).catch(() => undefined)
  const dir = await packageDir(source.path, ref, name)
  if (!dir) return status
  if (latest) {
    const tag = (await git.tagsMatching(source.path, `*v${latest.version}`))[0]
    if (tag) status.unpublished = await git.mainlineSubjects(source.path, `${tag}..${ref}`, dir).catch(() => null)
  }
  status.workflow = await publishWorkflow(source.path, ref, dir)
  if (status.workflow) {
    const run = (await gh.workflowRuns(sourceRepo, status.workflow.file, 1).catch(warnOn('gh.workflowRuns', [])))[0]
    if (run) status.lastRun = { status: run.status, conclusion: run.conclusion, createdAt: run.createdAt, url: run.url, published: !!latest && latest.at > run.createdAt }
  }
  return status
}

/** Paquets GitHub Packages dont dépend le worktree, avec leur état de publication. Cache d'une minute. */
export function sdkStatus(cwd: string, force = false): Promise<SdkStatus[]> {
  return statusCache.get(cwd, async () => {
    const scopes = githubScopes(cwd)
    if (!scopes.length || !existsSync(join(cwd, 'package.json'))) return []
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
    const deps = Object.entries({ ...pkg.devDependencies, ...pkg.dependencies }).filter(([n]) => scopes.some((s) => n.toLowerCase().startsWith(`${s}/`)))
    return Promise.all(deps.map(([n, range]) => statusOf(n, range, cwd)))
  }, force)
}
