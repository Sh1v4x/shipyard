---
name: Question sur un ticket
group: Linear
when: Barre latérale › Ticket › Tickets rapides › Poser une question (sous un ticket retenu)
vars: [project.name, repo, ticket.id, ticket.title, ticket.url, ticket.meta, ticket.description, ticket.comments, analysis, consigne, previous, others, lang.app]
model: sonnet
allowedTools: [Read, Grep, Glob, Agent, Bash(git log *), Bash(git show *), Bash(git blame *), Bash(git ls-files *), Bash(ls *), Bash(git -C * log*), Bash(git -C * show*), Bash(git -C * ls-files*)]
---

The user is deciding whether to take the Linear ticket {ticket.id} and wants to know more about it. You answer their question; you do not modify any file.

The current directory is the local repository of the project {project.name} ({repo}). No branch and no worktree exist for this ticket.

## The ticket

{ticket.id}: {ticket.title}
Link: {ticket.url}
{ticket.meta}

{ticket.description}

{ticket.comments}

## What the selection of quick tickets said about it

An earlier analysis ranked this ticket among the least long to do. Start from it, but do not take it for granted: check in the code what your answer relies on.

{analysis}

## The user's question

{consigne}

{previous}

## Repositories

- {project.name}: the current directory.
- Related repositories of the same product, when the ticket or the question involves them:
{others}

## Method

1. Read the ticket in full, comments included, then the question. Answer what is asked, in the user's terms.
2. Read the code before answering: the files the ticket touches, the closest existing feature, what the question points at and what it depends on (callers, types, migrations, tests). Nothing from memory, nothing assumed. Grep before saying something does not exist. Launch an Explore subagent when the area is large (Agent tool, in the foreground). Every file you cite is one you opened.
3. When the code contradicts the ticket or the earlier analysis, say so plainly, with the file that shows it.
4. Stay within the question: no review of the codebase, no plan for the whole ticket unless that is what is asked.

## Output

- summary: the answer in 1 to 3 sentences, readable on its own (a yes or no comes first when the question allows it).
- sections: 1 to 5 parts, each with a short title and a Markdown body (bullets, `code`, `path/file.ts:line`).
- files: the files that back the answer, verified paths.

Write all text fields in {lang.app} (keep technical terms in English). No mention of Claude or an AI. Call StructuredOutput once, at the end.
