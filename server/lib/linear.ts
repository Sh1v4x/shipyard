import type { CreatedTicket, LabelRole, LinearMeta, NewIssue, Ticket, TicketState, TicketStatusType } from '../../shared/types.ts'
import { matchesRole } from '../../shared/review.ts'
import { ttlCache } from './exec.ts'
import { labelRules } from './settings.ts'

const ENDPOINT = 'https://api.linear.app/graphql'

export const linearConfigured = () => Boolean(process.env.LINEAR_API_KEY)

async function query<T>(q: string, variables: Record<string, unknown> = {}): Promise<T> {
  const key = process.env.LINEAR_API_KEY
  if (!key) throw new Error('Clé Linear manquante : renseigne-la dans Réglages')
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: key },
    body: JSON.stringify({ query: q, variables }),
  })
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] }
  if (!res.ok || json.errors?.length) throw new Error(`Linear : ${json.errors?.map((e) => e.message).join(' · ') ?? res.statusText}`)
  return json.data as T
}

interface IssueNode {
  identifier: string
  title: string
  description: string | null
  priorityLabel: string
  url: string
  updatedAt: string
  state: { name: string; type: TicketStatusType }
  assignee: { id: string; name: string; displayName: string } | null
  labels: { nodes: { name: string }[] }
}

const ISSUE_FIELDS = `identifier title description priorityLabel url updatedAt state{name type} assignee{id name displayName} labels{nodes{name}}`

let viewerId: Promise<string> | null = null
const getViewerId = () => (viewerId ??= query<{ viewer: { id: string } }>('{viewer{id}}').then((d) => d.viewer.id))

/** Type du ticket d'après ses labels, selon les rôles des réglages ; feat par défaut. */
function typeFromLabels(labels: string[]): Ticket['type'] {
  const rules = labelRules()
  const has = (role: LabelRole) => labels.some((l) => matchesRole(rules, role, l))
  if (has('ticketFix')) return 'fix'
  if (has('ticketChore')) return 'chore'
  if (has('ticketRefactor')) return 'refactor'
  return 'feat'
}

function toTicket(i: IssueNode, me: string): Ticket {
  const labels = i.labels.nodes.map((l) => l.name)
  return {
    id: i.identifier,
    title: i.title,
    description: i.description ?? '',
    status: i.state.name,
    statusType: i.state.type,
    priority: i.priorityLabel,
    assignee: i.assignee?.displayName ?? i.assignee?.name ?? null,
    isMine: i.assignee?.id === me,
    updatedAt: i.updatedAt,
    url: i.url,
    labels,
    type: typeFromLabels(labels),
  }
}

const teamCache = ttlCache<Ticket[]>(60_000)

/** Tickets de l'équipe : ceux qui me sont assignés + ceux liés à un worktree (non annulés). */
export function teamTickets(teamKey: string, force = false): Promise<Ticket[]> {
  return teamCache.get(
    teamKey,
    async () => {
      const me = await getViewerId()
      const data = await query<{ issues: { nodes: IssueNode[] } }>(
        // Ouverts + terminés depuis moins de 14 jours (sinon l'historique remplit la limite).
        `query($team:String!,$me:ID!){issues(first:150,orderBy:updatedAt,filter:{team:{key:{eq:$team}},assignee:{id:{eq:$me}},or:[{state:{type:{nin:["completed","canceled"]}}},{completedAt:{gt:"-P14D"}}]}){nodes{${ISSUE_FIELDS}}}}`,
        { team: teamKey, me },
      )
      return data.issues.nodes.map((i) => toTicket(i, me))
    },
    force,
  )
}

const ticketCache = ttlCache<Ticket | null>(60_000)

/** Commentaires d'un ticket, du plus ancien au plus récent (précisions ajoutées après la description). */
export async function ticketComments(identifier: string): Promise<{ author: string; body: string; createdAt: string }[]> {
  const data = await query<{ issue: { comments: { nodes: { body: string; createdAt: string; user: { name: string; displayName: string } | null; botActor: { name: string } | null }[] } } | null }>(
    `query($id:String!){issue(id:$id){comments(first:50){nodes{body createdAt user{name displayName} botActor{name}}}}}`,
    { id: identifier },
  )
  return (data.issue?.comments.nodes ?? [])
    .filter((c) => c.body.trim())
    .map((c) => ({ author: c.user?.displayName || c.user?.name || c.botActor?.name || '?', body: c.body.trim(), createdAt: c.createdAt }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export function ticketById(identifier: string, force = false): Promise<Ticket | null> {
  return ticketCache.get(identifier, async () => {
    const me = await getViewerId()
    const data = await query<{ issue: IssueNode | null }>(`query($id:String!){issue(id:$id){${ISSUE_FIELDS}}}`, { id: identifier }).catch(() => ({ issue: null }))
    return data.issue ? toTicket(data.issue, me) : null
  }, force)
}

export async function teams(): Promise<{ key: string; name: string }[]> {
  const data = await query<{ teams: { nodes: { key: string; name: string }[] } }>('{teams{nodes{key name}}}')
  return data.teams.nodes
}

export function clearTickets(teamKey: string) {
  teamCache.clear(teamKey)
}

const TYPE_ORDER = ['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled', 'duplicate']
const statesCache = ttlCache<TicketState[]>(600_000)

/** Statuts du workflow de l'équipe, dans l'ordre du tableau Linear. */
export function teamStates(teamKey: string): Promise<TicketState[]> {
  return statesCache.get(teamKey, async () => {
    const data = await query<{ workflowStates: { nodes: (TicketState & { position: number })[] } }>(
      `query($team:String!){workflowStates(filter:{team:{key:{eq:$team}}}){nodes{id name type color position}}}`,
      { team: teamKey },
    )
    return data.workflowStates.nodes
      .sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.position - b.position)
      .map(({ id, name, type, color }) => ({ id, name, type, color }))
  })
}

/** Change le statut d'un ticket (l'identifiant ENG-123 est accepté comme id par Linear). */
export async function setTicketState(identifier: string, stateId: string): Promise<Ticket | null> {
  const data = await query<{ issueUpdate: { success: boolean } }>(
    `mutation($id:String!,$state:String!){issueUpdate(id:$id,input:{stateId:$state}){success}}`,
    { id: identifier, state: stateId },
  )
  if (!data.issueUpdate.success) throw new Error(`Linear a refusé le changement de statut de ${identifier}`)
  teamCache.clear()
  return ticketById(identifier, true)
}

const metaCache = ttlCache<LinearMeta>(600_000)

/** Ce qu'il faut pour créer un ticket dans l'équipe : membres actifs, labels, projets ouverts, statuts. */
export function teamMeta(teamKey: string): Promise<LinearMeta> {
  return metaCache.get(teamKey, async () => {
    const [me, states, data] = await Promise.all([
      getViewerId(),
      teamStates(teamKey),
      query<{ team: { members: { nodes: { id: string; name: string; displayName: string; active: boolean }[] }; labels: { nodes: { id: string; name: string }[] }; projects: { nodes: { id: string; name: string }[] } } }>(
        `query($team:String!){team(id:$team){members{nodes{id name displayName active}} labels(first:200){nodes{id name}} projects(first:50,filter:{state:{nin:["completed","canceled"]}}){nodes{id name}}}}`,
        { team: teamKey },
      ),
    ])
    return {
      teamKey,
      me,
      members: data.team.members.nodes.filter((m) => m.active).map(({ id, name, displayName }) => ({ id, name, displayName })),
      labels: data.team.labels.nodes,
      projects: data.team.projects.nodes,
      states,
    }
  })
}

/** Crée un ticket dans l'équipe et renvoie son identifiant (ENG-123) et son lien. */
export async function createIssue(teamKey: string, issue: NewIssue): Promise<CreatedTicket> {
  const team = await query<{ team: { id: string } }>(`query($team:String!){team(id:$team){id}}`, { team: teamKey })
  const input = {
    teamId: team.team.id,
    title: issue.title,
    description: issue.description,
    priority: issue.priority,
    labelIds: issue.labelIds,
    ...(issue.assigneeId ? { assigneeId: issue.assigneeId } : {}),
    ...(issue.stateId ? { stateId: issue.stateId } : {}),
    ...(issue.projectId ? { projectId: issue.projectId } : {}),
  }
  const data = await query<{ issueCreate: { success: boolean; issue: { identifier: string; title: string; url: string } | null } }>(
    `mutation($input:IssueCreateInput!){issueCreate(input:$input){success issue{identifier title url}}}`,
    { input },
  )
  if (!data.issueCreate.success || !data.issueCreate.issue) throw new Error(`Linear a refusé la création de « ${issue.title} »`)
  teamCache.clear(teamKey)
  const i = data.issueCreate.issue
  return { id: i.identifier, title: i.title, url: i.url }
}

/** Après un changement de clé : oublie tout ce qui dépend du compte (identité, tickets, équipes). */
export function resetLinear() {
  viewerId = null
  teamCache.clear()
  ticketCache.clear()
  statesCache.clear()
  metaCache.clear()
}

/** Vérifie une clé Linear sans l'enregistrer : renvoie le compte associé. */
export async function checkLinearKey(key: string): Promise<{ name: string; email: string }> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: key },
    body: JSON.stringify({ query: '{viewer{name email}}' }),
  })
  const json = (await res.json().catch(() => ({}))) as { data?: { viewer: { name: string; email: string } }; errors?: { message: string }[] }
  if (!res.ok || !json.data) throw new Error(`Linear refuse la clé : ${json.errors?.map((e) => e.message).join(' · ') ?? res.statusText}`)
  return json.data.viewer
}
