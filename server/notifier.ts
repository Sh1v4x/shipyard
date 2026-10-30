import type { Project, ProjectOverview } from '../shared/types.ts'
import { labelWithRole, needsChanges, needsRerequest, needsTesting } from '../shared/review.ts'
import { loadProjects } from './lib/config.ts'
import { ensureNotifierApp, macNotify } from './lib/macNotify.ts'
import { getSettings, labelRules } from './lib/settings.ts'
import { jsonFile } from './lib/store.ts'
import { overview } from './services.ts'

// Vérifie régulièrement GitHub et Linear (via la vue de chaque projet) et notifie chaque nouvelle tâche :
// review demandée, commentaires à traiter, CI en échec, conflit, PR à tester ou review à relancer, ticket en Todo.
// Une tâche est notifiée quand elle apparaît ou que son compteur augmente (un nouveau commentaire, un job de plus en échec).

interface Task { key: string; count: number; title: string; body: string; href: string }

const state = jsonFile<{ seeded: boolean; counts: Record<string, number> }>('notify-state.json', { seeded: false, counts: {} })

function tasksOf(p: Project, ov: ProjectOverview): Task[] {
  const out: Task[] = []
  const wtOf = (num: number) => ov.worktrees.find((w) => w.prNumber === num)
  const prHref = (num: number, tab: string, overviewTab: string) => {
    const wt = wtOf(num)
    return wt ? `#/p/${p.id}/wt/${wt.id}/${tab}` : `#/p/${p.id}/${overviewTab}`
  }
  const add = (key: string, count: number, title: string, body: string, href: string) => out.push({ key: `${p.id}:${key}`, count, title, body, href })

  for (const num of ov.requestedReviews) {
    const pr = ov.reviewPrs.find((x) => x.number === num)
    add(`review#${num}`, 1, `Review demandée · ${p.name} #${num}`, pr ? `${pr.title} (${pr.author})` : '', prHref(num, 'review', 'reviews'))
  }
  const rules = labelRules()
  for (const pr of ov.myPrs) {
    const n = pr.number
    if (pr.unresolvedThreads) add(`comments#${n}`, pr.unresolvedThreads, `${pr.unresolvedThreads} commentaire(s) à traiter · #${n}`, pr.title, prHref(n, 'comments', 'mypr'))
    if (pr.ci.failing) add(`ci#${n}`, pr.ci.failing, `CI en échec · #${n}`, `${pr.ci.failing} job(s) : ${pr.title}`, prHref(n, 'ci', 'ci'))
    if (pr.conflicts) add(`conflict#${n}`, 1, `Conflits avec ${pr.base} · #${n}`, pr.title, prHref(n, 'conflicts', 'mypr'))
    if (needsTesting(pr, rules)) add(`testing#${n}`, 1, `PR à tester · #${n}`, pr.title, prHref(n, 'tests', 'mypr'))
    if (needsChanges(pr, rules)) add(`changes#${n}`, 1, `Modifications demandées · #${n}`, `Label « ${labelWithRole(rules, 'changes', pr.labels)?.name ?? 'à corriger'} » sans commentaire : ${pr.title}`, prHref(n, 'ticket', 'mypr'))
    if (needsRerequest(pr, rules)) add(`rerequest#${n}`, 1, `Review à relancer · #${n}`, pr.title, prHref(n, 'comments', 'mypr'))
  }
  for (const t of ov.tickets) {
    if (t.isMine && t.statusType === 'unstarted') add(`ticket:${t.id}`, 1, `Nouveau ticket · ${t.id}`, t.title, `#/p/${p.id}/tickets`)
  }
  return out
}

// ---------- Envoi ----------

/** Adresse de l'interface, pour ouvrir la bonne page au clic sur une notification. */
const PANEL_URL = process.env.PANEL_URL ?? 'http://localhost:5173/'

export function sendNotification(n: { title: string; body: string; href: string }) {
  return macNotify({ title: n.title, body: n.body, url: `${PANEL_URL}${n.href}`, seconds: getSettings().notifications.durationSec })
}

// ---------- Boucle ----------

async function tick() {
  const projects = loadProjects()
  const prev = state.read()
  const counts: Record<string, number> = {}
  const fresh: Task[] = []
  for (const p of projects) {
    const ov = await overview(p, true).catch(() => null)
    // GitHub ou Linear injoignable : on garde l'état précédent du projet, pour ne pas renotifier au retour.
    if (!ov || ov.errors.length) {
      for (const [k, v] of Object.entries(prev.counts)) if (k.startsWith(`${p.id}:`)) counts[k] = v
      continue
    }
    for (const t of tasksOf(p, ov)) {
      counts[t.key] = t.count
      if (t.count > (prev.counts[t.key] ?? 0)) fresh.push(t)
    }
  }
  state.write({ seeded: true, counts })
  // Premier passage : on mémorise l'existant sans notifier.
  if (!prev.seeded || !fresh.length) return
  if (fresh.length > 3) {
    await sendNotification({ title: `${fresh.length} nouvelles tâches`, body: fresh.map((t) => t.title).slice(0, 4).join(' · '), href: '#/' })
    return
  }
  for (const t of fresh) await sendNotification({ title: t.title, body: t.body, href: t.href })
}

export function startNotifier() {
  // Compile l'app de notification dès le démarrage, pour que la première notification parte sans délai.
  void ensureNotifierApp()
  const loop = async () => {
    const s = getSettings().notifications
    if (s.enabled) await tick().catch((e: Error) => console.error(`Notifications : ${e.message}`))
    setTimeout(loop, (s.enabled ? s.intervalSec : 30) * 1000)
  }
  // Laisse le serveur démarrer et préchauffer ses caches avant la première vérification.
  setTimeout(loop, 15_000)
}
