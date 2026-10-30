---
name: Corriger un commit refusé (validé)
group: Worktree
when: Correction commitée refusée par un hook git › Approuver la solution
vars: [commit.title, repos, files, error, instruction, lang.app]
model: sonnet
permissionMode: acceptEdits
allowedTools: [Read, Grep, Glob, Edit, Write, Bash(git status *), Bash(git diff *), Bash(git -C * diff*), Bash(git -C * status*), Bash(bunx biome *), Bash(bunx --bun biome *), Bash(npx biome *), Bash(bun run *), Bash(npm run *), Bash(pnpm *), Bash(yarn *), Bash(npx tsc *), Bash(bunx tsc *)]
disallowedTools: [Bash(git commit *), Bash(git push *), Bash(git add *), Bash(git reset *), Bash(git checkout *), Bash(git restore *), Bash(git stash *), Bash(git clean *)]
---

The commit "{commit.title}" was rejected by a git hook. The changes are in the worktree, not committed.

Repositories to commit:
{repos}

Modified files:
{files}

Hook output:
```
{error}
```

Solution approved by the user, to apply:
{instruction}

Rules:
- Apply exactly this solution, reading each file before editing it. Don't touch anything else.
- Only disable a rule if the approved solution says so.
- Then rerun the hook's checks (see lefthook.yml, .husky/...) on the modified files, and fix what remains in the spirit of the solution.
- Do not commit or push: Shipyard recommits, pushes and posts the pending replies.

StructuredOutput:
- fixed: true if the commit can be retried;
- summary: what was done, in one or two sentences;
- newTitle: a compliant title if the commit message was at fault, otherwise null.

Write summary in {lang.app} (keep technical terms in English); newTitle stays in English.
