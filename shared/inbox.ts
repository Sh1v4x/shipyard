import type { ActionKind, RunScope } from './types.ts'

// Où agir sur le résultat d'un agent : le même lien sert à la page « À valider », aux notifications
// et à la liste des agents en cours.

const WORKTREE_TAB: Partial<Record<ActionKind, string>> = {
  'ticket-plan': 'ticket', ticket: 'ticket', 'change-plan': 'ticket', change: 'ticket', 'branch-ask': 'ticket',
  'commit-plan': 'ticket', 'commit-exec': 'ticket', 'commit-fix': 'ticket', 'pr-prepare': 'ticket', 'pr-video': 'ticket',
  review: 'review', 'self-review': 'files', 'finding-fix': 'files', 'findings-fix-all': 'files',
  'comments-analyze': 'comments', 'comment-fix': 'comments', 'general-fix': 'comments', 'comments-fix-all': 'comments', 'comment-reply': 'comments', 'followup-check': 'followup',
  test: 'tests', 'test-part': 'tests', 'test-manual': 'tests', 'test-check': 'tests', 'ci-analyze': 'ci', 'ci-fix': 'ci', 'ci-analyze-all': 'ci', 'ci-fix-all': 'ci', 'sdk-update': 'sdk', 'sdk-publish': 'sdk', 'checks-analyze': 'checks', 'checks-fix': 'checks', 'conflict-resolve': 'conflicts', 'merge-finish': 'conflicts', 'base-sync': 'conflicts', 'branch-sync': 'conflicts', 'dirty-triage': 'conflicts',
}

/** Lien interne (#/…) vers l'endroit où traiter le résultat d'un run. */
export function runHref(kind: ActionKind, scope: RunScope): string {
  if (kind === 'daily') return '#/daily'
  if (kind === 'ticket-draft') return `#/p/${scope.project}/ticket`
  if (kind === 'insights') return `#/p/${scope.project}/insights${scope.ref ? `/${scope.ref}` : ''}`
  if (kind === 'branch-name') return `#/p/${scope.project}/new`
  if (scope.worktree) return `#/p/${scope.project}/wt/${scope.worktree}${WORKTREE_TAB[kind] ? `/${WORKTREE_TAB[kind]}` : ''}`
  return `#/p/${scope.project}`
}
