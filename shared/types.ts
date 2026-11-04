// Contrat partagé entre le serveur (server/) et le front (web/).

export type TicketStatusType = 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled' | 'triage'

export interface Project {
  id: string
  name: string
  repo: string // owner/name
  path: string // clone local
  team: string | null // clé d'équipe Linear (ex. ENG)
  baseBranch: string
  worktreeRoot: string
  /** Groupe de projets liés (ex. « shop » pour l'API, le web et le mobile) : leurs worktrees peuvent être associés. */
  group?: string | null
}

export interface CreateWorktreeInput {
  mode: 'ticket' | 'new' | 'existing' | 'review'
  branch?: string
  base?: string
  ticketId?: string
  prNumber?: number
}

export interface Ticket {
  id: string // ENG-142
  title: string
  description: string
  status: string // nom affiché par Linear
  statusType: TicketStatusType
  priority: string
  assignee: string | null
  isMine: boolean
  updatedAt: string
  url: string
  labels: string[]
  type: 'feat' | 'fix' | 'chore' | 'refactor'
}

export interface TicketState {
  id: string
  name: string
  type: TicketStatusType | 'duplicate'
  color: string
}

export type WorktreeKind = 'mine' | 'review' | 'none'

export interface Worktree {
  id: string // chemin encodé en base64url
  path: string
  branch: string | null
  head: string
  isMain: boolean
  ticketId: string | null
  /** Ticket lié à la main dans Shipyard, au lieu d'être déduit de la branche ou de la PR. */
  ticketLinked?: boolean
  prNumber: number | null
  kind: WorktreeKind
  /** Ma PR de cette branche, mergée : le worktree attend d'être abouti (ticket en Done, worktree supprimé). */
  /** state CLOSED : PR fermée sans merge (review d'une PR abandonnée). Absent : mergée. */
  merged?: { number: number; title: string; url: string; mergedAt: string | null; state?: 'MERGED' | 'CLOSED' } | null
  /** Worktrees d'autres projets du groupe associés à celui-ci (même feature, même review). */
  links?: WorktreeLink[]
  /** Ticket local (proposition gardée sur le Mac, sans ticket Linear) : sert de description au plan et au travail. */
  localTicket?: LocalTicket | null
}

/** Proposition de « Features & optimisations » enregistrée avec son worktree, à la place d'un ticket Linear. */
export interface LocalTicket {
  project: string
  path: string
  branch: string
  title: string
  category: string
  why: string
  proposal: string
  files: string[]
  risk: string
  createdAt: string
}

export interface WorktreeLink {
  project: string
  /** Identifiant du worktree dans son projet (chemin encodé). */
  id: string
  path: string
}

export type CheckState = 'pass' | 'fail' | 'running' | 'pending' | 'skipped'

export interface CiJob {
  id: string
  name: string
  workflow: string | null
  state: CheckState
  url: string | null
  runId: string | null
  jobId: string | null
  duration: string | null
}

export interface CiSummary {
  state: 'pass' | 'fail' | 'running' | 'none'
  failing: number
  total: number
  jobs: CiJob[]
}

export interface PullRequest {
  number: number
  title: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  url: string
  author: string
  head: string
  base: string
  isDraft: boolean
  additions: number
  deletions: number
  changedFiles: number
  createdAt: string
  updatedAt: string
  reviewDecision: string | null
  ticketId: string | null
  /** Frise de la PR (vue du projet et détail d'un worktree). */
  timeline?: TimelineEvent[]
  ci: CiSummary
  unresolvedThreads: number
  mine: boolean
  labels: { name: string; color: string }[]
  /** Dernière review de chaque reviewer. */
  reviews: { login: string; state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING' }[]
  /** Reviewers dont la review est actuellement demandée. */
  requestedReviewers: string[]
  /** En conflit avec sa branche de base (calculé par GitHub). */
  conflicts: boolean
  /** GitHub n'a pas encore recalculé les conflits (ex. la base vient de bouger) : rien n'est garanti. */
  conflictsUnknown?: boolean
}

export interface BranchInfo {
  name: string
  /** Auteur du premier commit propre à la branche (ou du dernier si elle n'a plus de commit propre). */
  creator: string
  /** Créée par moi, ou porteuse d'une de mes PR. Seules ces branches peuvent être supprimées. */
  mine: boolean
  local: boolean
  remote: boolean
  lastCommitAt: string
  lastCommitSubject: string
  ahead: number // commits absents de la base
  behind: number
  unpushed: number // commits locaux non poussés
  worktree: string | null
  /** Fichiers modifiés non commités dans le worktree de la branche. */
  dirty: number
  pr: { number: number; state: 'OPEN' | 'MERGED' | 'CLOSED'; title: string; url: string; mergedAt: string | null } | null
  /** Ce que le panel conseille. */
  suggestion: 'delete-merged' | 'delete-closed' | 'stale' | 'keep'
  protected: boolean
}

export interface WorktreeCleanupInfo {
  id: string
  path: string
  branch: string | null
  kind: WorktreeKind
  ticket: { id: string; status: string; done: boolean } | null
  pr: { number: number; state: 'OPEN' | 'MERGED' | 'CLOSED'; mine: boolean; url: string } | null
  /** Pour un worktree de review : ma review est-elle déjà envoyée ? */
  reviewed: boolean | null
  lastCommitAt: string | null
  dirty: number
  unpushed: number
  suggestion: 'ticket-done' | 'pr-merged' | 'pr-closed' | 'review-done' | 'stale' | 'keep'
  reason: string
}

export interface BranchDeleteResult {
  name: string
  ok: boolean
  done: string[]
  error?: string
}

export interface TodoCounts {
  /** Mes PR avec des commentaires à traiter (une tâche par PR). */
  comments: number
  todo: number
  reviews: number
  /** Mes PR dont la CI échoue (une tâche par PR). */
  ci: number
  /** Mes PR dont les commentaires sont traités mais où il faut relancer la review. */
  rerequest: number
  /** Mes PR marquées « Ready for testing » : à tester. */
  testing: number
  /** Mes PR en conflit avec leur branche de base. */
  conflicts: number
  /** Mes PR avec un label « à corriger » mais sans commentaire ouvert. */
  changes: number
  total: number
}

/**
 * Groupe de la file d'attente. me : m'attend (seul groupe compté, partout) ; start : ticket à démarrer ;
 * progress : branche en cours sans PR ; others : attend quelqu'un d'autre ou la CI ; clean : à ranger.
 */
export type QueueGroup = 'me' | 'start' | 'progress' | 'others' | 'clean' | 'ghost'

/**
 * PR ou worktree mis de côté, statut propre à Shipyard (rien n'est changé sur GitHub) : il sort de « À toi », des
 * compteurs, de « À valider » et des notifications, jusqu'à ce que je le réveille.
 */
export interface Ghost {
  at: string
  /** Pourquoi je le laisse de côté, pour m'en souvenir. */
  note: string | null
}
export type QueueTone = 'red' | 'amber' | 'purple' | 'green' | 'blue' | 'gray'

/** Une ligne de la file d'attente : ce qu'il y a à faire, pourquoi, et où le faire. */
export interface QueueItem {
  key: string
  group: QueueGroup
  /** Gravité de la raison principale : couleur de la ligne. */
  tone: QueueTone
  kind: 'mine' | 'review' | 'branch' | 'ticket' | 'agent'
  title: string
  /** #512, ENG-240… */
  ref: string | null
  worktree: string | null
  prNumber: number | null
  ticketId: string | null
  /** Raisons, de la plus urgente à la moins urgente. */
  reasons: { label: string; tone: QueueTone }[]
  /** Ligne secondaire (taille, attente, auteur). */
  detail: string | null
  /** Action principale : un panneau du worktree (tab), une page interne (href) ou un lien externe (url). */
  action: { label: string; tab?: string; href?: string; url?: string } | null
  /** Depuis quand la ligne attend (tri, ancienneté). */
  since: string | null
  /** Résultat d'agent (kind agent) : son run, pour l'écarter ; s'il disparaît à l'ouverture, et sinon quand. */
  runId?: string
  clearsOnOpen?: boolean
  until?: string
  /** Mis de côté (groupe ghost). */
  ghost?: Ghost
}

export interface ProjectOverview {
  project: Project
  /** Mes ghosts du projet, par clé de ligne de la file (`pr:<numéro>` ou `wt:<id>`). */
  ghosts: Record<string, Ghost>
  worktrees: Worktree[]
  tickets: Ticket[]
  myPrs: PullRequest[]
  reviewPrs: PullRequest[]
  /** PR où ma review est attendue : demandée sur GitHub ou label « Waiting review » (les autres sont déjà reviewées). */
  requestedReviews: number[]
  todo: TodoCounts
  /** File d'attente du projet : une ligne par PR, branche ou ticket, rangée par ce qu'elle attend (voir shared/queue.ts). */
  queue: QueueItem[]
  linearConfigured: boolean
  errors: string[]
  fetchedAt: string
}

export interface ThreadComment {
  id: string
  author: string
  body: string
  createdAt: string
  url: string
}

export interface ReviewThread {
  id: string
  path: string
  line: number | null
  isResolved: boolean
  isOutdated: boolean
  /** Le dernier message est de moi : la balle est dans le camp du reviewer. */
  awaitingReviewer: boolean
  /** Fil d'une review en attente (brouillon jamais envoyé) : visible par moi seul, ce n'est pas un échange. */
  isDraft: boolean
  /** Fil ouvert par moi (premier commentaire) : sur la PR d'un autre, c'est un retour que j'ai fait. */
  byMe: boolean
  /** Résolu par moi : point tranché (correctif validé ou argument accepté), à ne pas rouvrir. */
  resolvedByMe: boolean
  /** Lignes commentées, côté PR (tirées du diff du premier commentaire) : une suggestion s'affiche en diff contre elles. */
  code?: string[]
  comments: ThreadComment[]
}

export interface DiffLine {
  t: ' ' | '+' | '-' | '@'
  o: number | null
  n: number | null
  code: string
}

/** Version précédente d'un prompt ou d'une règle : le texte d'avant une séance de modification. */
export interface PromptVersion {
  id: string
  savedAt: string
  content: string
}

export interface DiffFile {
  path: string
  additions: number
  deletions: number
  viewed: boolean
  lines: DiffLine[]
  truncated: boolean
}

export interface WorktreeDetail {
  project: Project
  worktree: Worktree
  ticket: Ticket | null
  pr: PullRequest | null
  commitsAhead: string[]
  dirtyFiles: { status: string; path: string }[]
  /** Fusion de la base en cours (résolution de conflits), sinon null. */
  merge: MergeState | null
  /** Commits de la base (origin/<base>, au dernier fetch) absents de la branche : « Récupérer <base> ». */
  behindBase: number
  /** Commits de ma propre branche sur GitHub (origin/<branche>, au dernier fetch) absents en local : poussés par quelqu'un d'autre. */
  behindRemote: number
  /** Auteurs de ces commits. */
  remoteAuthors: string[]
  /** Worktrees associés (projets du groupe) et leurs fichiers non commités : commités avec ceux-ci. */
  linked?: LinkedDirty[]
  /** Où en sont les tests de la branche (IA et manuel). */
  tests: TestsSummary
  /** Dernière auto-review, null si jamais lancée. */
  selfReview: SelfReviewSummary | null
}

export interface TestsSummary {
  /** Un test IA ou la préparation d'un test manuel est en cours. */
  running: boolean
  /**
   * Dernier test IA terminé. failed : scénarios et tests de la suite en échec, dépôts en erreur.
   * toCheck : scénarios « à vérifier », qu'un test manuel mené jusqu'au bout suffit à couvrir.
   * Un test lancé depuis un worktree lié qui couvre aussi celui-ci compte pour les deux :
   * runId est alors le test de l'autre worktree, from le nom de son projet (null pour un test lancé d'ici).
   */
  ai: { failed: number; toCheck: number; at: string; runId: string; from: string | null } | null
  /** Dernier test manuel : étapes faites (cochées, ou conformes à leur vérification) sur le total. */
  manual: { done: number; total: number; at: string } | null
}

/**
 * Commentaire général de la PR, attaché à aucune ligne : texte d'une review (souvent le contexte des commentaires
 * de ligne, ex. « ici »), ou commentaire de la conversation. Bots exclus.
 */
export interface GeneralComment {
  kind: 'review' | 'comment'
  author: string
  body: string
  /** Review : son verdict (APPROVED, CHANGES_REQUESTED, COMMENTED…), null pour un commentaire. */
  state: string | null
  at: string
  url: string
}

/** Personne à qui demander une review de ma PR ; suggested : proposée par GitHub (elle connaît le code touché). */
export interface ReviewerCandidate {
  login: string
  name: string | null
  suggested: boolean
}

export interface SelfReviewSummary {
  running: boolean
  /** Date de la dernière auto-review terminée, null si aucune n'a encore abouti. */
  at: string | null
  findings: number
  /** Remarques sans décision, ou acceptées mais pas encore corrigées. */
  pending: number
  /** Remarques déjà corrigées, par n'importe quelle correction de cette auto-review (liste commune ou une par une). */
  fixed: string[]
}

export interface LinkedDirty {
  project: string
  name: string
  id: string
  path: string
  branch: string | null
  dirtyFiles: { status: string; path: string }[]
}

export interface MergeState {
  /** Branche fusionnée (ex. develop). */
  base: string | null
  /** Fichiers en conflit au moment de la fusion. */
  conflicted: string[]
  /** Parmi eux, ceux qui contiennent encore des marqueurs de conflit. */
  remaining: string[]
}

/** Fichiers non commités avant une fusion : ce que l'IA recommande pour chacun. */
export interface DirtyTriageOutput {
  summary: string
  files: { path: string; verdict: 'commit' | 'discard' | 'ask'; reason: string }[]
  commitTitle: string | null
}

/** Fusion validée : commit de fusion poussé. */
export interface MergeFinishOutput {
  url: string
}

/** « Récupérer <base> » : lien du commit de fusion poussé (null si la branche était déjà à jour). */
export interface BaseSyncOutput {
  url: string | null
  conflicts: number
}

export interface ConflictQuestion {
  id: string
  file: string
  question: string
  options: string[]
}

export interface ConflictResolveOutput {
  summary: string
  files: { file: string; status: 'résolu' | 'en attente'; resolution: string; risk: 'aucun' | 'faible' | 'à vérifier' }[]
  /** Points où l'agent a besoin de l'utilisateur : le conflit reste en place dans le fichier en attendant. */
  questions: ConflictQuestion[]
  checks: { name: string; status: 'pass' | 'fail' | 'skip'; detail: string }[]
}

/** prompt : prompts/*.md ; rule : rules/*.md (règles de dev utilisées par la review). */
export type PromptSource = 'prompt' | 'rule'

export interface PromptInfo {
  key: string
  source?: PromptSource
  /** Règles : projets auxquels elles s'appliquent (`all` pour tous). */
  projects?: string[]
  name: string
  group: string
  when: string
  vars: string[]
  model: string | null
  permissionMode: string
  allowedTools: string[]
  content: string
  defaultContent: string
  modified: boolean
  /** null : aucun agent lancé avec ce prompt sur la période (toujours null pour une règle). */
  cost: PromptCost | null
}

// ---------- Runs (exécutions de claude -p) ----------

export type RunStatus = 'running' | 'success' | 'error' | 'cancelled'

export type RunEvent =
  | { t: 'text'; text: string; sub?: string }
  /** at : moment de l'appel (ms), sert à monter la vidéo d'un test autour des actions. */
  | { t: 'tool'; name: string; summary: string; sub?: string; at?: number }
  | { t: 'info'; text: string }
  | { t: 'error'; text: string }
  /** Avancement d'un travail en plusieurs éléments (ex. 12 / 47 commentaires corrigés). at : moment (ms). */
  | { t: 'progress'; done: number; total: number; label: string; at: number }

/** Coût des agents lancés avec un prompt, sur les 30 derniers jours, en équivalent API. */
export interface PromptCost {
  runs: number
  totalUsd: number
  averageUsd: number
}

export interface RunSummary {
  id: string
  kind: ActionKind
  title: string
  status: RunStatus
  startedAt: string
  endedAt: string | null
  costUsd: number | null
  scope: RunScope
}

export interface Run extends RunSummary {
  /** Prompt (prompts/<clé>.md) donné à l'agent ; absent pour une tâche serveur. */
  promptKey?: string
  /** Ma décision sur le résultat (flux ticket) : les captures sont supprimées dès qu'elle est prise. */
  decision?: 'approved' | 'declined' | 'revised' | null
  /** Message de l'utilisateur à l'origine du run (ex. question sur un plan). */
  note?: string | null
  /** Demande initiale d'un plan, reprise lors des échanges et du travail. */
  request?: string | null
  /** Paramètres de l'action (POST /api/actions/:kind), gardés pour pouvoir la relancer à l'identique. */
  input?: ActionInput | null
  /** Test manuel (test-manual) : étapes que j'ai cochées. */
  manualChecked?: number[]
  /** Vérification d'une étape (test-check) : ma décision, qui prend le pas sur le verdict de l'IA. */
  checkDecision?: 'pass' | 'fail' | null
  /** Test IA (test, test-part) : ma réponse aux points « à vérifier », par nom de scénario. Un point tranché ne bloque plus l'étape « Tests ». */
  testDecisions?: Record<string, string>
  /** Correction appliquée mais commit refusé par un hook git : les changements attendent ma décision. */
  blockedCommit?: BlockedCommit | null
  events: RunEvent[]
  result: string | null
  structured: unknown
  sessionId: string | null
}

/**
 * Commit d'une correction refusé par un hook git (lint, typecheck, format du message…). Les changements restent
 * dans le worktree : Shipyard propose une solution, je l'approuve ou en donne une autre, puis il recommite.
 */
export interface BlockedCommit {
  title: string
  /** Dépôts encore à commiter, dans l'ordre (celui refusé en premier). */
  repos: { name: string; repo: string; path: string; branch: string }[]
  /** Commits déjà poussés par ce run, repris dans les « DONE ». */
  done: string[]
  /** Fils de review à clore par « DONE <commits> » une fois le commit passé. */
  threads: string[]
  /** Sortie du hook. */
  error: string
  /** Run qui a fini par commiter. */
  resolvedBy?: string | null
}

/** Solution proposée pour un commit refusé par un hook, à approuver avant d'être appliquée. */
export interface HookFixPlanOutput {
  cause: string
  proposal: string
  /** La solution désactive une règle (biome-ignore, ts-expect-error, oxlint-disable…). */
  disablesRule: boolean
  /** Titre corrigé si seul le message de commit est en cause, sinon null. */
  newTitle: string | null
}

/** GitHub Actions refuse de lancer les jobs d'un compte (paiement en échec, limite de dépenses atteinte…). */
export interface ActionsBlock {
  /** Organisation ou compte GitHub concerné. */
  owner: string
  /** Dépôt où le blocage a été constaté. */
  repo: string
  /** Message de GitHub. */
  reason: string
  at: string
}

/**
 * Paquet npm privé publié sur GitHub Packages par un autre dépôt (ex. @acme/sdk, publié par app) :
 * la version figée par la branche, la dernière publiée, et ce que le dépôt source n'a pas encore publié.
 */
export interface SdkStatus {
  name: string
  /** Contrainte du package.json (ex. ^1.193.1). */
  range: string
  /** Version figée par le lockfile (celle que la CI installe). */
  locked: string | null
  latest: string | null
  latestAt: string | null
  /** Dépôt qui publie le paquet, et le projet Shipyard qui le suit (s'il y en a un). */
  sourceRepo: string | null
  sourceProject: string | null
  /** Branche d'où le paquet est publié (base du projet source). */
  sourceBranch: string | null
  /** Ce qui est arrivé dans le dossier du paquet sur la branche source depuis la dernière version publiée (titres des merges). */
  unpublished: string[] | null
  /** Workflow qui publie le paquet ; dispatchable : il accepte un lancement à la demande. */
  workflow: { file: string; dispatchable: boolean } | null
  /** Dernier passage de ce workflow ; published : une version est sortie depuis son lancement. */
  lastRun: { status: string; conclusion: string | null; createdAt: string; url: string; published: boolean } | null
}

/** Mise à jour ou publication d'un SDK : version installée, et commit poussé (null si rien à commiter). */
export interface SdkActionOutput {
  version: string | null
  url: string | null
}

export interface RunScope {
  project: string
  worktree?: string
  pr?: number
  ref?: string // identifiant libre : thread, finding, job…
}

/** Paramètres d’une action IA, envoyés par l’interface. */
export interface ActionInput {
  project: string
  worktree?: string
  /** Identifiant de portée choisi par le front, pour retrouver le run après un rechargement. */
  ref?: string
  extra?: string
  ticketId?: string
  finding?: Finding
  /** Auto-review : les remarques acceptées, corrigées ensemble par un seul agent. */
  findings?: Finding[]
  threadId?: string
  /** Commentaire général de la PR (son url) : appliqué à toute la PR par general-fix. */
  commentUrl?: string
  action?: string
  job?: { id: string; name: string; workflow: string | null; jobId: string | null }
  commits?: { title: string; files: string[]; project?: string }[]
  feedback?: string
  previousRunId?: string
  planRunId?: string
  resumeFrom?: string
  ci?: { cause: string; fix: string }
  /** CI : diagnostics retenus, corrigés ensemble par un seul agent. */
  ciJobs?: { name: string; cause: string; fix: string }[]
  /** Paquet GitHub Packages (SDK) à mettre à jour ou à publier. */
  sdk?: string
  period?: DailyPeriod
  /** Daily sur une période choisie (AAAA-MM-JJ, bornes comprises) : remplace `period`. */
  since?: string
  until?: string
  /** Re-test d'un travail (resumeFrom) : captures et vérifications refaites, code inchangé. */
  retest?: boolean
  /** Features & optimisations : type d'analyse, et digest forcé en carte. */
  insights?: InsightsMode
  digest?: 'auto' | 'map'
  /** Valider et pousser une fusion : si le hook refuse, un agent corrige d'après sa sortie, puis le commit est retenté. */
  autofix?: boolean
  /** « Tout accepter » : ce que l'analyse propose pour chaque fil. */
  items?: { threadId: string; verdict: 'fix' | 'skip'; action?: string; reply?: string }[]
  /** Contrôles : le rapport (son marqueur) et, pour une correction, les problèmes choisis. */
  report?: string
  checkItems?: CheckItem[]
  /** Test de worktrees liés : ceux à tester (les autres gardent leur dernier résultat). Vide ou absent : tous. */
  testOnly?: string[]
  /** Test manuel : l'étape à vérifier, sa commande et ce qui est attendu. */
  step?: string
  command?: string
  expected?: string
}

/** ActionInput tel que l'interface l'envoie : un paramètre absent peut valoir null (le serveur le traite comme absent). */
export type ActionRequest = { [K in keyof ActionInput]?: ActionInput[K] | null }

export type ActionKind =
  | 'branch-name'
  | 'ticket-draft'
  | 'daily'
  | 'conflict-resolve'
  | 'merge-finish'
  | 'dirty-triage'
  | 'ticket-plan'
  | 'ticket'
  | 'change-plan'
  | 'change'
  | 'pr-prepare'
  | 'self-review'
  | 'finding-fix'
  | 'comments-analyze'
  | 'comment-fix'
  | 'general-fix'
  | 'comments-fix-all'
  | 'comment-reply'
  | 'review'
  | 'review-part'
  | 'self-review-part'
  | 'test'
  | 'test-part'
  | 'test-manual'
  | 'test-check'
  | 'pr-video'
  | 'checks-analyze'
  | 'hook-fix-plan'
  | 'base-sync'
  | 'branch-sync'
  | 'findings-fix-all'
  | 'ci-analyze-all'
  | 'ci-fix-all'
  | 'sdk-update'
  | 'sdk-publish'
  | 'hook-fix'
  | 'checks-fix'
  | 'ci-analyze'
  | 'ci-fix'
  | 'commit-plan'
  | 'commit-exec'
  | 'commit-fix'
  | 'followup-check'
  | 'insights'

// ---------- Sorties structurées des agents ----------

/** Digest d'un dépôt (façon gitingest) : complet pour un petit projet, sinon la carte (arborescence + fichiers structurants). */
export interface DigestInfo {
  path: string
  mode: 'full' | 'map'
  sha: string
  branch: string
  files: number
  excluded: number
  /** Tokens estimés de tous les fichiers analysés. */
  totalTokens: number
  /** Tokens estimés du digest produit. */
  digestTokens: number
  /** Le contenu complet tient dans le budget d'un agent. */
  fullPossible: boolean
}

export type InsightsMode = 'features' | 'improve'

/** Proposition de l'analyse « Features & optimisations ». */
export interface InsightItem {
  title: string
  /** Feature : « feature » ; amélioration : performance, sécurité, dette, tests, accessibilité, ux, dx, architecture. */
  category: string
  /** Constat ou besoin : pourquoi c'est utile, d'après le code. */
  why: string
  /** Ce qu'il faut faire, concrètement. */
  proposal: string
  files: string[]
  effort: 'S' | 'M' | 'L'
  impact: 'faible' | 'moyen' | 'fort'
  risk: string
}

export interface InsightsOutput {
  summary: string
  items: InsightItem[]
}

export type Severity = 'bloquant' | 'important' | 'suggestion'

export interface Finding {
  id: string
  file: string
  line: number
  severity: Severity
  title: string
  body: string
  fix: string
  /** Fil déjà ouvert sur le même sujet ou au même endroit : la réponse du développeur s'affiche avec la remarque. */
  relatedThreadId?: string | null
}

export interface ReviewOutput {
  summary: string
  findings: Finding[]
}

export type ReviewEvent = 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE'

/** Un commentaire proposé par la review d'une PR, prêt à être posté à sa ligne. */
export interface ReviewComment {
  id: string
  file: string
  line: number
  severity: Severity
  body: string
  /** Re-review : fil existant auquel répondre, au lieu d'ouvrir un nouveau fil. */
  threadId: string | null
  /** Re-review : état de mon commentaire précédent sur ce fil. */
  followUp: 'partiel' | 'non-corrigé' | 'à-trancher' | null
  /** Motif récurrent : nom court du problème quand il apparaît à plusieurs endroits, sinon null. */
  pattern: string | null
  /** Autres emplacements du même problème : approuvés en même temps, un commentaire posté sur chacun. */
  also: { file: string; line: number; body: string; lineWarning?: string }[]
  /** Ajouté par le serveur quand la ligne a été recalée ou n'est pas dans le diff. */
  lineWarning?: string
  /** Fil déjà ouvert (par moi ou un autre reviewer) sur le même sujet ou au même endroit, hors threadId : affiché avec sa réponse. */
  relatedThreadId?: string | null
}

/** Suivi d'un de mes retours sur la PR d'un autre : ce que l'auteur a fait ou répondu. */
export type FollowupStatus = 'corrigé' | 'partiel' | 'non-corrigé' | 'contesté'

export interface FollowupItem {
  threadId: string
  status: FollowupStatus
  /** Ce qui a été fait dans le code, et si la réponse de l'auteur est fondée. */
  explanation: string
  /** Réponse proposée dans le fil, vide quand il suffit de résoudre. */
  reply: string
  /** Proposition de résoudre le fil (après la réponse s'il y en a une) : correctif en place, ou argument de l'auteur fondé. */
  resolve: boolean
}

export interface FollowupOutput {
  summary: string
  items: FollowupItem[]
}

export interface PrReviewOutput {
  mode: 'review' | 're-review'
  verdict: ReviewEvent
  summary: string
  /** Re-review : fils précédents dont le correctif est en place. */
  fixedThreads: string[]
  comments: ReviewComment[]
}

/** Ma review en attente sur GitHub (commentaires préparés, pas encore envoyés). */
/** Réponse de l'onglet Fichiers : diff de la PR et fils de discussion. */
export interface PrFiles {
  prId: string
  files: DiffFile[]
  localDiff: boolean
  threads: ReviewThread[]
}

export interface PendingReview {
  id: string
  comments: { id: string; path: string; line: number | null; body: string }[]
}

/** Tri des commentaires d'une review IA, enregistré côté serveur (.data/reviews/<run>.json). */
export interface ReviewDecisions {
  approved: string[]
  ignored: string[]
  /** Emplacements refusés par GitHub que j'ai choisi de ne pas renvoyer. */
  dropped: string[]
  /** Textes modifiés à la main. Clé d'un emplacement : id du commentaire, ou `<id>#<i>` pour un autre emplacement d'un motif. */
  text: Record<string, string>
  /** Lignes corrigées à la main, après un refus de GitHub. */
  line: Record<string, number>
  /** Emplacements ajoutés à ma review en attente sur GitHub → id du commentaire GitHub. */
  posted: Record<string, string>
  /** Emplacements refusés par GitHub → message d'erreur. */
  failed: Record<string, string>
  summary: string | null
  published: string | null
  /** Commentaires ajoutés hors de l'agent (ex. composants trop longs). */
  extra?: ReviewComment[]
}

/** Un commentaire à poster : nouveau fil à la ligne, ou réponse à un fil existant. */
export interface ReviewDraftComment {
  path: string
  line: number
  body: string
  threadId: string | null
}

export interface CommentAudit {
  threadId: string
  verdict: 'fix' | 'skip'
  audit: string
  action: string
  reply: string
  /** PR liée : ce que la correction change ou risque de casser dans l'autre dépôt (vide si rien ; absent des analyses d'avant). */
  linkedImpact?: string
}

export interface CommentsOutput {
  items: CommentAudit[]
}

/** « Tout accepter » : chaque commentaire analysé, avec ce qui a été fait. */
export interface CommentsFixAllOutput {
  results: { threadId: string; verdict: 'fix' | 'skip'; ok: boolean; detail: string }[]
}

/** Auto-review : un seul agent corrige toutes les remarques acceptées, puis un seul commit. */
export interface FindingsFixAllAgentOutput {
  commitTitle: string
  items: { id: string; status: 'fixed' | 'already' | 'failed'; summary: string }[]
}

export interface FindingsFixAllOutput {
  /** Commit poussé, null si rien n'a été commité (rien de corrigé, ou commit refusé par un hook). */
  url: string | null
  results: { id: string; ok: boolean; detail: string }[]
}

/** L'agent de « Tout accepter » : un résultat par fil, et un seul titre de commit pour l'ensemble. */
export interface CommentsFixAllAgentOutput {
  commitTitle: string
  /** fixed : corrigé maintenant ; already : déjà corrigé par un commit de la branche (alreadyFixed) ; failed : pas pu. */
  items: { threadId: string; status: 'fixed' | 'already' | 'failed'; alreadyFixed: string | null; summary: string }[]
}

export interface CommentReplyOutput {
  reply: string
}

export interface TicketPlanOutput {
  summary: string
  steps: { title: string; details: string; files: string[] }[]
  /** Écrans à capturer avant et après, pour vérifier visuellement le résultat. */
  /** platform : absent des plans d'avant la prise en charge d'Android (web). */
  screenshots: { name: string; platform?: 'web' | 'android'; route: string; description: string }[]
  risks: string[]
  questions: string[]
  /** Réponse au dernier message de l'utilisateur sur le plan (null pour un premier plan). */
  reply?: string | null
}

export interface TicketWorkOutput {
  summary: string
  changes: { file: string; change: string }[]
  checks: { name: string; status: 'pass' | 'fail' | 'skip'; detail: string }[]
  /** Fichiers d'image relatifs au dossier de captures du run (null si la capture n'a pas pu être faite). */
  screenshots: { name: string; platform?: 'web' | 'android'; description: string; before: string | null; after: string | null }[]
  appNote: string
  risks: string[]
  followUps: string[]
}

export interface CommitPlanOutput {
  /** project : projet du worktree lié où sont les fichiers (absent : ce worktree). */
  commits: { title: string; files: string[]; project?: string }[]
  excluded: { file: string; reason: string }[]
  notes: string
}

export interface CommitFixOutput {
  fixed: boolean
  summary: string
  /** Titre corrigé si le hook a refusé le message de commit, sinon null. */
  newTitle: string | null
}

export interface CommitExecResult {
  title: string
  files: string[]
  /** Projet du worktree lié où le commit a été fait (absent : ce worktree). */
  project?: string
  status: 'pushed' | 'committed' | 'failed' | 'skipped'
  sha: string | null
  attempts: number
  /** Corrections faites par l'IA pour passer les hooks (Biome, typecheck…). */
  fixes: string[]
  error: string | null
}

export interface CommitExecOutput {
  results: CommitExecResult[]
  pushed: number
  failed: number
}

export interface PrPrepareOutput {
  commits: { title: string; files: string[] }[]
  title: string
  body: string
}

export interface FixOutput {
  summary: string
  commitTitle: string
  changed: boolean
  /** Rien à modifier : la correction est déjà dans ce commit de la branche (sha). */
  alreadyFixed?: string | null
}

/** Test de worktrees liés (app + landing-page, app + mobile…) : un résultat par worktree, chacun avec son run et sa vidéo. */
export interface MultiTestOutput {
  parts: {
    project: string
    projectName: string
    worktree: string
    platform: 'web' | 'android'
    runId: string | null
    output: TestOutput | null
    error: string | null
    /** Dépôt non retesté cette fois : date du test dont le résultat est repris. */
    carriedAt?: string
  }[]
}

export interface TestOutput {
  suite: { command: string; passed: number; failed: number; summary: string }
  /** Ce qu'il a fallu préparer pour tester (environnement, données) : une note, pas un scénario. */
  setup?: string
  /** Leçons pour les prochains tests : ce qui a fait perdre du temps, et la bonne façon de faire (projet ou branche). */
  lessons?: { scope: 'project' | 'branch'; text: string }[]
  scenarios: { name: string; status: 'pass' | 'fail' | 'warn'; detail: string; decision?: TestDecision | null }[]
}

/**
 * Point que le test ne peut pas trancher seul (choix produit, question du ticket, comportement ambigu) :
 * la question à poser, et 2 à 4 réponses possibles. fix : ce qu'il faut changer dans le code pour cette réponse, null pour garder tel quel.
 */
export interface TestDecision {
  question: string
  options: { label: string; fix: string | null }[]
}

/**
 * Rapport d'un contrôle automatique posté en commentaire de PR par un bot (qualité de code, .env…),
 * reconnu à son marqueur caché (`<!-- code-quality-report -->`) et mis à jour à chaque push.
 */
export interface CheckReport {
  /** Le marqueur : identifie le contrôle d'une PR à l'autre. */
  id: string
  url: string
  author: string
  title: string
  /** Texte du commentaire, sans les balises HTML. */
  body: string
  updatedAt: string
  /** Avec un compte Oxlint sur les lignes ajoutées, lui seul décide : fail s'il y en a, pass sinon. */
  status: 'pass' | 'warn' | 'fail'
  /**
   * Problèmes Oxlint sur les lignes ajoutées par la PR (« Findings on added lines: 4 ») : ce qui bloque la PR.
   * null si le rapport n'a pas cette section.
   */
  blocking: number | null
  /** Autres compteurs du rapport (complexité, code mort, duplication…), indicatifs. */
  metrics: { label: string; value: number }[]
  /** Commande qui donne le détail en local (« Full report: `…` »), null si le rapport est complet. */
  command: string | null
  /** Rapport antérieur au dernier commit de la PR : le contrôle n'a pas encore tourné sur le code actuel. */
  stale: boolean
}

export interface CheckItem {
  id: string
  /** Outil ou section du rapport (Oxlint, Fallow complexité, variable manquante…). */
  source: string
  file: string | null
  line: number | null
  problem: string
  /** Introduit par la PR (sinon : existait déjà dans le code touché). */
  introduced: boolean
  /** Problème Oxlint sur une ligne ajoutée : il bloque la PR tant qu'il n'est pas corrigé. */
  blocking: boolean
  /** fix : se corrige dans le code ; ignore : à laisser ; manual : action hors du dépôt (secret, config déployée). */
  verdict: 'fix' | 'ignore' | 'manual'
  reason: string
  fix: string
}

export interface ChecksAnalyzeOutput {
  summary: string
  items: CheckItem[]
}

/** Test manuel : l'agent prépare l'environnement, Shipyard lance l'app et ouvre Chrome, je suis la liste. */
export interface ManualTestOutput {
  /** Ce que l'agent a préparé (dépendances, .env, base, données de test), en 1 à 3 phrases. */
  setup: string
  /** Commandes qui font tourner l'app : lancées par Shipyard et gardées allumées pendant mon test. */
  services: { name: string; cwd: string; command: string; port: number | null }[]
  /** Page à ouvrir dans Chrome ; null pour une app mobile (émulateur). */
  url: string | null
  /** Comptes de dev, données créées : ce qu'il faut savoir avant de commencer ; vide si rien. */
  access: string
  /** command : commande de vérification à lancer dans un terminal (lecture seule) ; url : page de l'app où faire l'étape. Sinon null. */
  steps: { title: string; detail: string; expected: string; command?: string | null; url?: string | null }[]
  lessons?: { scope: 'project' | 'branch'; text: string }[]
}

/** Vérification d'une étape de test manuel : la commande lancée, ce qu'elle a renvoyé, et si c'est conforme à l'attendu. */
export interface TestCheckOutput {
  verdict: 'pass' | 'fail' | 'unclear'
  /** Commande réellement exécutée (corrigée si l'environnement l'exigeait). */
  command: string
  /** Extrait utile de la sortie. */
  output: string
  /** Comparaison avec l'attendu, calculs compris, en 1 à 3 phrases. */
  explanation: string
}

/** Environnement d'un test manuel, lancé et gardé allumé par Shipyard jusqu'à ce que je l'arrête. */
export interface ManualEnv {
  runId: string
  url: string | null
  startedAt: string
  /** log : dernières lignes de sa sortie. */
  services: { name: string; command: string; port: number | null; alive: boolean; log: string }[]
}

export interface CiOutput {
  cause: string
  /** base : la PR fusionnée avec sa base ne passe plus (la base a changé ce que la PR utilise) : récupérer la base. */
  origin: 'pr' | 'config' | 'flaky' | 'infra' | 'base'
  fix: string
  fixable: boolean
}

/** Analyse de tous les jobs en échec d'une PR, par un seul agent. */
export interface CiAllOutput {
  summary: string
  jobs: (CiOutput & { jobId: string; name: string })[]
}

export interface BranchNameOutput {
  slug: string
}

// ---------- Création de tickets Linear ----------

export interface TicketDraftQuestion {
  id: string
  question: string
  /** Réponses proposées ; une réponse libre reste possible. */
  options: string[]
}

export interface TicketDraft {
  title: string
  /** Markdown, au format des tickets de l'équipe. */
  description: string
  type: 'Feature' | 'Bug' | 'Improvement'
  /** Noms de labels existants de l'équipe. */
  labels: string[]
  /** Priorité Linear : 0 aucune, 1 urgente, 2 haute, 3 normale, 4 basse. */
  priority: number
  /** Nom d'un projet Linear existant, ou null. */
  project: string | null
  /** Nom de branche proposé (2 à 4 mots anglais, kebab-case) ; absent des brouillons rédigés avant son ajout. */
  branch?: string
  /** Dépôts que le ticket modifie (noms des projets : celui de la page et ses projets liés) ; absent des anciens brouillons. */
  repos?: string[]
}

export interface TicketDraftOutput {
  summary: string
  /** Points à trancher avant de finaliser ; vide quand tout est clair. */
  questions: TicketDraftQuestion[]
  tickets: TicketDraft[]
}

export interface LinearMeta {
  teamKey: string
  me: string
  members: { id: string; name: string; displayName: string }[]
  labels: { id: string; name: string }[]
  projects: { id: string; name: string }[]
  states: TicketState[]
}

export interface NewIssue {
  title: string
  description: string
  assigneeId: string | null
  stateId: string | null
  priority: number
  labelIds: string[]
  projectId: string | null
}

export interface CreatedTicket {
  id: string
  title: string
  url: string
}

// ---------- Notes ----------

export interface Note {
  id: string
  text: string
  done: boolean
  /** Projet concerné, ou null pour une note générale. */
  project: string | null
  createdAt: string
  updatedAt: string
}

// ---------- Daily ----------

export type DailyPeriod = 'yesterday' | 'week' | 'last-week'

export interface DailyItem {
  /** Ce qui a été fait, en une ligne. */
  title: string
  /** PR concernée (#123), ou null. */
  pr: number | null
  url: string | null
  status: 'mergée' | 'ouverte' | 'fermée' | 'reviewée'
  /** 1 à 3 détails techniques courts, à citer à l'oral. */
  points: string[]
}

export interface DailyOutput {
  sections: { project: string; items: DailyItem[] }[]
  /** Ce qui reste en cours ou bloqué (en attente de review, CI, conflit…). */
  next: string[]
}

// ---------- Réglages ----------

export interface AgentProcess { pid: number; rssMb: number; elapsed: string; command: string }

/** Processus des agents : runs en cours (avec ce qu'ils ont lancé) et agents orphelins, sans run. */
/**
 * Worktree abîmé : dossier disparu mais encore connu de git, ou à moitié effacé (fichiers suivis supprimés en masse,
 * sans autre modification, typiquement une suppression interrompue). « Aboutir » et les actions qui commitent sont bloquées.
 */
export interface BrokenWorktree {
  project: string
  projectName: string
  id: string
  path: string
  branch: string | null
  reason: 'missing' | 'half-deleted'
  /** Fichiers suivis supprimés du disque. */
  deleted: number
  /** Fichiers non suivis encore présents (perdus si on supprime le worktree), et leurs dossiers principaux. */
  untracked: number
  untrackedSample: string[]
  /** Processus dont le dossier courant est dans le worktree (session claude, serveur de dev…) : à fermer avant de le supprimer. */
  holders: { pid: number; command: string }[]
}

export interface AgentProcesses {
  runs: { runId: string; title: string; kind: ActionKind; scope: RunScope; startedAt: string; pgid: number; rssMb: number; processes: AgentProcess[] }[]
  orphans: { pgid: number; rssMb: number; processes: AgentProcess[] }[]
  totalMb: number
}

/** Connexions, sans jamais renvoyer les clés : seulement leurs 4 derniers caractères. */
/** Une limite du forfait Claude : session de 5 h, semaine, ou quota hebdomadaire d'un modèle (ex. Fable). */
export interface UsageLimit {
  kind: string
  label: string
  percent: number
  resetsAt: string | null
  severity: 'normal' | 'warning' | 'critical'
}

export interface ClaudeUsage {
  limits: UsageLimit[]
  fetchedAt: string
}

/** Lignes modifiées d'un worktree par rapport à sa base, changements non commités compris. */
export interface WorktreeStat {
  branch: string | null
  /** Titre de la PR pour un worktree de review (sa branche review/pr-N ne dit rien). */
  title: string | null
  base: string
  files: number
  additions: number
  deletions: number
}

export interface Credentials {
  linear: { configured: boolean; hint: string | null; user: string | null }
  /** token : jeton saisi dans les réglages (GH_TOKEN) ; gh : la connexion de `gh auth login`. */
  github: { source: 'token' | 'gh'; hint: string | null; login: string | null }
  /** Claude Code, qui fait tourner les agents (claude -p) sur l'abonnement. */
  claude: { installed: boolean; version: string | null; loggedIn: boolean; method: string | null; email: string | null; org: string | null; plan: string | null }
}

/** Ce qu'un label déclenche ou signale, quel que soit le projet (voir LABEL_ROLES dans shared/review.ts). */
export type LabelRole = 'awaitingReview' | 'changes' | 'testing' | 'inProgress' | 'approved' | 'aiReview' | 'ticketFix' | 'ticketChore' | 'ticketRefactor'

/** Noms de labels reconnus pour chaque rôle, sans tenir compte de la casse. L'ordre compte : le premier présent dans le dépôt est celui qu'on pose. */
export type LabelRules = Record<LabelRole, string[]>

export interface Settings {
  labels: LabelRules
  notifications: {
    enabled: boolean
    /** Intervalle entre deux vérifications de GitHub et Linear. */
    intervalSec: number
    /** Durée d'affichage d'une notification macOS avant qu'elle soit retirée. */
    durationSec: number
  }
  /** Langue de ce que les agents écrivent, selon le destinataire. Code, commits et noms de branche restent en anglais. */
  languages: Languages
}

/** Réglages modifiés depuis l'interface : seuls les champs envoyés changent. */
export interface SettingsPatch {
  labels?: Partial<LabelRules>
  notifications?: Partial<Settings['notifications']>
  languages?: Partial<Languages>
}

export type Language = 'fr' | 'en'

export interface Languages {
  /** Ce que Shipyard m'affiche : analyses, plans, résumés, verdicts de test, daily. */
  app: Language
  /** Ce qui est posté sur GitHub : commentaires de review, réponses dans les fils. */
  github: Language
  /** Description des PR. */
  pr: Language
  /** Tickets Linear rédigés par l'IA. */
  tickets: Language
}

// ---------- À valider ----------

/** Un agent a fini et attend quelque chose de moi (valider un plan, trier une review, répondre à une question…). */
export interface InboxItem {
  runId: string
  kind: ActionKind
  project: string
  projectName: string
  /** Worktree concerné (id), ou null pour une action de projet. */
  worktree: string | null
  /** Nom court du worktree (dossier), ou titre du run. */
  label: string
  /** Ce qui est attendu, en quelques mots (« Plan prêt à valider »). */
  title: string
  detail: string | null
  href: string
  at: string
  tone: 'amber' | 'red' | 'purple' | 'green' | 'blue'
  /** Un résultat à lire (test, diagnostic, échec…) : il disparaît dès que je l'ouvre. */
  clearsOnOpen: boolean
  /** Quand l'élément disparaît, en quelques mots (« quand tu lances le travail »). */
  until: string
}

// ---------- Frise d'une PR ----------

/** Événement de la vie d'une PR (GitHub), du plus ancien au plus récent. */
export interface TimelineEvent {
  type: 'created' | 'review_requested' | 'review' | 'commit' | 'ready' | 'draft' | 'merged' | 'closed' | 'reopened'
  at: string
  actor: string | null
  /** review : état de la review ; review_requested : reviewer demandé ; commit : titre du commit. */
  detail: string | null
}

// ---------- Vidéos des tests ----------

/** Vidéo d'un test : la version complète, et la version courte qui ne garde que les actions. */
export interface RunVideo {
  file: string
  platform: 'web' | 'android'
  /** App filmée quand il y en a plusieurs (worktrees liés : app et landing-page…). */
  label?: string
  /** Version courte (pauses de réflexion retirées), sinon complète. */
  short: boolean
  durationSec: number
  sizeBytes: number
}

// ---------- Stats ----------

export type StatsScope = 'tracked' | 'all'

export interface StatsCounts {
  /** Commits de mes PR mergées sur la période. */
  commits: number
  prsOpened: number
  prsMerged: number
  /** Reviews envoyées sur les PR des autres (une PR peut en recevoir plusieurs). */
  reviews: number
  linesAdded: number
  linesDeleted: number
}

/** Mon activité sur une période (page Stats) : de quoi chiffrer un bilan ou un entretien. */
export interface StatsReport {
  /** Bornes comprises, AAAA-MM-JJ. */
  from: string
  to: string
  login: string
  scope: StatsScope
  totals: StatsCounts & {
    /** PR des autres sur lesquelles j'ai envoyé au moins une review. */
    reviewedPrs: number
    approvals: number
    changesRequested: number
    /** Tickets Linear qui me sont assignés, terminés sur la période ; null sans clé Linear. */
    ticketsCompleted: number | null
  }
  byRepo: (StatsCounts & { repo: string })[]
  /** Une entrée par mois de la période, même vide (AAAA-MM). */
  byMonth: { month: string; commits: number; prsMerged: number; reviews: number; ticketsCompleted: number }[]
  /** Mes PR mergées, les plus grosses d'abord. */
  mergedPrs: { repo: string; number: number; title: string; url: string; mergedAt: string; additions: number; deletions: number; commits: number }[]
  tickets: { id: string; title: string; url: string; completedAt: string }[] | null
  /** Ce qu'il faut savoir pour lire les chiffres (limites des sources). */
  notes: string[]
}
