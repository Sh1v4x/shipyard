import type { CheckReport } from '../../shared/types.ts'
import { CommandError, run } from './exec.ts'
import * as gh from './github.ts'

// Contrôles automatiques postés en commentaire de PR par des bots (github-actions…) : un commentaire par contrôle,
// reconnu à son marqueur caché en première ligne et mis à jour à chaque push. CodeRabbit a sa place dans Commentaires.

const MARKER = /^\s*<!--\s*([\w-]+)\s*-->/

const stripHtml = (s: string) =>
  s.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim()

/** Seul critère bloquant : les problèmes Oxlint sur les lignes ajoutées par la PR. Le reste du rapport est indicatif. */
const BLOCKING = /Findings on added lines:\s*(\d+)/i
const BLOCKING_LABEL = 'Findings on added lines'

const clean = (s: string) => s.replace(/[*`_]/g, '').replace(/^[^\p{L}\p{N}]+/u, '').trim()

/**
 * Compteurs du rapport : lignes de tableau `| libellé | 3 |` et segments `Libellé: 3` (séparés par · ou —).
 * Une ligne `Complexity — Critical: 1 · High: 1` garde sa catégorie : « Complexity Critical », « Complexity High ».
 */
function metrics(text: string): CheckReport['metrics'] {
  const out: CheckReport['metrics'] = []
  for (const line of text.split('\n')) {
    const row = line.match(/^\|\s*(.+?)\s*\|\s*(\d+)\s*\|\s*$/)
    if (row) {
      out.push({ label: clean(row[1]), value: Number(row[2]) })
      continue
    }
    const [first, ...rest] = line.split('—')
    const category = rest.length && !/:\s*\d+\s*$/.test(first) ? clean(first) : ''
    for (const seg of (category ? rest.join('—') : line).split(/[·—]/)) {
      const m = seg.match(/^\s*([^:|`]{2,60}?)\s*:\s*(\d+)\s*$/)
      if (m) out.push({ label: [category, clean(m[1])].filter(Boolean).join(' '), value: Number(m[2]) })
    }
  }
  return out.filter((m) => m.label)
}

export function parseReport(c: gh.BotComments['comments'][number], head: gh.BotComments['head']): CheckReport | null {
  if (/coderabbit/i.test(c.author)) return null
  const id = c.body.match(MARKER)?.[1]
  if (!id) return null
  const body = stripHtml(c.body)
  const heading = body.match(/^#{1,6}\s+(.+)$/m)?.[1] ?? id
  const blockingMatch = body.match(BLOCKING)
  const blocking = blockingMatch ? Number(blockingMatch[1]) : null
  const found = metrics(body).filter((m) => m.label !== BLOCKING_LABEL)
  return {
    id, url: c.url, author: c.author, title: clean(heading) || id, body, updatedAt: c.updatedAt, status: reportStatus(heading, blocking, found), blocking, metrics: found,
    command: body.match(/Full report:\s*`([^`]+)`/i)?.[1] ?? null, stale: isStale(c, head),
  }
}

function reportStatus(heading: string, blocking: number | null, found: CheckReport['metrics']): CheckReport['status'] {
  if (blocking != null) return blocking > 0 ? 'fail' : 'pass'
  // Sans section Oxlint : le titre tranche quand il porte un verdict (✅ / ❌), sinon un compteur non nul est à regarder.
  if (heading.includes('❌')) return 'fail'
  if (heading.includes('✅')) return 'pass'
  return found.some((m) => m.value > 0) ? 'warn' : 'pass'
}

/** Rapport daté d'avant le dernier commit, sauf s'il cite lui-même ce commit. */
function isStale(c: gh.BotComments['comments'][number], head: gh.BotComments['head']): boolean {
  return !c.body.includes(head.oid) && !!head.committedAt && c.updatedAt < head.committedAt
}

export async function checkReports(repo: string, num: number, force = false): Promise<CheckReport[]> {
  const { head, comments } = await gh.botComments(repo, num, force)
  return comments.map((c) => parseReport(c, head)).filter((r): r is CheckReport => !!r)
}

/** Script du dépôt seulement (`bun run check-ai-code --full`) : la commande vient d'un commentaire, elle ne passe pas par un shell. */
const SAFE_COMMAND = /^(bun run|bunx|pnpm|pnpm run|npm run|yarn) [\w:.-]+( --?[\w-]+)*$/

/** Lance la commande du rapport complet dans le worktree. Sortie gardée même en échec (un contrôle « advisory » peut sortir en erreur). */
export async function runReportCommand(command: string, cwd: string): Promise<{ ok: boolean; output: string }> {
  if (!SAFE_COMMAND.test(command)) return { ok: false, output: `Command refused (not a repository script): ${command}` }
  const [cmd, ...args] = command.split(' ')
  const out = await run(cmd, args, { cwd, timeoutMs: 10 * 60_000 }).then(
    (stdout) => ({ ok: true, output: stdout }),
    (e: unknown) => ({ ok: false, output: e instanceof CommandError ? `${e.stdout}\n${e.stderr}` : (e as Error).message }),
  )
  return { ...out, output: out.output.trim().slice(-60_000) }
}
