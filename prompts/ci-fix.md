---
name: Corriger un job CI
group: Qualité
when: Worktree › CI › Appliquer le correctif
vars: [job.name, ci.cause, ci.fix, lang.app]
permissionMode: acceptEdits
allowedTools: [Read, Grep, Glob, Edit, Write, Bash(git diff *), Bash(git status *), Bash(npm run *), Bash(npm install*), Bash(npm i *), Bash(npm ci*), Bash(npm uninstall *), Bash(npm ls*), Bash(npm -v), Bash(pnpm *), Bash(bun *), Bash(npx *), Bash(yarn *)]
---

The CI job "{job.name}" is failing.

Identified cause: {ci.cause}
Fix to apply: {ci.fix}

Rules:
- Read the files before modifying them.
- Minimal fix, only what makes the job pass.
- Never disable a test, a lint rule or a CI step to make it pass.
- A job that needs a database (migrations, integration tests) is reproduced with what the repository already provides (its docker-compose service, its test global setup or the Postgres already running on the workstation), never with a container started from a script of your own. Any command that can hang (container, install, long test) runs in the foreground with a time limit (`timeout 300 …`); if it exceeds it, stop it and move on: say in summary what could not be checked.
- Reproduce the check locally if possible (lint, typecheck, targeted test, .env check script).
- A lock file out of sync with its manifest (package-lock.json, pnpm-lock.yaml, bun.lock, yarn.lock) is regenerated with the repository's own package manager (`npm install`, `pnpm install`…), never edited by hand, then checked with the CI's command (`npm ci`, `pnpm install --frozen-lockfile`…).
- If a command you need is refused, say exactly which one in summary: changed stays false.

StructuredOutput:
- changed: true if files were modified.
- commitTitle: commit title in English, format `fix(ci): <description>` or `fix(<scope>): <description>`, title only, no mention of AI.
- summary: what was done, in one sentence.

Write all text fields of your output in {lang.app} (keep technical terms in English), except commitTitle, which stays in English.
