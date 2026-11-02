import type { ActionInput, DailyOutput, DailyPeriod, Run } from '../../shared/types.ts'
import { DATA_DIR, HttpError, loadProjects } from '../lib/config.ts'
import { startJob } from '../lib/claude.ts'
import * as gh from '../lib/github.ts'
import * as schemas from '../schemas.ts'
import { specFrom } from './context.ts'
import { customRange, dailyRange } from './dailyRange.ts'
import { warnOn } from '../lib/log.ts'

const DAILY_LABEL: Record<DailyPeriod, { title: string; period: string }> = {
  week: { title: 'Daily · semaine', period: 'this week' },
  'last-week': { title: 'Daily · semaine dernière', period: 'last week' },
  yesterday: { title: 'Daily · depuis hier', period: 'since yesterday' },
}

export async function dailyAction(input: ActionInput): Promise<Run> {
  const kind = 'daily'
  const period: DailyPeriod = input.period === 'yesterday' || input.period === 'last-week' ? input.period : 'week'
  const custom = input.since ? { from: input.since, to: input.until ?? input.since } : null
  if (custom && custom.from > custom.to) throw new HttpError(400, 'La date de début est après la date de fin')
  const { since, until } = custom ? customRange(custom.from, custom.to) : dailyRange(period)
  const ref = custom ? `${custom.from}..${custom.to}` : period
  const projects = loadProjects()
  const fmt = (x: Date) => x.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })
  // Dernier jour inclus de la période (until est exclu).
  const lastDay = until ? new Date(until.getTime() - 86_400_000) : null
  const short = (x: Date) => x.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
  const title = custom && lastDay ? `Daily · ${short(since)} → ${short(lastDay)}` : DAILY_LABEL[period].title
  return startJob({ kind, title, scope: { project: 'all', ref } }, async (ctx) => {
    ctx.log({ t: 'info', text: `Activité GitHub du ${since.toLocaleDateString('fr-FR')}${lastDay ? ` au ${lastDay.toLocaleDateString('fr-FR')}` : ' à aujourd’hui'} sur ${projects.map((p) => p.name).join(', ')}` })
    const activity = await Promise.all(projects.map(async (p) => ({
      p,
      prs: await gh.myActivity(p.repo, since.toISOString(), until?.toISOString()).catch(warnOn('gh.myActivity', [])),
      reviews: await gh.myReviews(p.repo, since.toISOString(), until?.toISOString()).catch(warnOn('gh.myReviews', [])),
    })))
    const REVIEW_STATE: Record<string, string> = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes requested', COMMENTED: 'commented', DISMISSED: 'dismissed' }
    const text = activity.filter((a) => a.prs.length || a.reviews.length).map(({ p, prs, reviews }) => [
      `## ${p.name} (${p.repo})`,
      ...prs.map((pr) => [
        `### #${pr.number} [${pr.state}] ${pr.title}`,
        `URL: ${pr.url} · branch ${pr.head}`,
        pr.body ? `Description (excerpt):\n${pr.body}` : '',
        pr.commits.length ? `My commits over the period:\n${pr.commits.map((c) => `- ${c.headline}${c.body ? ` — ${c.body.replace(/\s+/g, ' ').slice(0, 200)}` : ''}`).join('\n')}` : 'No commit of mine over the period.',
        `Main files: ${pr.files.map((f) => `${f.path} (+${f.additions} −${f.deletions})`).join(', ')}`,
      ].filter(Boolean).join('\n')),
      ...(reviews.length ? [`### Reviews done on colleagues' PRs`, ...reviews.map((r) => [
        `- #${r.number} [${r.state}] ${r.title} (by ${r.author}) · ${r.url}`,
        ...r.reviews.map((x) => `  - ${new Date(x.date).toLocaleDateString('en-US', { weekday: 'long' })}: ${REVIEW_STATE[x.state] ?? x.state}${x.body ? ` — ${x.body}` : ''}`),
      ].join('\n'))] : []),
    ].join('\n\n')).join('\n\n')
    const total = activity.reduce((a, x) => a + x.prs.length + x.reviews.length, 0)
    ctx.log({ t: 'info', text: `${activity.reduce((a, x) => a + x.prs.length, 0)} PR avec de l’activité, ${activity.reduce((a, x) => a + x.reviews.length, 0)} PR reviewées` })
    if (!total) return { sections: [], next: [] } satisfies DailyOutput
    const r = await ctx.runChild(specFrom('daily', {
      period: custom ? 'over the chosen period' : DAILY_LABEL[period].period,
      since: lastDay ? `from ${fmt(since)} to ${fmt(lastDay)}` : `since ${fmt(since)}`,
      activity: text,
    }, { kind: 'daily', title: 'Rédaction du Daily', scope: { project: 'all', ref: `${ref}-part` }, cwd: DATA_DIR, schema: schemas.dailySchema }))
    if (!r.structured) throw new Error('Rédaction du Daily en échec')
    return r.structured as DailyOutput
  })
}
