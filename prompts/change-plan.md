---
name: Plan d’une modification libre
group: Worktree
when: Worktree › Ticket › Modification libre › Proposer un plan
vars: [worktree.path, worktree.branch, consigne, context, feedback, previous, linked, capture, lang.app]
model: sonnet
allowedTools: [Read, Grep, Glob, Agent, Bash(git status *), Bash(git diff *), Bash(git log *), Bash(git show *), Bash(ls *), Bash(git -C * status*), Bash(git -C * diff*), Bash(git -C * log*)]
---

The user wants to make a change in the worktree {worktree.path} (branch {worktree.branch}). This is not the ticket itself nor a review comment: it is a direct request, to be integrated cleanly into the work already done on the branch. The ticket and the work already done are described in "Branch origin" below: that is what the request is about.

## the user's request

{consigne}

## Branch state

{context}

{previous}
{feedback}

{linked}

{capture}

Do not modify any file. You propose a plan, which the user approves before the work starts.

## Method

1. Understand what the branch already does: start from the branch origin (ticket, work done in Shipyard), then read the commits (`git log -p` on the most useful ones), the PR description and the branch diff on the relevant files. The change must fit into this work: same approach, same names, same files when relevant, without rewriting what works.
2. Explore the code around the request: CLAUDE.md, existing patterns, components, hooks and types to reuse (Grep before proposing to create any). Launch an Explore sub-agent if the area is large.
3. Choose the simplest and safest way to meet the stated need. If the request is better done another way (a more suitable place, something existing to extend rather than a new file), propose it and explain why in summary.
4. Stay within the scope of the request. Don't use the plan to address open review comments or refactor something else, unless the request says so; flag them in risks if the change touches them.

## Plan

- summary: the chosen approach in 2 to 4 sentences, how it fits with what the branch already does, and why;
- steps: 1 to 6 steps in execution order, each with the files to create or modify;
- screenshots: the app screens that show the change, to capture before and after (platform web or android, route or Android screen, and what should be visible). Empty list if the change has no visible effect;
- risks: what could break in the branch's existing work, or deserves particular attention;
- questions: what is ambiguous in the request and the user must decide. Empty if everything is clear.

Write all text fields of your output in {lang.app} (keep technical terms in English).

## Discussion about the plan

If a message from the user is provided, it is a question or an adjustment request about the previous plan, not a new request:
- answer it first in reply: 2 to 6 concrete sentences, based on what you saw in the code (check if needed, without re-exploring everything);
- then return the plan: identical to the previous plan if the message asks for no change, otherwise the previous plan with only the requested adjustments. Don't redo it from scratch.
For a first plan, reply is null.

Return the plan via StructuredOutput.
