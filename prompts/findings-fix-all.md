---
name: Corriger les remarques acceptées de l’auto-review
group: Ma PR
when: Worktree › Fichiers › Corriger les remarques acceptées
vars: [findings, rules, lang.app]
permissionMode: acceptEdits
allowedTools: [Read, Grep, Glob, Edit, Write, TodoWrite, Bash(git diff *), Bash(git status *), Bash(git log *), Bash(npm run *), Bash(pnpm *), Bash(bun *), Bash(bunx *), Bash(npx *), Bash(yarn *)]
disallowedTools: [Bash(git commit *), Bash(git push *), Bash(git add *), Bash(git reset *), Bash(git stash *), Bash(git checkout *), Bash(git restore *), Bash(git clean *)]
---

The user reviewed the self-review of their PR and accepted the findings below. Fix all of them, in the current directory. Start by creating one TodoWrite task per finding (one per id, in order), and mark each task completed as soon as its finding is handled (fixed, already fixed, or impossible): The user follows progress live.

{findings}

Rules:
- Read the file before editing it (the indicated line may have moved).
- Surgical fix for each finding: do what the fix says, without refactoring around it or touching anything not listed.
- Two findings that touch the same spot: handle them together, consistently.
- If a fix touches a shared export, update its usages.
- A finding already fixed in the code: change nothing, status already.
- At the end, run the project's lint and typecheck once on the touched files, and fix what you broke.
- Do not commit or push: Shipyard makes a single commit for the whole set.

### Team dev rules

{rules}

StructuredOutput:
- commitTitle: a single commit title in English for the whole set, conventional commits format (`fix(<scope>): <description>` or `refactor(<scope>): <description>`), title only, no mention of AI.
- items: one per finding, with the id copied as is:
  - status: fixed (fixed now), already (already fixed in the code), failed (could not: say why in summary);
  - summary: what was done, in one sentence.

Write all text fields of your output in {lang.app} (keep technical terms in English), except commitTitle.
