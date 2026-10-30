import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PromptInfo } from '../../shared/types.ts'
import { HttpError, ROOT } from './config.ts'
import { list, parseFrontMatter, serializeFrontMatter, str } from './markdown.ts'
import { keepVersion } from './promptHistory.ts'
import { languageVars } from './settings.ts'

/** Prompts livrés avec Shipyard (versionnés). */
const DIR = join(ROOT, 'prompts')
/**
 * Mes versions des prompts, jamais versionnées (.gitignore) : une modification faite depuis la page Prompts
 * arrive ici, et remplace le prompt livré du même nom. « Rétablir » la retire.
 */
const LOCAL_DIR = join(ROOT, 'prompts.local')
const AGENTS_DIR = join(ROOT, 'agents')

export interface PromptDef extends Omit<PromptInfo, 'content' | 'defaultContent' | 'modified' | 'cost'> {
  disallowedTools: string[]
  agents: string[]
  /** Fichiers à ne jamais commiter (nom de fichier), appliqué par le serveur. */
  exclude: string[]
  body: string
}

const shippedFile = (key: string) => join(DIR, `${key}.md`)
const localFile = (key: string) => join(LOCAL_DIR, `${key}.md`)

/** La clé vient de l'URL : sans ce contrôle, `..%2F` écrirait hors de prompts/. */
const fileOf = (key: string) => {
  if (!/^[a-z0-9_-]+$/.test(key) || !existsSync(shippedFile(key))) throw new HttpError(404, `Prompt inconnu : ${key}`)
  return existsSync(localFile(key)) ? localFile(key) : shippedFile(key)
}

export function loadPrompt(key: string): PromptDef {
  const file = fileOf(key)
  const { meta, body } = parseFrontMatter(readFileSync(file, 'utf8'))
  return {
    key,
    name: str(meta.name, key),
    group: str(meta.group, 'Autres'),
    when: str(meta.when),
    vars: list(meta.vars),
    model: str(meta.model) || null,
    permissionMode: str(meta.permissionMode, 'default'),
    allowedTools: list(meta.allowedTools),
    disallowedTools: list(meta.disallowedTools),
    agents: list(meta.agents),
    exclude: list(meta.exclude),
    body: body.trim(),
  }
}

/** Texte du prompt livré. */
const defaultBody = (key: string) => parseFrontMatter(readFileSync(shippedFile(key), 'utf8')).body.trim()

/** Prompts sans leur coût : il vient des runs (voir promptCosts). */
export async function listPrompts(): Promise<Omit<PromptInfo, 'cost'>[]> {
  const keys = readdirSync(DIR)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
    .map((f) => f.slice(0, -3))
  return Promise.all(
    keys.map(async (key) => {
      const { body, disallowedTools: _d, agents: _a, exclude: _x, ...def } = loadPrompt(key)
      const d = defaultBody(key)
      return { ...def, content: body, defaultContent: d, modified: d !== body }
    }),
  )
}

export function savePrompt(key: string, content: string) {
  const file = fileOf(key)
  const { meta, body } = parseFrontMatter(readFileSync(file, 'utf8'))
  keepVersion('prompt', key, body.trim(), content)
  mkdirSync(LOCAL_DIR, { recursive: true })
  writeFileSync(localFile(key), serializeFrontMatter(meta, `\n${content.trim()}\n`))
}

/** Revient au prompt livré en retirant ma version locale. */
export function resetPrompt(key: string) {
  keepVersion('prompt', key, loadPrompt(key).body, '')
  rmSync(localFile(key), { force: true })
}

/**
 * Remplace `{var}` par sa valeur. Les variables absentes restent visibles pour que l'agent le signale ;
 * une variable fournie vide (section optionnelle, ex. dépôts liés) disparaît avec sa ligne.
 */
export function fill(tpl: string, vars: Record<string, string | number | null | undefined>): string {
  return tpl
    .replace(/\{([a-z][a-z0-9_.]*)\}/gi, (m, k: string) => {
      const v = vars[k]
      return v == null ? m : String(v)
    })
    .replace(/\n{3,}/g, '\n\n')
}

export function systemPrompt(): string {
  return fill(readFileSync(fileOf('_system'), 'utf8').trim(), languageVars())
}

/** agents/*.md → objet attendu par `claude --agents`. */
export function loadAgents(names?: string[]): Record<string, { description: string; prompt: string; tools?: string[]; model?: string }> {
  const out: Record<string, { description: string; prompt: string; tools?: string[]; model?: string }> = {}
  for (const f of readdirSync(AGENTS_DIR).filter((x) => x.endsWith('.md'))) {
    const { meta, body } = parseFrontMatter(readFileSync(join(AGENTS_DIR, f), 'utf8'))
    const name = str(meta.name, f.slice(0, -3))
    if (names && !names.includes(name)) continue
    const tools = list(meta.tools)
    out[name] = { description: str(meta.description), prompt: fill(body.trim(), languageVars()), ...(tools.length ? { tools } : {}), ...(meta.model ? { model: str(meta.model) } : {}) }
  }
  return out
}
