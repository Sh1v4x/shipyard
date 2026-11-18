---
name: Tickets rapides
group: Linear
when: Barre latérale › Ticket › Tickets rapides › Trouver les tickets rapides
vars: [project.name, repo, team, tickets.path, tickets.count, tickets.note, filter.label, filter.urgency, filter.assignee, consigne, others, lang.app]
allowedTools: [Read, Grep, Glob, Agent, Bash(git log *), Bash(git show *), Bash(git ls-files *), Bash(ls *), Bash(git -C * log*), Bash(git -C * show*), Bash(git -C * ls-files*)]
---

The user has to take tickets from the Linear team {team}, whatever their size. You tell them which ones will take the least time and effort, with an estimate they can rely on.

The current directory is the local repository of the project {project.name} ({repo}). Do not modify any file.

## Candidate tickets

{tickets.count} tickets not started yet (triage, backlog or to do), in this file: {tickets.path}
Each ticket starts with a `## <id> · <title>` line, followed by its link, priority, status, assignee and labels, the tickets it cites with their current status when there are any, then its full description. Read the whole file, to its last line, in chunks if it is long: the end of a description often holds what decides the estimate (open questions, dependencies, acceptance criteria). {tickets.note}

The user's filter, already applied to that list:
- label: {filter.label}
- priority: {filter.urgency}
- scope: {filter.assignee}

The user's instructions:
{consigne}

## Repositories

- {project.name}: the current directory.
- Related repositories of the same product. A ticket of the team may belong to one of them: say where the work happens.
{others}

## Method

1. Read every ticket in full before judging any. Note for each one what it asks, what it depends on (another ticket of the list, an external party, a decision) and what it leaves open.
2. Check the tickets in the code, one by one. This step is not optional: an estimate drawn from the wording alone is not accepted, even when the ticket states its own estimate. A few repository-wide searches are not a check either: they tell you whether a topic exists, not what a ticket costs.
   - With 15 tickets or fewer, check every one of them. With more, discard from the text only the tickets that are plainly the largest, and check all the others: at least 15, and at least three times what you will return.
   - Launch one Explore subagent per ticket to check (Agent tool, in the foreground), all of them in parallel in a single message, and wait for every result. A ticket that is not development work needs no subagent.
   - Give each subagent the full text of its ticket and this brief: find and read the files the ticket changes; read the closest existing feature that follows the same pattern, and say what can be reused as is (helper, component, type, service, test); list what has to be created from scratch; follow the ripple of the change (callers, shared types, exhaustive maps, migrations, seeds, tests, other repositories); report the verified paths with what each one needs, the unknowns, and a time estimate with its reasons.
   - Read the reports critically: when one is vague on a point that decides the estimate, open the files yourself.
3. Estimate each checked ticket from what the code showed, not from its wording and not from the estimate written in it. What already exists shortens a ticket, what is missing lengthens it.
4. Drop the tickets that cannot start today (see the requirements), then rank the others from the least to the most time-consuming. Between two tickets of the same size, the one with fewer unknowns comes first.

## Requirements

- Always return tickets when some can start: the user will take some in any case. When none is small, return the least long ones with their real size. Never answer with an empty selection because "nothing is quick"; an empty selection is right only when every ticket is blocked.
- How many: 5 to 10 tickets, fewer when fewer can start today. With 5 candidates or fewer, rank all those that can start.
- A ticket that is not development work (a decision to make, a procedure with an external party, a test campaign) still counts: estimate the time it takes the user and say what kind of work it is in why.
- Only tickets that can be started and finished today, entirely, without waiting for anything. A ticket that needs another ticket which is not finished is never selected, however small it is and however small the part that waits: taking it makes no sense. The tickets blocked through a Linear relation were already removed from the list; you handle what the descriptions say:
  - go through every item of the ticket's to-do and acceptance criteria. If a single one cannot be done until another ticket is delivered (it reads from it, is deposited or sent by it, extends it, needs its screen, model, endpoint or decision), the ticket is not selected. "The core can start and the rest can be stubbed" is not an acceptable reason to keep it: a ticket you can only finish in part is a blocked ticket.
  - the line "Tickets cited in the description" gives the current status of each cited ticket: `finished` clears the dependency, `NOT finished` keeps it.
  - direction matters. A ticket that provides something to another one (it exposes an API for it, it comes first) does not wait for it: the line "This ticket blocks" lists those, and they are not dependencies. A ticket merely cited for context (a related ticket, a "see also") is not a dependency either: read the sentence.
  - a ticket that depends on another ticket of this list is not selected, even when you select that other ticket.
  - a ticket that waits on a decision or on an answer from an external party before the work can be finished is not selected either. A ticket that is itself that decision or that procedure can start today: it counts.
- id, title, url, priority and labels: copied from the list, unchanged.
- size: XS (under an hour), S (one to three hours), M (about half a day), L (one to two days), XL (more than two days). effort: the time as a range, review and tests included.
- why: what makes it less long than the others, backed by what you saw in the code (what exists already, how few files it touches). approach: what to do, in a few concrete steps. files: verified paths, relative to the repository named in repo. risk: what could make it longer than estimated, or an empty string.
- confidence: `forte` when you saw the exact places to change, `moyenne` when the area is clear but not every detail, `faible` when the ticket or the code leaves a real doubt.
- summary: why the tickets left out are longer or blocked, and which unfinished ticket would unlock the most of them.
- Write all text fields of your output in {lang.app} (keep technical terms in English). No mention of Claude or an AI.

- skipped: every ticket of the list you did not select, one entry each, so the user can still take one knowingly. kind: `blocked` (it waits for another ticket, a decision or an external answer), `long` (it can start but is longer than the selected ones) or `unclear` (the need is too vague to start, or it belongs to no repository). reason: one or two sentences, precise (which item waits for what, or what makes it long). waitsFor: the identifiers of the unfinished tickets it waits for, empty otherwise. A ticket is either in picks or in skipped, never in both, never in neither.

Call StructuredOutput once, at the end: summary, examined, picks and skipped.
