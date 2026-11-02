import { z } from 'zod'

// Messages d'erreur en français : ils remontent tels quels dans l'interface.
z.config(z.locales.fr())
import type {
  ActionInput,
  CheckItem,
  CreateWorktreeInput,
  Finding,
  InsightItem,
  NewIssue,
  Note,
  ReviewComment,
  ReviewDecisions,
  ReviewDraftComment,
  SettingsPatch,
} from '../shared/types.ts'
import { LABEL_ROLES } from '../shared/review.ts'

const id = z.string().min(1)
/** Jour au format AAAA-MM-JJ. */
export const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const ids = z.array(id)
const severity = z.enum(['bloquant', 'important', 'suggestion'])
const language = z.enum(['fr', 'en'])
/** L'interface envoie parfois null pour un paramètre absent : traité comme absent. */
const optional = <T extends z.ZodType>(schema: T) => schema.nullish().transform((v) => v ?? undefined)

const [firstRole, ...otherRoles] = LABEL_ROLES.map((r) => r.role)
const LABEL_ROLE_KEYS = [firstRole, ...otherRoles]

const finding = z.object({
  id,
  file: z.string(),
  line: z.number(),
  severity,
  title: z.string(),
  body: z.string(),
  fix: z.string(),
  relatedThreadId: z.string().nullable().optional(),
}) satisfies z.ZodType<Finding>

const checkItem = z.object({
  id,
  source: z.string(),
  file: z.string().nullable(),
  line: z.number().nullable(),
  problem: z.string(),
  introduced: z.boolean(),
  blocking: z.boolean(),
  verdict: z.enum(['fix', 'ignore', 'manual']),
  reason: z.string(),
  fix: z.string(),
}) satisfies z.ZodType<CheckItem>

const insightItem = z.object({
  title: z.string(),
  category: z.string(),
  why: z.string(),
  proposal: z.string(),
  files: z.array(z.string()),
  effort: z.enum(['S', 'M', 'L']),
  impact: z.enum(['faible', 'moyen', 'fort']),
  risk: z.string(),
}) satisfies z.ZodType<InsightItem>

const reviewComment = z.object({
  id,
  file: z.string(),
  line: z.number(),
  severity,
  body: z.string(),
  threadId: z.string().nullable(),
  followUp: z.enum(['partiel', 'non-corrigé', 'à-trancher']).nullable(),
  pattern: z.string().nullable(),
  also: z.array(z.object({ file: z.string(), line: z.number(), body: z.string(), lineWarning: z.string().optional() })),
  lineWarning: z.string().optional(),
  relatedThreadId: z.string().nullable().optional(),
}) satisfies z.ZodType<ReviewComment>

export const actionInput = z.object({
  project: id,
  worktree: optional(z.string()),
  ref: optional(z.string()),
  extra: optional(z.string()),
  ticketId: optional(z.string()),
  finding: optional(finding),
  findings: optional(z.array(finding)),
  threadId: optional(z.string()),
  action: optional(z.string()),
  job: optional(z.object({ id: z.string(), name: z.string(), workflow: z.string().nullable(), jobId: z.string().nullable() })),
  commits: optional(z.array(z.object({ title: z.string(), files: z.array(z.string()), project: z.string().optional() }))),
  feedback: optional(z.string()),
  previousRunId: optional(z.string()),
  planRunId: optional(z.string()),
  resumeFrom: optional(z.string()),
  ci: optional(z.object({ cause: z.string(), fix: z.string() })),
  ciJobs: optional(z.array(z.object({ name: z.string(), cause: z.string(), fix: z.string() }))),
  sdk: optional(z.string()),
  period: optional(z.enum(['yesterday', 'week', 'last-week'])),
  since: optional(isoDay),
  until: optional(isoDay),
  retest: optional(z.boolean()),
  insights: optional(z.enum(['features', 'improve'])),
  digest: optional(z.enum(['auto', 'map'])),
  autofix: optional(z.boolean()),
  items: optional(z.array(z.object({ threadId: z.string(), verdict: z.enum(['fix', 'skip']), action: z.string().optional(), reply: z.string().optional() }))),
  report: optional(z.string()),
  checkItems: optional(z.array(checkItem)),
  testOnly: optional(z.array(z.string())),
  step: optional(z.string()),
  command: optional(z.string()),
  expected: optional(z.string()),
}) satisfies z.ZodType<ActionInput>

export const addProjectInput = z.object({ url: z.string().min(1), path: z.string().optional(), team: z.string().nullable().optional() })

export const updateProjectInput = z.object({
  team: z.string().nullable().optional(),
  baseBranch: z.string().min(1).optional(),
  worktreeRoot: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  group: z.string().nullable().optional(),
})

export const createWorktreeInput = z.object({
  mode: z.enum(['ticket', 'new', 'existing', 'review']),
  branch: z.string().optional(),
  base: z.string().optional(),
  ticketId: z.string().optional(),
  prNumber: z.number().int().positive().optional(),
}) satisfies z.ZodType<CreateWorktreeInput>

export const localTicketInput = z.object({ branch: id, item: insightItem })
export const pathsInput = z.object({ paths: z.array(z.string()) })
export const worktreeCleanupInput = z.object({ paths: z.array(z.string()), discard: z.boolean(), deleteBranch: z.boolean() })
export const deleteBranchesInput = z.object({ names: ids, local: z.boolean(), remote: z.boolean(), discard: z.boolean().optional() })
export const createBranchInput = z.object({ branch: id, base: id })
export const ticketStateInput = z.object({ stateId: id })
export const moveWorktreeInput = z.object({ project: id })
export const linkWorktreeInput = z.object({ project: id, wt: id })
export const labelsInput = z.object({ add: z.array(z.string()).optional(), remove: z.array(z.string()).optional() })
const runId = z.string().regex(/^[\w-]+$/)
export const abandonInput = z.object({ plan: runId.optional(), work: runId.optional(), all: z.boolean().optional() })
export const fileViewedInput = z.object({ prId: id, path: z.string().min(1), viewed: z.boolean() })
export const linkTicketInput = z.object({ ticketId: z.string().nullable() })
export const threadReplyInput = z.object({ threadId: id, body: z.string(), resolve: z.boolean() })

export const createPullRequestInput = z.object({
  commits: z.array(z.object({ title: z.string().min(1), files: z.array(z.string()) })),
  title: z.string().min(1),
  body: z.string(),
  base: z.string().optional(),
})

const draftComment = z.object({ path: z.string(), line: z.number(), body: z.string(), threadId: z.string().nullable() }) satisfies z.ZodType<ReviewDraftComment>
export const pendingReviewInput = z.object({ comments: z.array(z.intersection(draftComment, z.object({ key: z.string() }))) })
export const submitReviewInput = z.object({ event: z.enum(['COMMENT', 'REQUEST_CHANGES', 'APPROVE']), body: z.string() })
export const dirtyApplyInput = z.object({ commit: z.array(z.string()), discard: z.array(z.string()), title: z.string().nullable() })
export const rerequestInput = z.object({ reviewers: ids })
export const ciRerunInput = z.object({ runId: id, jobId: optional(z.string()) })
export const openFileInput = z.object({ file: z.string().optional() })
export const runDecisionInput = z.object({ decision: z.enum(['approved', 'declined']), discard: z.boolean().optional() })
export const textInput = z.object({ text: z.string() })
export const ghostInput = z.object({ note: z.string().max(500).nullable().optional() })
export const statsQuery = z
  .object({ from: isoDay, to: isoDay, scope: z.enum(['tracked', 'all']).default('tracked') })
  .refine((q) => q.from <= q.to, { message: 'la date de début doit précéder la date de fin' })
export const manualStepsInput = z.object({ checked: z.array(z.number().int().nonnegative()) })
export const checkDecisionInput = z.object({ decision: z.enum(['pass', 'fail']).nullable() })

export const createNoteInput = z.object({ text: z.string(), project: z.string().nullable().optional() })
export const updateNoteInput = z.object({
  text: z.string().optional(),
  done: z.boolean().optional(),
  project: z.string().nullable().optional(),
}) satisfies z.ZodType<Partial<Pick<Note, 'text' | 'done' | 'project'>>>

export const credentialsInput = z.object({ linearKey: z.string().nullable().optional(), githubToken: z.string().nullable().optional() })

export const settingsInput = z.object({
  labels: z.partialRecord(z.enum(LABEL_ROLE_KEYS), z.array(z.string())).optional(),
  notifications: z.object({ enabled: z.boolean(), intervalSec: z.number().int().positive(), durationSec: z.number().int().positive() }).partial().optional(),
  languages: z.object({ app: language, github: language, pr: language, tickets: language }).partial().optional(),
}) satisfies z.ZodType<SettingsPatch>

const newIssue = z.object({
  title: z.string().min(1),
  description: z.string(),
  assigneeId: z.string().nullable(),
  stateId: z.string().nullable(),
  priority: z.number().int(),
  labelIds: z.array(z.string()),
  projectId: z.string().nullable(),
}) satisfies z.ZodType<NewIssue>
export const createIssuesInput = z.object({ runId: id, issues: z.array(z.intersection(newIssue, z.object({ index: z.number().int() }))) })

export const reviewDecisionsInput = z.object({
  approved: z.array(z.string()),
  ignored: z.array(z.string()),
  dropped: z.array(z.string()),
  text: z.record(z.string(), z.string()),
  line: z.record(z.string(), z.number()),
  posted: z.record(z.string(), z.string()),
  failed: z.record(z.string(), z.string()),
  summary: z.string().nullable(),
  published: z.string().nullable(),
  extra: z.array(reviewComment).optional(),
}) satisfies z.ZodType<ReviewDecisions>

export const saveRuleInput = z.object({ content: z.string(), projects: z.array(z.string()).optional() })
export const createRuleInput = z.object({ name: z.string().min(1), projects: z.array(z.string()).optional() })
export const savePromptInput = z.object({ content: z.string() })
