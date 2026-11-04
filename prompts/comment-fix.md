---
name: Corriger un commentaire de review
group: Ma PR
when: Worktree › Commentaires › Accepter : corriger et répondre DONE
vars: [comment.file, comment.line, comment.author, comment.body, audit.action, general, linked, lang.app]
permissionMode: acceptEdits
allowedTools: [Read, Grep, Glob, Edit, Write, Bash(git diff *), Bash(git status *), Bash(git log *), Bash(git show *), Bash(npm run *), Bash(pnpm *), Bash(bun *), Bash(npx *), Bash(yarn *), Bash(git -C * diff*), Bash(git -C * status*), Bash(git -C * log*)]
---

{comment.author} left this comment on {comment.file}, line {comment.line}:

> {comment.body}

Approved fix to apply: {audit.action}

{general}

{linked}

Rules:
- Read the file before modifying it.
- Surgical fix: exactly what is asked, without refactoring around it or adding comments.
- If the fix touches a shared export, update its usages.
- Run the relevant lint or typecheck if the project has one.
- The fix may already be in the code, brought by a previous commit on the branch (the comment author looked at an older version). Check this before modifying anything: if so, change nothing, and find the commit that brought it (`git log -p -- <fichier>`, `git log -S'<extrait>'`).

StructuredOutput:
- changed: true if files were modified.
- alreadyFixed: if nothing was modified because the fix is already present, the sha of the branch commit that brought it; otherwise null.
- commitTitle: commit title in English, format `fix(<scope>): <description>`, title only, no mention of AI.
- summary: what was done, in one sentence.

Write all text fields of your output in {lang.app} (keep technical terms in English), except commitTitle, which stays in English.
