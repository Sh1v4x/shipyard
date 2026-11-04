import type { ActionKind, PromptSource, StatsScope } from '../../../shared/types.ts'

/**
 * Clés du cache TanStack Query, en un seul endroit : les mutations invalident par préfixe
 * (ex. ['worktree', projet] couvre tous les worktrees du projet) au lieu de tout recharger.
 */
export const qk = {
  health: ['health'] as const,
  projects: ['projects'] as const,
  prompts: ['prompts'] as const,
  stats: (from: string, to: string, scope: StatsScope) => ['stats', from, to, scope] as const,
  /** Un run terminé, gardé en cache (voir useRun). */
  run: (id: string) => ['run', id] as const,
  /** Sous ['prompts'] : relu après chaque enregistrement. */
  promptHistory: (source: PromptSource, key: string) => ['prompts', source, key, 'history'] as const,
  promptVersionDiff: (source: PromptSource, key: string, version: string) => ['prompts', source, key, 'history', version] as const,
  teams: ['teams'] as const,
  notes: ['notes'] as const,
  settings: ['settings'] as const,
  credentials: ['credentials'] as const,
  /** Compte GitHub connecté dans le Chrome de Shipyard (vidéos des tests dans les PR). */
  githubBrowser: ['github-browser'] as const,
  claudeUsage: ['claude-usage'] as const,
  actionsStatus: ['actions-status'] as const,
  /** Sous ['runs'] : relu à chaque fin de run. */
  agents: ['runs', 'agents'] as const,
  brokenWorktrees: ['broken-worktrees'] as const,
  /** Sous ['runs'] : rechargé à chaque fin de run, comme la liste des runs. */
  inbox: ['runs', 'inbox'] as const,
  overview: (project: string | undefined) => ['overview', project] as const,
  digest: (project: string) => ['digest', project] as const,
  localTicketOrphans: ['local-ticket-orphans'] as const,
  worktree: (project: string, wt?: string) => (wt ? ['worktree', project, wt] as const : ['worktree', project] as const),
  /** Sous ['worktree', projet] : relu avec le worktree après chaque action. */
  worktreeStat: (project: string, wt: string) => ['worktree', project, wt, 'stat'] as const,
  /** Sous ['worktree', projet, wt] : relu avec le worktree après chaque action. */
  sdk: (project: string, wt: string) => ['worktree', project, wt, 'sdk'] as const,
  /** Sous ['worktree', projet, wt] : relu à la fin du run qui le prépare. */
  manualEnv: (project: string, wt: string) => ['worktree', project, wt, 'manual-env'] as const,
  files: (project: string, wt?: string) => (wt ? ['files', project, wt] as const : ['files', project] as const),
  /** Rapports des bots (contrôles) : sous ['threads'], rechargés avec les fils de la PR. */
  checks: (project: string, wt: string) => ['threads', project, wt, 'checks'] as const,
  threads: (project: string, wt?: string) => (wt ? ['threads', project, wt] as const : ['threads', project] as const),
  pendingReview: (project: string, wt: string) => ['pending-review', project, wt] as const,
  ticketStates: (project: string) => ['ticket-states', project] as const,
  branches: (project: string) => ['branches', project] as const,
  myBranches: (project: string) => ['my-branches', project] as const,
  worktreeCleanup: (project: string) => ['worktree-cleanup', project] as const,
  linearMeta: (project: string) => ['linear-meta', project] as const,
  repoLabels: (project: string) => ['repo-labels', project] as const,
  repoLabelDetails: (project: string) => ['repo-labels', project, 'details'] as const,
  createdTickets: (run: string | null) => ['created-tickets', run] as const,
  reviewDecisions: (run: string | null) => ['review-decisions', run] as const,
  runVideos: (run: string | null) => ['run-videos', run] as const,
  testDecisions: (run: string | null) => ['test-decisions', run] as const,
  testMemory: (project: string) => ['test-memory', project] as const,
  branchTestMemory: (project: string, wt: string) => ['test-memory', project, wt] as const,
  runs: (filter?: { project?: string; worktree?: string; kind?: ActionKind; ref?: string; pr?: number; status?: string }) => (filter ? ['runs', filter] as const : ['runs'] as const),
}
