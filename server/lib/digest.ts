import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { DigestInfo, Project } from '../../shared/types.ts'
import { DATA_DIR } from './config.ts'
import { run } from './exec.ts'

// Digest d'un dépôt, à la manière de gitingest : résumé, arborescence et contenu des fichiers, en un seul texte
// que l'agent lit. Complet pour un petit projet ; au-delà du budget, seulement la carte (arborescence + fichiers
// structurants) : l'agent lit alors le reste du code lui-même. Mis en cache par commit.

export const DIGESTS_DIR = join(DATA_DIR, 'digests')
mkdirSync(DIGESTS_DIR, { recursive: true })

/** Au-delà, le contenu complet ne tient plus dans ce qu'un agent lit utilement : on passe à la carte. */
const FULL_BUDGET = 200_000
/** Fichier ignoré au-delà de cette taille (données, fixtures, fichiers générés). */
const MAX_FILE = 150_000

/** Fichiers en surplus : dépendances verrouillées, binaires, médias, sorties de build, générés, secrets. */
const EXCLUDE = [
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|Cargo\.lock|poetry\.lock|Gemfile\.lock|composer\.lock|Podfile\.lock)$/,
  /\.(png|jpe?g|gif|webp|avif|ico|icns|bmp|tiff?|psd|svg|mp[34]|mov|avi|webm|wav|ogg|m4a|pdf|zip|gz|tgz|rar|7z|jar|aar|apk|ipa|keystore|jks|p12|pem|ttf|otf|woff2?|eot|bin|exe|dll|so|dylib|wasm|db|sqlite)$/i,
  /\.(snap|min\.js|min\.css|map)$/,
  /(^|\/)(dist|build|out|\.next|\.expo|\.turbo|coverage|node_modules|vendor|Pods|\.gradle|generated|__generated__|\.cache)\//,
  /(^|\/)\.env(\.|$)/,
]

/** Fichiers structurants, gardés dans la carte : de quoi comprendre le projet sans tout lire. */
const KEY = [
  /(^|\/)(README|CLAUDE|AGENTS|CONTRIBUTING|ARCHITECTURE)(\.md)?$/i,
  /(^|\/)package\.json$/,
  /(^|\/)(tsconfig|biome|turbo|nx|app|eas)\.json$/,
  /(^|\/)app\.config\.[jt]s$/,
  /(^|\/)(docker-compose|compose)\.ya?ml$/,
  /\.prisma$/,
  /(^|\/)(routes?|router)\.[jt]sx?$/,
  /(^|\/)docs\/[^/]+\.md$/,
]

const est = (chars: number) => Math.round(chars / 4)

function tree(paths: string[], name: string): string {
  type Node = Map<string, Node>
  const root: Node = new Map()
  for (const p of paths) {
    let n = root
    for (const part of p.split('/')) n = n.get(part) ?? n.set(part, new Map()).get(part)!
  }
  const lines = [`└── ${name}/`]
  const walk = (n: Node, prefix: string) => {
    const entries = [...n.entries()].sort(([a, x], [b, y]) => Number(!x.size) - Number(!y.size) || a.localeCompare(b))
    entries.forEach(([k, child], i) => {
      const last = i === entries.length - 1
      lines.push(`${prefix}${last ? '└── ' : '├── '}${k}${child.size ? '/' : ''}`)
      if (child.size) walk(child, `${prefix}${last ? '    ' : '│   '}`)
    })
  }
  walk(root, '    ')
  return lines.join('\n')
}

const isText = (buf: Buffer) => !buf.subarray(0, 8000).includes(0)

/**
 * Construit (ou reprend du cache) le digest du dépôt local du projet. mode : 'auto' choisit le contenu complet
 * s'il tient dans le budget, sinon la carte.
 */
export async function buildDigest(project: Project, mode: 'auto' | 'full' | 'map' = 'auto'): Promise<DigestInfo> {
  const cwd = project.path
  const sha = (await run('git', ['rev-parse', 'HEAD'], { cwd })).trim()
  const branch = (await run('git', ['branch', '--show-current'], { cwd }).catch(() => '')).trim() || 'détachée'
  const all = (await run('git', ['ls-files', '-z'], { cwd })).split('\0').filter(Boolean)
  const files: { path: string; content: string }[] = []
  let excluded = 0
  for (const p of all) {
    const abs = join(cwd, p)
    if (EXCLUDE.some((r) => r.test(p)) || !existsSync(abs)) { excluded++; continue }
    const size = statSync(abs).size
    if (size > MAX_FILE) { excluded++; continue }
    const buf = readFileSync(abs)
    if (!isText(buf)) { excluded++; continue }
    files.push({ path: p, content: buf.toString('utf8') })
  }
  const total = est(files.reduce((a, f) => a + f.content.length + f.path.length + 120, 0))
  const chosen = mode === 'auto' ? (total <= FULL_BUDGET ? 'full' : 'map') : mode
  const file = join(DIGESTS_DIR, `${project.id}-${sha.slice(0, 12)}-${chosen}.txt`)
  const kept = chosen === 'full' ? files : files.filter((f) => KEY.some((r) => r.test(f.path)))

  if (!existsSync(file)) {
    const header = [
      `Repository: ${project.repo}`,
      `Branch: ${branch === 'détachée' ? 'detached' : branch} · commit ${sha.slice(0, 12)}`,
      `Files analyzed: ${files.length} (${excluded} excluded: lockfiles, binaries, media, builds, generated, > ${MAX_FILE / 1000} KB)`,
      `Estimated tokens (all files): ${total}`,
      chosen === 'full'
        ? 'Content: every analyzed file below.'
        : `Content: project map only (${kept.length} key files). The repository is too large for a full digest: read other files directly from ${cwd}.`,
    ].join('\n')
    const body = kept.map((f) => `================================================\nFILE: ${f.path}\n================================================\n${f.content}`).join('\n\n')
    writeFileSync(file, `${header}\n\nDirectory structure:\n${tree(files.map((f) => f.path), basename(cwd))}\n\n${body}\n`)
  }
  return {
    path: file,
    mode: chosen,
    sha: sha.slice(0, 12),
    branch,
    files: files.length,
    excluded,
    totalTokens: total,
    digestTokens: est(readFileSync(file, 'utf8').length),
    fullPossible: total <= FULL_BUDGET,
  }
}
