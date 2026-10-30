// Règles de review partagées entre le serveur (compteurs « à faire ») et l'interface (barre latérale, bouton de relance).
// Les labels reconnus ne sont pas codés par projet : une seule liste par rôle (Réglages › Labels), valable pour tous les dépôts.

import type { LabelRole, LabelRules } from './types.ts'

/** Ce que fait chaque rôle, pour l'écran de réglages. `contains` : le label n'a qu'à contenir le texte (labels Linear). */
export const LABEL_ROLES: { role: LabelRole; title: string; help: string; source: 'GitHub' | 'Linear'; match: 'exact' | 'contains' }[] = [
  { role: 'awaitingReview', title: 'Review demandée', source: 'GitHub', match: 'exact', help: 'Sur la PR d’un autre : la compte dans « reviews à faire », même si GitHub ne me la redemande pas. Posé sur ma PR quand je relance la review (le premier présent dans le dépôt), retiré quand je rends ma review.' },
  { role: 'changes', title: 'À corriger', source: 'GitHub', match: 'exact', help: 'Sur ma PR : « modifications demandées », et les reviewers qui ont seulement commenté sont à relancer. Posé quand je demande des changements, retiré quand je relance la review ou que j’approuve.' },
  { role: 'testing', title: 'À tester', source: 'GitHub', match: 'exact', help: 'Sur ma PR : elle apparaît dans « PR à tester » et déclenche une notification.' },
  { role: 'inProgress', title: 'Review en cours', source: 'GitHub', match: 'exact', help: 'Retiré automatiquement quand je rends ma review.' },
  { role: 'approved', title: 'Approuvée', source: 'GitHub', match: 'exact', help: 'Posé quand j’approuve une PR (le premier présent dans le dépôt).' },
  { role: 'aiReview', title: 'CodeRabbit en cours', source: 'GitHub', match: 'exact', help: 'Posé sur ma PR à sa création (le premier présent dans le dépôt) : CodeRabbit la relit.' },
  { role: 'ticketFix', title: 'Ticket de type fix', source: 'Linear', match: 'contains', help: 'Le ticket est un correctif : branche et commits en fix.' },
  { role: 'ticketChore', title: 'Ticket de type chore', source: 'Linear', match: 'contains', help: 'Le ticket est une tâche technique : branche et commits en chore.' },
  { role: 'ticketRefactor', title: 'Ticket de type refactor', source: 'Linear', match: 'contains', help: 'Le ticket est un refactor. Sans label reconnu, un ticket est une feat.' },
]

/** Conventions repérées dans les dépôts de l'équipe (app : Change required / Review needed, app-mobile : To fix / Waiting review). */
export const DEFAULT_LABEL_RULES: LabelRules = {
  awaitingReview: ['Review needed', 'Waiting review', 'Waiting for review', 'Needs review', 'Ready for review'],
  changes: ['Change required', 'To fix', 'Changes requested', 'Needs changes', 'Clarification needed'],
  testing: ['Ready for testing'],
  inProgress: ['Review in progress'],
  approved: ['Review accepted', 'Ready', 'Approved'],
  aiReview: ['Rabbit in progress', 'Bugs bunny in progress', 'CodeRabbit in progress'],
  ticketFix: ['bug', 'fix'],
  ticketChore: ['chore', 'tech'],
  ticketRefactor: ['refacto'],
}

const lower = (s: string) => s.trim().toLowerCase()

/** Le label correspond-il à un des noms du rôle (sans tenir compte de la casse) ? */
export function matchesRole(rules: LabelRules, role: LabelRole, label: string) {
  const l = lower(label)
  const contains = LABEL_ROLES.find((r) => r.role === role)?.match === 'contains'
  return rules[role].some((n) => (contains ? l.includes(lower(n)) : l === lower(n)))
}

/** Premier label de la liste qui porte ce rôle. */
export const labelWithRole = (rules: LabelRules, role: LabelRole, labels: { name: string }[]) => labels.find((l) => matchesRole(rules, role, l.name))

/** Labels du dépôt qui portent ce rôle, dans l'ordre des réglages : le premier est celui qu'on pose. */
export const repoLabelsWithRole = (rules: LabelRules, role: LabelRole, available: string[]) =>
  [...new Set(rules[role].map((n) => available.find((a) => lower(a) === lower(n))).filter((x): x is string => !!x))]

const BOTS = /\[bot\]$|^coderabbitai$/

/**
 * Reviewers à relancer : ceux qui ont demandé des changements sur GitHub, et, si la PR porte un label « à corriger »,
 * ceux qui ont seulement commenté (l'équipe signale les changements par label). Jamais ceux qui ont approuvé,
 * ni ceux dont la review est déjà redemandée.
 */
export function reviewersToRerequest(pr: { labels: { name: string }[]; reviews: { login: string; state: string }[]; requestedReviewers: string[] }, rules: LabelRules): string[] {
  const flagged = !!labelWithRole(rules, 'changes', pr.labels)
  return pr.reviews
    .filter((r) => !BOTS.test(r.login) && !pr.requestedReviewers.includes(r.login))
    .filter((r) => r.state === 'CHANGES_REQUESTED' || (flagged && r.state === 'COMMENTED'))
    .map((r) => r.login)
}

/** La PR attend une review par label, même si GitHub ne me la redemande pas. */
export const awaitsReview = (pr: { labels: { name: string }[] }, rules: LabelRules) => !!labelWithRole(rules, 'awaitingReview', pr.labels)

/** Ma PR est prête à être testée par moi. */
export const needsTesting = (pr: { labels: { name: string }[] }, rules: LabelRules) => !!labelWithRole(rules, 'testing', pr.labels)

/** Ma PR attend une relance : plus de commentaire à traiter, mais des reviewers à relancer. */
export const needsRerequest = (pr: Parameters<typeof reviewersToRerequest>[0] & { unresolvedThreads: number; ci: { failing: number } }, rules: LabelRules) =>
  pr.unresolvedThreads === 0 && pr.ci.failing === 0 && reviewersToRerequest(pr, rules).length > 0

/** Ma PR porte un label « à corriger » sans commentaire ouvert : oubli, ou modification encore à faire. */
export const needsChanges = (pr: Parameters<typeof needsRerequest>[0], rules: LabelRules) =>
  pr.unresolvedThreads === 0 && !!labelWithRole(rules, 'changes', pr.labels) && !needsRerequest(pr, rules)
