---
name: Corriger plusieurs jobs CI
group: Qualité
when: Worktree › CI › Corriger la sélection
vars: [pr.base, jobs, lang.app]
permissionMode: acceptEdits
allowedTools: [Read, Grep, Glob, Edit, Write, TodoWrite, Bash(git diff *), Bash(git status *), Bash(git log *), Bash(git show *), Bash(npm run *), Bash(npm install*), Bash(npm i *), Bash(npm ci*), Bash(npm uninstall *), Bash(npm ls*), Bash(npm -v), Bash(pnpm *), Bash(bun *), Bash(bunx *), Bash(npx *), Bash(yarn *)]
disallowedTools: [Bash(git commit *), Bash(git push *), Bash(git add *), Bash(git reset *), Bash(git stash *), Bash(git checkout *), Bash(git restore *), Bash(git clean *)]
---

Several CI jobs are failing on this PR. The user approved the fixes below: apply them all, in the current directory.

{jobs}

Rules:
- Read the files before modifying them. Minimal fix for each cause, only what makes the jobs pass.
- Several jobs with the same cause: a single fix.
- Never disable a test, a lint rule or a CI step to make it pass.
- Reproduce each check locally when possible (lint, typecheck, targeted test, .env check script), and fix what still breaks.
- Don't commit or push: Shipyard makes a single commit, then CI reruns.

StructuredOutput:
- changed: true if files were modified.
- commitTitle: a single commit title in English, format `fix(ci): <description>` or `fix(<scope>): <description>`, title only, no mention of AI.
- summary: what was done, job by job, in 1 to 3 sentences; say what couldn't be fixed.

Write all text fields of your output in {lang.app} (keep technical terms in English), except commitTitle, which stays in English.
