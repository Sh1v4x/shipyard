import type { PullRequest, TimelineEvent } from './types.ts'

// Depuis quand une PR attend, et quoi : déduit de sa frise GitHub, pour la barre latérale et l'en-tête du worktree.

const BOT = /\[bot\]$|^coderabbitai$/
const isHuman = (login: string | null) => !!login && !BOT.test(login)

export interface Waiting {
  /** Ce qu'elle attend, en quelques mots (« review demandée »). */
  label: string
  since: string
}

const last = (events: TimelineEvent[], fn: (e: TimelineEvent) => boolean) => [...events].reverse().find(fn)

/**
 * Ma PR : changements demandés, approuvée, en attente de review ou simplement ouverte.
 * PR d'un autre : review qu'on me demande, ou review rendue qui attend l'auteur.
 */
export function waitingInfo(pr: PullRequest, me: string | null): Waiting | null {
  const t = pr.timeline
  if (!t?.length) return { label: 'ouverte', since: pr.createdAt }
  if (pr.mine) {
    if (pr.isDraft) return { label: 'brouillon', since: last(t, (e) => e.type === 'draft')?.at ?? pr.createdAt }
    const review = last(t, (e) => e.type === 'review' && isHuman(e.actor) && e.actor !== me)
    const request = last(t, (e) => e.type === 'review_requested')
    const push = last(t, (e) => e.type === 'commit' && e.actor === me)
    if (pr.reviewDecision === 'APPROVED' && review) return { label: 'approuvée', since: review.at }
    // Une review plus récente que la dernière relance : c'est à moi de jouer.
    if (review && review.detail !== 'APPROVED' && (!request || review.at > request.at)) return { label: review.detail === 'CHANGES_REQUESTED' ? 'changements demandés' : 'commentée', since: review.at }
    if (pr.requestedReviewers.length && request) return { label: 'review demandée', since: request.at }
    if (push) return { label: 'dernier commit', since: push.at }
    return { label: 'ouverte', since: pr.createdAt }
  }
  const asked = last(t, (e) => e.type === 'review_requested' && e.detail === me)
  const mine = last(t, (e) => e.type === 'review' && e.actor === me)
  if (me && pr.requestedReviewers.includes(me)) return { label: 'review demandée', since: asked?.at ?? pr.createdAt }
  if (mine) {
    const after = t.find((e) => e.type === 'commit' && e.at > mine.at)
    return after ? { label: 'nouveaux commits', since: after.at } : { label: 'review rendue', since: mine.at }
  }
  return { label: 'ouverte', since: pr.createdAt }
}

/** Durée courte depuis une date : « 12 min », « 5 h », « 3 j ». */
export function since(iso: string, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000))
  if (min < 60) return `${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h`
  return `${Math.round(h / 24)} j`
}

/** Plus de 3 jours : la PR traîne. */
export const isStale = (iso: string, now = Date.now()) => now - Date.parse(iso) > 3 * 86_400_000
