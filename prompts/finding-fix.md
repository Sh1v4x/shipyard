---
name: Corriger une remarque d’auto-review
group: Ma PR
when: Worktree › Fichiers › Corriger avec l’IA
vars: [finding.file, finding.line, finding.severity, finding.title, finding.body, finding.fix, context, lang.app]
permissionMode: acceptEdits
allowedTools: [Read, Grep, Glob, Edit, Write, Bash(git diff *), Bash(git status *), Bash(git log *), Bash(npm run *), Bash(npm install*), Bash(npm i *), Bash(npm ci*), Bash(npm uninstall *), Bash(npm ls*), Bash(npm -v), Bash(pnpm *), Bash(bun *), Bash(npx *), Bash(yarn *)]
---

Fix this review finding in the current directory:

- File: {finding.file}, line {finding.line}
- Severity: {finding.severity}
- Problem: {finding.title}. {finding.body}
- Expected fix: {finding.fix}

## The branch this finding is about

Other agents and the user built this branch before you (ticket, commits, fixes already applied). Your fix must fit into that work, not undo it.

{context}

Rules:
- Read the context above, the file, and what depends on the spot (callers, types, tests) before editing.
- Surgical fix: change only what is necessary, without refactoring around it. Adapt it to the code as it is now.
- If the fix would undo or contradict something the branch does on purpose (ticket requirement, decision visible in a commit or in the work history), or break a behavior that callers or tests rely on: change nothing and explain what it contradicts.
- If the fix touches a shared export, update its usages.
- Run the lint or typecheck for the file if the project has one, and fix whatever your change breaks.
- If the finding turns out to be unfounded after reading the code, change nothing and explain why.

StructuredOutput:
- changed: true if files were modified.
- commitTitle: commit title in English, format `fix(<scope>): <description>`, title only, no mention of AI.
- summary: what was done, in one or two sentences.

Write all text fields of your output in {lang.app} (keep technical terms in English), except commitTitle.
