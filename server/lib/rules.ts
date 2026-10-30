import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PromptInfo } from '../../shared/types.ts'
import { HttpError, ROOT } from './config.ts'
import { list, parseFrontMatter, serializeFrontMatter, str } from './markdown.ts'
import { keepVersion } from './promptHistory.ts'

// Règles de dev utilisées par la review : un fichier par thème, éditables depuis la page Prompts.
// `projects: [all]` ou la liste des projets concernés (ids du panel).

/** Règles livrées avec Shipyard (versionnées). */
const DIR = join(ROOT, 'rules')
/**
 * Règles de mon équipe, jamais versionnées (.gitignore) : mes propres règles, et mes versions des règles livrées.
 * Une règle locale remplace la règle livrée du même nom.
 */
const LOCAL_DIR = join(ROOT, 'rules.local')

const checkKey = (key: string) => {
  if (!/^[a-z0-9-]+$/.test(key)) throw new HttpError(400, `Nom de règle invalide : ${key}`)
  return key
}
const localFile = (key: string) => join(LOCAL_DIR, `${checkKey(key)}.md`)
const fileOf = (key: string) => (existsSync(localFile(key)) ? localFile(key) : join(DIR, `${checkKey(key)}.md`))

function load(key: string) {
  const file = fileOf(key)
  if (!existsSync(file)) throw new HttpError(404, `Règle inconnue : ${key}`)
  const { meta, body } = parseFrontMatter(readFileSync(file, 'utf8'))
  return { key, name: str(meta.name, key), projects: list(meta.projects), body: body.trim(), meta }
}

const mdKeys = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)) : [])
const keys = () => [...new Set([...mdKeys(DIR), ...mdKeys(LOCAL_DIR)])].sort()
const applies = (projects: string[], projectId: string) => projects.includes('all') || projects.includes(projectId)

/** Texte des règles qui s'appliquent au projet, à injecter dans le prompt de review. */
export function rulesFor(projectId: string): string {
  const parts = keys().map(load).filter((r) => applies(r.projects, projectId))
  return parts.length ? parts.map((r) => `### ${r.name}\n\n${r.body}`).join('\n\n') : '(no rule defined for this project: follow the repository CLAUDE.md)'
}

/** Texte de la règle livrée, null pour une règle qui n'existe qu'en local. */
function defaultBody(key: string): string | null {
  const file = join(DIR, `${key}.md`)
  return existsSync(file) ? parseFrontMatter(readFileSync(file, 'utf8')).body.trim() : null
}

export async function listRules(): Promise<PromptInfo[]> {
  return Promise.all(keys().map(async (key) => {
    const r = load(key)
    const d = defaultBody(key) ?? r.body
    return {
      key, name: r.name, group: 'Règles de review', source: 'rule' as const, projects: r.projects,
      when: `S’applique à : ${r.projects.includes('all') ? 'tous les projets' : r.projects.join(', ')}`,
      vars: [], model: null, permissionMode: '', allowedTools: [], content: r.body, defaultContent: d, modified: d !== r.body, cost: null,
    }
  }))
}

export function saveRule(key: string, content: string, projects?: string[]) {
  const r = load(key)
  const meta = { ...r.meta, ...(projects ? { projects } : {}) }
  keepVersion('rule', key, r.body, content)
  // Une modification va toujours dans rules.local/ : la règle livrée reste intacte, « Rétablir » la retrouve.
  mkdirSync(LOCAL_DIR, { recursive: true })
  writeFileSync(localFile(key), serializeFrontMatter(meta, `\n${content.trim()}\n`))
}

export const ruleBody = (key: string) => load(key).body

/** Revient à la règle livrée en retirant ma version locale. Une règle qui n'existe qu'en local reste telle quelle. */
export function resetRule(key: string) {
  load(key)
  if (!existsSync(join(DIR, `${key}.md`))) return
  keepVersion('rule', key, ruleBody(key), '')
  rmSync(localFile(key), { force: true })
}

export function createRule(name: string, projects: string[]): string {
  const key = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'regle'
  if (existsSync(fileOf(key))) throw new HttpError(409, `La règle ${key} existe déjà`)
  mkdirSync(LOCAL_DIR, { recursive: true })
  writeFileSync(localFile(key), serializeFrontMatter({ name, projects: projects.length ? projects : ['all'] }, '\n## Nouvelle règle\nDécris ici la règle, et ce qui est accepté ou interdit.\n'))
  return key
}
