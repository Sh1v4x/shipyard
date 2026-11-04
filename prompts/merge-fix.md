---
name: Corriger une fusion refusée
group: Ma PR
when: Worktree › Conflits › Valider et pousser refusé par un hook › Corriger avec l’IA et pousser
vars: [worktree.path, worktree.branch, base, error, rules, lang.app]
model: sonnet
permissionMode: acceptEdits
allowedTools: [Read, Grep, Glob, Edit, Write, Bash(git status *), Bash(git diff *), Bash(git log *), Bash(git show *), Bash(bunx biome *), Bash(bunx --bun biome *), Bash(npx biome *), Bash(bun run *), Bash(bun x *), Bash(bunx *), Bash(npm run *), Bash(npm install*), Bash(npm i *), Bash(npm ci*), Bash(npm uninstall *), Bash(npm ls*), Bash(npm -v), Bash(npx *), Bash(pnpm *), Bash(yarn *)]
disallowedTools: [Bash(git commit *), Bash(git push *), Bash(git merge *), Bash(git reset *), Bash(git checkout *), Bash(git restore *), Bash(git stash *), Bash(git clean *), Bash(git rm *)]
---

In the worktree {worktree.path} (branch {worktree.branch}), the merge of `origin/{base}` is in progress: all conflicts are resolved, but the pre-commit hook rejects the merge commit.

Hook output (the end is the most useful part):
```
{error}
```

## Method

1. Identify each real error in the output: typecheck, Biome (lint or format), tests, quality check.
2. Find its cause, often one of these:
   - **semantic conflict between the two sides**: the base calls a function, hook, type or component that the branch modified (signature, name, renamed field), or the other way around. No file was in conflict for git, but the code no longer fits together. Read both versions (`git show origin/{base}:<file>`, `git show HEAD:<file>`) and fix it while keeping the intent of both sides: the branch keeps its behavior, the base keeps what it added (for example, make a parameter optional rather than removing a call);
   - **stale generated file** (Prisma client, route types, build cache): regenerate it with the project's script (e.g. `bun run generate` in the Prisma schema package) instead of editing it by hand;
   - **lint or format error** in the merged code: Biome auto-fix, then fix what remains by hand.
3. Fix only what makes the hook fail, reading each file before editing it, then rerun the check that was failing (for example `bun run check-types`) to confirm it passes.
4. Never disable a check (no ts-ignore, biome-ignore, eslint-disable or `any` added as a workaround), and follow the dev rules below.
5. If an error cannot be fixed without a human decision (ambiguous business logic, two incompatible behaviors), change nothing and explain why.

Do not commit, do not push, and do not touch the merge (no git merge, reset, checkout or restore): Shipyard reruns the merge commit after you.

## Team dev rules

{rules}

StructuredOutput:
- fixed: true if the merge commit can be retried;
- summary: what you fixed (file and reason), or why you could not, in one to three sentences;
- newTitle: always null.

Write summary in {lang.app} (keep technical terms in English).
