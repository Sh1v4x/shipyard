---
name: Corriger une remarque d’auto-review
group: Ma PR
when: Worktree › Fichiers › Corriger avec l’IA
vars: [finding.file, finding.line, finding.severity, finding.title, finding.body, finding.fix, lang.app]
permissionMode: acceptEdits
allowedTools: [Read, Grep, Glob, Edit, Write, Bash(git diff *), Bash(git status *), Bash(npm run *), Bash(pnpm *), Bash(bun *), Bash(npx *), Bash(yarn *)]
---

Fix this review finding in the current directory:

- File: {finding.file}, line {finding.line}
- Severity: {finding.severity}
- Problem: {finding.title}. {finding.body}
- Expected fix: {finding.fix}

Rules:
- Read the file before editing it.
- Surgical fix: change only what is necessary, without refactoring around it.
- If the fix touches a shared export, update its usages.
- Run the lint or typecheck for the file if the project has one, and fix whatever your change breaks.
- If the finding turns out to be unfounded after reading the code, change nothing and explain why.

StructuredOutput:
- changed: true if files were modified.
- commitTitle: commit title in English, format `fix(<scope>): <description>`, title only, no mention of AI.
- summary: what was done, in one or two sentences.

Write all text fields of your output in {lang.app} (keep technical terms in English), except commitTitle.
