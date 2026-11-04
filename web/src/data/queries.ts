import { useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type {
  ActionKind, ActionsBlock, DiffLine, AgentProcesses, BrokenWorktree, CheckReport, SdkStatus, DigestInfo, LocalTicket, BranchInfo, ClaudeUsage, Credentials, InboxItem, Note, Settings, CreatedTicket, LinearMeta, PendingReview, PrFiles, Project, ProjectOverview, PromptInfo, PromptSource, PromptVersion, ReviewDecisions, StatsReport, StatsScope, ReviewThread,
  ManualEnv, Run, RunSummary, RunVideo, TicketState, WorktreeCleanupInfo, WorktreeDetail, WorktreeStat,
} from '../../../shared/types.ts'
import { DEFAULT_LABEL_RULES } from '../../../shared/review.ts'
import { inboxToQueue, queueCount } from '../../../shared/queue.ts'
import { api } from './client.ts'
import { qk } from './keys.ts'

export const wtPath = (project: string, wt: string) => `/projects/${project}/worktrees/${wt}`

export const useHealth = () =>
  useQuery({ queryKey: qk.health, queryFn: () => api<{ github: string | null; linear: boolean; claude: string | null }>('/health'), staleTime: 300_000 })

export const useProjects = () => useQuery({ queryKey: qk.projects, queryFn: () => api<Project[]>('/projects'), staleTime: 300_000 })

export const statsPath = (from: string, to: string, scope: StatsScope, refresh = false) => `/stats?${new URLSearchParams({ from, to, scope, ...(refresh ? { refresh: '1' } : {}) })}`

/** Mon activité sur une période : lue sur GitHub et Linear, longue à calculer sur une grande période. */
export const useStats = (from: string, to: string, scope: StatsScope) =>
  useQuery({ queryKey: qk.stats(from, to, scope), queryFn: () => api<StatsReport>(statsPath(from, to, scope)), staleTime: 10 * 60_000, enabled: !!from && !!to && from <= to })

export const usePrompts = () => useQuery({ queryKey: qk.prompts, queryFn: () => api<PromptInfo[]>('/prompts') })

const historyPath = (source: PromptSource, key: string) => `/${source === 'rule' ? 'rules' : 'prompts'}/${key}/history`

/** Chargé seulement quand le panneau est ouvert. */
export const usePromptHistory = (source: PromptSource, key: string, enabled: boolean) =>
  useQuery({ queryKey: qk.promptHistory(source, key), queryFn: () => api<PromptVersion[]>(historyPath(source, key)), enabled })

export const usePromptVersionDiff = (source: PromptSource, key: string, version: string | null) =>
  useQuery({
    queryKey: qk.promptVersionDiff(source, key, version ?? ''),
    queryFn: () => api<DiffLine[]>(`${historyPath(source, key)}/${version}`),
    enabled: version != null,
  })

export const useTeams = (enabled = true) =>
  useQuery({ queryKey: qk.teams, queryFn: () => api<{ key: string; name: string }[]>('/linear/teams'), staleTime: 600_000, enabled })

export const useNotes = () => useQuery({ queryKey: qk.notes, queryFn: () => api<Note[]>('/notes') })

/** Ce que les agents terminés attendent de moi, tous projets confondus. */
/** GitHub Actions bloqué (paiement, limite de dépenses) : vérifié toutes les 5 minutes. */
export const useActionsStatus = () =>
  useQuery({ queryKey: qk.actionsStatus, queryFn: () => api<ActionsBlock[]>('/github/actions-status'), refetchInterval: 300_000, staleTime: 60_000, retry: false })

export const useInbox = () => useQuery({ queryKey: qk.inbox, queryFn: () => api<InboxItem[]>('/inbox'), refetchInterval: 15_000, staleTime: 5_000 })

/** Connexions (Linear, GitHub, Claude Code). poll : relit toutes les 3 s, le temps d'une connexion en cours. */
export const useCredentials = (poll = false) =>
  useQuery({ queryKey: qk.credentials, queryFn: () => api<Credentials>('/settings/credentials'), staleTime: 60_000, refetchInterval: poll ? 3_000 : false })

/** Compte GitHub du Chrome de Shipyard (vidéos des tests dans les PR) : lu à la demande, Chrome se lance pour le savoir. */
export const useGithubBrowser = () =>
  useQuery({ queryKey: qk.githubBrowser, queryFn: () => api<{ user: string | null }>('/settings/github-browser'), staleTime: 300_000, refetchOnWindowFocus: false })

/** Usage du forfait Claude (session, semaine, Fable), relu toutes les 5 minutes. */
export const useClaudeUsage = () =>
  useQuery({ queryKey: qk.claudeUsage, queryFn: () => api<ClaudeUsage>('/claude/usage'), refetchInterval: 300_000, staleTime: 60_000, retry: false })

export const useSettings = () => useQuery({ queryKey: qk.settings, queryFn: () => api<Settings>('/settings'), staleTime: 300_000 })

/** Labels reconnus par rôle (Réglages › Labels), pour les règles de review de shared/review.ts. */
export const useLabelRules = () => useSettings().data?.labels ?? DEFAULT_LABEL_RULES

/** Labels existants dans les dépôts de tous les projets, dédoublonnés (suggestions des réglages). */
export function useAllRepoLabels() {
  const projects = useProjects().data ?? []
  return useQueries({
    queries: projects.map((p) => ({ queryKey: qk.repoLabels(p.id), queryFn: () => api<string[]>(`/projects/${p.id}/labels`), staleTime: 600_000 })),
    combine: (rs) => {
      const names = new Map<string, string>()
      for (const r of rs) for (const n of r.data ?? []) if (!names.has(n.toLowerCase())) names.set(n.toLowerCase(), n)
      return { names: [...names.values()].sort((a, b) => a.localeCompare(b)), loading: rs.some((r) => r.isLoading) }
    },
  })
}

// ---------- Projet ----------

/** Vue d'un projet (worktrees, PR, tickets, compteurs « à faire »), rafraîchie toutes les 2 minutes. */
export const useProjectOverview = (project: string | undefined) =>
  useQuery({
    queryKey: qk.overview(project),
    queryFn: () => api<ProjectOverview>(`/projects/${project}/overview`),
    enabled: !!project,
    refetchInterval: 120_000,
  })

/**
 * File d'attente d'un projet : celle de la vue du projet, plus les résultats d'agents à valider du projet.
 * count : le nombre « à toi » affiché partout (titre, projet, barre latérale).
 */
export function useQueue(project: string | undefined) {
  const ov = useProjectOverview(project)
  const inbox = useInbox()
  const agents = (inbox.data ?? []).filter((i) => i.project === project).map(inboxToQueue)
  const items = ov.data ? [...agents, ...(ov.data.queue ?? [])] : undefined
  return { items, count: project ? queueCount(ov.data?.queue, inbox.data, project) : 0, overview: ov }
}

/** Vues de plusieurs projets (ex. ceux du groupe, pour associer des worktrees). */
export const useProjectOverviews = (projects: string[]) =>
  useQueries({
    queries: projects.map((p) => ({ queryKey: qk.overview(p), queryFn: () => api<ProjectOverview>(`/projects/${p}/overview`), refetchInterval: 120_000 })),
    combine: (rs) => ({ data: rs.map((r) => r.data).filter((d): d is ProjectOverview => !!d), loading: rs.some((r) => r.isLoading) }),
  })

/** Tickets locaux dont le worktree n'existe plus : signalés dans la barre du haut. */
export const useLocalTicketOrphans = () =>
  useQuery({ queryKey: qk.localTicketOrphans, queryFn: () => api<LocalTicket[]>('/local-tickets/orphans'), refetchInterval: 300_000, staleTime: 60_000 })

/** Digest du dépôt (façon gitingest) : complet ou carte, mis en cache par commit côté serveur. */
export const useDigest = (project: string) =>
  useQuery({ queryKey: qk.digest(project), queryFn: () => api<DigestInfo>(`/projects/${project}/digest`), staleTime: 300_000 })

export const useTicketStates = (project: string) =>
  useQuery({ queryKey: qk.ticketStates(project), queryFn: () => api<TicketState[]>(`/projects/${project}/ticket-states`), staleTime: 600_000 })

export const useBranches = (project: string) =>
  useQuery({ queryKey: qk.branches(project), queryFn: () => api<string[]>(`/projects/${project}/branches`) })

export const useMyBranches = (project: string) =>
  useQuery({ queryKey: qk.myBranches(project), queryFn: () => api<BranchInfo[]>(`/projects/${project}/branches/mine`) })

export const useWorktreeCleanup = (project: string) =>
  useQuery({ queryKey: qk.worktreeCleanup(project), queryFn: () => api<WorktreeCleanupInfo[]>(`/projects/${project}/worktrees/cleanup`) })

export const useLinearMeta = (project: string, enabled = true) =>
  useQuery({ queryKey: qk.linearMeta(project), queryFn: () => api<LinearMeta>(`/projects/${project}/linear/meta`), enabled, staleTime: 600_000 })

// ---------- Worktree ----------

/**
 * Début de détail tiré de la vue du projet (worktree, PR, ticket) : l'en-tête s'affiche sans attendre,
 * le reste (commits, fichiers modifiés, fusion en cours) arrive avec la vraie réponse.
 */
function detailFromOverview(qc: QueryClient, project: string, wt: string): WorktreeDetail | undefined {
  const ov = qc.getQueryData<ProjectOverview>(qk.overview(project))
  const worktree = ov?.worktrees.find((w) => w.id === wt)
  if (!ov || !worktree) return undefined
  const pr = [...ov.myPrs, ...ov.reviewPrs].find((p) => p.number === worktree.prNumber) ?? null
  return {
    project: ov.project,
    worktree,
    ticket: ov.tickets.find((t) => t.id === worktree.ticketId) ?? null,
    pr,
    commitsAhead: [],
    dirtyFiles: [],
    merge: null,
    behindBase: 0,
    // Inconnus tant que la vraie réponse n'est pas arrivée : la page affiche « … » (voir isPlaceholderData).
    tests: { running: false, ai: null, manual: null },
    selfReview: null,
  }
}

const worktreeQuery = (project: string, wt: string) => ({
  queryKey: qk.worktree(project, wt),
  queryFn: () => api<WorktreeDetail>(wtPath(project, wt)),
})

export function useWorktreeDetail(project: string, wt: string) {
  const qc = useQueryClient()
  return useQuery({ ...worktreeQuery(project, wt), placeholderData: () => detailFromOverview(qc, project, wt) })
}

/** Précharge un worktree (survol d'un lien) : la page s'ouvre avec ses données. */
export function usePrefetchWorktree() {
  const qc = useQueryClient()
  return (project: string, wt: string) => qc.prefetchQuery({ ...worktreeQuery(project, wt), staleTime: 30_000 })
}

/** Lignes ajoutées / supprimées du worktree ouvert, pour la barre d'état. */
export const useWorktreeStat = (project: string | undefined, wt: string | undefined) =>
  useQuery({ queryKey: qk.worktreeStat(project ?? '', wt ?? ''), queryFn: () => api<WorktreeStat>(`${wtPath(project!, wt!)}/stat`), enabled: !!project && !!wt, refetchInterval: 30_000 })

/** Labels du dépôt avec leur couleur (sélecteur de labels), chargés à l'ouverture du sélecteur. */
export const useRepoLabelDetails = (project: string, enabled: boolean) =>
  useQuery({ queryKey: qk.repoLabelDetails(project), queryFn: () => api<{ name: string; color: string; description: string }[]>(`/projects/${project}/labels/details`), enabled, staleTime: 600_000 })

export const usePrFiles = (project: string, wt: string) =>
  useQuery({ queryKey: qk.files(project, wt), queryFn: () => api<PrFiles>(`${wtPath(project, wt)}/files`) })

export const useThreads = (project: string, wt: string, enabled = true) =>
  useQuery({ queryKey: qk.threads(project, wt), queryFn: () => api<ReviewThread[]>(`${wtPath(project, wt)}/threads`), enabled })

export const useChecks = (project: string, wt: string, enabled = true) =>
  useQuery({
    queryKey: qk.checks(project, wt),
    queryFn: () => api<CheckReport[]>(`${wtPath(project, wt)}/checks`),
    enabled,
    // Un rapport en retard sur le dernier commit va être réécrit par son bot : on le guette.
    refetchInterval: (q) => (q.state.data?.some((r) => r.stale) ? 30_000 : false),
  })

/** SDK privés (GitHub Packages) dont dépend le worktree, et leur état de publication. */
export const useSdkStatus = (project: string, wt: string, enabled = true) =>
  useQuery({ queryKey: qk.sdk(project, wt), queryFn: () => api<SdkStatus[]>(`${wtPath(project, wt)}/sdk`), enabled, staleTime: 60_000 })

export const usePendingReview = (project: string, wt: string, enabled = true) =>
  useQuery({ queryKey: qk.pendingReview(project, wt), queryFn: () => api<PendingReview | null>(`${wtPath(project, wt)}/review/pending`), enabled })

// ---------- Runs ----------

export type RunFilter = { project?: string; worktree?: string; kind?: ActionKind; ref?: string; pr?: number }

const runsQs = (filter: RunFilter & { status?: string; limit?: number }) =>
  new URLSearchParams(Object.entries(filter).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])).toString()

/** Tous les runs d'un worktree (onglet Logs), relus toutes les 5 s tant qu'un agent tourne. */
export const useWorktreeRuns = (project: string, worktree: string) =>
  useQuery({
    queryKey: qk.runs({ project, worktree, status: 'all' }),
    queryFn: () => api<RunSummary[]>(`/runs?${runsQs({ project, worktree, limit: 200 })}`),
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === 'running') ? 5_000 : false),
    staleTime: 5_000,
  })

export const useRuns = (filter: RunFilter, enabled = true) =>
  useQuery({ queryKey: qk.runs(filter), queryFn: () => api<RunSummary[]>(`/runs?${runsQs(filter)}`), enabled, staleTime: 5_000 })

/** Tous les runs en cours, tous projets confondus (rafraîchi toutes les 3 s). */
/** Processus des agents (mémoire, orphelins), relus toutes les 10 s. */
/** Worktrees abîmés (dossier disparu ou à moitié effacé), tous projets : vérifié toutes les 2 minutes. */
export const useBrokenWorktrees = () => useQuery({ queryKey: qk.brokenWorktrees, queryFn: () => api<BrokenWorktree[]>('/worktrees/broken'), refetchInterval: 120_000, staleTime: 60_000 })

export const useAgents = () => useQuery({ queryKey: qk.agents, queryFn: () => api<AgentProcesses>('/agents'), refetchInterval: 10_000, staleTime: 0 })

export const useRunningRuns = () =>
  useQuery({ queryKey: qk.runs({ status: 'running' }), queryFn: () => api<RunSummary[]>(`/runs?${runsQs({ status: 'running', limit: 50 })}`), refetchInterval: 3_000, staleTime: 0 })

export const useReviewDecisions = (run: string | null) =>
  useQuery({ queryKey: qk.reviewDecisions(run), queryFn: () => api<ReviewDecisions>(`/runs/${run}/review-decisions`), enabled: !!run, staleTime: 0 })

/** Paramètres d'un run, connus dès son lancement (le suivi en direct ne les donne qu'à la fin). */
export const useRunInput = (run: string | null) =>
  useQuery({ queryKey: qk.runInput(run), queryFn: () => api<Run>(`/runs/${run}`).then((r) => r.input ?? null), enabled: !!run, staleTime: Infinity })

/** Mes réponses aux points « à vérifier » d'un test IA (run d'un dépôt), par nom de scénario. */
export const useTestDecisions = (run: string | null) =>
  useQuery({ queryKey: qk.testDecisions(run), queryFn: () => api<Record<string, string>>(`/runs/${run}/test-decisions`), enabled: !!run })

export const useCreatedTickets = (run: string | null) =>
  useQuery({ queryKey: qk.createdTickets(run), queryFn: () => api<(CreatedTicket & { index: number })[]>(`/runs/${run}/created-tickets`), enabled: !!run })

/**
 * Vidéos d'un test. Le montage se fait après la fin du run : tant qu'elles ne sont pas prêtes,
 * la liste est relue toutes les 4 s (pendant 3 minutes au plus).
 */
export const useRunVideos = (run: string | null, endedAt: string | null) =>
  useQuery({
    queryKey: qk.runVideos(run),
    queryFn: () => api<RunVideo[]>(`/runs/${run}/videos`),
    enabled: !!run && !!endedAt,
    refetchInterval: (q) => (!q.state.data?.length && endedAt && Date.now() - Date.parse(endedAt) < 180_000 ? 4_000 : false),
  })

/** Mémoire des tests : celle du projet (toutes les branches), ou celle d'une branche (wt). */
/** App lancée pour mon test manuel : relue tant qu'elle tourne, pour voir un service tomber. */
export const useManualEnv = (project: string, wt: string) =>
  useQuery({
    queryKey: qk.manualEnv(project, wt),
    queryFn: () => api<ManualEnv | null>(`${wtPath(project, wt)}/manual-env`),
    refetchInterval: (q) => (q.state.data ? 5_000 : false),
  })

export const useTestMemory = (project: string, wt?: string) =>
  useQuery({
    queryKey: wt ? qk.branchTestMemory(project, wt) : qk.testMemory(project),
    queryFn: () => api<{ text: string }>(wt ? `${wtPath(project, wt)}/test-memory` : `/projects/${project}/test-memory`),
  })
