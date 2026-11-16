---
name: Corriger les remarques acceptées de l’auto-review
group: Ma PR
when: Worktree › Fichiers › Corriger les remarques acceptées
vars: [findings, context, review, scope, rules, lang.app]
permissionMode: acceptEdits
allowedTools: [Read, Grep, Glob, WebSearch, WebFetch, Edit, Write, TodoWrite, Bash(git diff *), Bash(git status *), Bash(git log *), Bash(npm run *), Bash(npm install*), Bash(npm i *), Bash(npm ci*), Bash(npm uninstall *), Bash(npm ls*), Bash(npm -v), Bash(pnpm *), Bash(bun *), Bash(bunx *), Bash(npx *), Bash(yarn *)]
disallowedTools: [Bash(git commit *), Bash(git push *), Bash(git add *), Bash(git reset *), Bash(git stash *), Bash(git checkout *), Bash(git restore *), Bash(git clean *)]
---

The user reviewed the self-review of their PR and accepted the findings below. Fix all of them, in the current directory. Start by creating one TodoWrite task per finding (one per id, in order), and mark each task completed as soon as its finding is handled (fixed, already fixed, or impossible): The user follows progress live.

{findings}

## The branch these findings are about

Other agents and the user built this branch before you: the ticket, the commits, the fixes already applied (tests, review comments, free changes). Your fixes must fit into that work, not undo it.

{context}

{review}

## Scope: this PR and nothing else

The files the branch changes, and the only ones you may modify:

{scope}

- Inside these files, only touch the code the branch wrote or changed (`git diff` against the base shows it). Existing code around it stays as it is, even if it breaks a rule or could be better: it is not this PR's business.
- Do not modify a file outside this list. Do not create a file either, unless the finding explicitly asks for one (a missing test, a component to split): then say so in summary.
- A finding whose fix needs more than that is out of scope: changing a file the branch does not touch, or changing the signature or the behavior of existing code that other features use (a shared hook, a util, an API route, a schema used elsewhere). Decline it (status `declined`, reason "out of the PR's scope: would change <what>, used by <where>"). Do not fix it "properly" by widening the change, and do not adapt other features to make it fit.
- The only exception: a real bug that the branch introduces and that cannot be fixed inside its own code. Then touch the strict minimum and name each outside file in summary.

## Before fixing

1. Read the context above, then `git log --oneline -15` and `git diff` (uncommitted work in progress): you need to know what was done recently and why before touching it.
2. For each finding, read the file and what depends on the spot (callers, types, tests, the other side of an API contract). The indicated line may have moved.
3. Judge the finding before applying it. A finding is a reviewer's opinion on a diff, written without the history: it can be wrong. Decline it (status `declined`, nothing changed for it) when:
   - it is out of scope (see above);
   - the fix would undo or contradict something the branch does on purpose (a ticket requirement, a decision visible in a commit message or in the work history above, a fix made after a test or a review comment);
   - the fix would break a behavior that callers or tests rely on, and the finding does not account for it;
   - the problem it describes does not exist once you read the code.
   Say precisely why in summary (what it contradicts, with the file or commit), so the user can settle it. When the finding is right but its proposed fix is not the right one for this code, fix the problem your way and say what you did differently.
   Do not decline out of caution: a finding that is correct and safe gets fixed.

## Rules

- Fix each finding at its root, without refactoring around it or touching anything not listed. Adapt the fix to the code as it is now (naming, helpers, patterns already used by the branch).
- Smallest change that fixes it. Every line you add will be reviewed again: no new helper, abstraction, constant table or test unless the finding asks for exactly that, and no "while I am here" cleanup. When the fix asked for is itself an over-engineering for the problem described (a new abstraction for a two-line duplication), do the simple version and say so.
- A fix changes a behavior used elsewhere in the branch (another screen, the API, a test): adapt those places too, so the whole stays consistent.
- Two findings that touch the same spot: handle them together, consistently.
- The code you write follows the team dev rules below, like any other code of the PR. Surgical does not mean dirty: a fix that satisfies the finding but breaks one of these rules is not acceptable. If the fix you were given cannot be applied without breaking one, apply the clean variant and say so in summary; if there is none, leave that finding unfixed and explain why.
- If a fix touches a shared export, update its usages.
- A finding already fixed in the code: change nothing, status already.
- At the end, run the project's lint and typecheck once on the touched files, and fix what you broke.
- Do not commit or push: Shipyard makes a single commit for the whole set.

### Team dev rules

{rules}

StructuredOutput:
- commitTitle: a single commit title in English for the whole set, conventional commits format (`fix(<scope>): <description>` or `refactor(<scope>): <description>`), title only, no mention of AI.
- items: one per finding, with the id copied as is:
  - status: fixed (fixed now), already (already fixed in the code), declined (you chose not to apply it, see "Before fixing"), failed (you tried and could not: say why in summary);
  - summary: what was done, in one sentence; for declined, the reason, with what the fix would have contradicted or broken.

Write all text fields of your output in {lang.app} (keep technical terms in English), except commitTitle.
