import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type {
  BranchDeleteResult, BranchInfo, ClaudeUsage, InsightItem, Run, Credentials, InboxItem, Note, Settings, CreatedTicket, NewIssue, PendingReview, PrFiles, Project, ProjectOverview, ReviewDecisions, ReviewDraftComment, ReviewEvent,
  TicketState, WorktreeDetail,
  StatsReport, StatsScope,
} from '../../../shared/types.ts'
import { api } from './client.ts'
import { qk } from './keys.ts'
import { statsPath, wtPath } from './queries.ts'

// Les mutations renvoient leur réponse : les pages gardent la main sur les messages (toast) via mutateAsync.
// Après une écriture, seul ce qui a pu changer est rechargé.

/**
 * Recalcule la vue du projet côté serveur (GitHub, Linear) et la pose dans le cache, puis invalide
 * les worktrees du projet. Sert après toute écriture distante.
 */
export async function syncProject(qc: QueryClient, project: string, opts: { wt?: string; files?: boolean } = {}) {
  const ov = await api<ProjectOverview>(`/projects/${project}/overview?refresh=1`).catch(() => null)
  if (ov) qc.setQueryData(qk.overview(project), ov)
  await Promise.all([
    qc.invalidateQueries({ queryKey: qk.worktree(project, opts.wt) }),
    opts.files ? qc.invalidateQueries({ queryKey: qk.files(project, opts.wt) }) : null,
  ])
}

/**
 * Bouton « Tout actualiser » : chaque PR du projet est relue sur GitHub (CI, commentaires, contrôles des bots,
 * fichiers, frise), ainsi que Linear et les SDK, sans passer par les caches du serveur.
 */
export function useRefreshProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (project?: string) => {
      if (project) qc.setQueryData(qk.overview(project), await api<ProjectOverview>(`/projects/${project}/refresh`, { method: 'POST' }))
      await Promise.all([
        project ? qc.invalidateQueries({ queryKey: qk.worktree(project) }) : null,
        project ? qc.invalidateQueries({ queryKey: qk.files(project) }) : null,
        qc.invalidateQueries({ queryKey: ['threads'] }),
        qc.invalidateQueries({ queryKey: ['pending-review'] }),
        qc.invalidateQueries({ queryKey: qk.runs() }),
        qc.invalidateQueries({ queryKey: qk.health }),
        qc.invalidateQueries({ queryKey: qk.actionsStatus }),
      ])
    },
  })
}

/** Relit l'usage Claude sans attendre le cache serveur (1 minute). */
export function useRefreshClaudeUsage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<ClaudeUsage>('/claude/usage?refresh=1'),
    onSuccess: (u) => qc.setQueryData(qk.claudeUsage, u),
  })
}

// ---------- Projets ----------

export function useAddProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { url: string; path?: string; team?: string }) => api<Project>('/projects', { body }),
    onSuccess: (p) => {
      qc.setQueryData<Project[]>(qk.projects, (old) => [...(old ?? []).filter((x) => x.id !== p.id), p])
    },
  })
}

/** Retire un projet de Shipyard (le clone et ses worktrees restent sur le disque). */
export function useRemoveProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api(`/projects/${id}`, { method: 'DELETE' }),
    onSuccess: (_, id) => {
      qc.setQueryData<Project[]>(qk.projects, (old) => old?.filter((p) => p.id !== id))
      qc.removeQueries({ queryKey: qk.overview(id) })
    },
  })
}

export function useLinkTeam(project: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (team: string) => api<Project>(`/projects/${project}`, { method: 'PATCH', body: { team } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.projects })
      await syncProject(qc, project)
    },
  })
}

/** Range le projet dans un groupe de projets liés (null : le sort de son groupe). */
export function useSetProjectGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ project, group }: { project: string; group: string | null }) => api<Project>(`/projects/${project}`, { method: 'PATCH', body: { group } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.projects }),
  })
}

// ---------- Worktrees et branches ----------

/** Associe un worktree à celui d'un autre projet du groupe : les deux vues sont recalculées. */
export function useLinkWorktree(project: string, wt: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (other: { project: string; wt: string }) => api(`${wtPath(project, wt)}/links`, { body: other }),
    onSuccess: (_, other) => Promise.all([syncProject(qc, project, { wt }), syncProject(qc, other.project, { wt: other.wt })]),
  })
}

/** Retire ce worktree de ses associations. linked : projets des worktrees qui lui étaient liés, à recalculer aussi. */
export function useUnlinkWorktree(project: string, wt: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (_linked: string[]) => api(`${wtPath(project, wt)}/links`, { method: 'DELETE' }),
    onSuccess: (_, linked) => Promise.all([syncProject(qc, project, { wt }), ...[...new Set(linked)].map((p) => syncProject(qc, p))]),
  })
}

export function useCreateWorktree(project: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { mode: string; branch?: string; base?: string; ticketId?: string; prNumber?: number }) =>
      api<{ id: string; path: string }>(`/projects/${project}/worktrees`, { body }),
    onSuccess: () => syncProject(qc, project),
  })
}

/** Recrée le worktree dans un autre projet (même branche, même ticket) et supprime l'original. */
export function useMoveWorktree(project: string, wt: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (target: string) => api<{ path: string; id: string }>(`${wtPath(project, wt)}/move`, { body: { project: target } }),
    onSuccess: async (_, target) => {
      qc.removeQueries({ queryKey: qk.worktree(project, wt) })
      await Promise.all([syncProject(qc, project), syncProject(qc, target)])
    },
  })
}

/** Branche + worktree d'une proposition « Features & optimisations », gardée comme ticket local. */
export function useCreateLocalTicketWorktree(project: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { branch: string; item: InsightItem }) => api<{ path: string; id: string }>(`/projects/${project}/local-tickets`, { body: input }),
    onSuccess: () => syncProject(qc, project),
  })
}

/** Le ticket local devient un ticket Linear lié au worktree. */
export function usePromoteLocalTicket(project: string, wt: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<CreatedTicket>(`${wtPath(project, wt)}/local-ticket/promote`, { method: 'POST' }),
    onSuccess: () => syncProject(qc, project, { wt }),
  })
}

export function useRemoveLocalTicket(project: string, wt: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api(`${wtPath(project, wt)}/local-ticket`, { method: 'DELETE' }),
    onSuccess: () => syncProject(qc, project, { wt }),
  })
}

/** Supprime des tickets locaux dont le worktree n'existe plus. */
export function useDeleteOrphanLocalTickets() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (paths: string[]) => api('/local-tickets/orphans/delete', { body: { paths } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.localTicketOrphans }),
  })
}

export function useRemoveWorktree(project: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (wt: string) => api(wtPath(project, wt), { method: 'DELETE' }),
    onSuccess: async (_, wt) => {
      qc.removeQueries({ queryKey: qk.worktree(project, wt) })
      await syncProject(qc, project)
    },
  })
}

/** Aboutit un worktree à PR mergée : ticket Linear en Done, worktree supprimé. */
export function useFinishWorktree(project: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (wt: string) => api<{ ticket: { id: string; state: string } | null }>(`${wtPath(project, wt)}/finish`, { method: 'POST' }),
    onSuccess: async (_, wt) => {
      qc.removeQueries({ queryKey: qk.worktree(project, wt) })
      await syncProject(qc, project)
    },
  })
}

export function useCreateBranch(project: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { branch: string; base: string }) => api(`/projects/${project}/branches`, { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.branches(project) }),
  })
}

/** Relit mes branches en forçant le serveur à recalculer (créateur, PR, commits non poussés). */
export function useRefreshMyBranches(project: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<BranchInfo[]>(`/projects/${project}/branches/mine?refresh=1`),
    onSuccess: (list) => qc.setQueryData(qk.myBranches(project), list),
  })
}

export function useDeleteBranches(project: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { names: string[]; local: boolean; remote: boolean; discard: boolean }) => api<BranchDeleteResult[]>(`/projects/${project}/branches/delete`, { body }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.myBranches(project) })
      await syncProject(qc, project)
    },
  })
}

export function useCleanupWorktrees(project: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { paths: string[]; discard: boolean; deleteBranch: boolean }) => api<BranchDeleteResult[]>(`/projects/${project}/worktrees/cleanup`, { body }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.worktreeCleanup(project) })
      await syncProject(qc, project)
    },
  })
}

export function useOpenInEditor(project: string, wt: string) {
  return useMutation({ mutationFn: (file?: string) => api(`${wtPath(project, wt)}/open`, { body: file ? { file } : {} }) })
}

// ---------- Linear ----------

/** Change le statut d'un ticket. Optimiste : la vue du projet et le worktree affichent le nouveau statut tout de suite. */
export function useSetTicketState(project: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ticket, state }: { ticket: string; state: TicketState }) => api(`/projects/${project}/tickets/${ticket}/state`, { body: { stateId: state.id } }),
    onMutate: async ({ ticket, state }) => {
      await qc.cancelQueries({ queryKey: qk.overview(project) })
      const prevOverview = qc.getQueryData<ProjectOverview>(qk.overview(project))
      const patch = <T extends { id: string; status: string; statusType: string }>(t: T): T =>
        t.id === ticket ? { ...t, status: state.name, statusType: state.type === 'duplicate' ? 'canceled' : state.type } : t
      qc.setQueryData<ProjectOverview>(qk.overview(project), (ov) => ov && { ...ov, tickets: ov.tickets.map(patch) })
      qc.setQueriesData<WorktreeDetail>({ queryKey: qk.worktree(project) }, (d) => d && (d.ticket?.id === ticket ? { ...d, ticket: patch(d.ticket) } : d))
      return { prevOverview }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prevOverview) qc.setQueryData(qk.overview(project), ctx.prevOverview)
      void qc.invalidateQueries({ queryKey: qk.worktree(project) })
    },
    onSettled: () => syncProject(qc, project),
  })
}

export function useCreateLinearIssues(project: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { runId: string; issues: (NewIssue & { index: number })[] }) =>
      api<{ created: (CreatedTicket & { index: number })[]; error: string | null }>(`/projects/${project}/linear/issues`, { body }),
    onSuccess: async (res, { runId }) => {
      qc.setQueryData(qk.createdTickets(runId), res.created)
      await syncProject(qc, project)
    },
    // Le serveur enregistre chaque ticket dès sa création : après une erreur, on relit ce qui a été créé.
    onError: (_e, { runId }) => qc.invalidateQueries({ queryKey: qk.createdTickets(runId) }),
  })
}

// ---------- PR ----------

export function useCreatePr(project: string, wt: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api<{ url: string; commits: string[]; label: string | null; videoRunId: string | null }>(`${wtPath(project, wt)}/pr`, { body }),
    onSuccess: () => syncProject(qc, project),
  })
}

export function useRerequestReview(project: string, wt: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (reviewers: string[]) => api<{ added: string[]; removed: string[] }>(`${wtPath(project, wt)}/rerequest`, { body: { reviewers } }),
    onSuccess: () => syncProject(qc, project, { wt }),
  })
}

/** Lie un ticket Linear à un worktree existant (null : revient au ticket déduit de la branche). */
export function useLinkTicket(project: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ wt, ticketId }: { wt: string; ticketId: string | null }) => api(`${wtPath(project, wt)}/ticket`, { method: 'PUT', body: { ticketId } }),
    onSuccess: (_, { wt }) => Promise.all([
      qc.invalidateQueries({ queryKey: qk.overview(project) }),
      qc.invalidateQueries({ queryKey: qk.worktree(project, wt) }),
    ]),
  })
}

/** Répond à un fil et le résout : la liste des fils et les compteurs « à traiter » sont rechargés. */
export function useReplyThread(project: string, wt: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { threadId: string; body: string; resolve: boolean }) => api(`${wtPath(project, wt)}/threads/reply`, { body }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.threads(project, wt) })
      await syncProject(qc, project, { wt, files: true })
    },
  })
}

/** Marque un fichier comme vu sur GitHub. Optimiste : la case est cochée tout de suite, annulée si GitHub refuse. */
export function useSetFileViewed(project: string, wt: string) {
  const qc = useQueryClient()
  const key = qk.files(project, wt)
  return useMutation({
    mutationFn: ({ prId, path, viewed }: { prId: string; path: string; viewed: boolean }) => api(`${wtPath(project, wt)}/files/viewed`, { body: { prId, path, viewed } }),
    onMutate: async ({ path, viewed }) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<PrFiles>(key)
      qc.setQueryData<PrFiles>(key, (old) => old && { ...old, files: old.files.map((f) => (f.path === path ? { ...f, viewed } : f)) })
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev)
    },
  })
}

export function useRerunCi(project: string, wt: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { runId: string; jobId?: string | null }) => api(`${wtPath(project, wt)}/ci/rerun`, { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.worktree(project, wt) }),
  })
}

/** Fusion de la base en cours : annulation, ou commit + push une fois les conflits résolus. */
export function useMergeAction(project: string, wt: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (what: 'abort' | 'finish') => api<{ url?: string }>(`${wtPath(project, wt)}/merge/${what}`, { method: 'POST' }),
    onSuccess: () => syncProject(qc, project, { wt, files: true }),
  })
}

// ---------- Review ----------

export function useAddPendingComments(project: string, wt: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (comments: (ReviewDraftComment & { key: string })[]) =>
      api<{ results: { key: string; commentId: string | null; error: string | null }[] }>(`${wtPath(project, wt)}/review/pending`, { body: { comments } }),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.pendingReview(project, wt) }),
  })
}

/** Retire un commentaire de ma review en attente. Optimiste sur la liste des commentaires en attente. */
export function useRemovePendingComment(project: string, wt: string) {
  const qc = useQueryClient()
  const key = qk.pendingReview(project, wt)
  return useMutation({
    mutationFn: (commentId: string) => api(`${wtPath(project, wt)}/review/pending/${encodeURIComponent(commentId)}`, { method: 'DELETE' }),
    onMutate: (commentId) => {
      qc.setQueryData<PendingReview | null>(key, (p) => p && { ...p, comments: p.comments.filter((c) => c.id !== commentId) })
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  })
}

export function useDiscardPendingReview(project: string, wt: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api(`${wtPath(project, wt)}/review/pending`, { method: 'DELETE' }),
    onSuccess: () => qc.setQueryData(qk.pendingReview(project, wt), null),
  })
}

export function useSubmitReview(project: string, wt: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { event: ReviewEvent; body: string }) =>
      api<{ url: string; labels?: { added: string[]; removed: string[] } }>(`${wtPath(project, wt)}/review/submit`, { body }),
    onSuccess: async () => {
      qc.setQueryData(qk.pendingReview(project, wt), null)
      await syncProject(qc, project, { wt })
    },
  })
}

/**
 * Tri d'une review (approuvés, ignorés, textes) : écrit tout de suite dans le cache, puis enregistré par le serveur.
 * Chaque clic est instantané ; l'enregistrement ne bloque rien.
 */
export function useSaveReviewDecisions(run: string | null, empty: ReviewDecisions) {
  const qc = useQueryClient()
  const key = qk.reviewDecisions(run)
  const save = useMutation({ mutationFn: (next: ReviewDecisions) => api(`/runs/${run}/review-decisions`, { method: 'PUT', body: next }) })
  return {
    ...save,
    update: (patch: Partial<ReviewDecisions>, onError?: (e: Error) => void) => {
      const next = { ...empty, ...qc.getQueryData<ReviewDecisions>(key), ...patch }
      qc.setQueryData(key, next)
      save.mutate(next, { onError })
    },
  }
}

// ---------- Runs ----------

/** Décision sur le travail d'un agent (approuvé, refusé, refusé en annulant les changements). */
export function useRunDecision(project: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ run, decision, discard }: { run: string; decision: 'approved' | 'declined'; discard?: boolean }) =>
      api(`/runs/${run}/decision`, { body: { decision, discard: !!discard } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.runs() })
      await syncProject(qc, project)
    },
  })
}

/** Ajoute ou retire des labels sur la PR du worktree (écrit sur GitHub), puis recalcule la vue. */
export function useEditPrLabels(project: string, wt: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (change: { add?: string[]; remove?: string[] }) => api(`${wtPath(project, wt)}/labels`, { body: change }),
    onSuccess: () => syncProject(qc, project, { wt }),
  })
}

/** Termine un agent orphelin (sans run) et tout ce qu'il a lancé. */
/** Worktree abîmé : restaurer ses fichiers suivis, ou le retirer. La vue des projets est recalculée. */
export function useRepairWorktree() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ project, id, action }: { project: string; id: string; action: 'restore' | 'remove' }) =>
      api(`/worktrees/broken/${project}/${id}/${action}`, { method: 'POST' }),
    onSuccess: (_r, { project }) => Promise.all([
      qc.invalidateQueries({ queryKey: qk.brokenWorktrees }),
      qc.invalidateQueries({ queryKey: qk.overview(project) }),
      qc.invalidateQueries({ queryKey: qk.worktree(project) }),
    ]),
  })
}

export function useKillOrphan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (pgid: number) => api(`/agents/${pgid}/kill`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.agents }),
  })
}

/**
 * Abandonne le plan et/ou le travail d'un worktree : agents arrêtés, fichiers qu'ils ont changés remis (worktrees liés
 * compris), runs écartés. all : sans photo d'avant le travail, annule toutes les modifications non commitées.
 */
export function useAbandonAgent(project: string, wt: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: { plan?: string; work?: string; all?: boolean }) => api<{ reverted: 'agent' | 'all' | 'none'; needsAll: boolean }>(`${wtPath(project, wt)}/abandon`, { body: ids }),
    onSuccess: async (r, ids) => {
      // Les runs suivis gardent leur dernière version en cache : on y reporte l'abandon.
      if (!r.needsAll) for (const id of [ids.plan, ids.work]) if (id) qc.setQueryData<Run>(['run', id], (x) => (x ? { ...x, decision: 'declined' } : x))
      await qc.invalidateQueries({ queryKey: qk.runs() })
      await syncProject(qc, project, { wt, files: true })
    },
  })
}

// ---------- Prompts et règles ----------

export function useSavePrompt(source: 'prompt' | 'rule') {
  const qc = useQueryClient()
  const base = source === 'rule' ? '/rules' : '/prompts'
  return useMutation({
    mutationFn: ({ key, content, projects }: { key: string; content: string; projects?: string[] }) =>
      api(`${base}/${key}`, { method: 'PUT', body: projects ? { content, projects } : { content } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.prompts }),
  })
}

export function useResetPrompt(source: 'prompt' | 'rule') {
  const qc = useQueryClient()
  const base = source === 'rule' ? '/rules' : '/prompts'
  return useMutation({
    mutationFn: (key: string) => api(`${base}/${key}/reset`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.prompts }),
  })
}

export function useCreateRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => api<{ key: string }>('/rules', { body: { name, projects: ['all'] } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.prompts }),
  })
}

// ---------- Notes ----------
// Optimistes : la liste change au clic, le serveur suit ; en cas d'erreur, la liste est relue.

export function useCreateNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { text: string; project: string | null }) => api<Note>('/notes', { body }),
    onSuccess: (note) => qc.setQueryData<Note[]>(qk.notes, (old) => [note, ...(old ?? [])]),
  })
}

export function useUpdateNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string } & Partial<Pick<Note, 'text' | 'done' | 'project'>>) => api<Note>(`/notes/${id}`, { method: 'PATCH', body: patch }),
    onMutate: ({ id, ...patch }) => {
      qc.setQueryData<Note[]>(qk.notes, (old) => old?.map((n) => (n.id === id ? { ...n, ...patch } : n)))
    },
    onError: () => qc.invalidateQueries({ queryKey: qk.notes }),
  })
}

export function useDeleteNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api(`/notes/${id}`, { method: 'DELETE' }),
    onMutate: (id) => {
      qc.setQueryData<Note[]>(qk.notes, (old) => old?.filter((n) => n.id !== id))
    },
    onError: () => qc.invalidateQueries({ queryKey: qk.notes }),
  })
}

// ---------- Réglages ----------

export function useSaveSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => api<Settings>('/settings', { method: 'PUT', body: patch }),
    onSuccess: (s, patch) => {
      qc.setQueryData(qk.settings, s)
      // Les labels reconnus changent les compteurs « à faire » de chaque projet.
      if (patch.labels) void qc.invalidateQueries({ queryKey: ['overview'] })
    },
  })
}

export function useTestNotification() {
  return useMutation({ mutationFn: () => api('/notifications/test', { method: 'POST' }) })
}

/** Change une clé de connexion : toutes les données venant de GitHub ou Linear sont rechargées avec le nouveau compte. */
export function useSaveCredentials() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { linearKey?: string | null; githubToken?: string | null }) => api<Credentials>('/settings/credentials', { method: 'PUT', body }),
    onSuccess: async (c) => {
      qc.setQueryData(qk.credentials, c)
      await qc.invalidateQueries()
    },
  })
}

// ---------- À valider ----------

/** Écarte un élément de « À valider » (déjà traité ailleurs, ou sans intérêt). Optimiste. */
export function useDismissInbox() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (runId: string) => api(`/inbox/${runId}/dismiss`, { method: 'POST' }),
    onMutate: (runId) => {
      qc.setQueryData<InboxItem[]>(qk.inbox, (old) => old?.filter((i) => i.runId !== runId))
    },
    onError: () => qc.invalidateQueries({ queryKey: qk.inbox }),
  })
}

/** Claude Code : ouvre la connexion dans un Terminal (login) ou déconnecte le compte (logout). */
export function useClaudeAuth() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (action: 'login' | 'logout') => api<Credentials>(`/settings/claude/${action}`, { method: 'POST' }),
    onSuccess: (c) => {
      qc.setQueryData(qk.credentials, c)
      void qc.invalidateQueries({ queryKey: qk.health })
    },
  })
}

/** Ouvre la page de connexion GitHub dans le Chrome de Shipyard ; l'état est relu une fois la fenêtre fermée. */
export function useGithubBrowserLogin() {
  return useMutation({ mutationFn: () => api('/settings/github-browser/login', { method: 'POST' }) })
}

/** Tri des fichiers non commités avant une fusion : commite ceux à garder, annule les autres. */
export function useApplyDirty(project: string, wt: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { commit: string[]; discard: string[]; title: string | null }) => api<{ sha: string | null; remaining: number }>(`${wtPath(project, wt)}/dirty/apply`, { body }),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.worktree(project, wt) }),
  })
}

/** Enregistre la mémoire des tests du projet, ou celle d'une branche (wt). */
export function useStopManualEnv(project: string, wt: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api(`${wtPath(project, wt)}/manual-env`, { method: 'DELETE' }),
    onSuccess: () => qc.setQueryData(qk.manualEnv(project, wt), null),
  })
}

export function useOpenManualEnv(project: string, wt: string) {
  return useMutation({ mutationFn: () => api(`${wtPath(project, wt)}/manual-env/open`, { method: 'POST' }) })
}

export function useSaveTestMemory(project: string, wt?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (text: string) => api<{ text: string }>(wt ? `${wtPath(project, wt)}/test-memory` : `/projects/${project}/test-memory`, { method: 'PUT', body: { text } }),
    onSuccess: (r) => qc.setQueryData(wt ? qk.branchTestMemory(project, wt) : qk.testMemory(project), r),
  })
}

// ---------- Test manuel ----------

/** Étapes cochées d'un test manuel : gardées sur son run, elles comptent pour l'étape « Tests » et la PR. */
export function useSaveManualSteps(project: string, wt: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ runId, checked }: { runId: string; checked: number[] }) => api(`/runs/${runId}/manual-steps`, { method: 'PUT', body: { checked } }),
    onSuccess: (_, { runId, checked }) => {
      qc.setQueryData<Run>(qk.run(runId), (r) => r && { ...r, manualChecked: checked })
      return qc.invalidateQueries({ queryKey: qk.worktree(project, wt) })
    },
  })
}

/** Ma décision sur la vérification d'une étape : elle remplace le verdict de l'IA. */
export function useSetCheckDecision(project: string, wt: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ runId, decision }: { runId: string; decision: 'pass' | 'fail' | null }) => api(`/runs/${runId}/check-decision`, { method: 'PUT', body: { decision } }),
    onSuccess: (_, { runId, decision }) => {
      qc.setQueryData<Run>(qk.run(runId), (r) => r && { ...r, checkDecision: decision })
      return qc.invalidateQueries({ queryKey: qk.worktree(project, wt) })
    },
  })
}

/** Relit GitHub et Linear pour la période, sans le cache du serveur. */
export function useRefreshStats(from: string, to: string, scope: StatsScope) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<StatsReport>(statsPath(from, to, scope, true)),
    onSuccess: (report) => qc.setQueryData(qk.stats(from, to, scope), report),
  })
}

// ---------- Ghosts ----------

/** Met de côté une PR ou un worktree (clé `pr:<numéro>` ou `wt:<id>`) : il sort de « À toi » jusqu'à son réveil. */
export function useSetGhost(project: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ key, note }: { key: string; note: string | null }) => api(`/projects/${project}/ghosts/${encodeURIComponent(key)}`, { method: 'PUT', body: { note } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.overview(project) }),
  })
}

export function useWakeGhost(project: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (key: string) => api(`/projects/${project}/ghosts/${encodeURIComponent(key)}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.overview(project) }),
  })
}

/** Worktrees des tickets qui viennent d'être créés, l'un après l'autre (chacun touche au dépôt). */
export function useCreateTicketWorktrees(project: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (items: { ticketId: string; branch: string; base: string }[]) => {
      const created: { ticketId: string; id: string }[] = []
      for (const it of items) {
        const r = await api<{ id: string; path: string }>(`/projects/${project}/worktrees`, { body: { mode: 'ticket', branch: it.branch, base: it.base, ticketId: it.ticketId } })
        created.push({ ticketId: it.ticketId, id: r.id })
      }
      return created
    },
    onSettled: () => syncProject(qc, project),
  })
}
