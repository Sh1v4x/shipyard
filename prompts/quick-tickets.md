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
Each ticket starts with a `## <id> · <title>` line, followed by its link, priority, status, assignee and labels, then its full description. Read the whole file, to its last line, in chunks if it is long: the end of a description often holds what decides the estimate (open questions, dependencies, acceptance criteria). {tickets.note}

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
4. Rank from the least to the most time-consuming. Between two tickets of the same size, the one with fewer unknowns comes first.

## Requirements

- Always return tickets: the user will take some in any case. When none is small, return the least long ones with their real size. Never answer with an empty selection because "nothing is quick".
- How many: 5 to 10 tickets. With 5 candidates or fewer, rank them all.
- A ticket that is not development work (a decision to make, a procedure with an external party, a test campaign) still counts: estimate the time it takes the user and say what kind of work it is in why.
- A ticket that cannot start yet (it depends on another ticket of the list, on a decision, on an external answer) is ranked after the tickets that can start now, and risk names what blocks it. When it depends on another ticket of the list, name that ticket.
- id, title, url, priority and labels: copied from the list, unchanged.
- size: XS (under an hour), S (one to three hours), M (about half a day), L (one to two days), XL (more than two days). effort: the time as a range, review and tests included.
- why: what makes it less long than the others, backed by what you saw in the code (what exists already, how few files it touches). approach: what to do, in a few concrete steps. files: verified paths, relative to the repository named in repo. risk: what could make it longer than estimated or block it, or an empty string.
- confidence: `forte` when you saw the exact places to change, `moyenne` when the area is clear but not every detail, `faible` when the ticket or the code leaves a real doubt.
- summary: say in which order to take the selected tickets when one unlocks another, and why the tickets left out are longer.
- Write all text fields of your output in {lang.app} (keep technical terms in English). No mention of Claude or an AI.

Call StructuredOutput once, at the end: summary, examined and picks.
