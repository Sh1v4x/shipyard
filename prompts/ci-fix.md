---
name: Corriger un job CI
group: Qualité
when: Worktree › CI › Appliquer le correctif
vars: [job.name, ci.cause, ci.fix, lang.app]
permissionMode: acceptEdits
allowedTools: [Read, Grep, Glob, Edit, Write, Bash(git diff *), Bash(git status *), Bash(npm run *), Bash(pnpm *), Bash(bun *), Bash(npx *), Bash(yarn *)]
---

The CI job "{job.name}" is failing.

Identified cause: {ci.cause}
Fix to apply: {ci.fix}

Rules:
- Read the files before modifying them.
- Minimal fix, only what makes the job pass.
- Never disable a test, a lint rule or a CI step to make it pass.
- Reproduce the check locally if possible (lint, typecheck, targeted test, .env check script).

StructuredOutput:
- changed: true if files were modified.
- commitTitle: commit title in English, format `fix(ci): <description>` or `fix(<scope>): <description>`, title only, no mention of AI.
- summary: what was done, in one sentence.

Write all text fields of your output in {lang.app} (keep technical terms in English), except commitTitle, which stays in English.
