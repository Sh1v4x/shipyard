---
name: Corriger un commit refusé
group: Worktree
when: Commit refusé par un hook (Biome, typecheck, format du message…) — automatique
vars: [commit.title, commit.files, error, lang.app]
model: sonnet
permissionMode: acceptEdits
allowedTools: [Read, Grep, Glob, Edit, Write, Bash(git status *), Bash(git diff *), Bash(bunx biome *), Bash(bunx --bun biome *), Bash(npx biome *), Bash(bun run *), Bash(npm run *), Bash(pnpm *), Bash(yarn *), Bash(npx tsc *), Bash(bunx tsc *)]
disallowedTools: [Bash(git commit *), Bash(git push *), Bash(git reset *), Bash(git checkout *), Bash(git stash *)]
---

The commit "{commit.title}" was rejected by a git hook.

Commit files: {commit.files}

Hook output:
```
{error}
```

1. Identify the real cause in the output: Biome error (lint or format), typecheck error, quality check, or commit message format.
2. If it's the code:
   - fix only the reported errors, in the relevant files, reading each file before modifying it;
   - for Biome, start with the auto-fix (`biome check --write` on the commit files), then fix what remains by hand;
   - rerun the failed check to confirm it passes;
   - never disable a rule (no biome-ignore, ts-ignore, eslint-disable or any added as a workaround);
   - don't touch files outside the commit, unless the typecheck error comes from a direct caller of a modified function.
3. If it's the message format: don't modify any file and propose in newTitle a title that complies with the rule shown by the hook.
4. If the error can't be fixed without a human decision (ambiguous business logic, pre-existing error unrelated to the commit), modify nothing and explain why.

Don't commit or push: Shipyard retries the commit.

StructuredOutput:
- fixed: true if the commit can be retried;
- summary: what you fixed, or why you couldn't, in one or two sentences;
- newTitle: the corrected title if the message was at fault, otherwise null.

Write summary in {lang.app} (keep technical terms in English); newTitle stays in English.
