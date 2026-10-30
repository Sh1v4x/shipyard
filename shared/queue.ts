import { awaitsReview, labelWithRole, needsChanges, needsTesting, reviewersToRerequest } from './review.ts'
import { since, waitingInfo } from './timeline.ts'
import type { InboxItem, LabelRules, ProjectOverview, PullRequest, QueueGroup, QueueItem, QueueTone, Ticket, Worktree } from './types.ts'

// File d'attente d'un projet : une ligne par PR, branche ou ticket, avec ce qu'elle attend et où agir.
// Calculée par le serveur avec la vue du projet ; le front y ajoute les résultats d'agents à valider (inboxToQueue).
// Seul le groupe « me » est compté : c'est le nombre affiché partout (titre de l'onglet, projet, barre latérale).

export const QUEUE_GROUPS: { key: QueueGroup; label: string }[] = [
  { key: 'me', label: 'À toi' },
  { key: 'start', label: 'À démarrer' },
  { key: 'progress', label: 'En cours · sans PR' },
  { key: 'others', label: 'Attend les autres' },
  { key: 'clean', label: 'À ranger' },
]

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`
const size = (pr: PullRequest) => `+${pr.additions} −${pr.deletions} · ${plural(pr.changedFiles, 'fichier', 'fichiers')}`

type Reason = QueueItem['reasons'][number]

const RANK: Record<QueueTone, number> = { red: 0, amber: 1, purple: 2, blue: 3, green: 4, gray: 5 }
/** Couleur de la ligne : la raison la plus grave, même si ce n'est pas la première à traiter. */
const worst = (reasons: Reason[]): QueueTone => reasons.reduce<QueueTone>((t, r) => (RANK[r.tone] < RANK[t] ? r.tone : t), 'gray')

/** Ce que ma PR attend de moi, du plus bloquant au moins bloquant (même ordre que l'onglet par défaut du worktree). */
function myPrReasons(pr: PullRequest, rules: LabelRules): (Reason & { tab: string; action: string })[] {
  const out: (Reason & { tab: string; action: string })[] = []
  if (pr.conflicts) out.push({ label: `Conflits avec ${pr.base}`, tone: 'red', tab: 'conflicts', action: 'Résoudre' })
  if (pr.unresolvedThreads) out.push({ label: plural(pr.unresolvedThreads, 'commentaire', 'commentaires'), tone: 'amber', tab: 'comments', action: 'Traiter' })
  if (pr.ci.failing) out.push({ label: plural(pr.ci.failing, 'job CI en échec', 'jobs CI en échec'), tone: 'red', tab: 'ci', action: 'Corriger la CI' })
  if (needsChanges(pr, rules)) out.push({ label: `Label « ${labelWithRole(rules, 'changes', pr.labels)?.name} » sans commentaire`, tone: 'amber', tab: 'ticket', action: 'Corriger' })
  if (needsTesting(pr, rules)) out.push({ label: 'À tester', tone: 'purple', tab: 'tests', action: 'Tester' })
  if (!pr.unresolvedThreads && !pr.ci.failing) {
    const who = reviewersToRerequest(pr, rules)
    if (who.length) out.push({ label: `${who.join(', ')} à relancer`, tone: 'amber', tab: 'reviewers', action: 'Relancer' })
  }
  return out
}

const isApproved = (pr: PullRequest, rules: LabelRules) => !!labelWithRole(rules, 'approved', pr.labels) || pr.reviewDecision === 'APPROVED'

export function buildQueue(ov: Omit<ProjectOverview, 'queue'>, rules: LabelRules, me: string | null): QueueItem[] {
  const items: QueueItem[] = []
  const ticketOf = (id: string | null) => ov.tickets.find((t) => t.id === id)
  const seenPrs = new Set<number>()

  const prItem = (pr: PullRequest, w: Worktree | null): QueueItem => {
    seenPrs.add(pr.number)
    const wait = waitingInfo(pr, me)
    const base: QueueItem = {
      key: `pr:${pr.number}`, group: 'others', tone: 'gray', kind: pr.mine ? 'mine' : 'review', title: pr.title, ref: `#${pr.number}`,
      worktree: w?.id ?? null, prNumber: pr.number, ticketId: w?.ticketId ?? pr.ticketId, reasons: [], detail: null,
      action: w ? { label: 'Ouvrir', tab: undefined } : null, since: wait?.since ?? pr.updatedAt,
    }
    if (pr.mine) {
      const reasons = myPrReasons(pr, rules)
      if (reasons.length) {
        return { ...base, group: 'me', tone: worst(reasons), reasons: reasons.map(({ label, tone }) => ({ label, tone })), detail: [size(pr), wait && `${wait.label} · ${since(wait.since)}`].filter(Boolean).join(' · '), action: w ? { label: reasons[0].action, tab: reasons[0].tab } : null }
      }
      const reasonsWaiting: Reason[] = []
      if (pr.isDraft) reasonsWaiting.push({ label: 'Brouillon', tone: 'gray' })
      if (pr.ci.state === 'running') reasonsWaiting.push({ label: `CI en cours · ${pr.ci.jobs.filter((j) => j.state === 'pass').length}/${pr.ci.total}`, tone: 'blue' })
      if (isApproved(pr, rules)) reasonsWaiting.push(pr.conflictsUnknown ? { label: 'Approuvée · conflits en vérification', tone: 'amber' } : { label: 'Prête à merger', tone: 'green' })
      else if (pr.requestedReviewers.length) reasonsWaiting.push({ label: `Review demandée à ${pr.requestedReviewers.join(', ')}`, tone: 'gray' })
      return { ...base, tone: isApproved(pr, rules) ? 'green' : 'gray', reasons: reasonsWaiting, detail: [size(pr), wait && `${wait.label} · ${since(wait.since)}`].filter(Boolean).join(' · '), action: isApproved(pr, rules) ? { label: 'Merger', url: pr.url } : base.action }
    }
    // PR d'un autre : review demandée (ou redemandée par label), sinon rendue et en attente de l'auteur.
    const requested = ov.requestedReviews.includes(pr.number)
    if (requested) {
      const again = awaitsReview(pr, rules) && pr.reviews.some((r) => r.login === me)
      return {
        ...base, group: 'me', tone: 'purple',
        reasons: [{ label: again ? 'Review redemandée' : 'Review demandée', tone: 'purple' }, ...(pr.ci.failing ? [{ label: plural(pr.ci.failing, 'job CI en échec', 'jobs CI en échec'), tone: 'red' as const }] : [])],
        detail: [pr.author, size(pr), wait && `attend depuis ${since(wait.since)}`].filter(Boolean).join(' · '),
        action: w ? { label: again ? 'Vérifier' : 'Reviewer', tab: again ? 'followup' : 'review' } : null,
      }
    }
    return { ...base, reasons: [{ label: 'Review rendue', tone: 'green' }], detail: [pr.author, wait && `${wait.label} · ${since(wait.since)}`].filter(Boolean).join(' · ') }
  }

  for (const w of ov.worktrees) {
    const t = ticketOf(w.ticketId)
    const ticketDone = t?.statusType === 'completed' || t?.statusType === 'canceled'
    if (w.merged) {
      seenPrs.add(w.merged.number)
      const review = w.kind === 'review'
      items.push({
        key: `wt:${w.id}`, group: 'clean', tone: 'gray', kind: review ? 'review' : 'mine', title: w.merged.title, ref: `#${w.merged.number}`, worktree: w.id, prNumber: w.merged.number, ticketId: w.ticketId,
        reasons: [{ label: w.merged.state === 'CLOSED' ? 'Fermée' : 'Mergée', tone: 'purple' }],
        detail: review ? 'Review terminée : le worktree peut être supprimé' : `${w.ticketId ? `Passer ${w.ticketId} en Done, ` : ''}supprimer le worktree`,
        action: { label: review ? 'Supprimer' : 'Aboutir' }, since: w.merged.mergedAt,
      })
      continue
    }
    const pr = w.prNumber ? [...ov.myPrs, ...ov.reviewPrs].find((p) => p.number === w.prNumber) : undefined
    if (pr) {
      items.push(prItem(pr, w))
      continue
    }
    const title = w.localTicket?.title ?? t?.title ?? w.branch ?? w.head
    if (ticketDone) {
      items.push({ key: `wt:${w.id}`, group: 'clean', tone: 'gray', kind: 'branch', title, ref: t?.id ?? null, worktree: w.id, prNumber: null, ticketId: w.ticketId, reasons: [{ label: `Ticket ${t?.status}`, tone: 'gray' }], detail: 'Ticket terminé : worktree à supprimer', action: { label: 'Ouvrir' }, since: t?.updatedAt ?? null })
      continue
    }
    items.push({
      key: `wt:${w.id}`, group: 'progress', tone: 'blue', kind: 'branch', title, ref: t?.id ?? null, worktree: w.id, prNumber: null, ticketId: w.ticketId,
      reasons: [w.localTicket ? { label: 'Ticket local', tone: 'gray' } : t ? { label: t.status, tone: 'gray' } : { label: 'Sans ticket', tone: 'gray' }],
      detail: w.branch, action: { label: 'Continuer', tab: 'ticket' }, since: null,
    })
  }

  // PR sans worktree : elles comptent aussi (le bouton crée le worktree).
  for (const pr of [...ov.myPrs, ...ov.reviewPrs]) if (!seenPrs.has(pr.number)) items.push(prItem(pr, null))

  // Tickets à moi pas encore démarrés, sans worktree.
  for (const t of ov.tickets) {
    if (!t.isMine || t.statusType !== 'unstarted' || ov.worktrees.some((w) => w.ticketId === t.id)) continue
    items.push(ticketItem(ov.project.id, t))
  }

  return items.sort((a, b) => RANK[a.tone] - RANK[b.tone] || (a.since ?? '~').localeCompare(b.since ?? '~'))
}

function ticketItem(project: string, t: Ticket): QueueItem {
  return {
    key: `ticket:${t.id}`, group: 'start', tone: 'gray', kind: 'ticket', title: t.title, ref: t.id, worktree: null, prNumber: null, ticketId: t.id,
    reasons: [{ label: t.priority, tone: t.priority === 'Urgent' ? 'red' : t.priority === 'High' ? 'amber' : 'gray' }],
    detail: t.labels.join(', ') || null, action: { label: 'Démarrer', href: `#/p/${project}/new?ticket=${encodeURIComponent(t.id)}` }, since: t.updatedAt,
  }
}

/** Tickets affichés dans l'Accueil (onglet et barre latérale) : en Todo ou en cours, pas le backlog ni les terminés. */
export const isActiveTicket = (t: Ticket) => t.statusType === 'unstarted' || t.statusType === 'started'

const INBOX_TONE: Record<InboxItem['tone'], QueueTone> = { amber: 'amber', red: 'red', purple: 'purple', green: 'green', blue: 'blue' }

/** Résultat d'agent à valider : une ligne « À toi » de la file du projet. */
export function inboxToQueue(i: InboxItem): QueueItem {
  return {
    key: `agent:${i.runId}`, group: 'me', tone: INBOX_TONE[i.tone], kind: 'agent', title: `${i.label} · ${i.title}`, ref: null, worktree: i.worktree, prNumber: null, ticketId: null,
    reasons: [{ label: 'Agent terminé', tone: INBOX_TONE[i.tone] }], detail: i.detail, action: { label: 'Voir', href: i.href }, since: i.at,
    runId: i.runId, clearsOnOpen: i.clearsOnOpen, until: i.until,
  }
}

/** Nombre affiché partout : ce qui m'attend dans le projet, résultats d'agents compris. */
export const queueCount = (queue: QueueItem[] | undefined, inbox: InboxItem[] | undefined, project: string) =>
  (queue ?? []).filter((q) => q.group === 'me').length + (inbox ?? []).filter((i) => i.project === project).length
