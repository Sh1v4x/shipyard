import { existsSync } from 'node:fs'
import { decodeId } from './config.ts'
import { jsonFile } from './store.ts'

// Mémoire des tests, sur deux niveaux, relue au début de chaque test pour ne pas refaire les mêmes erreurs :
// - projet : valable pour toutes les branches (lancer l'app, environnement, base, connexion, outils) ;
// - branche : propre au worktree en cours (données créées pour son ticket, pièges de son code), retirée avec lui.
// Les deux se modifient à la main dans l'onglet Tests.

interface Memory { projects: Record<string, string>; branches: Record<string, string> }

const file = jsonFile<Memory | Record<string, string>>('test-memory.json', { projects: {}, branches: {} })

/** Lit le fichier ; l'ancien format (un texte par projet) devient la mémoire de projet. */
function read(): Memory {
  const raw = file.read()
  if ('projects' in raw && typeof raw.projects === 'object') return raw as Memory
  return { projects: raw as Record<string, string>, branches: {} }
}

/** Au-delà, les leçons les plus anciennes sont retirées. */
const MAX_PROJECT = 40
const MAX_BRANCH = 20

export const projectTestMemory = (project: string) => read().projects[project] ?? ''
export const branchTestMemory = (worktree: string) => read().branches[worktree] ?? ''

export function saveProjectTestMemory(project: string, text: string) {
  const m = read()
  file.write({ ...m, projects: { ...m.projects, [project]: text.trim() } })
}

export function saveBranchTestMemory(worktree: string, text: string) {
  const m = read()
  const branches = { ...m.branches, [worktree]: text.trim() }
  if (!text.trim()) delete branches[worktree]
  // Ménage : les worktrees supprimés depuis n'ont plus de mémoire.
  for (const id of Object.keys(branches)) if (!existsSync(decodeId(id))) delete branches[id]
  file.write({ ...m, branches })
}

/** Ajoute des leçons (une ligne « - … » chacune) à un texte, sans doublon, en gardant les plus récentes. */
function append(text: string, lessons: string[], max: number): string {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const known = new Set(lines.map((l) => l.replace(/^- /, '').toLowerCase()))
  for (const l of lessons.map((x) => x.trim()).filter(Boolean)) {
    if (known.has(l.toLowerCase())) continue
    known.add(l.toLowerCase())
    lines.push(`- ${l}`)
  }
  const bullets = lines.filter((l) => l.startsWith('- '))
  return (bullets.length > max ? [...lines.filter((l) => !l.startsWith('- ')), ...bullets.slice(-max)] : lines).join('\n')
}

/** Leçons d'un test, rangées selon leur portée. */
export function addTestLessons(project: string, worktree: string, lessons: { scope: 'project' | 'branch'; text: string }[]) {
  const forProject = lessons.filter((l) => l.scope === 'project').map((l) => l.text)
  const forBranch = lessons.filter((l) => l.scope === 'branch').map((l) => l.text)
  if (forProject.length) saveProjectTestMemory(project, append(projectTestMemory(project), forProject, MAX_PROJECT))
  if (forBranch.length) saveBranchTestMemory(worktree, append(branchTestMemory(worktree), forBranch, MAX_BRANCH))
}
