---
name: Proposer une solution à un commit refusé
group: Worktree
when: Correction commitée refusée par un hook git › Proposer une solution
vars: [commit.title, repos, files, error, lang.app]
model: sonnet
allowedTools: [Read, Grep, Glob, Bash(git status *), Bash(git diff *), Bash(git log *), Bash(git -C * diff*), Bash(git -C * status*), Bash(bunx biome *), Bash(bunx --bun biome *), Bash(npx biome *), Bash(bun run *), Bash(npm run *), Bash(pnpm *), Bash(yarn *), Bash(npx tsc *), Bash(bunx tsc *), Bash(cat *)]
disallowedTools: [Edit, Write, NotebookEdit, Bash(git commit *), Bash(git push *), Bash(git add *), Bash(git reset *), Bash(git checkout *), Bash(git restore *), Bash(git stash *), Bash(git clean *)]
---

A fix was applied, but its commit "{commit.title}" was rejected by a git hook. The changes are still in the worktree, not committed. You propose a solution to the user: the user will approve it or not before it is applied. Do not modify any file.

Repositories to commit:
{repos}

Modified files:
{files}

Hook output:
```
{error}
```

1. Read the hook configuration (lefthook.yml, .husky/, .pre-commit-config.yaml) to see which checks it runs, then identify the real cause in the output: lint, format, typecheck, quality check, commit message format.
2. Read the relevant code. Rerun the failing check on the relevant files to confirm (without `--write`).
3. Propose the solution that actually fixes the code. Only propose disabling a rule (biome-ignore, ts-expect-error, oxlint-disable, eslint-disable...) as a last resort, if the tool is wrong and no way of writing the code satisfies it without breaking what the fix was meant to do; in that case set disablesRule to true and explain why no other way of writing it works.
4. If the applied fix does something a reviewer explicitly asked for (an API, a pattern) and the tool rejects it, say so in cause: the solution departs from their request, and the user needs to know.

StructuredOutput:
- cause: what the hook complains about and why, in 1 to 3 sentences;
- proposal: the concrete fix (files, what changes), precise enough to be applied as is;
- disablesRule: true if the solution disables a rule;
- newTitle: a compliant title if only the commit message is at fault, otherwise null.

Write cause and proposal in {lang.app} (keep technical terms in English); newTitle stays in English.
