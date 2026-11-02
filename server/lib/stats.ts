import type { StatsCounts, StatsReport, StatsScope } from '../../shared/types.ts'
import { loadProjects } from './config.ts'
import { ttlCache } from './exec.ts'
import * as gh from './github.ts'
import * as linear from './linear.ts'
import { warnOn } from './log.ts'
import { plural } from '../../shared/text.ts'

type Tickets = NonNullable<StatsReport['tickets']>

/**
 * PR de release ou de synchronisation (develop → main…) : leurs commits et leurs lignes sont déjà comptés dans les
 * PR des fonctionnalités, elles les compteraient deux fois.
 */
const RELEASE_HEAD = /^(main|master|develop|dev|staging|preprod|production|prod)$/

const empty = (): StatsCounts => ({ commits: 0, prsOpened: 0, prsMerged: 0, reviews: 0, linesAdded: 0, linesDeleted: 0 })

/** Mois AAAA-MM de `from` à `to` compris, pour avoir une barre même pour un mois sans activité. */
function months(from: string, to: string): string[] {
  const out: string[] = []
  let [y, m] = from.slice(0, 7).split('-').map(Number)
  const last = to.slice(0, 7)
  for (let key = from.slice(0, 7); key <= last; key = `${y}-${String(m).padStart(2, '0')}`) {
    out.push(key)
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  return out
}

/** Assemble le rapport : `repos` limite aux dépôts des projets suivis (null : tous les dépôts). */
export function buildStats(
  c: gh.MyContributions,
  tickets: Tickets | null,
  opts: { from: string; to: string; scope: StatsScope; repos: Set<string> | null },
): StatsReport {
  const keep = (repo: string) => !opts.repos || opts.repos.has(repo.toLowerCase())
  const merged = c.merged.filter((p) => keep(p.repo) && !RELEASE_HEAD.test(p.head))
  const opened = c.opened.filter((p) => keep(p.repo) && !RELEASE_HEAD.test(p.head))
  const releases = c.merged.filter((p) => keep(p.repo) && RELEASE_HEAD.test(p.head)).length
  const reviews = c.reviews.filter((r) => keep(r.repo))

  const repos = new Map<string, StatsCounts>()
  const at = (repo: string) => {
    const found = repos.get(repo)
    if (found) return found
    const created = empty()
    repos.set(repo, created)
    return created
  }
  for (const p of merged) {
    const r = at(p.repo)
    r.prsMerged += 1
    r.commits += p.commits
    r.linesAdded += p.additions
    r.linesDeleted += p.deletions
  }
  for (const p of opened) at(p.repo).prsOpened += 1
  for (const rv of reviews) at(rv.repo).reviews += 1

  const byMonth = months(opts.from, opts.to).map((month) => ({
    month,
    commits: merged.filter((p) => p.mergedAt.startsWith(month)).reduce((a, p) => a + p.commits, 0),
    prsMerged: merged.filter((p) => p.mergedAt.startsWith(month)).length,
    reviews: reviews.filter((r) => r.date.startsWith(month)).length,
    ticketsCompleted: tickets?.filter((t) => t.completedAt.startsWith(month)).length ?? 0,
  }))

  const byRepo = [...repos].map(([repo, counts]) => ({ repo, ...counts })).sort((a, b) => b.prsMerged + b.reviews - (a.prsMerged + a.reviews))
  const sum = (k: keyof StatsCounts) => byRepo.reduce((a, r) => a + r[k], 0)
  const notes = [
    'Commits : ceux de mes PR mergées sur la période (avec des merges en squash, GitHub n’en compte qu’un par PR sur la branche principale).',
    'Dates en UTC. Lignes ajoutées et supprimées : celles des PR mergées.',
    ...(releases ? [`${plural(releases, 'PR de release ou de synchronisation (develop → main…) n’est pas comptée', 'PR de release ou de synchronisation (develop → main…) ne sont pas comptées')} : leur contenu l’est déjà dans les PR des fonctionnalités.`] : []),
    ...(c.truncated ? ['La recherche GitHub plafonne à 1 000 PR : sur cette période, les chiffres sont des minimums.'] : []),
    ...(tickets ? ['Tickets : ceux qui me sont assignés dans Linear, terminés sur la période, tous projets confondus.'] : []),
  ]

  return {
    from: opts.from,
    to: opts.to,
    login: c.login,
    scope: opts.scope,
    totals: {
      commits: sum('commits'),
      prsOpened: sum('prsOpened'),
      prsMerged: sum('prsMerged'),
      reviews: sum('reviews'),
      linesAdded: sum('linesAdded'),
      linesDeleted: sum('linesDeleted'),
      reviewedPrs: new Set(reviews.map((r) => `${r.repo}#${r.pr}`)).size,
      approvals: reviews.filter((r) => r.state === 'APPROVED').length,
      changesRequested: reviews.filter((r) => r.state === 'CHANGES_REQUESTED').length,
      ticketsCompleted: tickets?.length ?? null,
    },
    byRepo,
    byMonth,
    mergedPrs: [...merged].sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions)),
    tickets,
    notes,
  }
}

const sources = ttlCache<{ contributions: gh.MyContributions; tickets: Tickets | null }>(10 * 60_000)

/** Rapport de la période, depuis GitHub et Linear (gardés 10 minutes en cache, `force` pour relire). */
export async function statsReport(from: string, to: string, scope: StatsScope, force = false): Promise<StatsReport> {
  const { contributions, tickets } = await sources.get(`${from}..${to}`, async () => {
    const [contributions, tickets] = await Promise.all([
      gh.myContributions(from, to),
      linear.linearConfigured() ? linear.myCompletedTickets(from, to).catch(warnOn('linear.myCompletedTickets', null)) : Promise.resolve(null),
    ])
    return { contributions, tickets }
  }, force)
  const repos = scope === 'tracked' ? new Set(loadProjects().map((p) => p.repo.toLowerCase())) : null
  return buildStats(contributions, tickets, { from, to, scope, repos })
}
