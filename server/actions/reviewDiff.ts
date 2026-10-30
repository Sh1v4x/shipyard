import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PrReviewOutput, ReviewOutput, ReviewComment, Finding } from '../../shared/types.ts'

/** Au-delà, la PR est relue en plusieurs lots : un agent ne lit vraiment qu'un diff de taille raisonnable. */
const LOT_FILES = 40

const LOT_LINES = 3000

const SEVERITY_RANK = { bloquant: 0, important: 1, suggestion: 2 } as const

/** Fichiers sans intérêt pour une review : lockfiles, snapshots, sources générées. */
const NOISE = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?)$|\.snap$|\.min\.(js|css)$|(^|\/)(generated|__generated__)\//

/** Mono-repo = plusieurs applications dans le dépôt (apps-v2/*, apps/*, packages/). */
export const isMonorepo = (path: string) => existsSync(join(path, 'apps-v2')) || (existsSync(join(path, 'apps')) && existsSync(join(path, 'packages')))

function zoneOf(path: string): string {
  const m = path.match(/^apps(?:-v2)?\/([^/]+)\//)
  if (m) return m[1] === 'api' ? 'API' : m[1].charAt(0).toUpperCase() + m[1].slice(1)
  if (path.startsWith('packages/')) return 'SDK'
  return 'Racine'
}

/** Dossier commun d'une liste de chemins (2 niveaux au plus), pour nommer un lot. */
function commonDir(paths: string[]): string {
  const parts = paths.map((p) => p.split('/').slice(0, -1))
  const out: string[] = []
  for (let i = 0; i < 3; i++) {
    const seg = parts[0]?.[i]
    if (!seg || parts.some((p) => p[i] !== seg)) break
    out.push(seg)
  }
  return out.join('/') || '.'
}

export type Lot = { name: string; diff: string; files: number; lines: number }

/**
 * Découpe un diff unifié en lots : par zone dans le mono-repo, puis par taille (fichiers triés par chemin,
 * pour garder un dossier ensemble). Les fichiers de bruit sont écartés.
 */
export function splitIntoLots(diff: string, monorepo: boolean): { lots: Lot[]; skipped: string[] } {
  const groups = new Map<string, { path: string; block: string }[]>()
  const skipped: string[] = []
  for (const block of diff.split(/^(?=diff --git )/m)) {
    const path = block.match(/^diff --git a\/.+? b\/(.+)$/m)?.[1]
    if (!path) continue
    if (NOISE.test(path)) { skipped.push(path); continue }
    const g = monorepo ? zoneOf(path) : ''
    groups.set(g, [...(groups.get(g) ?? []), { path, block }])
  }
  const lots: Lot[] = []
  for (const [zone, files] of groups) {
    files.sort((a, b) => a.path.localeCompare(b.path))
    let cur: typeof files = []
    let lines = 0
    const flush = () => {
      if (!cur.length) return
      const dir = commonDir(cur.map((f) => f.path))
      lots.push({ name: [zone, dir === '.' ? '' : dir].filter(Boolean).join(' · ') || 'Racine', diff: cur.map((f) => f.block).join(''), files: cur.length, lines })
      cur = []
      lines = 0
    }
    for (const f of files) {
      const n = f.block.split('\n').length
      if (cur.length && (cur.length >= LOT_FILES || lines + n > LOT_LINES)) flush()
      cur.push(f)
      lines += n
    }
    flush()
  }
  return { lots, skipped }
}

/** Lignes commentables du diff (côté droit : ajoutées ou de contexte), par fichier. */
export function diffLines(diff: string): Map<string, number[]> {
  const out = new Map<string, number[]>()
  for (const block of diff.split(/^(?=diff --git )/m)) {
    const file = block.match(/^diff --git a\/.+? b\/(.+)$/m)?.[1]
    if (!file) continue
    const lines: number[] = []
    let n: number | null = null
    for (const l of block.split('\n')) {
      const h = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)/)
      if (h) n = Number(h[1])
      else if (n != null && (l.startsWith('+') || l.startsWith(' ')) && !l.startsWith('+++')) lines.push(n++)
    }
    out.set(file, lines)
  }
  return out
}

/** Écart maximal pour recaler une ligne sur la ligne commentable la plus proche. */
const SNAP_MAX = 3

/**
 * Vérifie que chaque emplacement est une ligne du diff (sinon GitHub le refuse) :
 * recale un léger décalage, et signale le reste pour correction avant envoi.
 */
export function lineFixer(diff: string) {
  const valid = diffLines(diff)
  return <T extends { file: string; line: number; lineWarning?: string }>(loc: T): T => {
    const lines = valid.get(loc.file)
    if (!lines) return { ...loc, lineWarning: 'Fichier absent du diff : à vérifier' }
    if (lines.includes(loc.line)) return loc
    const near = lines.reduce((a, b) => (Math.abs(b - loc.line) < Math.abs(a - loc.line) ? b : a), lines[0])
    if (near != null && Math.abs(near - loc.line) <= SNAP_MAX) return { ...loc, line: near, lineWarning: `Ligne recalée de ${loc.line} à ${near}` }
    return { ...loc, lineWarning: `Ligne ${loc.line} hors du diff : corrige-la avant d’ajouter` }
  }
}

export function checkLines(out: PrReviewOutput, diff: string): PrReviewOutput {
  const fix = lineFixer(diff)
  return { ...out, comments: out.comments.map((c) => (c.threadId ? c : { ...fix(c), also: (c.also ?? []).map(fix) })) }
}

/** Taille au-delà de laquelle un composant mérite d'être découpé. */
const COMPONENT_MAX_LINES = 200

/**
 * Composants ajoutés ou modifiés par la PR qui dépassent COMPONENT_MAX_LINES, en un seul commentaire groupé
 * (un emplacement par fichier, sur sa première ligne ajoutée, toujours présente dans le diff).
 */
function largeComponents(diff: string, cwd: string): ReviewComment[] {
  const found: { file: string; line: number; size: number }[] = []
  for (const block of diff.split(/^(?=diff --git )/m)) {
    const file = block.match(/^diff --git a\/.+? b\/(.+)$/m)?.[1]
    if (!file || !/\.(tsx|jsx)$/.test(file) || /^\+\+\+ \/dev\/null/m.test(block)) continue
    const path = join(cwd, file)
    if (!existsSync(path)) continue
    const size = readFileSync(path, 'utf8').split('\n').length
    if (size <= COMPONENT_MAX_LINES) continue
    let n = 0
    for (const l of block.split('\n')) {
      const h = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)/)
      if (h) n = Number(h[1])
      else if (l.startsWith('+') && !l.startsWith('+++')) {
        found.push({ file, line: n, size })
        break
      } else if (l.startsWith(' ')) n++
    }
  }
  if (!found.length) return []
  found.sort((a, b) => b.size - a.size)
  const body = (f: { size: number }) => `Ce fichier fait ${f.size} lignes : il devient gros et gagnerait à être découpé en composants ou hooks plus petits.`
  const [main, ...others] = found
  return [{
    id: 'size',
    file: main.file,
    line: main.line,
    severity: 'suggestion',
    body: body(main),
    threadId: null,
    followUp: null,
    pattern: others.length ? `Composant de plus de ${COMPONENT_MAX_LINES} lignes` : null,
    also: others.map((f) => ({ file: f.file, line: f.line, body: body(f) })),
  }]
}

/** Finalise une review : composants trop longs (première review seulement), puis contrôle des lignes. */
export function finishReview(out: PrReviewOutput, diff: string, cwd: string): PrReviewOutput {
  const sized = out.mode === 'review' ? { ...out, comments: [...out.comments, ...largeComponents(diff, cwd)] } : out
  return checkLines(sized, diff)
}

/**
 * Finalise une auto-review : lignes recalées sur le diff (la remarque s'affiche alors à sa place),
 * puis les composants trop longs, en une remarque de fin.
 */
export function finishSelfReview(out: ReviewOutput, diff: string, cwd: string): ReviewOutput {
  const fix = lineFixer(diff)
  const findings: Finding[] = out.findings.map((f) => ({ ...f, line: fix(f).line }))
  const [size] = largeComponents(diff, cwd)
  if (size) {
    const all = [{ file: size.file, line: size.line, body: size.body }, ...size.also]
    findings.push({
      id: 'size', file: size.file, line: size.line, severity: 'suggestion',
      title: all.length > 1 ? `${all.length} composants de plus de ${COMPONENT_MAX_LINES} lignes` : `Composant de plus de ${COMPONENT_MAX_LINES} lignes`,
      body: all.map((a) => `${a.file} : ${a.body.match(/\d+ lignes/)?.[0] ?? ''}`).join('\n'),
      fix: 'Découper en composants ou hooks plus petits, en commençant par le plus gros.',
    })
  }
  return { ...out, findings }
}

/** Fusionne les auto-reviews de chaque lot, bloquants d'abord. */
export function mergeSelfReviews(parts: { zone: string; out: ReviewOutput }[]): ReviewOutput {
  const findings = parts.flatMap(({ out }, i) => out.findings.map((f) => ({ ...f, id: `l${i + 1}-${f.id}` })))
  findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
  return { summary: parts.map((p) => `**${p.zone}** : ${p.out.summary}`).join('\n\n'), findings }
}

/** Fusionne les reviews de chaque lot ; un même motif trouvé dans plusieurs lots devient un seul commentaire groupé. */
export function mergeReviews(parts: { zone: string; out: PrReviewOutput }[]): PrReviewOutput {
  const comments: ReviewComment[] = []
  const byPattern = new Map<string, ReviewComment>()
  for (const [i, { out }] of parts.entries()) {
    for (const c of out.comments) {
      const comment: ReviewComment = { ...c, id: `l${i + 1}-${c.id}`, also: [...(c.also ?? [])], pattern: c.pattern ?? null }
      const key = comment.pattern?.trim().toLowerCase()
      const same = key ? byPattern.get(key) : undefined
      if (same) {
        same.also.push({ file: comment.file, line: comment.line, body: comment.body }, ...comment.also)
        if (SEVERITY_RANK[comment.severity] < SEVERITY_RANK[same.severity]) same.severity = comment.severity
        continue
      }
      if (key) byPattern.set(key, comment)
      comments.push(comment)
    }
  }
  comments.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
  const blocking = comments.some((c) => c.severity !== 'suggestion')
  return {
    mode: 'review',
    verdict: blocking ? 'REQUEST_CHANGES' : comments.length ? 'COMMENT' : 'APPROVE',
    summary: parts.map((p) => `**${p.zone}** : ${p.out.summary}`).join('\n\n'),
    fixedThreads: [],
    comments,
  }
}
