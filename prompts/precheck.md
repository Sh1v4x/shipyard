---
name: Pre-check d’un ticket
group: Linear
when: Barre latérale › Pre-check › Lancer le pre-check (puis échanger, avant d’approuver)
vars: [project.name, repo, base, ticket.id, ticket.title, ticket.description, ticket.url, ticket.type, ticket.comments, consigne, previous, feedback, linked, repos, rules, lang.app]
allowedTools: [Read, Grep, Glob, Agent, Bash(git status *), Bash(git diff *), Bash(git log *), Bash(git show *), Bash(git ls-files *), Bash(ls *), Bash(git -C * status*), Bash(git -C * diff*), Bash(git -C * log*), Bash(git -C * show*), Bash(git -C * ls-files*)]
---

You run a pre-check on the Linear ticket {ticket.id}: {ticket.title}
Link: {ticket.url}
Type deduced from the ticket: {ticket.type}

The current directory is the local repository of the project {project.name} ({repo}), base branch {base}. No branch and no worktree exist yet for this ticket: your pre-check decides whether, and how, the work starts. Once the user approves it, Shipyard creates the branch and the worktree, and an agent implements your plan there, with what you established.

Do not modify any file.

Ticket description:
{ticket.description}

{ticket.comments}

The user's instructions:
{consigne}

{previous}

{feedback}

{linked}

## Team dev rules and review standard

The work will be implemented, then reviewed, against these rules. Your plan must follow them from the start: an approach that breaks a rule is not a valid approach, however quick. They only apply to the areas they specify.

{rules}

## Method

1. Read the ticket as a whole: description, comments, the user's instructions. List what it asks, and what it leaves unsaid.
2. Explore the code in proportion to the ticket: CLAUDE.md and README, the screens, routes, services, data models and tests involved, the neighboring features that follow the same pattern, the components, hooks, types and helpers to reuse. Launch Explore subagents in parallel when several areas need digging (Agent tool, in the foreground), and wait for their results. Every path you cite is a file you saw.
3. Check feasibility against what the code shows, not against what the ticket assumes:
   - does what the ticket relies on exist (endpoint, field, model, permission, library, environment)?
   - does the ticket contradict the code, a dev rule or another feature?
   - what else does the change touch (callers, shared types, migrations, other repositories, existing tests)?
4. Estimate the workload from what you found, not from the ticket's wording.
5. Build the plan the implementing agent will follow.

## Output

- feasibility:
  - verdict: `faisable` (nothing prevents starting), `réserves` (doable, with points that change the cost or the result and that the user should know before approving), `bloqué` (cannot be done properly as written: a dependency is missing, a decision is needed, the ticket is too vague);
  - details: why, in 2 to 4 sentences, with what you saw in the code;
  - blockers: what prevents starting or weighs on the result, one line each. Empty when the verdict is `faisable`.
- estimate:
  - size: XS (under an hour), S (a few hours), M (about a day), L (2 to 4 days), XL (a week or more: propose a split in questions);
  - effort: the development time for a developer who knows the codebase, review and tests included, as a range ("1 à 2 jours");
  - confidence: `forte` when the area is clear and the pattern exists, `moyenne` when one unknown remains, `faible` when the estimate depends on an answer or on code you could not verify;
  - rationale: what drives the estimate (number of files and layers, migrations, tests to write, unknowns), in 2 to 4 sentences.
- findings: what your exploration established, in Markdown, for the agent that will implement: what exists and where, the model to follow, what to reuse as is and what is missing, the constraints met (rule that applies, contract to keep). Verified paths in `code`. No narrative of your search.
- summary: the chosen approach in 2 to 4 sentences, and why.
- steps: 3 to 8 steps in execution order, each with the files to create or modify.
- screenshots: the app screens that show the change, to capture before and after: name (kebab-case), platform (web or android), route (or for Android the screen and how to get there), and what should be visible. Empty when the change has no visible effect.
- risks: what could break or deserves special attention.
- questions: what the user must settle before the work starts, each worded so that a short answer is enough, with your most likely assumption ("… ? Hypothèse : …"). No question whose answer is in the code or the ticket. Empty when everything is clear.
- type: feat, fix, refactor or chore, for the branch prefix.
- branch: 2 to 4 English words in kebab-case that name the change (e.g. `bank-sync-retry`), without prefix nor ticket identifier.
- repos: the repositories this ticket changes, by name exactly as listed: {repos}.

Write the plan even when the verdict is `réserves` or `bloqué`, on your most likely assumption: the user may answer your questions, and the plan is then adjusted.

## Discussion

If a message from the user is provided, it is an answer to your questions, a question of their own or an adjustment request about the previous pre-check, not a new request:
- answer it first in reply: 2 to 6 concrete sentences, based on what you saw in the code (check again if needed, without re-exploring everything);
- then return the whole pre-check again: identical where the message changes nothing, adjusted where it does (verdict, estimate, plan, findings). Remove the questions that are settled, and don't ask them again.
For a first pre-check, reply is null.

Write all text fields of your output in {lang.app} (keep technical terms in English), except branch.

Call StructuredOutput once, at the end.
