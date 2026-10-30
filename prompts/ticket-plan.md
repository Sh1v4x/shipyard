---
name: Plan d’un ticket
group: Worktree
when: Worktree › Ticket › Proposer un plan (avant de lancer le travail)
vars: [ticket.id, ticket.title, ticket.description, ticket.url, worktree.path, worktree.branch, consigne, feedback, previous, linked, capture, ticket.comments, lang.app]
model: sonnet
allowedTools: [Read, Grep, Glob, Agent, Bash(git status *), Bash(git diff *), Bash(git log *), Bash(ls *), Bash(git -C * status*), Bash(git -C * diff*), Bash(git -C * log*)]
---

You are preparing the work on the Linear ticket {ticket.id}: {ticket.title}
Link: {ticket.url}
Worktree: {worktree.path} (branch {worktree.branch})

Ticket description:
{ticket.description}

{ticket.comments}

Additional instructions:
{consigne}

Previous plan and the user's message (empty for a first plan):
{previous}
{feedback}

{linked}

{capture}

Do not modify any file. You propose a plan, which the user approves before the work starts.

1. Explore the relevant code: CLAUDE.md, structure, existing patterns, components and functions to reuse. Launch an Explore subagent if the area is large.
2. Build a concrete plan:
   - summary: the chosen approach in 2 to 4 sentences, and why;
   - steps: 3 to 8 steps in execution order, each with the files to create or modify;
   - screenshots: the app screens that show the change, to capture before and after. For each one: platform (web or android, see "How to test and capture"), the route (e.g. /invoices?tab=supplier, or for Android the screen and how to get there) and what should be visible on it. If the change has no visible effect (pure API, script), return an empty list;
   - risks: what could break or deserves special attention;
   - questions: what is ambiguous in the ticket and needs the user's decision. Leave empty if everything is clear.

## Discussion about the plan

If a message from the user is provided, it is a question or an adjustment request about the previous plan, not a new request:
- answer it first in reply: 2 to 6 concrete sentences, based on what you saw in the code (check if needed, without re-exploring everything);
- then return the plan: identical to the previous plan if the message asks for no change, otherwise the previous plan with only the requested adjustments. Don't redo it from scratch.
For a first plan, reply is null.

Write all text fields of your output in {lang.app} (keep technical terms in English).

Return the plan via StructuredOutput.
