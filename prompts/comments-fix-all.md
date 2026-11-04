---
name: Corriger tous les commentaires
group: Ma PR
when: Worktree › Commentaires › Tout accepter
vars: [comments, general, linked, lang.app]
permissionMode: acceptEdits
allowedTools: [Read, Grep, Glob, Edit, Write, TodoWrite, Bash(git diff *), Bash(git status *), Bash(git log *), Bash(git show *), Bash(npm run *), Bash(npm install*), Bash(npm i *), Bash(npm ci*), Bash(npm uninstall *), Bash(npm ls*), Bash(npm -v), Bash(pnpm *), Bash(bun *), Bash(npx *), Bash(yarn *), Bash(git -C * diff*), Bash(git -C * status*), Bash(git -C * log*)]
disallowedTools: [Bash(git commit *), Bash(git push *), Bash(git add *), Bash(git reset *), Bash(git stash *), Bash(git checkout *), Bash(git restore *), Bash(git clean *)]
---

The user approved the fixes below, on the review comments of their PR. Apply them all, one after the other, in this worktree. Start by creating with TodoWrite one task per comment (one per threadId, in order), and mark each task completed as soon as its comment is handled (fixed, already fixed or impossible): The user follows the progress live. If you just analyzed these comments, use what you already read: don't re-explore the code.

{comments}

{general}

{linked}

Rules:
- Read the file before modifying it (reread it if it changed since your analysis).
- Surgical fix for each comment: exactly what was approved, without refactoring around it or adding comments.
- If a fix touches a shared export, update its usages.
- Two fixes touching the same place: do them together, consistently.
- A fix may already be in the code, brought by a previous commit on the branch. Check this before modifying: if so, change nothing and find the commit (`git log -p -- <fichier>`, `git log -S'<extrait>'`).
- At the end, run the project's lint and typecheck once on the touched files, and fix what you broke.
- Don't commit or push: Shipyard makes a single commit for the whole set, then replies "DONE" on each fixed thread.

StructuredOutput:
- commitTitle: a single commit title in English for the whole set, format `fix(<scope>): <description>` (e.g. `fix(api): address review comments`), title only, no mention of AI.
- items: one per comment, with the threadId copied as is:
  - status: fixed (fixed now), already (already fixed by a branch commit, sha in alreadyFixed), failed (couldn't: say why in summary);
  - alreadyFixed: the sha if status is already, otherwise null;
  - summary: what was done, in one sentence.

Write all text fields of your output in {lang.app} (keep technical terms in English), except commitTitle, which stays in English.
