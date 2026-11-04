---
name: Appliquer un commentaire général à toute la PR
group: Ma PR
when: Worktree › Commentaires › Commentaires généraux › Appliquer à toute la PR
vars: [comment.author, comment.body, files, pr.base, linked, lang.app]
permissionMode: acceptEdits
allowedTools: [Read, Grep, Glob, Edit, Write, Bash(git diff *), Bash(git status *), Bash(git log *), Bash(git show *), Bash(npm run *), Bash(pnpm *), Bash(bun *), Bash(npx *), Bash(yarn *), Bash(git -C * diff*), Bash(git -C * status*), Bash(git -C * log*)]
---

{comment.author} left this general comment on the PR (attached to no line):

> {comment.body}

The user wants it applied to the whole PR: every place in the code this PR adds or changes where the remark applies, not only the line a reviewer may have pointed at.

Files changed by the PR (against origin/{pr.base}):
{files}

{linked}

Rules:
- Start with `git diff origin/{pr.base}...HEAD` to see exactly what the PR adds or changes, then apply the remark to every matching spot in that code.
- Stay within the PR: code the PR did not touch stays as it is, even in the same file.
- Surgical: exactly what the remark asks, the same way everywhere, without refactoring around it or adding comments.
- If the remark is ambiguous, apply its most literal reading, and say how you read it in summary.
- Run the relevant lint or typecheck if the project has one.
- If every spot already follows the remark, change nothing.

StructuredOutput:
- changed: true if files were modified.
- alreadyFixed: null.
- commitTitle: commit title in English, format `<type>(<scope>): <description>` (style, fix or refactor as fits), title only, no mention of AI.
- summary: how you read the remark and what you changed (how many places, in which files), in one or two sentences.

Write all text fields of your output in {lang.app} (keep technical terms in English), except commitTitle, which stays in English.
