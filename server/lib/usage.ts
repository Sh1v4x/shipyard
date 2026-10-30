import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ClaudeUsage, UsageLimit } from '../../shared/types.ts'
import { run, ttlCache } from './exec.ts'

// Usage du forfait Claude (session de 5 h, semaine, quota par modèle), lu avec le jeton OAuth de Claude Code.
// Le jeton n'est jamais rafraîchi ici : Claude Code s'en charge à sa prochaine utilisation.

interface OAuth { accessToken: string; expiresAt?: number }

async function oauthToken(): Promise<OAuth> {
  const raw =
    process.platform === 'darwin'
      ? await run('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w']).catch(() => '')
      : ''
  const file = join(homedir(), '.claude', '.credentials.json')
  const text = raw.trim() || (existsSync(file) ? readFileSync(file, 'utf8') : '')
  const oauth = text ? (JSON.parse(text) as { claudeAiOauth?: OAuth }).claudeAiOauth : undefined
  if (!oauth?.accessToken) throw new Error('Claude Code non connecté')
  if (oauth.expiresAt && oauth.expiresAt < Date.now()) throw new Error('Jeton Claude expiré : relance une session claude pour le rafraîchir')
  return oauth
}

interface RawLimit { kind: string; percent: number; severity: string; resets_at: string | null; scope: { model?: { display_name: string | null } | null } | null }
interface RawWindow { utilization: number | null; resets_at: string | null }
interface RawUsage { limits?: RawLimit[]; five_hour?: RawWindow | null; seven_day?: RawWindow | null }

const LABELS: Record<string, string> = { session: 'Session', weekly_all: 'Semaine' }

function limitsOf(u: RawUsage): UsageLimit[] {
  if (u.limits?.length)
    return u.limits.map((l) => ({
      kind: l.kind,
      label: l.scope?.model?.display_name ?? LABELS[l.kind] ?? l.kind,
      percent: l.percent,
      resetsAt: l.resets_at,
      severity: l.severity === 'critical' ? 'critical' : l.severity === 'warning' ? 'warning' : 'normal',
    }))
  // Ancien format : seulement les fenêtres de 5 h et de 7 jours.
  const win = (kind: string, w?: RawWindow | null): UsageLimit[] =>
    w?.utilization != null ? [{ kind, label: LABELS[kind], percent: w.utilization, resetsAt: w.resets_at, severity: w.utilization >= 90 ? 'critical' : w.utilization >= 75 ? 'warning' : 'normal' }] : []
  return [...win('session', u.five_hour), ...win('weekly_all', u.seven_day)]
}

const cache = ttlCache<ClaudeUsage>(60_000)
/** Dernier usage lu, pour décider sans attendre du modèle des agents. */
let last: ClaudeUsage | null = null

/**
 * Le quota hebdomadaire de Fable (modèle par défaut des agents sans modèle fixé) est épuisé : ils passent alors
 * sur Opus jusqu'à sa remise à zéro. Relit l'usage en arrière-plan pour la prochaine fois.
 */
export function fableExhausted(): boolean {
  void claudeUsage().catch(() => undefined)
  const fable = last?.limits.find((l) => l.kind === 'weekly_scoped' && /fable/i.test(l.label))
  return !!fable && fable.percent >= 100 && (!fable.resetsAt || Date.parse(fable.resetsAt) > Date.now())
}

export function claudeUsage(force = false): Promise<ClaudeUsage> {
  return cache.get(
    'usage',
    async () => {
      const { accessToken } = await oauthToken()
      const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
        headers: { Authorization: `Bearer ${accessToken}`, 'anthropic-beta': 'oauth-2025-04-20' },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) throw new Error(`Usage Claude indisponible (HTTP ${res.status})`)
      last = { limits: limitsOf((await res.json()) as RawUsage), fetchedAt: new Date().toISOString() }
      return last
    },
    force,
  )
}

// Lu dès le démarrage : le premier agent lancé connaît déjà l’état du quota Fable.
void claudeUsage().catch(() => undefined)
