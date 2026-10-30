import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { Project } from '../../shared/types.ts'
import { writeFileAtomic } from './atomicWrite.ts'

export const ROOT = resolve(import.meta.dirname, '../..')
export const DATA_DIR = join(ROOT, '.data')
export const RUNS_DIR = join(DATA_DIR, 'runs')
/** Captures avant/après des runs « ticket », supprimées dès que je décide. */
export const SHOTS_DIR = join(DATA_DIR, 'shots')
/** Copies temporaires du code (captures « avant » d'un re-test), hors des worktrees du projet. */
export const CHECKOUTS_DIR = join(DATA_DIR, 'checkouts')
/** Vidéos des tests (complète et courte), par run : gardées 14 jours pour pouvoir les transmettre. */
export const VIDEOS_DIR = join(DATA_DIR, 'videos')
const PROJECTS_FILE = join(DATA_DIR, 'projects.json')

mkdirSync(RUNS_DIR, { recursive: true })
mkdirSync(SHOTS_DIR, { recursive: true })
mkdirSync(VIDEOS_DIR, { recursive: true })
for (const d of readdirSync(VIDEOS_DIR)) {
  const p = join(VIDEOS_DIR, d)
  if (Date.now() - statSync(p).mtimeMs > 14 * 86_400_000) rmSync(p, { recursive: true, force: true })
}

// Filet de sécurité : les captures sans décision au bout de 7 jours sont supprimées.
for (const d of readdirSync(SHOTS_DIR)) {
  const p = join(SHOTS_DIR, d)
  if (Date.now() - statSync(p).mtimeMs > 7 * 86_400_000) rmSync(p, { recursive: true, force: true })
}

loadEnvFile(join(ROOT, '.env.local'))

function loadEnvFile(file: string) {
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

export const PORT = Number(process.env.PORT ?? 4317)

export function expandHome(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p
}

/** Dossier où cloner un projet ajouté sans chemin local. */
export const PROJECTS_ROOT = process.env.PROJECTS_ROOT || '~/shipyard/projects'

export function defaultWorktreeRoot(projectName: string): string {
  const tpl = process.env.WORKTREE_ROOT || '~/shipyard/worktrees/{project}'
  return expandHome(tpl.replace('{project}', projectName))
}

export function loadProjects(): Project[] {
  if (!existsSync(PROJECTS_FILE)) return []
  return JSON.parse(readFileSync(PROJECTS_FILE, 'utf8')) as Project[]
}

export function saveProjects(projects: Project[]) {
  writeFileAtomic(PROJECTS_FILE, JSON.stringify(projects, null, 2))
}

export function getProject(id: string): Project {
  const p = loadProjects().find((x) => x.id === id)
  if (!p) throw new HttpError(404, `Projet inconnu : ${id}`)
  return p
}

export class HttpError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    message: string,
  ) {
    super(message)
  }
}

/** Identifiant d'URL stable pour un chemin de worktree. */
export const encodeId = (path: string) => Buffer.from(path).toString('base64url')
export const decodeId = (id: string) => Buffer.from(id, 'base64url').toString('utf8')
