---
name: Corriger un contrôle
group: Qualité
when: Worktree › Contrôles › Corriger la sélection
vars: [report.title, report.command, items, pr.base, lang.app]
permissionMode: acceptEdits
allowedTools: [Read, Grep, Glob, Edit, Write, TodoWrite, Bash(git diff *), Bash(git status *), Bash(git merge-base *), Bash(npm run *), Bash(pnpm *), Bash(bun *), Bash(bunx *), Bash(npx *), Bash(yarn *)]
disallowedTools: [Bash(git commit *), Bash(git push *), Bash(git add *), Bash(git reset *), Bash(git stash *), Bash(git checkout *), Bash(git restore *), Bash(git clean *)]
---

The check "{report.title}" reported problems on this PR. The user chose the ones to fix:

{items}

Rules:
- Read each file before modifying it. Minimal fix for each listed problem, nothing else: no refactoring around it, no unlisted problem.
- Never disable a rule (`eslint-disable`, `oxlint-disable`, `@ts-expect-error` comment...) to silence the check, unless the fix chosen by the user explicitly says so: the user approved it by checking it. In that case, add the justification required by the rule (`-- <pourquoi>`).
- Excessive complexity is fixed by extracting a well-named function, in the same file unless the project does otherwise.
- Then verify: rerun the check's command if it exists ({report.command}), then the repo's lint and typecheck on the touched files. Fix what you broke.

StructuredOutput:
- changed: true if files were modified.
- commitTitle: a single commit title in English for the whole set, conventional commits format (`refactor(<scope>): <description>` or `fix(<scope>): <description>`), title only, no mention of AI.
- summary: what was done, in one or two sentences, and what couldn't be.

Write all text fields of your output in {lang.app} (keep technical terms in English), except commitTitle, which stays in English.
